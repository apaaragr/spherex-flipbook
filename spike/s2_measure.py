"""Spike step 2: download cutouts for the 3 main visits, centroid Barnard's Star + quiet field stars,
compare measured motion with Gaia's prediction (positive control) and field-star scatter (negative control)."""
import json, time, concurrent.futures as cf, logging, warnings
import numpy as np, astropy.units as u
from astropy.coordinates import SkyCoord, Distance
from astropy.time import Time
from astropy.table import Table
from astropy.io import fits
from astropy.wcs import WCS
from astropy.utils.data import conf
from astroquery.gaia import Gaia
warnings.filterwarnings('ignore'); logging.getLogger('astropy').setLevel(logging.ERROR)
conf.remote_timeout = 120

g = json.load(open('out/barnard_gaia.json'))
REF = Time(2016.0, format='jyear')
def mk(ra, dec, pmra, pmdec, plx=None):
    kw = dict(distance=Distance(parallax=plx*u.mas)) if plx and plx > 0 else {}
    return SkyCoord(ra=ra*u.deg, dec=dec*u.deg, pm_ra_cosdec=pmra*u.mas/u.yr, pm_dec=pmdec*u.mas/u.yr, obstime=REF, **kw)
star = mk(g['ra'], g['dec'], g['pmra'], g['pmdec'], g['parallax'])
centre = star.apply_space_motion(Time('2026-01-01'))

# negative-control field stars: bright-ish, near-zero proper motion, within 4 arcmin
f = Gaia.launch_job(f"""SELECT source_id, ra, dec, pmra, pmdec, parallax, phot_g_mean_mag FROM gaiadr3.gaia_source
WHERE 1=CONTAINS(POINT('ICRS',ra,dec), CIRCLE('ICRS',{centre.ra.deg},{centre.dec.deg},0.067))
AND phot_g_mean_mag BETWEEN 9 AND 12.5 AND SQRT(pmra*pmra+pmdec*pmdec) < 20
AND DISTANCE(POINT('ICRS',ra,dec),POINT('ICRS',{centre.ra.deg},{centre.dec.deg})) > 0.01
ORDER BY phot_g_mean_mag""").get_results()[:6]
print(f'{len(f)} control stars, G =', [round(float(x),1) for x in f['phot_g_mean_mag']])
controls = [mk(float(r['ra']), float(r['dec']), float(r['pmra']), float(r['pmdec'])) for r in f]

inv = Table.read('out/barnard_inventory.ecsv')
mjd = np.array(inv['time_bounds_lower'], float)
main = [(60900, 60925), (61110, 61145), (61265, 61290)]   # Aug-25, Mar-26, Aug-26 (MJD windows)
sel = [i for i in range(len(inv)) if any(a <= mjd[i] <= b for a, b in main)]
print(f'{len(sel)} images in the 3 main visits (window check:', [Time(a,format='mjd').iso[:10] for a,_ in main], ')')
SIZE = 0.15  # deg

def centroid(img, x0, y0, box=3):
    xi, yi = int(round(x0)), int(round(y0))
    if not (box <= xi < img.shape[1]-box and box <= yi < img.shape[0]-box): return None
    for _ in range(3):  # re-centre on peak-weighted mean
        sub = img[yi-box:yi+box+1, xi-box:xi+box+1]
        if not np.isfinite(sub).all(): return None
        bg = np.nanmedian(img); s = np.clip(sub - bg, 0, None)
        if s.sum() <= 0: return None
        yy, xx = np.mgrid[-box:box+1, -box:box+1]
        cx, cy = (s*xx).sum()/s.sum() + xi, (s*yy).sum()/s.sum() + yi
        nxi, nyi = int(round(cx)), int(round(cy))
        if (nxi, nyi) == (xi, yi): break
        xi, yi = nxi, nyi
    return cx, cy

def work(i):
    row = inv[i]; t = Time(mjd[i], format='mjd')
    url = f"https://irsa.ipac.caltech.edu/{row['uri']}?center={centre.ra.deg},{centre.dec.deg}d&size={SIZE}"
    for attempt in range(3):
        try:
            with fits.open(url, cache=False) as h:
                img = h['IMAGE'].data.astype(float); flags = h['FLAGS'].data; w = WCS(h['IMAGE'].header)
            break
        except Exception as e:
            err = e; time.sleep(2)
    else:
        return {'i': i, 'err': repr(err)}
    out = {'i': i, 'mjd': mjd[i], 'band': str(row['energy_bandpassname'])}
    for name, c in [('star', star)] + [(f'c{k}', cc) for k, cc in enumerate(controls)]:
        pred = c.apply_space_motion(t)
        x0, y0 = (float(v) for v in w.world_to_pixel(pred))
        res = centroid(img, x0, y0)
        if res is None: continue
        xi, yi = int(round(x0)), int(round(y0))
        meas = w.pixel_to_world(*res)
        d_ra = (meas.ra - pred.ra).to(u.arcsec).value * np.cos(pred.dec.rad)
        d_dec = (meas.dec - pred.dec).to(u.arcsec).value
        out[name] = dict(ra=meas.ra.deg, dec=meas.dec.deg, dra=d_ra, ddec=d_dec,
                         flag=int(flags[yi, xi]) if 0 <= yi < flags.shape[0] and 0 <= xi < flags.shape[1] else -1,
                         peak=float(np.nanmax(img[yi-1:yi+2, xi-1:xi+2])))
    return out

t0 = time.time(); rows = []
with cf.ThreadPoolExecutor(12) as ex:
    for k, r in enumerate(ex.map(work, sel)):
        rows.append(r)
        if k % 50 == 0: print(f'  {k}/{len(sel)}  {time.time()-t0:.0f}s', flush=True)
print(f'downloaded+measured {len(rows)} in {time.time()-t0:.0f}s; errors:', sum('err' in r for r in rows))
json.dump(rows, open('out/barnard_measure.json', 'w'))
