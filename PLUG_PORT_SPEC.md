# Disocclusion Plug — Port Specification

**Purpose.** Implement the background-layer *plug* (the rubber sheet that fills
disocclusion holes) as live, load-time code for any image + depth map. This spec
is written so each function can be unit-tested against reference outputs before
integration — the failure mode we hit was reimplementation drift in an untested
harness, and the fixtures below exist to catch exactly that.

The depth **design** is settled and proven; this is a faithful-port task, not a
research task. The reference implementation is the numpy in §3. Match it.

---


> **⚠️ CRITICAL CORRECTION (found during port):** The original spec said
> `valid = ~band`. THIS IS WRONG. The correct definition is
> `valid = ~fillset` where `fillset = band ∪ figure_interiors`. Using `~band`
> treats figure pixels as valid anchors, causing the plug to extrude to
> figure depth (behind-troll: 0.191 instead of the correct 0.021). This one
> variable was the root cause of ALL prior JS port drift (p95 0.46).
>
> The fillset/valid mask is shipped as `defaultBgValid.png` (white = valid
> background). For general computation: `fillset = band | (depth > boxMin(depth,61) + threshold)` 
> approximates it, but exact FG/BG classification requires the app's existing flood/companion-d pass.

## 0. The four laws (acceptance context)

1. The background layer carries **zero** foreground content — no FG color, no FG depth.
2. Each hole is plugged by a sheet **welded to its background rim**, interior at the
   local background surface depth — **never extruded toward the foreground**.
3. The plug is **transparent everywhere it is not plugging** (a single `discard` on
   the band mask in the BG material — no passthrough surface).
4. Fill **color** continues the painting's own pixels into the holes (separate stage;
   not covered here — this spec is depth only).

