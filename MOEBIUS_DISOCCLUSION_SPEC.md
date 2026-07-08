# moebius.js — Disocclusion System Specification

## What this document is

This is the complete architectural and algorithmic specification for the
background-layer disocclusion system in moebius.js, a 2.5D head-tracked portal
renderer that takes a single image + depth map and renders it as a parallax scene.
It captures every design decision, formula, failure mode, and lesson learned across
~3 months of development. It is written so that an implementor (human or AI) can
build the system from scratch without the conversation history.

---

## 1. The Problem

Given one image and one depth map, the renderer splits the scene into a foreground
mesh (the figures) and a background layer (everything behind them). When the viewer
moves their head, the foreground shifts more than the background — parallax. This
opens **disocclusion holes**: regions behind figures that were never photographed and
must be filled plausibly.

The disocclusion system produces:
- **Plug depth**: a rubber-sheet surface welded to the rim of each hole, at the
  local background depth — never protruding toward the foreground.
- **Fill color**: plausible background color inside each hole, continuing the
  painting's own texture.
- **Transparency**: the plug exists *only* inside the holes. No second surface
  anywhere else.

---

## 2. The Four Laws

These emerged from iterative visual testing at extreme camera offsets (±0.12 in
the app's normalized units). Every design decision traces to one of them.

### Law 1 — Zero foreground on the background layer
The background layer carries no foreground content — not its colors, not its depth.
Any foreground pixel on the background layer creates a "ghost outline" that tracks
with the figure at the wrong parallax rate.

### Law 2 — Welded plug at local background depth
Each hole is plugged by a rubber sheet whose edges **weld to the background rim**
of the hole. The interior sits at the local background surface depth — cave wall
behind the troll, floor behind the serpent — **never extruding toward the
foreground**. A plug at figure depth is visible as a bright (near) blob that warps
at figure speed, breaking the illusion.

### Law 3 — Transparent everywhere else
The plug is transparent (discarded) everywhere it is not plugging a hole. No
passthrough surface, no "clean plate," no matte painting in the distance. Any
full-frame background surface creates parallax mismatch at floor/wall holes (the
matte moves at a different rate than the floor it's supposed to continue).

### Law 4 — Fill continues the painting's own pixels
The color filling each hole continues the painting's own texture — stroke grain,
value, structure — from the valid background at the hole's rim. Not a wash, not
white noise, not AI-generated content. The first ~20px of any reveal should be
near-copies of the adjacent real background, which is physically what appears from
behind an edge.

---

## 3. Architecture Overview

```
Image + Depth
      │
      ▼
  ┌──────────┐
  │ SHARPEN  │  Color-guided weighted-median snap (σ=0.08, 2 passes)
  │          │  Concentrates depth edges to sub-pixel; makes interiors smooth
  └────┬─────┘
       ▼
  ┌──────────┐
  │ DETECT   │  step₃ > max(0.03, 9·slope)
  │          │  Slope-relative edge detection on the sharpened depth
  └────┬─────┘
       ▼
  ┌──────────┐
  │  BAND    │  Budgeted dilation from detected edges, budget = |LUT(d)−LUT(rim)|
  │          │  The disoccludable rim zone (the hole footprint)
  └────┬─────┘
       ▼
  ┌──────────┐         ┌──────────┐
  │  PLUG    │────────▶│  FILL    │
  │ (depth)  │         │ (color)  │
  └────┬─────┘         └────┬─────┘
       │                    │
       ▼                    ▼
  ┌──────────────────────────────┐
  │     BG MESH (plug only)     │  Displacement = plug depth
  │     Transparent outside     │  Color = fill
  │     Cut at plug seams       │  Law 3: exists only in holes
  └──────────────────────────────┘

  ┌──────────────────────────────┐
  │     FG MESH (full scene)     │  Displacement = sharpened depth
  │     Cut at fwidth > 0.008    │  Occludes the BG mesh by z-buffer
  └──────────────────────────────┘
```

---

## 4. Stage-by-Stage Algorithm

### 4.1 Sharpen

**Purpose:** Snap soft depth edges to hard steps so the detector and cut work
cleanly. Without this, gradual depth ramps produce wide, ambiguous bands and the
0.008 cut tears smooth surfaces.

**Algorithm:** Color-guided weighted-median filter. For each pixel, collect a 5×5
neighborhood. Weight each neighbor by color similarity (Gaussian, σ=0.08 in
normalized RGB). Take the weighted median of the depth values. Two passes. Only
applied inside the "edge zone" (pixels where the local depth range exceeds a
threshold), leaving smooth interiors untouched.

**Certified property:** After sharpening, smooth figure interiors measure < 0.008
depth-gradient/px everywhere (verified: 0 false discards at τ=0.008 on the
reference asset). This is what makes the aggressive FG cut safe.

**Runtime:** ~700–900ms in JS (single-threaded CPU). Already ported and certified
bit-exact (63/64 regression samples).

### 4.2 Detect

**Purpose:** Mark depth edges (occluder silhouettes) as seeds for band growth.

**Algorithm:** Slope-relative threshold on the sharpened depth:
```
step3 = max(d) - min(d)  over a 3×3 window
slope = local depth gradient magnitude over a wider window
edge[i] = step3[i] > max(0.03, 9 * slope[i])
```

The slope-relative term prevents false edges on gently sloping surfaces (cave
walls, floors) while catching genuine silhouettes. The 0.03 floor catches edges
even in flat regions.

**Certified property:** 96.9% coverage of soft contours the fixed-threshold
detector missed. Already ported in the edgebake module.

### 4.3 Band

**Purpose:** Grow the detected edges into the disoccludable rim zone — the set of
pixels that will be replaced by the plug.

**Algorithm:** Budgeted BFS dilation from each detected edge pixel. The budget at
each pixel is the **parallax budget**: `|LUT(d_pixel) - LUT(d_edge)|`, where LUT
is the app's parallax displacement curve. A pixel exhausts its budget when it has
moved (in screen space) as far as the head-tracking range allows. This ensures the
band is exactly as wide as the maximum reveal at each edge — no wider (wasting fill
quality) and no narrower (leaving gaps).

**The parallax curve (exact formula):**
```
s(d) = d < 0.5 ? 0.02·(1 - smoothstep(0,0.5,d)) : -0.04·smoothstep(0.5,1,d)
LUT(delta, d) = delta · s(d) / (0.20 + s(d)) · (W / 0.16)
```
where `delta` is the camera offset, `W` is image width, and `smoothstep(a,b,x) =
t²(3-2t)` with `t = clamp((x-a)/(b-a), 0, 1)`.

**Current status:** Computed by the app's existing GPU passes (seed + 64-iteration
dilation). The band for the reference asset is ~90,413px (10.4% of frame). For the
JS plug port, the band is loaded from `defaultBgBand.png` rather than read back
from the GPU (encoding mismatches caused failures in readback attempts).

### 4.4 Plug (Depth)

**Purpose:** Fill each hole with a smooth depth surface welded to the surrounding
background — Law 2.

**Algorithm (four steps):**

#### Step A — Valid set and locally-far anchor selection

> **⚠️ CRITICAL:** `valid = ~fillset`, NOT `~band`. The fillset is `band ∪
> figure_interiors` — everything that is NOT definitely background. Using `~band`
> treats figure pixels as valid anchors, causing the plug to extrude to figure
> depth (the root cause of all prior JS port failures: troll extruded from the
> correct 0.021 to 0.191).

```
fillset = band | elevated_pixels    (where elevated = d > boxMin(d, 61) + threshold)
valid   = ~fillset                  (only true background pixels)
vinf    = where(valid, depth, 2.0)  (sentinel keeps invalids out of the min)
far     = boxMin(vinf, radius=21)   (farthest valid depth in a 43×43 window)
anchor  = valid & (depth <= far + 0.08)
```

The anchor test excludes occluder rims — valid pixels that sit markedly nearer
than the local far field. The 0.08 slack admits gently-varying background while
rejecting figure edges.

For the reference asset, the exact fillset is pre-computed (shipped as
`defaultBgValid.png` = `~fillset`). For general use, the app's existing
flood/companion-d GPU pass computes the equivalent FG/BG classification.

#### Step B — Dirichlet values via nearest-anchor transport

```
extA = nearestValue(depth, anchor)   // two-pass 4-connected chamfer
```

Each band pixel is assigned the depth of its nearest anchor. This is the
Dirichlet boundary condition for the harmonic solve. Two-pass chamfer (forward
then backward) is sufficient when the valid set is correct (verified: plug matches
v5 within 0.0035 p95 with chamfer).

> **Note:** When the valid set was wrong (`~band`), the chamfer found figure
> pixels as "nearest anchor" and the plug extruded. With `~fillset`, the nearest
> anchor is always a true background pixel, so the chamfer works correctly.

#### Step C — Bounded harmonic solve (220 Jacobi sweeps)

```
ring     = band pixels with a non-band 4-neighbor (the weld boundary)
interior = band & ~ring

D[i] = band[i] ? extA[i] : depth[i]     // initialize
D[ring] = extA[ring]                      // pin the ring (Dirichlet)

for s = 0..219:
    for each interior pixel i:
        D2[i] = 0.25 * (D[left] + D[right] + D[up] + D[down])   // clamp borders
    D2[ring] = extA[ring]                 // re-pin every sweep
    swap(D, D2)

plugDepth[i] = band[i] ? D[i] : depth[i]
```

**220 sweeps** reproduces the eye-approved reference within p95 0.0035. More sweeps
move negligibly (1500 sweeps: p95 0.0065 improvement). On GPU: ~220 ping-pong
passes of a trivial 4-tap fragment shader. On CPU: ~1.7s in JS at 851×1023.

> **Do NOT use multigrid.** Tested: coarse grids smear the thin plug ribbons and
> diverge to 0.27 max error. Flat Jacobi at full resolution is the correct method.

**Border convention:** Edge-replicate (clamp). The `boxMin` and Jacobi shifts both
use clamped borders. Reflect or zero borders will drift the rim values.

#### Step D — Output

`plugDepth`: Float32Array, same dimensions as input. Equals plug depth inside the
band, equals scene depth outside. The band mask (Law 3) drives transparency
separately.

**Verified metrics (reference asset — Frazetta troll/woman painting, 851×1023):**

| Region | Plug depth | Figure depth | Wall depth | Plug→wall | Nearer than figure |
|---|---|---|---|---|---|
| Behind troll | 0.021 | 0.525 | 0.000 | 0.021 | **0.0%** |
| Behind woman | 0.139 | 0.176 | 0.122 | 0.018 | 34.4%* |

\* Known residual: low-contrast pocket where the harmonic pulls slightly toward
the woman's edge. Acceptable for first version; the correct fix is per-hole
valid-rim-only anchor refinement (three global-bias attempts each regressed other
regions — do not retry).

### 4.5 Fill (Color)

**Purpose:** Fill each hole with plausible background color — Law 4.

**Current best (exemplar continuation, "fill v3"):**

```
For each fill pixel (in priority order by distance from the rim):
    Search valid background within a local window for the patch whose
    7×7 context best matches the fill pixel's known-neighbor context.
    Copy that pixel's color. (Quarter-res solve, full-res offset application.)

Blend: 0.7 · structure + 0.3 · pull-push wash (deep interiors relax toward wash)
```

This produces real copied paint strokes and texture. Computed offline (~50s in
numpy at quarter-res); the result is importable via the 🎨 button (`procedural_fill_v3.png`).

**Simpler alternative (copy-blend, "fill v2"):**
```
fill(p) = (1-k) · blur₃(painting[nearest_valid(p)]) + k · wash(p)
    where k ramps from 0 at the rim to 0.7 deep inside
```
Faster, tonally correct (dark cave stays dark), but lacks structure.

**The wash:** Pull-push pyramid from valid (non-fill) pixels. Carries the lighting
(low frequency) faithfully. Used as the relaxation target deep inside large holes.

**What doesn't work:**
- Flat wash alone: correct tone but zero texture — every membrane becomes a
  visible flat stripe against the painting's grain (the "paper-thin things" symptom)
- Spectral/FFT synthesis: correct texture statistics but no structure — palette
  without strokes, reads as colored fog
- SD/diffusion: works but violates the "elegant formula, not an API call" constraint

### 4.6 FG Mesh Cut

**Purpose:** The foreground mesh discards at depth discontinuities so the plug
shows through.

**Algorithm:** In the FG material's fragment shader:
```glsl
float depthRate = fwidth(vNormalizedDepth);
if (depthRate > 0.008) discard;   // "isGap = true" in the shader
```

The 0.008 threshold (vs the original 0.03) is safe because sharpening guarantees
smooth interiors measure < 0.008/px everywhere (verified: 0 false discards). This
kills the entire 13,924px "skin class" (silhouette steps between 0.008 and 0.03)
that previously connected figures to the background as visible 1-2px walls.

**Gated:** Only applies when the certified sharpened depth is in use (`u_cutSharp`
uniform, set by the live bake or certified-source gate). Uncertified assets keep
the legacy slider threshold to avoid tearing smooth surfaces on raw depth ramps.

### 4.7 Plug Seam Cut

**Purpose:** Where the plug's edge meets the surrounding mesh at a genuine depth
step, the mesh would stretch a wall across the jump. The seam cut discards at
those steps so the surfaces separate cleanly.

This was chosen over "open figure-edge holes" (option a) by visual comparison —
full plug + cut at seams fills everything, while opening holes left void slivers
at extreme offsets.

---

## 5. Renderer Twin (Offline Verification)

A numpy rasterizer (`twin.py`) that faithfully reproduces the app's mesh rendering:
- Uses the app's exact `parallaxCurve` (the LUT formula above)
- Mesh-faithful 1D rasterizer with span interpolation between neighbors
- Cut skips (no span drawn across discards)
- Z-buffer compositing: BG layer first, FG layer on top
- Two-pass shear for the Y axis (approximation disclosed)

**Standing instruction:** Always render at **very offset** (±0.12) — that's where
the background shows itself and every defect is visible. The twin was built after
the "protocol collapse" where seam tables were being certified without ever
rendering a view.

---

## 6. The Deployment Architecture

### Current state (what works)
- **Sharpen + detect + cut:** Run live via the inlined `MoebiusEdgeBake` module at
  BG-layer build time (~880ms). Certified 63/64 regression against the numpy
  reference. Works on any asset.
- **Band:** Computed by the app's existing GPU passes (seed + 64-iteration dilation).
  For the plug port, loaded from `defaultBgBand.png` (verified: 90,413px, 10.4%).
- **Plug:** Computed by the `MoebiusPlug.buildPlugFromValid()` JS module (~1.7s CPU).
  Requires `band` + `valid` masks as input. Output is a Float32 DataTexture
  (RedFormat, FloatType, NoColorSpace) bound to the BG mesh displacement.
- **Fill color:** The app's existing pull-push wash, overridable via the 🎨 button
  with `procedural_fill_v3.png` (exemplar continuation).

### Files deployed alongside moebius.html
| File | Purpose |
|---|---|
| `moebius.js` | The app (v3.11.1-liveplug) |
| `defaultBgBand.png` | Band mask (white = plug here) |
| `defaultBgValid.png` | Valid-background mask (white = definitely background) |
| `defaultBgDepthBand.png` | Pre-baked depth record (regression reference) |
| `procedural_fill_v3.png` | Exemplar color fill (import via 🎨) |

### What remains for full generality
1. **Band from GPU → JS:** The GPU computes the band correctly, but reading it back
   failed (channel encoding mismatch). Either fix the readback encoding or compute
   band on CPU (the algorithm is a budgeted BFS, ~100 lines).
2. **Valid/fillset from GPU → JS:** The app's companion-d / flood pass computes
   FG/BG classification. Wire that result to the plug module's `valid` input.
3. **Fill on CPU:** Port the exemplar or copy-blend fill to run at load time, or
   keep the 🎨 override for manual use.
4. **Generality test:** Drop in a **never-seen image** with a figure standing well
   in front of a distant wall (the stress case the Frazetta painting lacks, where
   plug-follows-background vs plug-follows-figure actually diverge). If the plugs
   sit at wall depth there, the system is genuinely general.

---

## 7. Lessons Learned (Failure Modes to Avoid)

### 7.1 valid = ~band vs valid = ~fillset
The single most expensive bug in the project. `~band` includes figure-interior
pixels as "valid," so the plug's anchor selection treats figure depth as background.
The plug then sits at figure depth (extrusion), which is invisible in aggregate
metrics but immediately visible to the eye. **Always use `~fillset`** (true
background only).

### 7.2 Certifying by table instead of rendering
For months, seam tables (p50/p95/max of depth gradients at boundaries) were the
acceptance gate. These caught some real defects but missed others entirely — the
"ghost outline" extrusion was invisible to the table because it was *within
tolerance* per pixel while being perceptually loud as a coherent stripe. The
renderer-twin and "always look at very offset" protocol were the fix. **Never
certify a visual artifact by its metric alone.**

### 7.3 Per-asset archaeology
Records, fingerprint gates, fallback chains, certified-asset toggles — each was
justified individually and collectively built a system that could only render one
painting. The cure is the formula pipeline: the same eight stages run on any input,
records become regression fixtures, and the gate becomes a test assertion.

### 7.4 Multigrid for thin structures
Multigrid Jacobi solves diverge on the plug because the plug ribbons are only a
few pixels wide. The coarse grid smears them, and prolongation can't recover the
detail. **Use flat full-resolution Jacobi** (220 sweeps, ~1s CPU).

### 7.5 The matte-plate fallacy
A smooth far matte plate (v5 in the session) seems elegant but fails at floor and
wall holes: those holes *should* reveal floor/wall at the correct depth, not a
distant plane. The matte creates parallax mismatch — the floor through the hole
moves at matte speed, not floor speed. **The plug must weld to each hole's own
rim depth**, which is why it's a harmonic interpolation, not a flat surface.

### 7.6 Debugging a live renderer by screenshot
Five consecutive misdiagnoses of why a depth PNG wasn't reaching the mesh — each
requiring a full round-trip deploy-and-screenshot cycle. The bugs were real but
narrow (fingerprint gate comparing against sharpened instead of raw; scope error;
sRGB gamma decode; GPU readback encoding). All would have been one-iteration fixes
with a live console. **Use devtools or Claude Code for runtime wiring.**

---

## 8. Test Fixtures

Shipped in `port_fixtures.npz` (numpy format, 851×1023 reference asset):

| Array | Type | Description |
|---|---|---|
| `sharpened` | float32 | Input to the plug (after sharpen stage) |
| `band` | uint8 | The correct band mask (1 = plug here) |
| `valid` | uint8 | The correct valid mask (1 = background) |
| `ext` | float32 | Nearest-valid-background depth at each pixel |
| `plug_v5` | float32 | **The reference plug output — match this** |

Plus `plug_golden200.csv`: 200 `(flat_index, plug_depth)` samples for a quick
language-agnostic spot check.

**Acceptance tolerances:**
```
err = abs(port_output[band] - plug_v5[band])
err.mean() < 0.01      (the chamfer causes ~0.006 mean vs EDT)
err.p95   < 0.025      (chamfer-vs-EDT boundary effects)
err.max   < 0.25       (isolated concave-rim pixels)
```

**Spot checks (must pass regardless of aggregate):**
- Behind troll (180:520, 300:470): plug median ≈ 0.02, must be < 0.10
- Behind woman (560:900, 410:560): plug median ≈ 0.14, must be < 0.18

---

## 9. The Parallax Curve (Reference)

The app's displacement function, used by both meshes and the renderer-twin:

```javascript
function parallaxCurve(d, delta, W) {
    // d: normalized depth (0=far, 1=near)
    // delta: camera offset (-0.12 to +0.12)
    // W: image width in pixels
    // returns: horizontal pixel displacement
    const t1 = Math.min(Math.max(d / 0.5, 0), 1);
    const s_lo = 0.02 * (1 - t1*t1*(3-2*t1));
    const t2 = Math.min(Math.max((d - 0.5) / 0.5, 0), 1);
    const s_hi = -0.04 * t2*t2*(3-2*t2);
    const s = d < 0.5 ? s_lo : s_hi;
    return delta * s / (0.20 + s) * (W / 0.16);
}
```

Near objects (d→1) shift up to ~±50px at full offset. Far objects (d→0) shift
~±10px. The non-linear curve and asymmetric near/far range are why the band budget
is per-edge rather than uniform.

---

## 10. File Manifest

| File | Lines | Role |
|---|---|---|
| `moebius.js` | ~10,700 | The app (renderer, UI, all stages) |
| `moebius_disocclusion_DRAFT.js` | 95 | Verified plug module (portable) |
| `plug_port.js` | 95 | Same module, working copy |
| `twin.py` | 35 | Renderer-twin for offline verification |
| `PLUG_PORT_SPEC.md` | ~200 | Plug algorithm spec with test plan |
| `HANDOFF.md` | ~200 | Bug chain + integration guide |
| `port_fixtures.npz` | 12MB | Test arrays for the reference asset |
| `plug_golden200.csv` | 3KB | Quick spot-check samples |

---

## 11. What "Done" Looks Like

Load any image + depth map. The system runs sharpen → detect → band → plug → fill
→ two meshes, all at load time, with no pre-baked per-asset files. Move to ±0.12.
The foreground parallaxes ahead of the background. Behind every figure, the
background continues as plausible cave/wall/floor at the correct depth. No ghost
outlines, no extruding blobs, no flat stripes, no wash fog. The plug exists only
where needed, welded at the rims, transparent elsewhere. The fill wears the
painting's own texture.

Then load a **second** image the system has never seen — a figure standing well in
front of a distant wall. The plugs sit at wall depth, not figure depth. That is
disocclusion as a formula.
