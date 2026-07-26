# Camera FOV LUT — findings

Head-Z tracking is planned, so the table has a real consumer and this is built.
What follows is the deliverable minus the one thing this environment cannot
produce, stated plainly up front.

## 1. What is delivered, and the one gap

| Deliverable | State |
|---|---|
| `camera-fov-lut.json` | **Schema and roster complete. Every value `null` with a reason.** |
| `resolve-intrinsics.js` | **Complete and tested.** Full chain, mode rules, zoom, warnings. |
| `harness/intrinsics_test.js` | **27 assertions, all passing**, including the synthetic round trip. |
| `calibrate-charuco.md` | Tier A procedure, runnable per device. |
| Prior | **Not derived.** `derivePrior()` is implemented and refuses to return a number from an unpopulated table. |

**The gap: no outbound network in the authoring environment** (`curl` to any
external host returns 000; the same reason the MediaPipe model cannot load
here). Every FOV value would be recalled rather than sourced. Constraint 1 calls
that fabrication and constraint 2 makes it uncitable, so per constraint 1 the
entries are `null` with reasons. **The resolver consumes populated entries with
no code change** — filling the table is data entry against a tested consumer,
not further engineering.

## 2. Keying strategy, and where it cannot cover a platform

Chain: `VID:PID` → normalised label → pattern/family → prior. Implemented and
unit-tested.

**VID:PID** is the only genuinely stable key, extracted from the
`(vvvv:pppp)` suffix Chromium appends on some platforms. Which platforms do so
is **not verified here** — it needs real hardware across Chrome/Firefox/Safari
on macOS/Windows/Linux/Android — and is the first thing to check on real
machines. The resolver degrades cleanly when it is absent.

**Label normalisation** collapses the variants that are safe to collapse:
case, `_`/`-`, whitespace, and the `(Built-in)` / `(Integrated)` / `(Front)`
parentheticals. It also strips the VID:PID suffix, so a device that carries one
still matches label rows. Verified: `FaceTime HD Camera (Built-in)`,
`FaceTime_HD_Camera` and `FaceTime HD Camera` all normalise identically.

**Generic labels are a negative entry, deliberately.** `Integrated Camera`,
`Integrated_Webcam_HD`, `HD User Facing` and friends are shared across a very
large number of unrelated Lenovo/Dell/OEM machines with different modules. The
table carries them with `family: "GENERIC-DO-NOT-POPULATE"` and the resolver
treats that family as an **immediate fall-through to the prior with a warning**.
This is the one case where matching is worse than not matching, and encoding it
as a row stops a future contributor attaching a value to it.

**Coverage gap to raise:** the label is empty before camera permission is
granted. If that holds (believed, not verified here), **the LUT cannot be
consulted at page load** — intrinsics resolve only after the stream opens. The
resolver emits this as a warning rather than silently returning a prior. This
matches where the existing a144/a145 calibration already runs.

**Weak fingerprint, not used:** the resolution ladder from `getCapabilities()`.
Evaluated and rejected as a primary key — `width.max`/`height.max` collide
heavily across modules. It may be usable as a tie-breaker *within* a family
(e.g. separating FaceTime HD generations), which is where it is most needed;
noted as future work rather than guessed at now.

## 3. Mode and aspect behaviour — treated as first class

A single quoted FOV is meaningless without its mode. Encoded as a per-device
`modeRule` and applied by the resolver against live `getSettings()`:

* `crop-v` — 16:9 is a vertical crop of a 4:3 sensor. Horizontal preserved,
  vertical lost. **Measured in the test suite: a 70° horizontal 4:3 camera
  streaming 16:9 has 43.0° vertical against 55.4° native — 12.4° thrown away.**
  Quoting the 4:3 number at a 16:9 stream overstates the vertical field by that
  much, which is the classic naive-table error.
* `crop-h` — vertical preserved, horizontal cropped.
* `scale` — full sensor mapped to the output. Both preserved, which implies
  non-square pixels at a non-native aspect; the resolver warns because that
  breaks the `fy = fx` assumption.
* `unknown` — assumes `crop-v` (the common UVC case) **and says so in
  warnings**. No silent default.

**The diagonal trap, quantified.** A 78° horizontal 16:9 field is 85.8°
diagonal. Storing the diagonal and reading it as horizontal is a 7.8° error —
about 10% on fx, therefore 10% on depth gain, i.e. twice the whole accuracy
budget from one units mistake. This is why the schema stores `{raw, type,
aspect}` and never a bare derived number.

**Selectable-FOV devices** (Brio and similar) get a warning: the active mode is
not reported to the web platform, so a single row cannot be right for all of
them.

## 4. Auto-framing — RAISED, as instructed

