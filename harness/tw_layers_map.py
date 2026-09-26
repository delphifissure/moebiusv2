#!/usr/bin/env python3
"""Label map from tw_layers.js: a pixel that changes when an object is hidden is drawn by that object (the frontmost one
wins when several change it, in the order foreground, plate 2, step faces, plate, margin strips, sky). False colour +
counts inside and outside the picture's rectangle.
  python3 tw_layers_map.py <shots/tw/TAG> <LABEL>   -> <LABEL>_layers_<pose>.png, counts appended to <LABEL>_layers.json
"""
import json, os, sys
import numpy as np
from PIL import Image

NAMES = ['fg', 'plate', 'ring', 'sky', 'plate2', 'steps']
COL = {'none': (255, 0, 255), 'fg': (240, 240, 240), 'plate': (60, 130, 230), 'ring': (250, 150, 20), 'sky': (120, 220, 255), 'plate2': (200, 60, 200), 'steps': (40, 200, 90)}
PRI = ['fg', 'plate2', 'steps', 'plate', 'ring', 'sky']

d, lab = sys.argv[1], sys.argv[2]
jp = os.path.join(d, lab + '_layers.json'); R = json.load(open(jp)) if os.path.exists(jp) else {}
tw = json.load(open(os.path.join(d, lab + '.json')))['tw']
lw, lh = tw['layerWH']; R['counts'] = {}
for pose in ['rest', 'L42', 'R42', 'up30']:
    if not all(os.path.exists(os.path.join(d, '_lyr', pose + f)) for f in ['_full.png'] + ['_no%d.png' % k for k in range(6)]): continue
    full = np.asarray(Image.open(os.path.join(d, '_lyr', pose + '_full.png')).convert('RGBA')).astype(int)
    H, W = full.shape[:2]; x = (np.arange(W) + .5) / W * 2 - 1; y = (np.arange(H) + .5) / H * 2 - 1
    ins = (np.abs(x)[None, :] < lw / 0.16) & (np.abs(y)[:, None] < lh / 0.09)
    drawn = full[..., 3] > 128; lab_map = np.full((H, W), 'none', dtype=object)
    ch = {}
    for k, n in enumerate(NAMES):
        no = np.asarray(Image.open(os.path.join(d, '_lyr', pose + '_no%d.png' % k)).convert('RGBA')).astype(int)
        ch[n] = np.abs(no - full).max(-1) > 3
    for n in reversed(PRI): lab_map[ch[n] & drawn] = n
    lab_map[drawn & (lab_map == 'none')] = 'fg'   # drawn but no single object changes it: two layers coincide
    rgb = np.zeros((H, W, 3), np.uint8)
    for n, c in COL.items(): rgb[lab_map == n] = c
    img = (0.35 * full[..., :3] + 0.65 * rgb).astype(np.uint8); img[~ins & (lab_map != 'none')] = rgb[~ins & (lab_map != 'none')]
    img[np.roll(ins, 1, 1) != ins] = (0, 255, 0); img[np.roll(ins, 1, 0) != ins] = (0, 255, 0)
    Image.fromarray(img).save(os.path.join(d, lab + '_layers_' + pose + '.png'))
    R['counts'][pose] = {'inside': {n: round(100 * float(((lab_map == n) & ins).sum()) / ins.sum(), 2) for n in COL}, 'outside': {n: round(100 * float(((lab_map == n) & ~ins).sum()) / max(1, (~ins).sum()), 2) for n in COL}}
    print(pose, json.dumps(R['counts'][pose]))
json.dump(R, open(os.path.join(d, lab + '_layers.json'), 'w'), indent=1)
