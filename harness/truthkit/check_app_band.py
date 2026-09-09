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
    # S4: the second layer — the app's plate 2 (farField2, -1 = none) against the kit's SECOND ever-visible hidden
    # layer where both exist, and the better of the app's two layers against the kit's first
    f2p = os.path.join(probe, 'farField2.f32')
    if os.path.exists(f2p):
        ff2 = np.fromfile(f2p, np.float32).reshape(ph, pw); has_app2 = ff2 >= 0
        order = np.argsort(~vis_hidden, axis=-1, kind='stable'); n_vis = vis_hidden.sum(-1)
        k2 = order[..., 1]; has_kit2 = n_vis >= 2
        d_true2 = np.take_along_axis(dep_c, k2[..., None], axis=-1)[..., 0]
        d_app2 = -app_z_of_d(np.clip(ff2, 0, 1), pn, outer, inner)
        m2 = dis & has_kit2 & has_app2 & np.isfinite(d_true2); err2 = np.abs(d_app2 - d_true2)[m2]
        m1 = dis & has & np.isfinite(d_true); e1 = np.abs(d_app - d_true); ea = np.abs(d_app2 - d_true); best = np.where(has_app2, np.minimum(e1, ea), e1)
        # app layer 2 against the kit's first layer (is the second layer sometimes the kit's first?)
        m21 = dis & has & has_app2 & np.isfinite(d_true)
        res['layer2'] = {'app_px': int((dis & has_app2).sum()), 'kit_px': int((dis & has_kit2).sum()), 'both_px': int(m2.sum()),
                         'median_abs_m': float(np.median(err2)) if m2.any() else None, 'p90_abs_m': float(np.percentile(err2, 90)) if m2.any() else None,
                         'best_of_two_vs_first_median_m': float(np.median(best[m1])) if m1.any() else None, 'best_of_two_vs_first_p90_m': float(np.percentile(best[m1], 90)) if m1.any() else None,
                         'layer1_vs_first_p90_m': float(np.percentile(e1[m1], 90)) if m1.any() else None,
                         'app2_matches_kit1_frac': float((ea[m21] < e1[m21]).mean()) if m21.any() else None}
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
# S5: carriers (plate vertices at far depth for continuity) vs the texture band; the wash check from the bake
cp = os.path.join(probe, 'carrier.u8'); res['carrier_px'] = int((np.fromfile(cp, np.uint8) > 0).sum()) if os.path.exists(cp) else None
res['clone_count'] = meta.get('cloneCount'); res['clone_count_final'] = meta.get('cloneCountFinal')
cp2 = os.path.join(probe, 'carrier2.u8'); res['carrier2_px'] = int((np.fromfile(cp2, np.uint8) > 0).sum()) if os.path.exists(cp2) else None
# S6: the band by first-uncover pose (bandPose.f32 = smallest pose fraction at which the texel was demanded; fraction =
# tan(head angle)/tan(envelope)); per tier its size and its precision against the same truth (a tier is a subset of the band)
bpf = os.path.join(probe, 'bandPose.f32')
if os.path.exists(bpf):
    bp = np.fromfile(bpf, np.float32).reshape(ph, pw); env = float(meta.get('envDeg') or 45.0); res['tiers'] = {}
    for deg in (15, 25, 35):
        t = dis & (bp <= np.tan(np.radians(deg)) / np.tan(np.radians(env)) + 1e-6); n = int(t.sum())
        res['tiers'][str(deg)] = {'px': n, 'frac_of_band': float(n / max(1, dis.sum())), 'precision': float((t & hidden).sum() / max(1, n))}
    print('tiers', json.dumps(res['tiers']))
json.dump(res, open(os.path.splitext(sys.argv[4])[0] + '.json', 'w'), indent=1)
