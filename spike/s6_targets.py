"""Spike step 6: WISE 0855 + Epsilon Indi B. Per-visit median stacks on a common grid; measure target shift vs reference
motion (positive control) and self-detected field stars (negative control); SNR of target per visit; blink figure."""
import sys, time, json, concurrent.futures as cf, warnings, logging
import numpy as np, astropy.units as u, matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from astropy.coordinates import SkyCoord; from astropy.time import Time; from astropy.io import fits; from astropy.wcs import WCS
from astroquery.ipac.irsa import Irsa; from reproject import reproject_interp
warnings.filterwarnings('ignore'); logging.getLogger('astropy').setLevel(logging.ERROR)
from astropy.utils.data import conf; conf.remote_timeout = 120
T = {  # reference position at epoch (MJD), proper motion (arcsec/yr), bands to use, source of the reference
 'WISE0855': dict(ra=133.7831722, dec=-7.2442516, mjd=57338.571, pmra=-8.0212, pmdec=1.0357, bands=['SPHEREx-D6', 'SPHEREx-D5'], ref='CatWISE2020'),
 'EpsIndB': dict(ra=331.0767776, dec=-56.7939530, mjd=57493.372, pmra=3.966, pmdec=-2.536, bands=['SPHEREx-D2', 'SPHEREx-D6'], ref='CatWISE2020 position + published eps Ind system motion'),
}
name = sys.argv[1]; t = T[name]; PER = 15; N = 41
ref = SkyCoord(t['ra']*u.deg, t['dec']*u.deg, pm_ra_cosdec=t['pmra']*u.arcsec/u.yr, pm_dec=t['pmdec']*u.arcsec/u.yr, obstime=Time(t['mjd'], format='mjd'))
pos = lambda mjd: ref.apply_space_motion(Time(mjd, format='mjd'))
c = pos(Time('2026-01-01').mjd)
t0 = time.time()
for k in range(4):
    try:
        r = Irsa.query_tap(f"""SELECT a.uri, p.time_bounds_lower, p.energy_bandpassname FROM spherex.artifact a JOIN spherex.plane p ON a.planeid=p.planeid
        WHERE 1=CONTAINS(POINT('ICRS',{c.ra.deg},{c.dec.deg}), p.poly) ORDER BY p.time_bounds_lower""").to_table(); break
    except Exception as e: print('tap retry', e); time.sleep(20)
mjd = np.array(r['time_bounds_lower'], float); print(f'{name}: {len(r)} images, TAP {time.time()-t0:.0f}s')
vis = np.split(np.arange(len(mjd)), np.where(np.diff(mjd) > 20)[0] + 1)
vis = [v for v in vis if len(v) >= 40]  # full passes only
for v in vis: print(f"  pass {Time(mjd[v[0]],format='mjd').iso[:10]}..{Time(mjd[v[-1]],format='mjd').iso[:10]} n={len(v)}")
hdr = fits.Header({'NAXIS': 2, 'NAXIS1': N, 'NAXIS2': N, 'CTYPE1': 'RA---TAN', 'CTYPE2': 'DEC--TAN', 'CRVAL1': c.ra.deg, 'CRVAL2': c.dec.deg,
                   'CRPIX1': (N+1)/2, 'CRPIX2': (N+1)/2, 'CDELT1': -6.15/3600, 'CDELT2': 6.15/3600}); W = WCS(hdr)
def get(i):
    url = f"https://irsa.ipac.caltech.edu/{r['uri'][i]}?center={c.ra.deg},{c.dec.deg}d&size=0.1"
    for k in range(5):
        try:
            with fits.open(url, cache=True) as h:
                return reproject_interp((h['IMAGE'].data.astype(float) - h['ZODI'].data, WCS(h['IMAGE'].header)), hdr)[0]
        except Exception: time.sleep(5 * (k + 1))
def centroid(img, x0, y0, box=2, search=3):
    xi, yi = int(round(x0)), int(round(y0)); s = img[yi-search:yi+search+1, xi-search:xi+search+1]
    dy, dx = np.unravel_index(np.nanargmax(s), s.shape); xi, yi = xi-search+dx, yi-search+dy
    sub = img[yi-box:yi+box+1, xi-box:xi+box+1] - np.nanmedian(img); sub = np.clip(np.nan_to_num(sub), 0, None)
    yy, xx = np.mgrid[-box:box+1, -box:box+1]; return (sub*xx).sum()/sub.sum()+xi, (sub*yy).sum()/sub.sum()+yi
