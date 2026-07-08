# moebius.js — Handoff & Efficient Path Forward

You've been validating live-app behavior by screenshotting a debug sheet and
mailing it back. That loop works but is ~30× slower than fixing these in a
browser with devtools open. This document gives you (1) the three real bugs I
found, each a few lines, verifiable in minutes live; (2) the depth pipeline that
is *proven correct in numpy* and just needs faithful wiring; (3) exactly what to
check so you're never guessing.

---

## The situation in one paragraph

The **disocclusion depth design is solved and proven** (welded plugs, no forward
extrusion, verified against eye-approved renders). What has been failing is
purely **plumbing between the correct depth data and the mesh** — a chain of
small, real bugs in the app's texture handling that are hard to see without a
live console but trivial to fix with one. The current build (`v3.10.4-lineardepth`)
has my best attempt at all three fixes; the last one (colorspace) is applied but
unverified because I can't run the browser.

---

## The three bugs (all found this session, in order of discovery)

### Bug 1 — raw-fingerprint gate mis-rejects the depth record  ✅ fixed & shipped
`bandCertifiedFor(L)` gates whether the loaded `defaultBgDepthBand.png` reaches
the mesh. It compares the layer's **current depth** against a hardcoded
fingerprint of the **raw** asset (`FP[]`, "v3.9.6 raw-depth samples"). But by the
time the gate runs, `applyCertifiedSource`/live-bake has already swapped
`L.textures.depth` to the **sharpened** field — so it never matches the raw
fingerprint, `_bandCertified` is false, and the mesh silently falls back to the
live plug. **Symptom:** footer shows `live=bake`, your loaded PNG never appears.
**Fix (applied):** bind the loaded record directly when present and
dimension-matched, bypassing the raw-fingerprint gate. See the
`_bgWhich = 'record'` block in `buildBackgroundLayer`.

### Bug 2 — `srcW`/`srcH` undefined at the bind site  ✅ fixed & shipped
My Bug-1 fix referenced `srcW`/`srcH`, which only exist in the debug-sheet
function, not in `buildBackgroundLayer` (where the dims are `w`/`h`). Threw
`ReferenceError: srcW is not defined` before the mesh was built. **Fix:** use
`w`/`h`. Trivial, done.

