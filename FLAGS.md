# SPHEREx pixel flags (Explanatory Supplement v2.0, Table 16)
Bits: TRANSIENT 0 · OVERFLOW 1 · SUR_ERROR 2 · NONFUNC 6 · DICHROIC 7 · MISSING_DATA 9 · HOT 10 · COLD 11 · FULLSAMPLE 12 ·
PHANMISS 14 · NONLINEAR 15 · PERSIST 17 · OUTLIER 19 · CROSSTALK 20 · SOURCE 21 · GHOST 22 · GHOST_FPA 23 · GHOST_EXT 24 · STREAK 25 · BLOOM 26

- **Informational, NOT bad:** SOURCE (21, pixel on a known source), FULLSAMPLE (12).
- **Bad for imaging (mask in stacks):** TRANSIENT, OVERFLOW, SUR_ERROR, NONFUNC, MISSING_DATA, HOT, COLD, PHANMISS, NONLINEAR, PERSIST, OUTLIER, STREAK.
- **Warn-only overlay:** DICHROIC, CROSSTALK, GHOST*, BLOOM.
- Barnard's Star core = OVERFLOW+SUR_ERROR+SOURCE+BLOOM → saturated (explains ~30% centroid success). 97.6% of pixels in a 0.4° Milky-Way cutout carry SOURCE → "any flag" is meaningless; always decode bits.
