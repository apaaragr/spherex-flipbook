"""Spike step 4: eye test. Per-visit median stacks on one common grid + difference image; also dump flag bit names."""
import json, time, concurrent.futures as cf, warnings, logging
import numpy as np, astropy.units as u, matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from astropy.coordinates import SkyCoord, Distance
from astropy.time import Time
from astropy.table import Table
from astropy.io import fits
from astropy.wcs import WCS
from reproject import reproject_interp
warnings.filterwarnings('ignore'); logging.getLogger('astropy').setLevel(logging.ERROR)
g = json.load(open('out/barnard_gaia.json'))
star = SkyCoord(ra=g['ra']*u.deg, dec=g['dec']*u.deg, pm_ra_cosdec=g['pmra']*u.mas/u.yr, pm_dec=g['pmdec']*u.mas/u.yr,
                distance=Distance(parallax=g['parallax']*u.mas), obstime=Time(2016.0, format='jyear'))
c = star.apply_space_motion(Time('2026-01-01'))
inv = Table.read('out/barnard_inventory.ecsv'); mjd = np.array(inv['time_bounds_lower'], float)
V = {'Aug 2025': (60900, 60925), 'Mar 2026': (61110, 61145), 'Aug 2026': (61265, 61290)}
BAND = 'SPHEREx-D2'
pick = {v: [i for i in range(len(inv)) if a <= mjd[i] <= b and inv['energy_bandpassname'][i] == BAND] for v, (a, b) in V.items()}
print({v: len(x) for v, x in pick.items()})
# common output grid: TAN, north up, 6.15"/px, 41x41 px (~4.2')
N = 41; hdr = fits.Header({'NAXIS': 2, 'NAXIS1': N, 'NAXIS2': N, 'CTYPE1': 'RA---TAN', 'CTYPE2': 'DEC--TAN', 'CRVAL1': c.ra.deg,
    'CRVAL2': c.dec.deg, 'CRPIX1': (N+1)/2, 'CRPIX2': (N+1)/2, 'CDELT1': -6.15/3600, 'CDELT2': 6.15/3600})
W = WCS(hdr); shown = [False]
def get(i):
    url = f"https://irsa.ipac.caltech.edu/{inv['uri'][i]}?center={c.ra.deg},{c.dec.deg}d&size=0.1"
    for k in range(4):
        try:
            with fits.open(url, cache=False) as h:
                if not shown[0]:
                    shown[0] = True
                    print('FLAG bits:', {k2: v2 for k2, v2 in h['FLAGS'].header.items() if k2.startswith(('MP_', 'HIERARCH', 'FLAG'))})
                img = h['IMAGE'].data.astype(float) - h['ZODI'].data
                return reproject_interp((img, WCS(h['IMAGE'].header)), hdr)[0]
        except Exception as e:
            time.sleep(3 * (k + 1))
    return None
stacks = {}
with cf.ThreadPoolExecutor(4) as ex:
    for v, idx in pick.items():
        arr = [a for a in ex.map(get, idx) if a is not None]
        stacks[v] = np.nanmedian(arr, 0); print(v, 'stacked', len(arr))
np.savez('out/barnard_stacks.npz', **{k.replace(' ', '_'): s for k, s in stacks.items()})
fig, ax = plt.subplots(1, 4, figsize=(16, 4.4))
vmin, vmax = np.nanpercentile(stacks['Aug 2025'], [5, 99.7])
for a, (v, s) in zip(ax, stacks.items()):
    a.imshow(s, origin='lower', cmap='gray', vmin=vmin, vmax=vmax); a.set_title(f'SPHEREx D2 · {v}')
    p = star.apply_space_motion(Time(np.mean(V[v]), format='mjd')); x, y = W.world_to_pixel(p)
    a.plot(x, y, '+', ms=18, mew=0.8, color='tab:red')
d = stacks['Aug 2026'] - stacks['Aug 2025']; lim = np.nanpercentile(np.abs(d), 99.8)
ax[3].imshow(d, origin='lower', cmap='RdBu_r', vmin=-lim, vmax=lim); ax[3].set_title('Aug 2026 − Aug 2025 (red=new, blue=gone)')
for a in ax: a.set_xticks([]); a.set_yticks([])
fig.suptitle("Barnard's Star · red + = Gaia-predicted position at each visit · 1 px = 6.15\"", y=0.99)
plt.tight_layout(); plt.savefig('out/barnard_blink.png', dpi=110); print('saved')
