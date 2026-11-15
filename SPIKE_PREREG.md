# Data spike — pre-registration (written BEFORE any data is pulled)

**Date:** 2026-11-14 · **Challenge:** NASA Space Apps 2026, "Planet X and SPHEREx" (solo)

## Question
Can SPHEREx images alone show a known moving star actually moving, clearly enough for a
public flipbook viewer? Or do we need older WISE (Wide-field Infrared Survey Explorer) frames to
lengthen the time baseline?

## Target
Barnard's Star. Gaia DR3 (Data Release 3) gives the reference position + proper motion (~10.4"/yr).

## Method
1. IRSA TAP query → every SPHEREx image covering the star's *current* predicted position.
2. Group images into "visits" (clusters in time). Count visits and the time span.
3. Download small cutouts from ONE detector band per visit; centroid the brightest source near
   the Gaia-predicted position for that date.
4. Compare measured shift (earliest → latest visit) vs Gaia-predicted shift.

## Controls (fixed now)
- **Positive control:** Barnard's Star must move by the Gaia-predicted amount (and direction).
- **Negative control:** 2–3 bright field stars in the same cutouts with |proper motion| < 20 mas/yr
  must show ≈ 0 shift. Their scatter = our astrometric **noise floor** (the null).
- **Null:** the star's measured shift is not distinguishable from the field-star scatter.

## Decision rule (fixed now)
- **GO SPHEREx-only** if: ≥ 2 visits, AND measured shift agrees with Gaia within 1 px (6.15"),
  AND shift ≥ 3× the field-star noise floor, AND it's visible by eye in a blink.
- **ADD WISE** if: shift < 3× noise, or < ~1.5 px (not visible by eye), or only 1 visit.
- **STOP / rethink** if: data access is broken or too slow (> ~10 min for one target's cutouts).

## Results
_(filled in after running — see bottom)_

### Results (2026-11-14, Barnard's Star)
- **Coverage:** 358 images; 3 full passes (Aug 2025, Mar 2026, Aug 2026, ~110 imgs each, all 6 detectors) + 3 small top-ups. Baseline ≈ 1.0 yr.
- **Positive control:** measured Aug25→Aug26 shift **10.28" (1.67 px)**, dRA −2.17" / dDec +10.04". Gaia predicts this to within **1.4" (0.23 px)** → PASS.
- **Negative control (3 Gaia stars, |pm|<20 mas/yr):** shifts 0.11–0.18" → noise floor ≈ 0.2"; star shift ≈ **57× noise** → PASS.
- **Eye test:** raw blink = subtle (1.7 px); **difference image = obvious dipole** (red north, blue south) → PASS *with subtract mode*.
- **DECISION: GO SPHEREx-only** for Barnard's Star. WISE stays a stretch, re-check per target (Epsilon Indi B ≈ 4.7"/yr ≈ 0.75 px/yr will likely need it).

### Anomalies found (for the build)
1. Star centroid worked on only ~30% of images (controls ~100%): bright-star core pixels are flagged/NaN (likely saturation). All star pixels flagged nonzero; bit names not in the FITS header → need Explanatory Supplement Table 16.
2. IRSA returned **HTTP 503 on 18% of requests at 12 threads**; ~5% at 4 threads → use ≤4 threads + backoff + caching.
3. **Speed ≈ 1 s per cutout** → a full target (~350 images) takes minutes → precompute showcase targets; on-demand path pulls one detector and caches.
4. Control star c2 has a constant ~4" offset in all visits (likely a blended neighbour) → constant, so it doesn't affect motion.
5. Barnard's RA residual drifts −1.4" between visits (> its ~0.1" error) → probably saturation-biased centroids; within tolerance.
