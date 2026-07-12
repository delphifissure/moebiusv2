
## Addendum 5 — v4.2 cross-asset validation (Frazetta, silverwarrior)

Full 8-shot matrix per asset on `review-fix` @ b6f2853:

| asset | T2 holes (4 poses) | T1 rest >8/255 (vs v3.12 baseline) | headline change at +0.11 |
|---|---|---|---|
| frazetta 851x1023 | 0 | 7,805 (6,271) | **all D11 black blobs GONE** — carried rim colours sidestep the lum>=45 fill starvation on the dark palette (`fr2_comp_r11.png`) |
| silverwarrior 3000x3000 | 0 | **8,268 (13,078 — improved)** | **the full-height ribbon-streak column is GONE** (`sv2_comp_r11.png`); residual mild smears only at sub-0.10 edges (D3, untreated) |

Mechanism sizing per asset (self-reported): frazetta tear 7,277/1.74M
triangles, pass-2 +313,365px (36% of frame — the dark cave's continuous
depth; no visible damage, plate under unrevealed areas is invisible);
silverwarrior tear 78,021/18.0M, pass-2 +12,282px. The v4.2 pipeline
self-scales across a 12x resolution range with no per-asset tuning.

Cross-asset residuals: sub-0.10 edges still smear mildly everywhere (D3 —
the seeding-threshold structural limit; MPI layer extraction is the fix);
wash texture vs painterly detail (SD plate's job); build time on the 3000^2
asset remains ~1-2 min unoptimized (see Addendum 3 budget).
