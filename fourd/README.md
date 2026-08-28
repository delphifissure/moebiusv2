# 4DAnyone portal PoC — splat portal + off-axis rig viewer

Two halves, both driven by the SAME off-axis spatial normalization
(`portal.js`, the moebius head->eye->frustum law extracted verbatim):

## Half 1 — 4D splat portal (`splat.html`)

What 4DAnyone ultimately feeds (its repo generates multi-view videos; the
animated gaussian splat is trained downstream — per-frame 3DGS via their
nerfstudio guide; open-source 4DGS is on their TODO). This viewer renders
that end product behind the portal today:

- `splat_renderer.js` — minimal 3DGS renderer: `.splat` (antimatter15) and
  binary 3DGS `.ply` (DC color band), CPU covariance, EWA projection in the
  vertex shader, counting-sort back-to-front, premultiplied over-blending.
- 4D = per-frame splat sequences (`assets/manifest.json`), exactly the shape
  per-frame 3DGS training of a 4DAnyone rig produces.
- `make_synthetic_splat.js` — no GPU exists here to train real splats, so the
  test asset is generated: a 24-frame walking figure + depth markers.
- `splat_shots.js` — invariants, both PASS:
  - I1 depth-ordered window parallax through the fixed rect: front marker
    +20.5px vs back marker −18.3px over a ±0.4 head sweep (opposite signs),
    subject centroid AT the portal plane moves 1.1px (pinned).
  - I2 4D playback: quarter-cycle frames differ by 5,143/120,000 samples.
- Subject framing comes from the asset's own `subject` metadata (like
  4DAnyone's `framing`), never the union bbox.
- Honest limits: DC color only (no view-dependent SH yet); the EWA Jacobian
  keeps the focal terms of the asymmetric frustum (center exact, ellipse
  first-order) — the standard WebGL splat approximation; whole-sequence
  preload (121-frame real captures will want streaming).

Run: `node fourd/server.js` then `http://localhost:8098/fourd/splat.html`
(mouse = head, or `?eye=x,y&frame=k`; drop any `.splat`/`.ply` on the page).

## Half 2 — off-axis rig viewer (`fourd.html`)

