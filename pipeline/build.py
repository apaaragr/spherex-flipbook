"""SPHEREx time-lapse pipeline: sky position -> aligned, cleaned, per-pass stacks + measurements for the web viewer.

Usage:  python -m pipeline.build barnard [--fov 0.1] [--per-pass-detector 20]
Outputs web/data/<target>/: manifest.json, frame PNGs (one per pass x detector + an all-detector frame), diff PNG,
spectrum.json. Cutouts are cached under data/cache/<target>/ so re-runs never hit the archive again.
"""
import argparse, concurrent.futures as cf, json, logging, os, time, urllib.parse, urllib.request, warnings
from pathlib import Path

import numpy as np
import astropy.units as u
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from astropy.coordinates import SkyCoord, Distance
from astropy.io import fits
from astropy.table import Table
from astropy.time import Time
from astropy.wcs import WCS
from reproject import reproject_interp

warnings.filterwarnings("ignore")
logging.getLogger("astropy").setLevel(logging.ERROR)

ROOT = Path(__file__).resolve().parent.parent
IRSA = "https://irsa.ipac.caltech.edu/"
PIX = 6.15  # SPHEREx pixel scale, arcsec
# Explanatory Supplement v2.0 Table 16 (see FLAGS.md). SOURCE (21) and the ghost/bloom bits are informational.
BAD_BITS = [0, 1, 2, 6, 9, 10, 11, 14, 15, 17, 19, 25]
BAD_MASK = sum(1 << b for b in BAD_BITS)
SAT_MASK = (1 << 1) | (1 << 2)  # OVERFLOW | SUR_ERROR -> saturated core
PASS_GAP_DAYS = 20
# Inventories the background retry job saves under other names
RETRY_NAMES = {"wise0855": "WISE0855", "epsindb": "EpsIndB", "rwaur": "RWAur", "rdra": "RDra"}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


# ---------- target + reference motion ----------
def reference(t):
    epoch = Time(t["epoch_mjd"], format="mjd") if "epoch_mjd" in t else Time(t["epoch_jyear"], format="jyear")
    kw = {"distance": Distance(parallax=t["parallax"] * u.mas)} if t.get("parallax", 0) > 0 else {}
    return SkyCoord(ra=t["ra"] * u.deg, dec=t["dec"] * u.deg, pm_ra_cosdec=t["pmra"] * u.mas / u.yr,
                    pm_dec=t["pmdec"] * u.mas / u.yr, obstime=epoch, **kw)


def position_at(ref, mjd):
    return ref.apply_space_motion(Time(mjd, format="mjd"))


# ---------- step 1: image list ----------
def inventory(key, centre):
    for p in [ROOT / f"data/inventory/{key}.csv", ROOT / f"out/{RETRY_NAMES.get(key, key)}_inventory.csv"]:
        if p.exists() and p.stat().st_size > 0:
            log(f"image list: {p.relative_to(ROOT)}")
            return Table.read(p, format="csv")
    q = (f"SELECT a.uri, p.time_bounds_lower, p.energy_bandpassname FROM spherex.artifact a "
         f"JOIN spherex.plane p ON a.planeid = p.planeid WHERE 1 = CONTAINS(POINT('ICRS', {centre.ra.deg}, "
         f"{centre.dec.deg}), p.poly) ORDER BY p.time_bounds_lower")
    url = IRSA + "TAP/sync?" + urllib.parse.urlencode({"LANG": "ADQL", "FORMAT": "csv", "QUERY": q})
    log("image list: querying IRSA TAP (180 s timeout)")
    with urllib.request.urlopen(url, timeout=180) as r:
        body = r.read()
    out = ROOT / f"data/inventory/{key}.csv"
    out.write_bytes(body)
    return Table.read(out, format="csv")


def group_passes(mjd):
    order = np.argsort(mjd)
    return [order[g] for g in np.split(np.arange(len(mjd)), np.where(np.diff(mjd[order]) > PASS_GAP_DAYS)[0] + 1)]


# ---------- step 2: cached cutout download ----------
def fetch(uri, centre, size, cache_dir):
    path = cache_dir / (Path(str(uri)).name.replace(".fits", "") + f"_{size:.3f}.fits")
    if path.exists():
        return path
    url = f"{IRSA}{uri}?center={centre.ra.deg},{centre.dec.deg}d&size={size}"
    for attempt in range(5):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                data = r.read()
            tmp = path.with_suffix(".part")
            tmp.write_bytes(data)
            os.replace(tmp, path)
            return path
        except Exception:
            time.sleep(5 * (attempt + 1))
    return None


