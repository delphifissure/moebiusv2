# Tier A ground truth — per-device calibration

Produces the measured value a LUT row is checked against. Zhang's method with a
ChArUco board; ChArUco rather than a plain chessboard because it tolerates
partial views and occlusion, which matters when a laptop camera cannot be moved
independently of its screen.

## Procedure

1. Print a ChArUco board (e.g. 7x5 squares, 40 mm square, 30 mm marker, DICT_4X4_50).
   Mount it flat and rigid — a bowed print is the largest error source here.
   **Measure the printed square with calipers** and use the measured size, not
   the nominal: printer scaling of 2-3% is common and goes straight into fx.
2. Capture 20-30 frames at the **exact resolution the app will stream**, since
   the mode rule is what the LUT row has to describe. Vary board pose: fill the
   frame, corners, and at least 6 distinct tilts beyond 30 degrees. Tilt is what
   separates focal length from distance; a set of fronto-parallel views is
   ill-conditioned and will produce a confident wrong answer.
3. Set `resizeMode: "none"` in the constraints so the browser is not resampling.
   Disable any auto-framing in the OS camera settings and note whether you could.
4. Calibrate (OpenCV `calibrateCameraCharuco`). Record `fx, fy, cx, cy`,
   the reprojection RMS, and the frame count.
5. Reject the run if RMS > 0.5 px, or if `fy/fx` deviates from 1 by more than
   1% — the latter means either non-square pixels or a bad board, and both
   invalidate the square-pixel assumption the resolver makes.
6. Convert: `hFovDeg = 2*atan(W/(2*fx))`. Store as
   `{raw: hFovDeg, type: "horizontal", aspect: "<live W:H>", tier: "A",
     source: {url: "<your calibration record>", kind: "calibration"}}`.
7. Repeat at each resolution on the ladder that the app might use. If hFov is
   constant across a 4:3 -> 16:9 change, the rule is `crop-v`. If vFov is
   constant instead, it is `crop-h`. If both change, it is `scale`.

## What this is not

It does not produce a distortion model, by design. Radial distortion displaces a
face near the frame edge and lands on X and Y, not Z — out of scope per the
brief, and flagged at runtime by the resolver when the field is wide enough for
it to matter.