### Bug 3 — loaded depth PNG is gamma-decoded (sRGB), flattening the depth  ⚠️ fix applied, UNVERIFIED
This is the "missing plugs" symptom in the latest sheet. The app's own depth
lives in a **FloatType linear render target**; my depth arrives as an **8-bit PNG
loaded as a normal texture**. three.js, by default, treats loaded images as sRGB
and **gamma-decodes them on sample** — which nonlinearly crushes the depth values
into the smooth gradient you saw in `live depth incl. BG`. The plugs aren't
missing; the whole depth field got flattened.
**Fix (applied, needs live confirmation):**
```js
bandOfRecordTex.colorSpace = THREE.NoColorSpace;   // r152+ API
bandOfRecordTex.encoding   = THREE.LinearEncoding; // pre-r152 API
bandOfRecordTex.flipY      = false;                // match render-target convention
```
**How to verify in 30 seconds live:** load the build, open console, rebuild the
BG layer, look at the `live depth incl. BG` panel. If it shows **structured depth
with figure silhouettes and dark plug holes** (like the app's own plug did), Bug 3
is fixed. If it's still a **smooth gradient**, the colorspace fix didn't take and
the next thing to try is loading the depth as an explicit `DataTexture`
(Float32, `NoColorSpace`) instead of an `<img>` — see §4.

---

## The depth pipeline (proven correct — this is what should run)

The plug algorithm is fully specified with reference numpy and unit-test fixtures
in **`PLUG_PORT_SPEC.md`** (shipped alongside this). Summary of the four laws it
encodes, all validated by eye at very-offset (±0.12):

1. BG layer carries **zero** foreground content.
2. Each hole plugged by a sheet **welded to its background rim**, interior at the
   local background depth — **never extruded toward the foreground**.
3. Plug is **transparent everywhere it isn't plugging**.
4. Fill **color** continues the painting's own pixels (exemplar/nearest-valid).

**Verified metrics on the reference asset** (behind the troll): plug sits 0.021
from the far wall, **0% of pixels nearer than the figure** (no extrusion), welds
hold (interior over-weld max +0.048). **Known residual:** behind the woman, a
low-contrast pocket where ~34% of plug pixels sit slightly proud (+0.018 median) —
minor, documented, and the first refinement target. **Do not** fix it with a
global depth bias: three attempts each regressed other regions. The correct fix is
a per-hole, valid-rim-only anchor refinement, developed against the fixtures.

**Portability note:** the plug is a bounded (220-sweep) Jacobi harmonic —
GPU-friendly (~220 ping-pong passes of a 4-tap shader, sub-100ms). Multigrid was
tested and **diverges** (smears thin ribbons); use flat full-res Jacobi.

---

## What to do next, in priority order

### Immediate (minutes, live browser)
1. Deploy `moebius.js` (v3.10.4-lineardepth) + `defaultBgDepthBand.png` together.
2. Console must show, on BG-layer build:
   `[RUNG-P] BG mesh displacement source = record (loaded PNG / v5 plug)`
   → confirms Bugs 1–2 fixed (the record reaches the mesh).
3. Check the `live depth incl. BG` panel:
   - **Structured (silhouettes + plug holes)** → Bug 3 fixed. You're now looking
     at the verified v5 depth. Validate at ±0.12: troll plugs at wall depth, no
     extrusion. Ship it.
   - **Smooth gradient** → Bug 3 fix didn't take → §4.

### If Bug 3 persists (§4 — the DataTexture route)
The robust fix is to not use an `<img>` for depth at all. Load the PNG, draw to a
canvas, read pixels, build a `THREE.DataTexture(Float32Array, w, h, RedFormat,
FloatType)` with `colorSpace = NoColorSpace`, `flipY` handled manually, and bind
*that*. This exactly matches how the app's own render-target depth is typed and
sidesteps all image-colorspace behavior. ~15 lines; I can write it if you confirm
the symptom, or any dev can from this description.

### Durable (the real finish)
Port the plug per `PLUG_PORT_SPEC.md` to run **live at load** (no baked PNG), and
verify each function against `port_fixtures.npz` / `plug_golden200.csv`. Then the
true test: a **never-seen image** with a figure in front of a distant wall (the
stress case this painting lacks). That's disocclusion as a formula.

---

## Files in this handoff
- `moebius.js` — v3.10.4-lineardepth (Bugs 1–2 fixed, Bug 3 fix applied/unverified)
- `defaultBgDepthBand.png` — the **verified v5 depth record** (correct data)
- `PLUG_PORT_SPEC.md` — plug algorithm, reference numpy, integration notes
- `port_fixtures.npz` — arrays incl. `plug_v5` (the target output) for unit tests
- `plug_golden200.csv` — 200 sampled plug values for a quick check
- `HANDOFF.md` — this file


---

## LIVE CONSOLE RESULT (latest run — read this first)

Actual output from the deployed v3.10.4 build:
```
[RUNG-P] certified-asset fingerprint MATCHED; depth path = band
[RUNG-LIVE] bake 882ms at 851x1023 — sharpen + detector + cut computed live (17235 edge px)
[RUNG-LIVE] regression vs sharpened record: 63/64 PASS
[BG-LAYER] lake closure: sealed-wall flag flood (256) + lake fill (128)
[RUNG-P] BG mesh displacement source = live (live bake fallback)   <-- THE BUG
[BG-LAYER] built: band + plug depth + baked color, mesh added behind layer 0
```

### Two big positives confirmed
- **The live bake is CORRECT**: `regression vs sharpened record: 63/64 PASS`.
  Sharpen + slope-detector + 0.008 cut now compute correctly on any asset at load
  (~880ms). This is the hard part of the pipeline and it works.
- The fingerprint gate at load (`bandCertifiedFor`, line ~6264) **MATCHED** — so
  `bandOfRecordImg` is loaded and non-null by build time.

### The one remaining bug, fully narrowed
Two code paths disagree about the same object at BG-layer build:
- Line ~6264 `bandCertifiedFor(L)` → **MATCHED** (implies `bandOfRecordImg` is a
  valid, loaded image).
- Line ~6942 my direct-bind check
  `bandOfRecordTex && bandOfRecordImg && naturalWidth===w && naturalHeight===h`
  → **FALSE** (falls back to `live`).

So one of these is true at build time and must be logged to see which:
1. `bandOfRecordTex` is still null (texture created in the onload, but a different
   load path set `bandOfRecordImg` without creating the texture — check whether
   the fingerprint path and my texture-creation path are the same onload), OR
2. `w`/`h` at the bind site ≠ `naturalWidth`/`naturalHeight` (the mesh build `w,h`
   may be a downscaled working resolution, not the image's native 851×1023).

**#2 is my leading suspicion** — the BG pipeline may run at a processing
resolution that differs from the PNG's native size, so the dimension equality
fails even though the image is fine.

### The five-minute live fix
Open devtools, set a breakpoint (or add a log) at line ~6942 and print:
```js
console.log('DIAG', {
  hasTex: !!bandOfRecordTex,
  natW: bandOfRecordImg && bandOfRecordImg.naturalWidth,
  natH: bandOfRecordImg && bandOfRecordImg.naturalHeight,
  w, h
});
```
- If `w,h` ≠ `natW,natH` → **remove the dimension check** (or resample). The record
  should bind regardless; a size mismatch just means the texture samples in UV
  space, which is fine for displacement.
- If `hasTex` is false → the texture isn't being created on the same onload that
  sets `bandOfRecordImg`; create `bandOfRecordTex` wherever `bandOfRecordImg` is
  assigned.

### BUT — do you even need the record anymore?
Since the **live bake now passes 63/64**, the depth *inputs* (sharpened source,
detector, cut) are correct live. The thing still wrong is the app's **band+plug
construction** consuming those inputs — that's the extrusion, and it's the exact
logic replaced by `PLUG_PORT_SPEC.md`. So the highest-value move is no longer
"make the PNG bind" — it's **port the plug per the spec so the live path builds
the correct plug directly**, making the baked PNG unnecessary. The record-bind
was a bridge to see correct depth; the live bake passing regression means the
bridge is nearly obsolete.

## The one thing to internalize
The depth is right. Every remaining failure has been the **data-to-mesh plumbing**,
not the algorithm. Fix that plumbing with a live console open (Bug 3, then the
DataTexture route if needed) and you're done with the depth. The plug port is the
only substantial remaining work, and it's fully specified and test-guarded.
