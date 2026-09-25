#!/usr/bin/env python3
"""Find objects, no clicks (S71 §1): one of the seg_models pipelines on a picture; each mask written as an 8-bit grey PNG (0 / 255;
the app decodes it without a canvas)
(mask_000.png ...) plus masks.json (method, seconds, per-mask area). The app keeps, orders and merges them by depth.
  python3 seg_run.py picture.png outdir --method owl_sam|gdino_sam|birefnet|sam3"""
import argparse, json, os, sys, time
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from seg_models import ARMS
ap = argparse.ArgumentParser(); ap.add_argument('picture'); ap.add_argument('out'); ap.add_argument('--method', default='owl_sam', choices=sorted(ARMS))
A = ap.parse_args(); os.makedirs(A.out, exist_ok=True)
img = np.asarray(Image.open(A.picture).convert('RGB')); t0 = time.time()
masks = [m for m in ARMS[A.method](img) if m.sum() >= 50]
info = {'method': A.method, 'size': [img.shape[1], img.shape[0]], 'secs': round(time.time() - t0, 1), 'masks': []}
for k, m in enumerate(masks):
    f = 'mask_%03d.png' % k; Image.fromarray((m * 255).astype(np.uint8), 'L').save(os.path.join(A.out, f))
    info['masks'].append({'file': f, 'px': int(m.sum())})
json.dump(info, open(os.path.join(A.out, 'masks.json'), 'w'), indent=1); print(json.dumps({k: v for k, v in info.items() if k != 'masks'} | {'n': len(masks)}))
