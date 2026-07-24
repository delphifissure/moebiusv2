#!/usr/bin/env python3
"""Analytic test scene. Every feature is defined as a FRACTION of frame size and
evaluated at the target resolution — never resampled — so the same scene at two
resolutions is the same SCENE, not a filtered copy of one. That makes any
remaining drift in the bake attributable to the code, which a resampled
photograph can never do (Addendum 101: input-side drift 24.3% swamped the
21.1% output drift)."""
import sys, numpy as np
from PIL import Image
W = int(sys.argv[1]); H = int(W * 0.75); tag = sys.argv[2]
x = (np.arange(W) + 0.5) / W          # normalised coords, resolution-free
y = (np.arange(H) + 0.5) / H
X, Y = np.meshgrid(x, y)

d = np.full((H, W), 0.02, np.float32)                 # sky (flat, far)
gnd = Y > 0.45
d[gnd] = (0.15 + 0.45 * (Y[gnd] - 0.45) / 0.55)       # smooth receding ground
wedge = (X > 0.72) & (Y > 0.30)                        # steep smooth slope
d[wedge] = 0.30 + 0.45 * (X[wedge] - 0.72) / 0.28
fig = ((X - 0.38) / 0.13) ** 2 + ((Y - 0.55) / 0.30) ** 2 < 1.0   # figure: hard cliff
d[fig] = 0.80
bar = (np.abs(X - 0.60) < 0.004) & (Y > 0.25) & (Y < 0.80)        # thin feature
d[bar] = 0.72

c = np.zeros((H, W, 3), np.float32)
tex = 0.5 + 0.5 * np.sin(X * 90) * np.sin(Y * 70)      # texture at a fixed spatial FREQUENCY
c[..., 0] = 40 + 120 * tex; c[..., 1] = 60 + 100 * tex; c[..., 2] = 150 - 60 * tex
c[gnd] = np.stack([200 * tex[gnd], 170 * tex[gnd], 150 * tex[gnd]], -1)
c[wedge] = np.stack([120 + 80 * tex[wedge], 110 * tex[wedge], 90 * tex[wedge]], -1)
c[fig] = np.stack([230 * tex[fig], 200 * tex[fig], 90 * tex[fig]], -1)
c[bar] = 250

Image.fromarray(np.clip(c, 0, 255).astype(np.uint8)).save(f'{tag}_color.png')
Image.fromarray((np.clip(d, 0, 1) * 255).astype(np.uint8)).save(f'{tag}_depth.png')
print(f'{tag}: {W}x{H}  figure/sky cliff 0.78, ground slope, wedge slope, thin bar 0.8% wide')
