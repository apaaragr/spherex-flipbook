# SPHEREx Flipbook

**Watch the infrared sky change, six months at a time.**
A public web tool that turns NASA SPHEREx all-sky images of any patch of sky into a flipbook, blink comparison and
difference image, so anyone can spot stars, brown dwarfs and asteroids that move or change.

Built solo for the **NASA Space Apps Challenge 2026**, challenge *“Planet X and SPHEREx”*.

## What it does
- **Flipbook / Blink / Difference** views of every SPHEREx pass over a sky position, per detector (D1–D6, 0.75–5 µm) or all six combined.
- **Predicted-position overlay** from Gaia DR3 / CatWISE2020 proper motions, so you can see whether a mover is where the catalogue says.
- **“Does it really move?” check**: measured shift vs catalogue prediction, with nearby non-moving stars as a noise floor.
- **Spectrum at the target**: one point per SPHEREx image, coloured by pass (SPHEREx's linear-variable filters mean each image sees a slightly different wavelength).
- Click-to-read coordinates, decimal or sexagesimal input, and all settings in the URL for sharing and embedding.

## Result on the test target
Barnard's Star, Aug 2025 → Aug 2026 (0.98 yr): **measured 10.18″, Gaia predicts 10.23″** (difference 0.80″ = 0.13 px);
non-moving field stars shift 0.08″, so signal ÷ noise ≈ 123×.

## How it works
1. **Find every image** covering the position (IRSA TAP, `spherex.artifact` × `spherex.plane`).
2. **Download small cutouts** (IRSA cutout service), cached locally, max 4 in parallel with retries.
3. **Clean**: subtract the ZODI (zodiacal light) model; mask bad pixels from the FLAGS bitmap (see [FLAGS.md](FLAGS.md)).
   Saturated cores are kept for display and marked.
4. **Align** every cutout onto one north-up TAN grid at SPHEREx's native 6.15″ pixels.
5. **Stack each six-month pass** (median per detector; “All” = mean of per-detector robust z-scores).
6. **Measure** centroids, shifts and aperture photometry; export PNG frames + `manifest.json` for the static viewer.

The method was tested before building, against controls fixed in advance; see [SPIKE_PREREG.md](SPIKE_PREREG.md).

## Run it
```bash
python3 -m venv .venv && .venv/bin/pip install numpy astropy astroquery reproject matplotlib scipy
.venv/bin/python -m pipeline.build barnard                 # a showcase target (pipeline/targets.json)
.venv/bin/python -m pipeline.build --ra 269.446 --dec 4.768 # any position
cd web && python3 -m http.server 8765                      # open http://127.0.0.1:8765
```

## Status / known limits
- During the hackathon weekend (15 Nov 2026) IRSA's search services (TAP/SIA) returned HTTP 502 for hours, so only
  Barnard's Star (whose image list was fetched the day before) is pre-built. The other test targets (Epsilon Indi B,
  WISE 0855−0714, RW Aurigae, R Draconis) need only `python -m pipeline.build <target>` once the archive is back.
- One year of SPHEREx data = ~1.7 px of motion even for Barnard's Star; Difference mode makes it obvious, a raw flipbook only subtly.

## Data & credits
This publication makes use of data products from the Spectro-Photometer for the History of the Universe, Epoch of
Reionization and Ices Explorer (SPHEREx), which is a joint project of the Jet Propulsion Laboratory and the California
Institute of Technology, and is funded by the National Aeronautics and Space Administration. Data via the NASA/IPAC
Infrared Science Archive (IRSA). Reference astrometry from ESA Gaia DR3 and CatWISE2020. Viewer design inspired by WiseView.

Licence: Apache-2.0.
