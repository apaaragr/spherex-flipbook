"""Show what ONE raw SPHEREx spectral-image file contains: IMAGE, ZODI, IMAGE-ZODI, FLAGS, VARIANCE, wavelength map."""
import warnings, logging, numpy as np, astropy.units as u, matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from astropy.table import Table; from astropy.io import fits; from astropy.wcs import WCS
warnings.filterwarnings('ignore'); logging.getLogger('astropy').setLevel(logging.ERROR)
inv = Table.read('out/barnard_inventory.ecsv')
i = [k for k in range(len(inv)) if inv['energy_bandpassname'][k] == 'SPHEREx-D2'][3]
url = f"https://irsa.ipac.caltech.edu/{inv['uri'][i]}?center=269.4463,4.7682d&size=0.4"
import time
for k in range(6):
    try: h = fits.open(url, cache=True); break
    except Exception as e: print('retry', k, e); time.sleep(10*(k+1))
with h:
    h.info()
    img, zod, var, flg = (h[n].data.astype(float) for n in ['IMAGE', 'ZODI', 'VARIANCE', 'FLAGS'])
    hdr = h['IMAGE'].header; print('BUNIT', hdr.get('BUNIT'), 'DATE', hdr.get('DATE-OBS'), 'shape', img.shape, 'VERSION', h[0].header.get('VERSION'))
    sw = WCS(hdr, fobj=h, key='W'); sw.sip = None
    yy, xx = np.mgrid[0:img.shape[0]:4, 0:img.shape[1]:4]
    wl = sw.pixel_to_world(xx, yy)[0].to(u.micron).value
    print('wavelength range in this cutout (um):', np.nanmin(wl).round(3), np.nanmax(wl).round(3))
    print('flagged pixel share:', (flg != 0).mean().round(3), ' bits set anywhere:', sorted({b for b in range(32) if (np.bitwise_or.reduce(flg.astype(np.int64).ravel()) >> b) & 1}))
    print('star-core pixel values (IMAGE, FLAGS):'); cy, cx = np.unravel_index(np.nanargmax(np.nan_to_num(img - zod)), img.shape)
    print(np.round(img[cy-2:cy+3, cx-2:cx+3], 1)); print(flg[cy-2:cy+3, cx-2:cx+3].astype(np.int64))
f, ax = plt.subplots(2, 3, figsize=(15, 9.5))
def show(a, d, t, **k): im = a.imshow(d, origin='lower', **k); a.set_title(t, fontsize=10); plt.colorbar(im, ax=a, fraction=.046); a.set_xticks([]); a.set_yticks([])
p = np.nanpercentile
show(ax[0,0], img, '1. IMAGE: calibrated brightness (MJy/sr)', cmap='gray', vmin=p(img, 1), vmax=p(img, 99.5))
show(ax[0,1], zod, '2. ZODI: modelled zodiacal-light glow (to subtract)', cmap='magma')
d = img - zod; show(ax[0,2], d, '3. IMAGE − ZODI: what the viewer will show', cmap='gray', vmin=p(d, 1), vmax=p(d, 99.5))
show(ax[1,0], (flg != 0).astype(float), '4. FLAGS: any quality flag set (white)', cmap='gray')
show(ax[1,1], np.sqrt(var), '5. sqrt(VARIANCE): per-pixel noise', cmap='viridis', vmin=p(np.sqrt(var), 1), vmax=p(np.sqrt(var), 99))
show(ax[1,2], wl, '6. Wavelength each pixel sees (µm) — from WCS-WAVE', cmap='turbo')
f.suptitle(f"One raw SPHEREx file · detector D2 · {hdr.get('DATE-OBS','')[:10]} · {img.shape[1]}×{img.shape[0]} px of 6.15\" (0.4° cutout around Barnard's Star)")
plt.tight_layout(); plt.savefig('out/raw_anatomy.png', dpi=100); print('saved')
