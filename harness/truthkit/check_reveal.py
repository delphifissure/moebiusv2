#!/usr/bin/env python3
"""Score the closed-form reveal instrument (depth only) against the truth kit's exact scope.
Truth: scope_gt.npz of a scope run at the SAME envelope (the app's 45 deg sweep: thx up to 45,
thy up to atan(H/W tan 45)); hidden in-frame samples (classes 2-5) ever visible collapse to a
per-pixel 'hidden content exists here' mask. Instrument: reveal.npz band (w_disp > 0).

  python3 check_reveal.py out/S27_env45/scope_gt.npz out/S27/reveal/reveal.npz out/S27/rest_rgb.png out/S27/check_reveal.png
"""
import sys, json
import numpy as np
from PIL import Image, ImageDraw
from tk import to_u8

gt = np.load(sys.argv[1]); rv = np.load(sys.argv[2])
cls = gt['cls']; w = gt['w_disp'].astype(np.float32)
H, W, K = cls.shape
band = rv['w_disp'] > 0
ph, pw = band.shape
y0 = (H - ph) // 2; x0 = (W - pw) // 2
cls_c = cls[y0:y0 + ph, x0:x0 + pw]; w_c = w[y0:y0 + ph, x0:x0 + pw]
hidden = ((cls_c >= 2) & (cls_c <= 5) & (w_c > 0)).any(axis=-1)
by_class = {c: ((cls_c == c) & (w_c > 0)).any(axis=-1) for c in (2, 3, 4, 5)}
tp = (band & hidden).sum(); fp = (band & ~hidden).sum(); fn = (~band & hidden).sum()
res = {'truth_hidden_px': int(hidden.sum()), 'instrument_band_px': int(band.sum()), 'precision': float(tp / max(1, band.sum())), 'recall': float(tp / max(1, hidden.sum())), 'iou': float(tp / max(1, (band | hidden).sum()))}
for c, nm in ((2, 'bg'), (3, 'thing'), (4, 'side'), (5, 'interior')):
    m = by_class[c]; res[f'recall_{nm}'] = float((band & m).sum() / max(1, m.sum())); res[f'truth_{nm}_px'] = int(m.sum())
print(json.dumps(res, indent=1))
rgb = np.array(Image.open(sys.argv[3]).convert('RGB')).astype(float) / 255
col = np.zeros(rgb.shape); col[band & hidden] = (0.2, 0.9, 0.2); col[band & ~hidden] = (1, 0.5, 0); col[~band & hidden] = (0.3, 0.5, 1)
m = (band | hidden)[..., None]
im = np.where(m, 0.35 * rgb + 0.65 * col, rgb * 0.5)
tiles = [(Image.fromarray(to_u8(rgb)), 'rest RGB'), (Image.fromarray(to_u8(im)), f'green = both, orange = instrument only, blue = truth only; P {res["precision"]:.2f} R {res["recall"]:.2f} IoU {res["iou"]:.2f}')]
Wt, Ht = tiles[0][0].size; pad = 6
sh = Image.new('RGB', (2 * (Wt + pad) + pad, 28 + Ht + 22 + pad), (20, 20, 20)); d = ImageDraw.Draw(sh)
d.text((pad, 6), 'closed-form reveal instrument (depth only, 45 deg sweep) vs truth-kit exact hidden scope (same envelope)', fill=(255, 255, 255))
for k, (t, txt) in enumerate(tiles):
    x = pad + k * (Wt + pad); d.text((x, 28), txt, fill=(255, 230, 120)); sh.paste(t, (x, 44))
sh.save(sys.argv[4]); print('wrote', sys.argv[4])
