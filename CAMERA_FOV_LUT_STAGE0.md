# Camera FOV LUT — Stage 0 response, and two findings raised before Stage 1

Per the brief's instruction to raise open questions at each gate rather than
guess. There are three things to settle before a roster is worth assembling,
and one of them may remove the need for the table.

---

## 0. A hard blocker on Stages 1–2 in this environment

**This workspace has no outbound network.** `curl` to jsdelivr returns 000; the
MediaPipe/tfjs model cannot load here for the same reason. The brief's hard
constraints are:

> 1. Never fabricate a value… If you cannot source a number, the entry is `null`
>    with a reason string.
> 2. Every numeric entry carries a citation — URL plus what kind of source it is.

I cannot open a spec sheet, a teardown, or a review from here. Any FOV value I
produced would be recalled rather than sourced, which is fabrication under
constraint 1, and uncitable under constraint 2. **So Stage 2 cannot be executed
in this environment at all**, and a table of remembered numbers would be exactly
the "bad LUT row" the brief says is worse than no entry.

Stage 0 is analysis rather than sourcing, so it is deliverable — with the
caveat that the platform-behaviour claims below are split into *what I ran here*
and *what still needs verifying*.

---

## 1. FINDING — the consumer described is not the consumer that exists

The brief's justification for the table is:

> `Z = f · IPD / d` … Focal length cancels out of X and Y. FOV error corrupts
> only the depth axis.

Checked against the code. In `moebius.js`, `latestDetectedFaceX/Y` reach exactly
two places:

  * `camera.position.x/y` (the head-tracked parallax offset), and
  * `updateViewFade()` (the angle fade).

`camera.position.z` is written only by the dolly slider and by initialisation.
**Nothing computes head distance from the face.** There is no `Z = f·IPD/d` in
the pipeline.

By the brief's own statement, focal length cancels out of X and Y — which are
the only two axes the head tracker drives. **So for the pipeline as it stands,
a device FOV table buys nothing on the tracking path.** The ±5%-vs-±15% depth
gain argument is real, but it is an argument about a computation this code does
not perform.

That leaves one live consumer, and it is much looser.

### 1b. The one place FOV is used — and it can be made FOV-free

`updateViewFade()` uses hfov/vfov to convert the normalised face position into
degrees, so the fade can start "10 degrees from where tracking fails" (a144).
FOV error there shifts the fade onset by a few degrees. It does not corrupt a
depth gain, and there is no ±5% bar to hold.

More usefully: **a145 already measures the tracking-loss boundary directly, in
normalised frame units**, by probing the detector with a synthetic face. If the
band were expressed as a fraction of the measured trackable range rather than in
degrees — "fade over the last 30% of the range the tracker actually has" — then
**hfov cancels out of the fade entirely** and the LUT has no consumer left at
all.

That is a one-line change and it is not made, because the 10-degree band was an
explicit product decision and changing units silently would be the wrong move.
Raising it as the question it is.

**So the gate question is: is head-Z tracking planned?** If yes, the table
matters and Stage 1 should proceed on that basis; the roster ordering would then
be driven by which devices produce the worst depth-gain error, not by share
alone. If no, the honest recommendation is below.

---

## 2. What the web platform actually exposes — run here, not recalled

Chromium 141 headless, secure context, `getSupportedConstraints()` — all 35
supported keys:

```
aspectRatio, autoGainControl, brightness, channelCount, colorTemperature,
contrast, deviceId, displaySurface, echoCancellation, exposureCompensation,
exposureMode, exposureTime, facingMode, focusDistance, focusMode, frameRate,
groupId, height, iso, latency, noiseSuppression, pan, pointsOfInterest,
resizeMode, restrictOwnAudio, sampleRate, sampleSize, saturation, sharpness,
suppressLocalAudioPlayback, tilt, torch, voiceIsolation, whiteBalanceMode,
width, zoom
```

**No field of view, and nothing from which one can be derived.** The only
framing-adjacent keys are `pan`, `tilt`, `zoom` (PTZ, behind a separate
permission and only on cameras that implement it) and `resizeMode`.

