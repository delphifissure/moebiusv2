#!/usr/bin/env python3
"""What are MoGe's mask islands? (the user, 2026-09-26: "depth islands surrounded by sky can also be things like a bird,
football etc that should have parallax"). For each picture: MoGe-3's raw validity mask, then every
  - VALID island whose whole ring is invalid (clean_valid turned these into sky), and every
  - INVALID island off the border (clean_valid gave these the ring's median depth),
with its size, its colour distance to the border-connected sky (in units of the sky's own spread), its depth against the
main scene's depth distribution, and a crop sheet so each one can be seen.
  python3 sky_islands_probe.py OUTDIR name=color.png ...
"""
import json, os, sys
import numpy as np, torch
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from truewindow import load_moge3

out = sys.argv[1]; os.makedirs(out, exist_ok=True)
m = load_moge3(refine=False); R = {}
st = np.ones((3, 3), bool)
for arg in sys.argv[2:]:
    name, path = arg.split('=', 1)
    img = np.asarray(Image.open(path).convert('RGB')); H, W = img.shape[:2]
    x = torch.tensor(img / 255., dtype=torch.float32).permute(2, 0, 1)
    with torch.no_grad(): o = m.infer(x, fov_x=None, resolution_level=9, refine_steps=0, use_fp16=False)
    P = o['points'].numpy(); Z = P[..., 2]; valid = o['mask'].numpy() & np.isfinite(Z) & (Z > 0)
    np.save(os.path.join(out, name + '_valid.npy'), valid); np.save(os.path.join(out, name + '_Z.npy'), Z.astype(np.float32))
    lab = img.astype(float)
    border = lambda mk: mk[0].any() or mk[-1].any() or mk[:, 0].any() or mk[:, -1].any()
    li, ni = ndi.label(~valid, st); sky = np.zeros_like(valid)
    for k in range(1, ni + 1):
        mk = li == k
        if border(mk): sky |= mk
    main = valid.copy(); lv, nv = ndi.label(valid, st); isl = []
    if sky.any():
        mu = lab[sky].mean(0); C = np.cov(lab[sky].T) + np.eye(3) * 1e-3; Ci = np.linalg.inv(C)
        dsky = lambda px: float(np.sqrt(np.einsum('ni,ij,nj->n', px - mu, Ci, px - mu)).mean())
        sky_self = np.sqrt(np.einsum('ni,ij,nj->n', lab[sky] - mu, Ci, lab[sky] - mu)); p95 = float(np.percentile(sky_self, 95))
    else: dsky = lambda px: float('nan'); p95 = float('nan')
    for k in range(1, nv + 1):
        mk = lv == k; ring = ndi.binary_dilation(mk, st) & ~mk
        if ring.any() and not valid[ring].any() and not border(mk):
            isl.append(('valid-in-sky', mk)); main &= ~mk
    for k in range(1, ni + 1):
        mk = li == k
        if not border(mk): isl.append(('invalid-off-border', mk))
    Zm = Z[main]; rows = []
    crops = []
    for kind, mk in sorted(isl, key=lambda t: -t[1].sum())[:12]:
        ys, xs = np.nonzero(mk); zi = float(np.median(Z[mk])) if kind == 'valid-in-sky' else float('nan')
        rows.append({'kind': kind, 'px': int(mk.sum()), 'bbox': [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())],
                     'colourDistToSky': round(dsky(lab[mk]), 2), 'skySelfP95': round(p95, 2),
                     'Z_median': round(zi, 2), 'Z_pctOfMain': round(float((Zm < zi).mean() * 100), 1) if np.isfinite(zi) else None})
        pad = 24; x0, y0, x1, y1 = max(0, xs.min() - pad), max(0, ys.min() - pad), min(W, xs.max() + pad + 1), min(H, ys.max() + pad + 1)
        c = img[y0:y1, x0:x1].copy(); e = ndi.binary_dilation(mk, st)[y0:y1, x0:x1] & ~mk[y0:y1, x0:x1]; c[e] = (255, 0, 255) if kind == 'valid-in-sky' else (0, 255, 0)
        ci = Image.fromarray(c); ci.thumbnail((160, 160)); crops.append(ci)
    R[name] = {'size': [W, H], 'skyPx': int(sky.sum()), 'islands': rows}
    if crops:
        sh = Image.new('RGB', (160 * min(6, len(crops)), 160 * ((len(crops) + 5) // 6)), (30, 30, 30))
        for i, c in enumerate(crops): sh.paste(c, ((i % 6) * 160, (i // 6) * 160)); ImageDraw.Draw(sh).text(((i % 6) * 160 + 3, (i // 6) * 160 + 3), str(i), fill=(255, 255, 0))
        sh.save(os.path.join(out, name + '_islands.png'))
    print(name, json.dumps(R[name]), flush=True)
json.dump(R, open(os.path.join(out, 'islands.json'), 'w'), indent=1)
