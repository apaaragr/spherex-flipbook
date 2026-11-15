"""Spike step 1: Gaia reference for Barnard's Star + SPHEREx image inventory over it."""
import json, time
import numpy as np, astropy.units as u
from astropy.coordinates import SkyCoord, Distance
from astropy.time import Time
from astroquery.gaia import Gaia
from astroquery.ipac.irsa import Irsa

g = Gaia.launch_job("""SELECT source_id, ra, dec, pmra, pmdec, parallax, phot_g_mean_mag
FROM gaiadr3.gaia_source WHERE source_id = 4472832130942575872""").get_results()[0]
print({k: float(g[k]) for k in ['ra','dec','pmra','pmdec','parallax','phot_g_mean_mag']})
star = SkyCoord(ra=g['ra']*u.deg, dec=g['dec']*u.deg, pm_ra_cosdec=g['pmra']*u.mas/u.yr,
                pm_dec=g['pmdec']*u.mas/u.yr, distance=Distance(parallax=g['parallax']*u.mas),
                obstime=Time(2016.0, format='jyear'))
now = star.apply_space_motion(Time('2026-01-01'))
print('2026.0 position:', now.ra.deg, now.dec.deg)

t0 = time.time()
q = f"""SELECT a.uri, p.time_bounds_lower, p.energy_bandpassname
FROM spherex.artifact a JOIN spherex.plane p ON a.planeid = p.planeid
WHERE 1 = CONTAINS(POINT('ICRS', {now.ra.deg}, {now.dec.deg}), p.poly)
ORDER BY p.time_bounds_lower"""
r = Irsa.query_tap(q).to_table()
print(f'TAP {time.time()-t0:.1f}s, {len(r)} images')
mjd = np.array(r['time_bounds_lower'], float)
order = np.argsort(mjd); mjd = mjd[order]
# group into visits: gap > 20 days starts a new visit
visits = np.split(np.arange(len(mjd)), np.where(np.diff(mjd) > 20)[0] + 1)
for v in visits:
    bands = sorted(set(str(b) for b in r['energy_bandpassname'][order][v]))
    print(f"visit {Time(mjd[v[0]],format='mjd').iso[:10]} -> {Time(mjd[v[-1]],format='mjd').iso[:10]}: {len(v)} imgs, bands {bands}")
r.write('out/barnard_inventory.ecsv', overwrite=True)
json.dump({k: float(g[k]) for k in ['ra','dec','pmra','pmdec','parallax']}, open('out/barnard_gaia.json','w'))