Proof of concept: consume a [4DAnyone](https://github.com/ant-research/4DAnyone)
output rig (multi-view frame-synced videos of a person + `cameras.json`) and
present it behind a moebius-style portal driven by our off-axis spatial
normalization instead of a mouse orbit.

## The two laws (both from moebius.js, no new constants)

1. **Off-axis frustum** — `frameCorners()` ported verbatim: the projection is
   rebuilt per frame from the live eye against a fixed portal rect, so
   portal-plane points are pinned for any eye and everything behind the glass
   shows true window parallax (verified: projected pivot matches the analytic
   portal-ray prediction to ~1e-16, `shots.js`).
2. **Rig coordinate normalization** — the rig view direction is the angle the
   eye subtends at the subject pivot (`yaw = atan2(eyeX−pivotX, eyeZ−pivotZ)`).
   There is no gain to tune: head motion maps to exactly the orbit angle a real
   object behind the glass would present. The two yaw-adjacent views bracketing
   that angle blend linearly in angle; nearest pitch layer wins first.

## Run

```bash
node fourd/server.js          # serves the repo on :8098
# open http://localhost:8098/fourd/fourd.html
# drag = move head · wheel = approach
```

Default rig is the bundled mock (`fourd/data/mock`). For a real 4DAnyone
output, copy its folder (must contain `cameras.json` and `videos/dense/*.mp4`)
somewhere under the repo and open:

```
http://localhost:8098/fourd/fourd.html?rig=/path/to/that/folder
```

The viewer reads the 4DAnyone schema directly (`camera_id`, `layer_index`,
`pitch`, `yaw`, `K`, `camera_to_world`, `video`). mp4s play through
`<video>`/`VideoTexture`; the mock instead carries a `frame_sequence`
extension (PNG frames) because this container's chromium ships no H.264.

## Files

- `fourd.html` / `fourd.js` — the viewer.
- `mockrig.js` + `mockrig.html` — generates `data/mock`: an 8-view frontal-arc
  rig (the README's `--views_per_layer 8 --start_yaw -90 --yaw_span 180`
  layout) of a synthetic walking figure whose four sides are unmistakable
  (front red chest + face, back blue pack, left-of-world green arm, right
  yellow), 16 frames @ 12 fps, exact `cameras.json` schema.
- `shots.js` — harness: eye sweep with two invariants (view walk monotonic in
  eye yaw; off-axis pivot projection equals the analytic portal ray) plus
  screenshots into `fourd/shots/`.
- `server.js` — static server on :8098 (8099 is the scratch harness, serial).

## Honest limits of this PoC

- View interpolation is a linear crossfade between the two bracketing rig
  views (light-field style). Between 22.5°-spaced views the blend reads as a
  soft double exposure on fast silhouettes; a real 4DAnyone rig for portal use
  should be generated denser (`--views_per_layer 24`) and/or front-arc only.
- The card is a flat billboard at the pivot: no per-pixel depth inside the
  subject, so intra-subject parallax between bracketing views is approximated
  by the blend, not reprojected. Marrying the rig to the moebius depth pipeline
  (per-view depth → our reprojection law) is the next slice, not this one.
- Eye input is pointer/wheel; wiring the moebius head tracker is a hookup, not
  a design change (`window._fourdSetEye`).

## A223 — splats as a moebius input type (mixed with layers)

`moebius.html` now imports gaussian splats through the layer modal's color
slot (`.splat`, 3DGS `.ply`, `.spz` v1–3; `.ksplat` is detected and refused
with a convert hint — no zstd in the browser for spz v4 either). A splat
layer is real geometry: it renders in the same scene, same camera, same
off-axis law as every 2.5D layer (drawn after them, depth-tested against
their written depth), and is INVISIBLE to every analysis pass — normalized
depth, footprint, gap captures, pipeline debug views — so the 2.5D pipeline
is bit-identical with a splat present. Proven end-to-end by
`fourd/moebius_splat_test.js`: T1 the baked gap set reproduces the shipped
reference exactly (99907 px / 3769 boundary) with a splat loaded; T2 the
splat is visible in the composite; T3 spz v2 round-trip. Test API:
`window._addSplatLayerFromBuffer(buffer, name)`.

### A224 — 4D sequences in moebius (slice b)

Select MULTIPLE `.splat`/`.ply` frame files in the color slot (or point a
preset at a sequence `manifest.json`) and the layer becomes an animated 4D
splat: one normalization transform for the whole sequence, per-frame
playback on its own clock (manifest `fps` or `window._splatSeqFps`, default
12), resort on every frame advance. The GPU-side pipeline that produces
real sequences from a 4DAnyone rig lives in `fourd/gpu/` (runbook +
`train_sequence.py` warm-started per-frame splatfacto orchestrator +
`ply_to_sequence.py` converter, python->JS round-trip tested).

### A225 — SpacetimeGaussians: single-file 4D (slice c)

A trained SpacetimeGaussians `point_cloud.ply` (detected by its
`trbf_center` field) imports as a DYNAMIC splat layer: one persistent
gaussian set whose cubic position polynomial, linear rotation (omega), and
temporal opacity window are evaluated per vertex in the shader against a
continuous clip time — no per-frame files. Evaluation law verified against
their renderer; CPU resort re-runs at 1/24-clip granularity or on eye move.
Training conversion from a 4DAnyone rig: `fourd/gpu/fourd_to_stg.py`
(LLFF pose writer validated offline). Synthetic test clip:
`make_synthetic_spacetime.js` exercises motion orders 1-3, omega, and the
temporal window; tests T5 (motion moves the marker on screen) and T6
(a narrow-window blob exists ONLY near its trbf center: 0 px at t=0.08,
381 px at t=0.75) PASS alongside T1-T4.

Known v1 limits: subject framing uses the file's union bbox (fit to portal
height, pinned at the portal plane) — no per-layer placement controls yet;
DC color only; one global transform per file (sequences stay in
`splat.html` until slice b).

## A226 — real-scene validation (16 tests) + spz v4 + .splatv + orientation

`fourd/realscene_tests.js`: 16 tests on real, non-IP captures pulled from
research/reference sources (nianticlabs/spz samples, BabylonJS/Assets,
playcanvas/engine, splat-transform fixtures, antimatter15/splaTV's
flame_steak = Neural 3D Video). All 16 PASS + 2 bonus conformance checks
(`shots/realscenes/contact_sheet.png`). What the run hardened:

- **spz v4 (zstd)** now parses (vendored pure-JS `fzstd`, 8KB), and the
  decoder is verified against the REFERENCE implementation: biker.spz vs
  the nianticlabs CLI's own conversion — positions exact, covariance
  2.6e-8 relative.
- **spz v3/v4 rotation encoding fixed**: the smallest-three fields are
  sign-magnitude (negbit<<9|mag, mag=511·|q|/√½), not two's-complement.
  Caught ONLY by the reference cross-check — the wrong decode still
  rendered "plausibly" on soft scenes.
- **`.splatv`** (splaTV dynamic container) parses; flame_steak plays in
  the portal with time-varying pixels.
- **Orientation**: containers carry their producer's convention (measured:
  the reference CLI's ply matches our raw spz decode element-exactly — no
  format-level flip exists). Default import applies the 3DGS-standard
  y-down→y-up flip (`flipFrameRDF`); `?flip=0` / `opts.flip:false` for
  y-up-authored files (e.g. PlayCanvas spz).
- Test metric lesson: a compact subject pinned AT the portal plane has
  near-zero bulk centroid shift BY DESIGN — parallax is asserted as
  view-dependence, with sign-consistency only when the bulk shift is
  meaningful.

Test assets stay in gitignored `fourd/testdata/` (local testing only, never
redistributed; IP-flagged assets in the same sources were excluded).
