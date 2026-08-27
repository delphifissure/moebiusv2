# 4DAnyone portal PoC — off-axis rig viewer

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