This is worse for this consumer than a FOV error, and the reason is specific:
**auto-framing pans the sensor crop to keep the face centred, which is exactly
the signal the tracker reads as head motion.** A perfectly calibrated `fx` does
not help — the input is being counter-steered. In the limit, a camera that
centres the face perfectly makes the lateral parallax dead.

**Detection from the web platform: measured here, and the answer is no.**
Chromium 141 `getSupportedConstraints()` returns 35 keys and none is
auto-framing or equivalent. Full list in `CAMERA_FOV_LUT_STAGE0.md`. The only
framing-adjacent keys are `pan`/`tilt`/`zoom` (a separate permission, hardware
dependent) and `resizeMode`. Whether macOS Center Stage or Windows Studio
Effects can be detected or disabled from a web context on those platforms is
**not determinable from here** and is the second thing to check on real
hardware.

**Recommended runtime behaviour, needing no platform support.** The tracker can
detect auto-framing from its own signal: under auto-framing the face position
is actively *regulated* toward centre, so the residual after a head movement
decays back rather than persisting. A drifting baseline with suppressed variance
is the signature, and a144's running jitter estimate plus the a130 pose log
already carry it. That catches whatever produces the behaviour rather than a
named feature, and it is the guard I would build before any device list.

## 5. The prior — not derived, and why that is the right answer

The brief requires the prior to come from the distribution of the assembled
table. With zero populated rows there is no distribution, and picking a round
number would be exactly the "by feel" the brief forbids.

`derivePrior()` is implemented: median of the sourced horizontal FOVs, with the
bound taken from the larger IQR half-width rather than the extremes so one
ultrawide unit does not set the error bar for every laptop. **It returns `null`
with a reason below 8 populated entries** (tested), and returns the median
above (tested: 9 synthetic entries → median 70°, ±8°).

Until then the resolver prefers a **live per-session estimate from the observed
face** over any constant. That trades the camera-FOV guess for a viewing-distance
guess grounded in a real pixel measurement, and it is at least responsive to the
actual optics. It is labelled `confidence: "prior"` and warns that depth gain
inherits the distance assumption (roughly ±15%).

If neither exists, `fx` is `null` and the head-Z axis is simply unavailable —
**X and Y still resolve**, because `fx` cancels out of them. Degrading to
2-axis tracking is strictly better than degrading to a wrong depth gain.

## 6. Highest-value missing entries, ranked

Ordered by depth-gain error contribution — share × probable deviation from any
sensible prior — rather than share alone, since head-Z is the consumer:

1. **Apple FaceTime HD, both generations.** Largest single share, consistent
   labels, and the two generations plausibly differ. Needs VID:PID or a
   resolution-ladder tie-break to separate them.
2. **iPhone / iPad front cameras.** Large share, and mobile front cameras run
   wide (~80°), so a laptop-centred prior is worst here.
3. **Logitech C920/C922/C925e.** Largest USB share. Must be sourced
   *separately* — do not share one family value until three sources agree.
4. **Apple Studio Display.** Center Stage on by default; may be an
   auto-framing exclusion rather than a table row.
5. **Chicony / Sunplus / Sonix / Bison / Luxvisions modules.** If module-level
   VID:PIDs can be sourced, this covers many OEM machines at once and is the
   highest leverage per entry — evaluate tractability before the per-laptop rows.
6. Brio / MX Brio (selectable FOV — needs a per-mode row, not a number).

## 7. Maintenance

* A new row needs `{raw, type, aspect, tier, source{url,kind}}` plus
  `sensorAspect` and `modeRule`. Anything missing stays `null` with a reason.
* Two sources disagreeing go in `conflicts` — both recorded, neither silently
  chosen. The resolver warns when it uses a value that has conflicts.
* **Re-derive the prior** when the populated count crosses 8, and again whenever
  it grows by 50%, or when a new device class enters the roster (the laptop and
  phone distributions differ enough that mixing them without re-deriving would
  widen the bound for everyone).
* Tier C entries should be re-sourced to Tier A/B opportunistically; the
  resolver already flags them at runtime.

## 8. Verification status

Verified here, by `harness/intrinsics_test.js` (27 assertions):
FOV algebra including the diagonal round trip; all four mode rules; VID:PID
extraction and label normalisation; the generic-label fall-through; the
unsourced-entry path; face-derived preference; empty-label warning; `resizeMode`
warning; zoom correction; `derivePrior` refusal and derivation; and the
**synthetic round trip** — a camera authored at 74° and a head authored at
0.55 m are recovered to 1e-9, and a deliberately wrong 60° entry moves Z by
30.5% while leaving X and Y **bit-identical**, confirming `dZ/Z = dfx/fx` and
that the error is confined to the depth axis exactly as the brief states.

**Unverified: every LUT row**, because there are none. The measured delta
between sourced and calibrated values — the number that says how much to trust
unverified rows — cannot be computed until rows exist and `calibrate-charuco.md`
has been run on at least a few devices.