# ---------- steps 3-4: clean + align one image; photometry on its native pixels ----------
def process(path, grid_hdr, target):
    with fits.open(path) as h:
        img = h["IMAGE"].data.astype(float) - h["ZODI"].data
        flags = h["FLAGS"].data.astype(np.int64)
        w = WCS(h["IMAGE"].header)
        swcs = WCS(h["IMAGE"].header, fobj=h, key="W")
        swcs.sip = None
        date = h["IMAGE"].header.get("DATE-OBS", "")
        version = h[0].header.get("VERSION", "")
    bad = (flags & BAD_MASK) != 0
    clean = np.where(bad, np.nan, img)
    aligned = reproject_interp((clean, w), grid_hdr)[0]
    unmasked = reproject_interp((img, w), grid_hdr)[0]
    sat = reproject_interp((((flags & SAT_MASK) != 0).astype(float), w), grid_hdr, order="nearest-neighbor")[0]
    # aperture photometry at the target's predicted native pixel (r=2 px, sky annulus 4-7 px)
    x, y = (float(v) for v in w.world_to_pixel(target))
    phot = None
    if 7 <= x < img.shape[1] - 7 and 7 <= y < img.shape[0] - 7:
        yy, xx = np.mgrid[:img.shape[0], :img.shape[1]]
        r = np.hypot(xx - x, yy - y)
        ap, ann = r <= 2, (r >= 4) & (r <= 7)
        sky = np.nanmedian(img[ann])
        xi, yi = int(round(x)), int(round(y))
        wl, bw = swcs.pixel_to_world(x, y)
        phot = {"flux": float(np.nansum(img[ap] - sky)), "wavelength_um": float(wl.to(u.micron).value),
                "flag_bits": [b for b in range(32) if (int(flags[yi, xi]) >> b) & 1],
                "saturated": bool(flags[yi, xi] & SAT_MASK), "n_nan_in_aperture": int(np.isnan(img[ap]).sum())}
    return {"aligned": aligned, "unmasked": unmasked, "sat": sat, "phot": phot, "date": date, "version": version}


# ---------- step 6 helpers ----------
def centroid(img, x0, y0, box=2, search=3):
    xi, yi = int(round(x0)), int(round(y0))
    s = img[yi - search:yi + search + 1, xi - search:xi + search + 1]
    if s.size == 0 or not np.isfinite(s).any():
        return None
    dy, dx = np.unravel_index(np.nanargmax(s), s.shape)
    xi, yi = xi - search + dx, yi - search + dy
    sub = np.clip(np.nan_to_num(img[yi - box:yi + box + 1, xi - box:xi + box + 1] - np.nanmedian(img)), 0, None)
    if sub.sum() <= 0:
        return None
    yy, xx = np.mgrid[-box:box + 1, -box:box + 1]
    return float((sub * xx).sum() / sub.sum() + xi), float((sub * yy).sum() / sub.sum() + yi)


def field_stars(img, avoid, n=8, edge=5):
    s = np.nan_to_num(img.copy())
    N = s.shape[0]
    out = []
    for _ in range(80):
        y, x = np.unravel_index(np.argmax(s), s.shape)
        s[max(0, y - 3):y + 4, max(0, x - 3):x + 4] = 0
        if edge < x < N - edge - 1 and edge < y < N - edge - 1 and np.hypot(x - avoid[0], y - avoid[1]) > 6:
            out.append((x, y))
        if len(out) == n:
            break
    return out


def robust_z(a):
    med = np.nanmedian(a)
    mad = 1.4826 * np.nanmedian(np.abs(a - med))
    return (a - med) / (mad if mad > 0 else 1)


# ---------- step 7: rendering ----------
def save_png(arr, path, vmin, vmax, cover, cmap="gray", asinh=True):
    a = np.clip((arr - vmin) / (vmax - vmin), 0, 1)
    if asinh:
        a = np.arcsinh(a * 10) / np.arcsinh(10)
    a = np.where(np.isfinite(arr), a, 1.0)  # covered but unrecoverable (saturated core) -> brightest
    rgba = plt.get_cmap(cmap)(a)
    rgba[..., 3] = cover.astype(float)       # never observed -> transparent (viewer shows hatching)
    plt.imsave(path, rgba, origin="lower")


