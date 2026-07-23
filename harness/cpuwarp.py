#!/usr/bin/env python3
"""CPU-warp renderer v2 (vectorized): pose renders from exported bake
buffers. Two-pass z-splat: interpolate each connected px-pair at S steps,
scatter max-depth then color-at-max. FG: pairs disconnect at tear-step
cliffs; connected spans wider than 3 texels are dropped (the stretch cut).
Plate: solid, spans filled up to S_PLATE (walls stay visible, as GL shows).
Horizontal connectivity only — calibrated for horizontal-parallax classes.
Usage: cpuwarp.py <asset> <ex> [out.png] [scale]
"""
import json, sys, time
import numpy as np
from PIL import Image

t0 = time.time()
asset, ex = sys.argv[1], float(sys.argv[2])
out = sys.argv[3] if len(sys.argv) > 3 else f'val/CW_{asset}_{ex}.png'
scale = float(sys.argv[4]) if len(sys.argv) > 4 else 0.5
d = f'bufcache/{asset}'
meta = json.load(open(f'{d}/meta.json'))
PW, PH, tear, scone = meta['pw'], meta['ph'], meta['tearStep'], meta['sCone']
pw, ph = int(PW * scale), int(PH * scale)

def loadf(n):
    a = np.fromfile(f'{d}/{n}.f32', dtype=np.float32).reshape(PH, PW)
    return np.asarray(Image.fromarray(a).resize((pw, ph), Image.BILINEAR))
dQ, P = loadf('dQ'), loadf('P')
col = np.asarray(Image.open(f'{d}/color.png').convert('RGB').resize((pw, ph), Image.LANCZOS), np.float32)
pc  = np.asarray(Image.open(f'{d}/platecolor.png').convert('RGB').resize((pw, ph), Image.LANCZOS), np.float32)

dref = float(np.median(dQ))
k = (ex / 0.2) / scone * scale          # px shift per depth unit, at this scale

zbuf = np.full(ph * pw, -1e9, np.float32)
cbuf = np.zeros((ph * pw, 3), np.float32)
abuf = np.zeros(ph * pw, np.uint8)

def warp(depth, color, tearconn, cut3, SMAX):
    wx = np.arange(pw, dtype=np.float32)[None, :] + k * (depth - dref)
    a, b = wx[:, :-1], wx[:, 1:]
    da, db = depth[:, :-1], depth[:, 1:]
    ca, cb = color[:, :-1], color[:, 1:]
    span = np.abs(b - a)
    conn = np.ones_like(span, bool) if tearconn is None else (np.abs(db - da) <= tearconn)
    keep = conn & ((span <= 3.0 * max(scale * 2, 1)) if cut3 else (span <= SMAX))
    rows = np.arange(ph, dtype=np.int64)[:, None] * pw
    S = int(min(SMAX, 24))
    for t in np.linspace(0, 1, S + 1, dtype=np.float32):
        xt = np.rint(a * (1 - t) + b * t).astype(np.int64)
        ok = keep & (xt >= 0) & (xt < pw)
        idx = (rows + np.clip(xt, 0, pw - 1))[ok]
        dt = (da * (1 - t) + db * t)[ok]
        np.maximum.at(zbuf, idx, dt)
    for t in np.linspace(0, 1, S + 1, dtype=np.float32):
        xt = np.rint(a * (1 - t) + b * t).astype(np.int64)
        ok = keep & (xt >= 0) & (xt < pw)
        idx = (rows + np.clip(xt, 0, pw - 1))[ok]
        dt = (da * (1 - t) + db * t)[ok]
        win = dt >= zbuf[idx] - 1e-6
        ct = (ca * (1 - t)[..., None] + cb * t)[ok][win]
        cbuf[idx[win]] = ct; abuf[idx[win]] = 255

warp(P, pc, None, False, 24)     # plate solid
warp(dQ, col, tear, True, 8)     # FG with tear + cut

img = np.dstack([np.clip(cbuf.reshape(ph, pw, 3), 0, 255).astype(np.uint8),
                 abuf.reshape(ph, pw)[..., None]])
Image.fromarray(img, 'RGBA').save(out)
print(f'wrote {out} {pw}x{ph} ({time.time()-t0:.1f}s)')