Verdicts are read by eye at **very offset** (±0.12 in the app's camera units), with
the foreground toggled off and depth shown in grayscale. Aggregate metrics hid real
defects repeatedly; the pixel-level fixtures in §4 are the guard.

---

## 1. Inputs / outputs

**Input**
- `sharpened : Float32Array(W*H)` — the depth map after the certified sharpen stage
  (values 0..1, nearer = larger). Sharpen is a **prior** stage; the plug consumes its
  output. (If porting sharpen too, its module is already certified bit-exact elsewhere.)
- `band : Uint8Array(W*H)` — the hole/rim set to be plugged (1 = plug here). **Use the
  existing band detector output.** Do not rewrite band detection in this task; a naive
  BFS flood-fills ~50% of frame instead of the correct ~10% (learned the hard way).
- `W, H : int`.

**Output**
- `plugDepth : Float32Array(W*H)` — plug depth inside `band`, equal to `sharpened`
  outside it. This is what the BG mesh displaces by; the band mask drives transparency.

---

## 2. Algorithm (four steps)

**Step A — locally-far anchor selection.**
The plug must interpolate only *true background* rim depths, never the occluder's own
edge (that edge is what causes forward extrusion). A valid pixel qualifies as an anchor
iff it is **not markedly nearer than the farthest valid depth in a wide neighborhood**:

```
valid[i]      = (band[i] == 0)
farField      = boxMin( depthWithInvalidAs(+2.0), radius=21 )   # farthest valid nearby
anchor[i]     = valid[i] AND depth[i] <= farField[i] + 0.08
```

`boxMin` is a separable square-window minimum with clamped borders. `+2.0` sentinel
keeps invalid pixels out of the min. The `0.08` slack admits gently-varying background
while rejecting occluder rims (which sit well forward of the local far field).

**Step B — Dirichlet values via nearest-anchor.**
Each band pixel is pinned (at the ring) and initialized from the nearest anchor's depth:

```
extA = nearestValue(depth, anchor)   # two-pass chamfer: propagate anchor depths
```

Two-pass chamfer (forward then backward 4-neighbor) is sufficient; exact Euclidean not
required — only nearest *value* matters, and the harmonic solve smooths residual error.

**Step C — bounded harmonic solve.**
Jacobi iteration of the discrete Laplace equation on the band **interior**, with the
**ring pinned** to `extA` every sweep. Ring = band pixels 4-adjacent to any non-band
pixel.

```
D[i]  = band[i] ? extA[i] : depth[i]
for s in 0..SWEEPS:            # SWEEPS = 220 (verified; see §4)
    for each interior band pixel i:
        D2[i] = 0.25 * (D[left] + D[right] + D[up] + D[down])   # clamp borders
    for each ring pixel: D2[i] = extA[i]
    swap(D, D2)
plugDepth[i] = band[i] ? D[i] : depth[i]
```

**220 sweeps** reproduces the eye-approved reference within **0.0035 p95** (a 1500-sweep
solve moves only 0.006 further — diminishing past ~220). On GPU this is ~220 ping-pong
passes of a trivial 4-tap shader (sub-100ms at this resolution); on CPU, ~1s in JS.

> **Do NOT use multigrid.** Tested: coarse grids smear the thin (~few-px) plug ribbons
> and diverge to 0.27 max error. Flat Jacobi at full resolution is the method.

**Step D — output.** `plugDepth` as above. Transparency (Law 3) and color fill (Law 4)
are separate; this function returns depth only.

---

## 3. Reference implementation (authoritative — match this)

```python
import numpy as np
from scipy.ndimage import minimum_filter, binary_erosion, distance_transform_edt

def build_plug(sharpened, band, sweeps=220):
    H, W = sharpened.shape
    valid = ~band.astype(bool)

    # Step A: locally-far anchors
    vinf = np.where(valid, sharpened, np.float32(2.0))
    far  = minimum_filter(vinf, size=43, mode='nearest')     # radius 21 -> size 43
    anchor = valid & (sharpened <= far + 0.08)

    # Step B: nearest-anchor Dirichlet values
    _, (ay, ax) = distance_transform_edt(~anchor, return_indices=True)
    extA = sharpened[ay, ax].astype(np.float32)

    # ring = band pixels adjacent to non-band
    ring = band.astype(bool) & ~binary_erosion(band.astype(bool), iterations=1)

    # Step C: bounded Jacobi harmonic, ring pinned
    D = np.where(band.astype(bool), extA, sharpened).astype(np.float32)
    D[ring] = extA[ring]
    interior = band.astype(bool) & ~ring
    def shift(a, dy, dx):
        o = np.empty_like(a)
        ys = slice(max(dy,0), H+min(dy,0)); yd = slice(max(-dy,0), H+min(-dy,0))
        xs = slice(max(dx,0), W+min(dx,0)); xd = slice(max(-dx,0), W+min(-dx,0))
        o[:] = a; o[yd, xd] = a[ys, xs]      # clamp borders (edge replicate)
        return o
    for _ in range(sweeps):
        s = shift(D,-1,0) + shift(D,1,0) + shift(D,0,-1) + shift(D,0,1)
        D = np.where(interior, 0.25*s, D)
        D[ring] = extA[ring]

    return np.where(band.astype(bool), D, sharpened).astype(np.float32)
```

**Border convention:** edge-replicate (clamp). `minimum_filter(mode='nearest')` and the
clamped `shift` both replicate. Match this — reflect/zero borders will drift the rim.

---

## 4. Fixtures & unit tests (the anti-drift guard)

Shipped alongside this spec: **`port_fixtures.npz`** (from the reference asset,
851×1023) with arrays:

| key | dtype | meaning |
|---|---|---|
| `sharpened` | float32 (H,W) | plug input |
| `band` | uint8 (H,W) | the correct band (use directly) |
| `valid` | uint8 (H,W) | `~band` (convenience) |
| `ext` | float32 (H,W) | nearest-valid reference depth (weld target) |
| `plug_v5` | float32 (H,W) | **the reference output your port must match** |

Plus **`plug_golden200.csv`** — 200 `(flat_index, plug_depth)` rows sampled inside the
band, for a language-agnostic spot check without loading .npz.

**Test 1 — anchor set (Step A).** Compute `anchor`; assert it excludes occluder rims:
no anchor pixel should sit >0.08 nearer than `far` at its location. Count should be
~99%+ of valid pixels on this asset (occluder rims are a thin minority).

**Test 2 — full plug vs reference (Steps A–C).**
```
plug = build_plug(fixtures.sharpened, fixtures.band, sweeps=220)
err  = abs(plug[band] - fixtures.plug_v5[band])
assert err.mean() < 0.002 and percentile(err,95) < 0.004 and err.max() < 0.02
```
(The reference numpy hits mean 0.0000 / p95 0.0000 / max 0.0000 against itself; a
faithful port in another language should land within the tolerances above, which allow
for float-order differences. **If your port shows p95 > 0.05, Step A or B is wrong** —
that was the JS drift we caught: chamfer/anchor mismatch pushed behind-troll from the
correct 0.021 to 0.191 (extruded). Debug A and B before C.)

**Test 3 — the two spot checks (physical correctness).** At these boxes, median plug
depth must sit at the far wall, not the figure:

| region | box (rows, cols) | plug→wall target | plug must NOT exceed figure depth |
|---|---|---|---|
| behind troll | (180:520, 300:470) | ≈ 0.02 (wall ≈ 0.00) | figure ≈ 0.525; 0% plug px nearer |
| behind woman | (560:900, 410:560) | ≈ 0.02 (wall ≈ 0.122) | figure ≈ 0.176; ~34% nearer* |

\* The behind-woman **34% pocket is a known open residual** (low-contrast region where
the harmonic pulls slightly toward her edge; +0.018 median). It is acceptable for the
first live version and is the first target for refinement — do **not** "fix" it with a
global bias (three attempts each made other regions worse; see project log). The correct
fix is a per-hole, valid-rim-only anchor refinement, developed against these fixtures.

**Test 4 — welds (Law 2).** `abs(plug - ext)` on the ring may be large where the true
background rim is genuinely far (that is correct — the plug meets deep background); the
guard is instead that **interior** pixels are not *nearer* than their weld by more than
noise: `(plug - ext)[interior].max() < 0.05` (reference: +0.048).

**Test 5 — no forward extrusion (Law 2, global).** For every band pixel, `plug[i]`
should not exceed the nearest **foreground** edge depth behind it by more than noise.
Cheap proxy: `mean(plug[band] > figureEdgeNear[band])` should be small and concentrated
only in the known behind-woman pocket.

---

## 5. Integration notes

- **Transparency (Law 3):** in the BG layer's material, `if (band < 0.5) discard;`.
  There is no second surface outside the plugs — the old clean-plate/matte passthrough
  is retired (it created parallax mismatch in floor/wall holes).
- **Seam cut (Law 2 at plug edges):** the foreground mesh's `fwidth(depth) > 0.008`
  discard should **also** apply at the plug↔neighbor step so no wall is stretched across
  a genuine depth jump at the plug boundary. (This was the "full-plug (b)" option chosen
  by eye over "open the edge holes.")
- **Depth path only:** color fill is the exemplar stage (`fillSourceX/Y` offsets:
  nearest-valid pixel to copy, softened, blended to pull-push wash deep in large holes).
  Spec separately if needed; the offsets function is straightforward JFA/chamfer.
- **Parameters:** `sweeps=220`, `boxMin radius=21`, anchor slack `0.08`, cut `0.008`.
  All four are the values behind the passing fixtures; change only against re-run tests.

---

## 6. What "done" looks like

Load a **never-seen** image + depth (a figure standing well in front of a distant wall
is the stress case this asset lacks). At ±0.12 with FG off and depth in gray: the plugs
sit at the wall behind each figure, welded at the rims, transparent elsewhere, with no
ribbon reading nearer than the figure it fills behind. That is disocclusion as a formula
— which is the whole goal.