def save_diff(arr, path):
    lim = np.nanpercentile(np.abs(arr), 99.7) or 1
    plt.imsave(path, np.nan_to_num(arr), cmap="RdBu_r", vmin=-lim, vmax=lim, origin="lower")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("target", nargs="?", help="key in pipeline/targets.json (omit when using --ra/--dec)")
    ap.add_argument("--ra", type=float, help="any position: right ascension, degrees")
    ap.add_argument("--dec", type=float, help="any position: declination, degrees")
    ap.add_argument("--fov", type=float, default=0.1, help="cutout / field of view, degrees")
    ap.add_argument("--per-pass-detector", type=int, default=20, help="max images per (pass, detector)")
    ap.add_argument("--threads", type=int, default=4)
    args = ap.parse_args()
    if args.ra is not None and args.dec is not None:
        key = f"field_{args.ra:.4f}_{args.dec:+.4f}".replace(".", "p").replace("+", "n").replace("-", "s")
        t = {"label": f"Field {args.ra:.4f} {args.dec:+.4f}", "kind": "field", "ra": args.ra, "dec": args.dec,
             "epoch_jyear": 2016.0, "pmra": 0, "pmdec": 0, "parallax": 0, "ref": "user-chosen position"}
    else:
        key = args.target
        t = json.load(open(ROOT / "pipeline/targets.json"))[key]
    ref = reference(t)
    centre = position_at(ref, Time("2026-01-01").mjd)
    out_dir = ROOT / f"web/data/{key}"
    cache = ROOT / f"data/cache/{key}"
    out_dir.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)

    inv = inventory(key, centre)
    mjd = np.array(inv["time_bounds_lower"], float)
    det = np.array([str(b).replace("SPHEREx-", "") for b in inv["energy_bandpassname"]])
    passes = group_passes(mjd)
    log(f"{t['label']}: {len(inv)} images in {len(passes)} passes")

    # select up to K images per (pass, detector), spread evenly through the pass
    sel = []
    for pi, idx in enumerate(passes):
        for d in sorted(set(det[idx])):
            di = [i for i in idx if det[i] == d]
            if len(di) > args.per_pass_detector:
                di = [di[k] for k in np.linspace(0, len(di) - 1, args.per_pass_detector).round().astype(int)]
            sel += [(pi, d, i) for i in di]
    log(f"selected {len(sel)} cutouts; downloading (cached ones are instant)")

    N = int(np.ceil(args.fov * 3600 / PIX)) | 1
    grid = fits.Header({"NAXIS": 2, "NAXIS1": N, "NAXIS2": N, "CTYPE1": "RA---TAN", "CTYPE2": "DEC--TAN",
                        "CRVAL1": centre.ra.deg, "CRVAL2": centre.dec.deg, "CRPIX1": (N + 1) / 2, "CRPIX2": (N + 1) / 2,
                        "CDELT1": -PIX / 3600, "CDELT2": PIX / 3600})
    gw = WCS(grid)

    t0 = time.time()
    paths, failed = {}, 0
    with cf.ThreadPoolExecutor(args.threads) as ex:
        futs = {ex.submit(fetch, inv["uri"][i], centre, args.fov, cache): (pi, d, i) for pi, d, i in sel}
        for k, f in enumerate(cf.as_completed(futs)):
            p = f.result()
            if p is None:
                failed += 1
            else:
                paths[futs[f]] = p
            if k % 50 == 0:
                log(f"  {k}/{len(sel)} downloaded, {failed} failed, {time.time() - t0:.0f}s")
    log(f"downloads done: {len(paths)} ok, {failed} failed, {time.time() - t0:.0f}s")

    # process + stack
    per = {}
    spectrum = []
    versions = set()
    for (pi, d, i), p in sorted(paths.items(), key=lambda kv: kv[0]):
        try:
            r = process(p, grid, position_at(ref, mjd[i]))
        except Exception as e:
            log(f"  skip {p.name}: {e!r}")
            continue
        versions.add(r["version"])
        per.setdefault((pi, d), []).append(r)
        if r["phot"]:
            spectrum.append({"pass": pi, "detector": d, "mjd": float(mjd[i]), **r["phot"]})

    manifest = {"target": key, "label": t["label"], "kind": t["kind"], "reference": t["ref"],
                "blurb": t.get("blurb", ""), "look_for": t.get("look_for", ""),
                "grid": {"n": N, "pixel_arcsec": PIX, "ra": centre.ra.deg, "dec": centre.dec.deg, "fov_deg": args.fov},
                "built": time.strftime("%Y-%m-%d %H:%M %Z"), "spherex_versions": sorted(versions),
                "n_images_total": len(inv), "n_images_used": sum(len(v) for v in per.values()), "n_failed": failed,
                "passes": []}
    stacks_all = []
    for pi, idx in enumerate(passes):
        dets = sorted({d for (q, d) in per if q == pi})
        if not dets:
            continue
        mids = float(np.median(mjd[idx]))
        frames, covers, zs, nimg = {}, {}, [], 0
        for d in dets:
            rs = per[(pi, d)]
            nimg += len(rs)
            masked = np.nanmedian([r["aligned"] for r in rs], 0)
            raw = np.nanmedian([r["unmasked"] for r in rs], 0)
            st = np.where(np.isfinite(masked), masked, raw)  # fill flagged-only pixels (e.g. saturated cores) for display
            frames[d] = st
            covers[d] = np.any([np.isfinite(r["sat"]) for r in rs], 0)
            zs.append(robust_z(st))
        frames["ALL"] = np.nanmean(zs, 0)
        covers["ALL"] = np.any([covers[d] for d in dets], 0)
        x, y = (float(v) for v in gw.world_to_pixel(position_at(ref, mids)))
        sat_frac = float(np.mean([np.nanmean([r["sat"] for r in per[(pi, d)]], 0)[int(round(y)), int(round(x))] for d in dets]))
        manifest["passes"].append({"index": pi, "mjd": mids, "date": Time(mids, format="mjd").iso[:10],
                                   "start": Time(mjd[idx].min(), format="mjd").iso[:10],
                                   "end": Time(mjd[idx].max(), format="mjd").iso[:10],
                                   "n_images": nimg, "detectors": dets, "full": len(dets) >= 4,
                                   "predicted_px": [x, y], "saturated_fraction_at_target": round(sat_frac, 2), "frames": {}})
        stacks_all.append((manifest["passes"][-1], frames, covers))

    # shared brightness scale per detector (from the first pass that has it) so frames are comparable
    for d in sorted({d for _, fr, _ in stacks_all for d in fr}):
        first = next(fr[d] for _, fr, _ in stacks_all if d in fr)
        lo, hi = np.nanpercentile(first, [1, 99.8])
        for p, fr, cv in stacks_all:
            if d in fr:
                name = f"p{p['index']}_{d}.png"
                save_png(fr[d], out_dir / name, lo, hi, cv[d])
                p["frames"][d] = name
    # difference frames: every pass minus the first full pass, per detector (shared symmetric scale per detector)
    base = next(((p, fr, cv) for p, fr, cv in stacks_all if p["full"]), stacks_all[0])
    for d in base[1]:
        diffs = [(p, fr[d] - base[1][d], cv[d] & base[2][d]) for p, fr, cv in stacks_all if d in fr]
        lim = max(np.nanpercentile(np.abs(df), 99.7) for p, df, _ in diffs if p is not base[0]) if len(diffs) > 1 else 1
        for p, df, both in diffs:
            name = f"p{p['index']}_{d}_diff.png"
            rgba = plt.get_cmap("RdBu_r")(np.clip((np.nan_to_num(df) + lim) / (2 * lim), 0, 1))
            rgba[..., 3] = both.astype(float)
            plt.imsave(out_dir / name, rgba, origin="lower")
            p.setdefault("diff_frames", {})[d] = name
    manifest["diff_base"] = base[0]["date"]
    np.savez_compressed(ROOT / f"data/cache/{key}_stacks.npz",
                        **{f"p{p['index']}_{d}": fr[d] for p, fr, _ in stacks_all for d in fr})

    # validation: target shift first->last full pass vs reference; field-star noise floor
    full = [(p, fr) for p, fr, _ in stacks_all if p["full"]]
    if len(full) >= 2 and t["kind"] == "moving":
        (pa, fa), (pb, fb) = full[0], full[-1]
        save_diff(fb["ALL"] - fa["ALL"], out_dir / "diff_ALL.png")
        manifest["diff"] = {"file": "diff_ALL.png", "from": pa["date"], "to": pb["date"]}
        check = {"from": pa["date"], "to": pb["date"], "years": round((pb["mjd"] - pa["mjd"]) / 365.25, 2)}
        ca, cb = centroid(fa["ALL"], *pa["predicted_px"]), centroid(fb["ALL"], *pb["predicted_px"])
        if ca and cb:
            meas = np.subtract(cb, ca) * PIX
            pred = np.subtract(pb["predicted_px"], pa["predicted_px"]) * PIX
            check.update(measured_arcsec=[round(-meas[0], 2), round(meas[1], 2)],  # (east, north); x grows west
                         predicted_arcsec=[round(-pred[0], 2), round(pred[1], 2)],
                         measured_total_arcsec=round(float(np.hypot(*meas)), 2),
                         predicted_total_arcsec=round(float(np.hypot(*pred)), 2),
                         error_arcsec=round(float(np.hypot(*(meas - pred))), 2))
            shifts = []
            for (x, y) in field_stars(fa["ALL"], ca):
                c1 = centroid(fa["ALL"], x, y)
                c2 = centroid(fb["ALL"], *c1) if c1 else None
                if c1 and c2:
                    shifts.append(float(np.hypot(*np.subtract(c2, c1))) * PIX)
            if shifts:
                check["field_star_shift_arcsec_median"] = round(float(np.median(shifts)), 2)
                check["n_field_stars"] = len(shifts)
                check["signal_to_noise"] = round(check["measured_total_arcsec"] / max(np.median(shifts), 0.05), 1)
        manifest["check"] = check
        log("check:", json.dumps(check))

    # brightness change first -> last full pass, per detector, with field stars as the control
    if len(full) >= 2:
        (pa, fa), (pb, fb) = full[0], full[-1]

        def apflux(img, x, y, r=2):
            yy, xx = np.mgrid[:img.shape[0], :img.shape[1]]
            d = np.hypot(xx - x, yy - y)
            sky = np.nanmedian(img[(d >= 4) & (d <= 7)])
            return float(np.nansum(img[d <= r] - sky))

        per_det = {}
        for d in sorted(set(fa) & set(fb) - {"ALL"}):
            ta, tb = apflux(fa[d], *pa["predicted_px"]), apflux(fb[d], *pb["predicted_px"])
            ratios = []
            for (x, y) in field_stars(fa[d], pa["predicted_px"]):
                f1, f2 = apflux(fa[d], x, y), apflux(fb[d], x, y)
                if f1 > 0 and f2 > 0:
                    ratios.append(f2 / f1)
            if ta > 0 and tb > 0 and ratios:
                med = float(np.median(ratios))
                per_det[d] = {"target_ratio": round(tb / ta, 3), "field_ratio_median": round(med, 3),
                              "field_ratio_scatter": round(float(1.4826 * np.median(np.abs(np.array(ratios) - med))), 3)}
        if per_det:
            rel = [v["target_ratio"] / v["field_ratio_median"] for v in per_det.values()]
            manifest["variability"] = {"from": pa["date"], "to": pb["date"], "per_detector": per_det,
                                       "median_change": round(float(np.median(rel)), 3),
                                       "median_field_scatter": round(float(np.median([v["field_ratio_scatter"] for v in per_det.values()])), 3)}
            log("variability:", json.dumps(manifest["variability"]))

    json.dump(spectrum, open(out_dir / "spectrum.json", "w"))
    manifest["spectrum"] = {"file": "spectrum.json", "n_points": len(spectrum)}
    json.dump(manifest, open(out_dir / "manifest.json", "w"), indent=1)
    log(f"wrote {out_dir.relative_to(ROOT)}: {len(manifest['passes'])} passes, {len(spectrum)} spectrum points")
    # site index of built targets (the viewer's target picker)
    idx_path = ROOT / "web/data/index.json"
    idx = json.load(open(idx_path)) if idx_path.exists() else {}
    idx[key] = {"label": t["label"], "kind": t["kind"], "ra": centre.ra.deg, "dec": centre.dec.deg}
    json.dump(idx, open(idx_path, "w"), indent=1)


if __name__ == "__main__":
    main()
