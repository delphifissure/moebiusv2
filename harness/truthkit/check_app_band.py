#!/usr/bin/env python3
"""Score the app's baked disocclusion band (a257_probe dump: disocc.u8 = the texels the quick bake
fills with far content, source rows) against the truth kit's exact hidden scope at the app's own
sweep envelope (scope_gt.npz from a *_env45 run at the plate resolution). Also scores the app's
far-field depth on the band against the truth's first hidden layer.

  python3 check_app_band.py out/S27_env45/scope_gt.npz ../shots/a257probe/S27 out/S27/rest_rgb.png out/S27/check_app.png
"""
import sys, os, json
import numpy as np
from PIL import Image, ImageDraw
from tk import to_u8, app_z_of_d

gt = np.load(sys.argv[1]); probe = sys.argv[2]
meta = json.load(open(os.path.join(probe, 'meta.json'))); pw, ph = meta['pw'], meta['ph']
dis = np.fromfile(os.path.join(probe, 'disocc.u8'), np.uint8).reshape(ph, pw) > 0
ff = np.fromfile(os.path.join(probe, 'farField.f32'), np.float32).reshape(ph, pw) if os.path.exists(os.path.join(probe, 'farField.f32')) else None
cls = gt['cls']; w = gt['w_disp'].astype(np.float32); dep = gt['depth']
H, W, K = cls.shape
y0 = (H - ph) // 2; x0 = (W - pw) // 2
cls_c = cls[y0:y0 + ph, x0:x0 + pw]; w_c = w[y0:y0 + ph, x0:x0 + pw]; dep_c = dep[y0:y0 + ph, x0:x0 + pw]
vis_hidden = (cls_c >= 2) & (cls_c <= 5) & (w_c > 0)
hidden = vis_hidden.any(axis=-1)
# sky revealed behind an occluder counts as hidden content (R3): the sky layer of the rest atlas
sky_hid = None
if 'sky_hidden' in gt.files:
    sky_hid = (gt['sky_hidden'] & (gt['sky_w_disp'].astype(np.float32) > 0))[y0:y0 + ph, x0:x0 + pw]
    hidden = hidden | sky_hid
tp = (dis & hidden).sum()
res = {'scene': os.path.basename(probe), 'plate': [pw, ph], 'truth_hidden_px': int(hidden.sum()), 'app_band_px': int(dis.sum()),
       'precision': float(tp / max(1, dis.sum())), 'recall': float(tp / max(1, hidden.sum())), 'iou': float(tp / max(1, (dis | hidden).sum()))}
# weighted recall: how much of the visibility-weighted truth the band covers
wmax = np.where(vis_hidden, w_c, 0).max(axis=-1)
res['recall_w_disp'] = float((wmax * dis).sum() / max(1e-9, wmax.sum()))
for c, nm in ((2, 'bg'), (3, 'thing'), (4, 'side'), (5, 'interior')):
    m = ((cls_c == c) & (w_c > 0)).any(axis=-1); res[f'truth_{nm}_px'] = int(m.sum()); res[f'recall_{nm}'] = float((dis & m).sum() / max(1, m.sum()))
if sky_hid is not None:
    res['truth_sky_reveal_px'] = int(sky_hid.sum()); res['recall_sky_reveal'] = float((dis & sky_hid).sum() / max(1, sky_hid.sum()))
# depth on the band: the app's far field (normalised depth) vs the truth's first ever-visible hidden layer, in metres
if ff is not None:
    outer, inner, pn = meta['outer'], meta['inner'], meta['pn']
    # first ever-visible hidden layer per pixel
    kk = np.argmax(vis_hidden, axis=-1); has = vis_hidden.any(axis=-1)
    d_true = np.take_along_axis(dep_c, kk[..., None], axis=-1)[..., 0]
    d_app = -app_z_of_d(ff, pn, outer, inner)          # metres behind the window
    m = dis & has & np.isfinite(d_true)   # sky-reveal texels have no finite truth depth; excluded from the metres error
    err = (d_app - d_true)[m]
    res['band_depth_err_m'] = {'n': int(m.sum()), 'mean': float(err.mean()) if m.any() else None, 'median_abs': float(np.median(np.abs(err))) if m.any() else None,
                               'p90_abs': float(np.percentile(np.abs(err), 90)) if m.any() else None, 'scene_depth_m': float(outer)}
    # the RENDERED plate depth (plateF.f32, stored bottom-up) after the ordering clamps and the slope limit: what the screen shows
    pfp = os.path.join(probe, 'plateF.f32')
    if os.path.exists(pfp):
        pf = np.fromfile(pfp, np.float32).reshape(ph, pw)[::-1]
        d_pl = -app_z_of_d(pf, pn, outer, inner); errp = (d_pl - d_true)[m]
        res['plate_depth_err_m'] = {'n': int(m.sum()), 'mean': float(errp.mean()) if m.any() else None, 'median_abs': float(np.median(np.abs(errp))) if m.any() else None,
                                    'p90_abs': float(np.percentile(np.abs(errp), 90)) if m.any() else None}
print(json.dumps(res, indent=1))
rgb = np.array(Image.open(sys.argv[3]).convert('RGB').resize((pw, ph))).astype(float) / 255
col = np.zeros(rgb.shape); col[dis & hidden] = (0.2, 0.9, 0.2); col[dis & ~hidden] = (1, 0.5, 0); col[~dis & hidden] = (0.3, 0.5, 1)
mm = (dis | hidden)[..., None]
im = np.where(mm, 0.35 * rgb + 0.65 * col, rgb * 0.5)
tiles = [(Image.fromarray(to_u8(rgb)), 'rest RGB (truth-kit scene)'), (Image.fromarray(to_u8(im)), f'green = both, orange = app band only, blue = truth only; P {res["precision"]:.2f} R {res["recall"]:.2f} IoU {res["iou"]:.2f}')]
Wt, Ht = tiles[0][0].size; pad = 6
sh = Image.new('RGB', (2 * (Wt + pad) + pad, 28 + Ht + 22 + pad), (20, 20, 20)); d = ImageDraw.Draw(sh)
d.text((pad, 6), f'{res["scene"]}: the app\'s baked band (quick bake, 45 deg sweep) vs the exact hidden scope at the same envelope', fill=(255, 255, 255))
for k, (t, txt) in enumerate(tiles):
    x = pad + k * (Wt + pad); d.text((x, 28), txt, fill=(255, 230, 120)); sh.paste(t, (x, 44))
sh.save(sys.argv[4]); print('wrote', sys.argv[4])
json.dump(res, open(os.path.splitext(sys.argv[4])[0] + '.json', 'w'), indent=1)
