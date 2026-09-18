#!/usr/bin/env python3
"""S35 §29: an object-id map for a kit scene from its own truth, the kit's stand-in for SAM's masks on a picture: the first
hit's primitive at every rest pixel, THING primitives numbered 1.., background (label 1) 0. Primitives named in --unlabelled
(e.g. a Canopy of leaves) stay 0 so that, as in the troll's forest under a click mask, their leaves are depth components.
  python3 truth_ids.py L1 [--unlabelled forest] -> out/L1/truth_ids.png"""
import sys, os, json, argparse, numpy as np
from PIL import Image
ap = argparse.ArgumentParser(); ap.add_argument('scene'); ap.add_argument('--unlabelled', nargs='*', default=[]); a = ap.parse_args()
TK = os.path.dirname(os.path.abspath(__file__)); meta = json.load(open(f'{TK}/out/{a.scene}/meta.json'))
R = np.load(f'{TK}/out/{a.scene}/rest_layers.npz'); pid = R['pid']; pid0 = pid[..., 0] if pid.ndim == 3 else pid   # (ny, nx, K): the first hit
nx, ny = meta['nx'], meta['ny']; H0, W0 = pid0.shape; pid0 = np.asarray(pid0).reshape(-1)
ids = np.zeros(pid0.shape, np.uint8); k = 0; names = []
for p in meta['prims']:
    if p['label'] != 2 or p['name'] in a.unlabelled or any(p['name'].startswith(u) for u in a.unlabelled): continue
    m = pid0 == p['pid']
    if not m.any(): continue
    k += 1; ids[m] = k; names.append((k, p['name'], int(m.sum())))
# the rest canvas has a margin; keep the in-frame part (the app's plate is the frame)
img = ids.reshape(H0, W0)
if img.shape != (ny, nx): y0 = (H0 - ny) // 2; x0 = (W0 - nx) // 2; img = img[y0:y0 + ny, x0:x0 + nx]
Image.fromarray(img).save(f'{TK}/out/{a.scene}/truth_ids.png')
print(f'{a.scene}: {k} things -> out/{a.scene}/truth_ids.png ({nx}x{ny}); ' + ', '.join(f'{i}:{n}({c})' for i, n, c in names[:12]) + (' ...' if len(names) > 12 else ''))
