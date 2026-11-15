"""Build web/data/distances.json: galactic direction (l, b) + distance for each showcase target.
Distances from parallax; 'verified' marks values fetched from Gaia DR3 in this project, others are provisional literature values."""
import json
import astropy.units as u
from astropy.coordinates import SkyCoord
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
# parallax in milliarcseconds
P = {  # Gaia DR3 values fetched 2026-11-15 via the GAVO Heidelberg mirror (gaia.dr3lite)
    "barnard":  {"plx": 546.97595, "err": 0.040, "src": "Gaia DR3 4472832130942575872", "verified": True},
    "wise0855": {"plx": 439.0, "err": None, "src": "infrared parallax from the literature; too cold and faint for Gaia", "verified": False},
    "epsindb":  {"plx": 274.84314, "err": 0.096, "src": "Gaia DR3 6412595290592307840 (its host star, Epsilon Indi A)", "verified": True},
    "rwaur":    {"plx": 6.4062495, "err": 0.044, "src": "Gaia DR3 156430822114424576 (brighter member of a close binary)", "verified": True},
    "rdra":     {"plx": 1.250918, "err": 0.065, "src": "Gaia DR3 1648328016354496384 (pulsating giant: parallax has extra systematic uncertainty)", "verified": True},
}
idx = json.load(open(ROOT / "web/data/index.json"))
out = {}
for k, t in idx.items():
    if k not in P:
        continue
    g = SkyCoord(ra=t["ra"] * u.deg, dec=t["dec"] * u.deg).galactic
    d_ly = (1000.0 / P[k]["plx"]) * 3.26156
    out[k] = {"label": t["label"], "kind": t["kind"], "l": round(g.l.deg, 4), "b": round(g.b.deg, 4),
              "distance_ly": round(d_ly, 1), "parallax_mas": P[k]["plx"], "parallax_err_mas": P[k]["err"], "source": P[k]["src"], "verified": P[k]["verified"]}
    print(f"{k:9s} l={g.l.deg:7.2f} b={g.b.deg:+6.2f}  {d_ly:8.1f} ly  {'verified' if P[k]['verified'] else 'provisional'}")
json.dump(out, open(ROOT / "web/data/distances.json", "w"), indent=1)