out = {'ref': t['ref'], 'bands': {}}
fig, ax = plt.subplots(len(t['bands']), len(vis)+1, figsize=(4*(len(vis)+1), 4.2*len(t['bands'])), squeeze=False)
with cf.ThreadPoolExecutor(4) as ex:
    for bi, band in enumerate(t['bands']):
        stacks, mids = [], []
        for v in vis:
            idx = [i for i in v if r['energy_bandpassname'][i] == band][:PER]
            arr = [a for a in ex.map(get, idx) if a is not None]
            stacks.append(np.nanmedian(arr, 0)); mids.append(np.median(mjd[idx])); print(f'  {band} pass {len(stacks)}: {len(arr)}/{len(idx)} stacked  {time.time()-t0:.0f}s', flush=True)
        res = []
        for s, m in zip(stacks, mids):
            x0, y0 = (float(q) for q in W.world_to_pixel(pos(m))); cx, cy = centroid(s, x0, y0)
            noise = 1.4826*np.nanmedian(np.abs(s - np.nanmedian(s))); peak = s[int(round(cy)), int(round(cx))] - np.nanmedian(s)
            res.append(dict(mjd=m, pred=(x0, y0), meas=(cx, cy), snr=float(peak/noise), off_px=float(np.hypot(cx-x0, cy-y0))))
        a, b = res[0], res[-1]
        meas = np.subtract(b['meas'], a['meas']); pred = np.subtract(b['pred'], a['pred'])
        # negative control: 6 brightest field peaks in pass 1 (away from target), re-centroided in last pass
        s0 = np.nan_to_num(stacks[0]); field = []
        for _ in range(40):
            yy, xx = np.unravel_index(np.argmax(s0), s0.shape); s0[max(0,yy-3):yy+4, max(0,xx-3):xx+4] = 0
            if 5 < xx < N-6 and 5 < yy < N-6 and np.hypot(xx-a['meas'][0], yy-a['meas'][1]) > 6: field.append((xx, yy))
            if len(field) == 6: break
        fs = [np.hypot(*np.subtract(centroid(stacks[-1], *centroid(stacks[0], x, y)), centroid(stacks[0], x, y))) for x, y in field]
        out['bands'][band] = dict(snr=[round(q['snr'], 1) for q in res], off_from_pred_px=[round(q['off_px'], 2) for q in res],
            meas_shift_px=round(float(np.hypot(*meas)), 2), pred_shift_px=round(float(np.hypot(*pred)), 2),
            shift_err_px=round(float(np.hypot(*(meas-pred))), 2), field_shift_px_median=round(float(np.median(fs)), 2), years=round((b['mjd']-a['mjd'])/365.25, 2))
        print(band, out['bands'][band])
        lo, hi = np.nanpercentile(stacks[0], [5, 99.7])
        for k, (s, q) in enumerate(zip(stacks, res)):
            A = ax[bi, k]; A.imshow(s, origin='lower', cmap='gray', vmin=lo, vmax=hi); A.plot(*q['pred'], '+', ms=16, color='tab:red')
            A.set_title(f"{band[-2:]} · {Time(q['mjd'],format='mjd').iso[:7]} · SNR {q['snr']:.0f}", fontsize=10)
        d = stacks[-1] - stacks[0]; L = np.nanpercentile(np.abs(d), 99.8)
        ax[bi, -1].imshow(d, origin='lower', cmap='RdBu_r', vmin=-L, vmax=L); ax[bi, -1].set_title('last − first pass', fontsize=10)
for A in ax.ravel(): A.set_xticks([]); A.set_yticks([])
fig.suptitle(f'{name} · red + = reference-predicted position ({t["ref"]}) · 1 px = 6.15"'); plt.tight_layout(); plt.savefig(f'out/{name}_blink.png', dpi=95)
json.dump(out, open(f'out/{name}_result.json', 'w'), indent=1); print('done', f'{time.time()-t0:.0f}s')