A live track's `getCapabilities()` here returns:

```json
{"aspectRatio":{"max":3840,"min":0.00046},"deviceId":"…","exposureMode":["manual","continuous"],
 "exposureTime":{…},"facingMode":[],"focusDistance":{…},"focusMode":["manual","continuous"],
 "frameRate":{"max":20,"min":0},"groupId":"…","height":{"max":2160,"min":1},
 "resizeMode":["none","crop-and-scale"],"width":{"max":3840,"min":1}}
```

Two things worth carrying into the schema:

  * `resizeMode: ["none","crop-and-scale"]` is exposed, and it bears directly on
    Stage 3 — a `crop-and-scale` mode is the browser resampling, distinct from
    the sensor crop the device applies, and the two compose. Worth constraining
    explicitly to `none` so at least one of the two is pinned.
  * `groupId` co-identifies devices sharing a physical unit. Not a stable
    cross-session key (it is per-origin, per-session) but it does group.

**Not verified here** (needs real hardware and multiple browsers), flagged
rather than asserted: which platforms append the `(vvvv:pppp)` USB VID:PID
suffix to `track.label`; Safari and Firefox labelling; and the exact
pre-permission label behaviour. My understanding is that the label is an empty
string before permission is granted, which — if true — has a concrete
consequence worth stating now: **the LUT cannot be consulted until the user has
granted camera access**, so any resolution that depends on it happens after the
stream opens, not at page load. That matches where a144/a145 already do their
work.

---

## 3. Auto-framing — the hazard is real and it is worse for this consumer

The brief flags Center Stage / Windows Studio Effects / RightSight as a
correctness hazard. For a head tracker it is worse than a FOV error, and the
reason is specific to this pipeline: **auto-framing pans the sensor crop to
keep the face centred, which is precisely the signal the tracker reads as head
motion.** A perfectly calibrated fx does not help; the input itself is being
counter-steered. In the limit, a camera that centres the face perfectly makes
`latestDetectedFaceX` constant and the parallax dead.

From the constraint list above, there is no `autoFraming` or equivalent
constraint in Chromium 141. Whether it can be detected or disabled from a web
context on macOS/Windows is **not something I can determine here** and is
exactly one of the points the brief said to raise back.

Recommended runtime behaviour regardless of detectability, because it needs no
platform support: **the tracker can detect auto-framing from its own signal.**
Under auto-framing the face position is actively regulated toward centre, so the
residual after a head movement decays back rather than persisting. A slow drift
of the *baseline* with a suppressed variance is the signature. That is
measurable with what a144 already records (the running jitter estimate and the
pose log) and would be a better guard than a device list, because it catches
whatever produces the behaviour rather than a named feature.

---

## 4. Recommendation, stated as the brief invited

> If the sourced values are so scattered that a prior-plus-slider approach would
> beat the table for the effort involved. That is a legitimate finding — say so.

**A stronger version of that finding applies: for the current pipeline the table
has no consumer that needs it, and the one consumer that uses FOV can be made
not to.** Concretely:

1. **If head-Z tracking is not planned:** do not build the LUT. Express the fade
   band as a fraction of the a145-measured trackable range; hfov disappears from
   the codebase. Keep `bgDeviceFovOverride` for anyone who wants it.
2. **If head-Z tracking is planned:** the LUT is worth building, but the roster
   should be ordered by depth-gain error rather than share, and Stage 0's keying
   problem should be settled on real hardware first — because a table keyed on
   an unstable label degrades to the prior anyway, and then the prior is the
   product.
3. **Either way**, the a146b face-derived estimate already trades the
   camera-FOV guess for a viewing-distance guess grounded in a real pixel
   measurement, with its uncertainty printed. That is available now, costs
   nothing, and would be the fallback prior in the LUT's own resolution chain.

What I have *not* done: assemble a roster or source a single value. Both are
blocked on network access, and guessing them would violate the brief's first
constraint. Give me egress, or the answer to the head-Z question, and Stage 1
becomes tractable.
