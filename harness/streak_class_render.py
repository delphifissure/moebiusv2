#!/usr/bin/env python3
"""S33: render streak_class.js output. python3 harness/streak_class_render.py harness/shots/streakclass/<TAG>
Writes <dir>/class_v.png (vertical edges: the bends the eye reads as horizontal streaks), class_h.png, and prints the table.
Colours: red = same surface, law disagrees (1); blue = real step between two visible surfaces (2); yellow = axis change (3);
magenta = no rim (4); light grey = band texel with no visible bend; the picture underneath at half strength."""
import sys, json, numpy as np
from PIL import Image
d = sys.argv[1]; sz = json.load(open(f'{d}/size.json')); pw, ph = sz['pw'], sz['ph']; meta = json.load(open(f'{d}/counts.json'))
# --step X: re-threshold at X depth units (when the run's effective quantum read the grid, not the visible step: sigma gate 0)
STEP = float(sys.argv[sys.argv.index('--step') + 1]) if '--step' in sys.argv else None
if STEP is not None:
    ratio = STEP / meta['step']
    for key, fn in (('v', 'vclass'), ('h', 'hclass')):
        cl = np.fromfile(f'{d}/{fn}.u8', np.uint8).reshape(ph, pw); J = np.fromfile(f'{d}/{fn[0]}jump.f32', np.float32).reshape(ph, pw)
        keep = J > ratio; cl2 = np.where(keep, cl, 0).astype(np.uint8); cl2.tofile(f'{d}/{fn}_step.u8')
        c = meta['counts'][key]; c['above'] = int(keep.sum() - ((cl == 0) & keep).sum()) if False else int((cl2 > 0).sum())
        for k in (1, 2, 3, 4):
            m = cl2 == k; jj = J[m] / ratio
            c['c'][k] = int(m.sum()); c['median'][k] = float(np.median(jj)) if m.any() else 0.0; c['p90'][k] = float(np.percentile(jj, 90)) if m.any() else 0.0; c['sum'][k] = float(jj.sum())
            c['joinedAny'][k] = -1
    meta['step'] = STEP; print(f'(re-thresholded at the visible step {STEP:.3e}; the run used {STEP / ratio:.3e})')
band = np.fromfile(f'{d}/band.u8', np.uint8).reshape(ph, pw) > 0
col = np.asarray(Image.open(f'{d}/color.png').convert('RGB').resize((pw, ph))).astype(np.float32)
COL = {1: (255, 40, 40), 2: (40, 90, 255), 3: (255, 220, 0), 4: (255, 0, 255)}
names = {1: 'same surface, law disagrees', 2: 'real step (two surfaces)', 3: 'axis change', 4: 'no rim'}
for key, fn in (('v', 'vclass'), ('h', 'hclass')):
    cl = np.fromfile(f'{d}/{fn}{"_step" if STEP is not None else ""}.u8', np.uint8).reshape(ph, pw)
    out = col * 0.45 + 255 * 0.55 * 0  # darkened picture
    out = col * 0.5
    out[band] = out[band] * 0.5 + np.array([200, 200, 200]) * 0.5
    for k, c in COL.items():
        m = cl == k; out[m] = c
        if key == 'v': out[1:, :][m[:-1, :]] = c   # paint both texels of a vertical edge so 1-texel walls are visible
        else: out[:, 1:][m[:, :-1]] = c
    Image.fromarray(out.clip(0, 255).astype(np.uint8)).save(f'{d}/class_{key}.png')
    c = meta['counts'][key]; tot = max(1, c['above']); totLen = max(1e-9, sum(c['sum']))
    print(f"{'vertical' if key == 'v' else 'horizontal'} band edges: {c['all']}; above the visible step: {c['above']} ({100 * c['above'] / max(1, c['all']):.1f} %)")
    for k in (1, 2, 3, 4):
        print(f"  {k} {names[k]:<30} {c['c'][k]:>8} ({100 * c['c'][k] / tot:5.1f} % of visible bends); any rim pair joined {c['joinedAny'][k]:>7}; jump median {c['median'][k]:.1f} steps, p90 {c['p90'][k]:.1f}, summed {c['sum'][k]:.0f} step-texels = {100 * c['sum'][k] / totLen:4.1f} % of the wall length")
print(f"band {meta['nBand']} texels; visible step {meta['step']:.3e} depth; grid {meta['qg']:.3e}")
