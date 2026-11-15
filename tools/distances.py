"""Build web/data/distances.json: galactic direction (l, b) + distance for each showcase target.
Distances from parallax; 'verified' marks values fetched from Gaia DR3 in this project, others are provisional literature values."""
import json
import astropy.units as u
from astropy.coordinates import SkyCoord
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
# parallax in milliarcseconds
P = {
    "barnard":  {"plx": 546.976, "src": "Gaia DR3 4472832130942575872", "verified": True},
    "wise0855": {"plx": 439.0,   "src": "literature parallax (Kirkpatrick et al. 2021) - provisional", "verified": False},
    "epsindb":  {"plx": 274.8,   "src": "Gaia DR3 parallax of its host star Epsilon Indi A - provisional", "verified": False},
    "rwaur":    {"plx": 6.1,     "src": "approximate Gaia parallax - provisional", "verified": False},
    "rdra":     {"plx": 1.2,     "src": "approximate; parallaxes of bright pulsating giants are uncertain - provisional", "verified": False},
}
idx = json.load(open(ROOT / "web/data/index.json"))
out = {}
for k, t in idx.items():
    if k not in P:
        continue
    g = SkyCoord(ra=t["ra"] * u.deg, dec=t["dec"] * u.deg).galactic
    d_ly = (1000.0 / P[k]["plx"]) * 3.26156
    out[k] = {"label": t["label"], "kind": t["kind"], "l": round(g.l.deg, 4), "b": round(g.b.deg, 4),
              "distance_ly": round(d_ly, 1), "parallax_mas": P[k]["plx"], "source": P[k]["src"], "verified": P[k]["verified"]}
    print(f"{k:9s} l={g.l.deg:7.2f} b={g.b.deg:+6.2f}  {d_ly:8.1f} ly  {'verified' if P[k]['verified'] else 'provisional'}")
json.dump(out, open(ROOT / "web/data/distances.json", "w"), indent=1)
