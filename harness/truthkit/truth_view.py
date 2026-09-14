#!/usr/bin/env python3
"""S27: the truth's own view of a kit scene from an eye of the app's envelope, on the plate grid (what the portal should show).
  python3 truth_view.py S15 <fx> <fy> <out.png> [--fade 45]
fx, fy = the eye offset as a fraction of e_max = D tan(fade) horizontally and of e_max * H/W vertically (the app's pose
convention in the harnesses: camera.position.x = fx * exR, y = fy * exR * bgEnvAspect()). Writes the first-hit colour;
alongside it <out>.npz with depth (metres) and pid so the comparison can be made per class.
"""
import sys, os, json
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tk import Portal, render
from scenes import SCENES
S, fx, fy, outp = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), sys.argv[4]
fade = float(sys.argv[sys.argv.index('--fade') + 1]) if '--fade' in sys.argv else 45.0
TK = os.path.dirname(os.path.abspath(__file__)); meta = json.load(open(f'{TK}/out/{S}/meta.json'))
W, H, D = meta['W'], meta['H'], meta['D']
build = SCENES[S]; prims, _ = build(W, H) if 'depth_arg' not in meta else build(W, H, meta['depth_arg'])
plate = Portal(W, H, D, meta['nx'], meta['ny'], 0.0)
ex = D * np.tan(np.radians(fade)); eye = (fx * ex, fy * ex * H / W, D)
R = render(prims, plate, eye, K=2)
rgb = np.clip(R['rgb'][..., 0, :], 0, 1); hit = R['valid'][..., 0]
img = (rgb * 255 + 0.5).astype(np.uint8); img[~hit] = (135, 175, 225)   # sky where nothing is hit (the kit's rest sky colour is scene-specific; masked in comparisons)
Image.fromarray(img).save(outp)
np.savez_compressed(os.path.splitext(outp)[0] + '.npz', depth=R['depth'][..., 0].astype(np.float32), pid=R['pid'][..., 0].astype(np.int16), hit=hit, eye=np.array(eye))
print(outp, 'eye', eye, 'hit', float(hit.mean()))
