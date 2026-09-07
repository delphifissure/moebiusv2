#!/usr/bin/env python3
"""Gap atlas v0 (R2): one container for "what the portal must show beyond the photograph", written
from the truth kit (exact) or from the app's bake (its current answer), so the two can be scored
chart by chart.

Container: <name>.npz + <name>.json, all charts on the rest canvas grid (frame-centred; the frame is
the central plate_w x plate_h region; the margin beyond it is the outpaint region).

Charts (each an (ny, nx) or (ny, nx, K) array):
  A0        photographed plate:            rgb (u8), depth_m (f32, metres behind the window, +behind)
  H         hidden layers k = 1..K-1:      depth_m (f32), rgb (u8 placeholder), cls (i8: 2 bg, 3 thing,
                                           4 own side, 5 own interior), w_disp (f16), w_ret (f16),
                                           prov (i8: 0 truth, 1 app far field, 2 app back layer, 3 SD)
  O         outpaint (beyond the frame):   the same fields at k = 0.. on the margin
Class weights are the envelope visibility weights of scope.py (w_disp = fraction of eyes, w_ret =
cos^3-weighted). The json carries the envelope, the mapping (W, H, D, pn, outer, inner), and stats:
per chart sample count, weight sums, class histogram.

  python3 atlas.py truth out/S27_env45/scope_gt.npz out/S27/atlas_truth
  python3 atlas.py app ../shots/a257probe/S27 out/S27/atlas_app  [--truth out/S27/atlas_truth.npz]
  python3 atlas.py sheet out/S27/atlas_truth.npz out/S27/rest_rgb.png out/S27/atlas_truth.png
"""
import sys, os, json, argparse
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from tk import to_u8, app_z_of_d

PROV = {'truth': 0, 'app_far': 1, 'app_back': 2, 'sd': 3}
CLASS_RGB = np.array([[0, 0, 0], [255, 140, 0], [40, 120, 255], [255, 60, 60], [60, 220, 90], [230, 60, 230], [120, 200, 255]], float) / 255


def stats(cls, w_disp, w_ret, mask):
    out = {'samples': int(mask.sum()), 'w_disp_sum': float(w_disp[mask].sum()), 'w_ret_sum': float(w_ret[mask].sum()), 'classes': {}}
    for c, nm in ((2, 'bg'), (3, 'thing'), (4, 'side'), (5, 'interior'), (1, 'outpaint'), (-1, 'unknown')):
        m = mask & (cls == c)
        if m.any():
            out['classes'][nm] = {'samples': int(m.sum()), 'w_disp_sum': float(w_disp[m].sum()), 'w_ret_sum': float(w_ret[m].sum())}
    return out


def from_truth(gt_path, out):
    g = np.load(gt_path)
    cls = g['cls']; w_disp = g['w_disp'].astype(np.float32); w_ret = g['w_ret'].astype(np.float32); dep = g['depth']; rgb = g['rgb']; valid = g['valid']
    ny, nx, K = cls.shape
    # frame = where layer 0 is class 0 (photographed) — the central plate
    frame = cls[..., 0] == 0
    ys, xs = np.nonzero(frame); y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    # charts hold only samples some envelope eye sees; samples no eye ever sees (a wall behind the floor's
    # own rows, an object's back face) are not scope and stay out of the atlas
    hidden = (cls >= 2) & (cls <= 5) & (w_disp > 0)
    outp = (cls == 1) & (w_disp > 0)
    prov = np.where(valid, PROV['truth'], -1).astype(np.int8)
    meta = {'source': 'truth', 'gt': os.path.abspath(gt_path), 'canvas': [nx, ny], 'frame': [int(x0), int(y0), int(x1), int(y1)], 'K': int(K),
            'eyes_thx': g['thx'].tolist(), 'eyes_thy': g['thy'].tolist(), 'n_eyes': int(g['n_eyes']),
            'stats': {'H_all': stats(cls, w_disp, w_ret, hidden), 'H_ever_visible': stats(cls, w_disp, w_ret, hidden & (w_disp > 0)),
                      'O_all': stats(cls, w_disp, w_ret, outp), 'O_ever_visible': stats(cls, w_disp, w_ret, outp & (w_disp > 0))}}
    for k in range(1, K):
        meta['stats'][f'H_{k}'] = stats(cls[..., k], w_disp[..., k], w_ret[..., k], hidden[..., k] & (w_disp[..., k] > 0))
    np.savez_compressed(out + '.npz', A0_rgb=rgb[..., 0, :], A0_depth_m=np.where(np.isfinite(dep[..., 0]), dep[..., 0], np.nan).astype(np.float32),
                        H_depth_m=np.where(hidden, dep, np.nan).astype(np.float32), H_rgb=np.where(hidden[..., None], rgb, 0), H_cls=np.where(hidden, cls, -1).astype(np.int8),
                        H_w_disp=np.where(hidden, w_disp, 0).astype(np.float16), H_w_ret=np.where(hidden, w_ret, 0).astype(np.float16), H_prov=np.where(hidden, prov, -1).astype(np.int8),
                        O_depth_m=np.where(outp, dep, np.nan).astype(np.float32), O_rgb=np.where(outp[..., None], rgb, 0), O_w_disp=np.where(outp, w_disp, 0).astype(np.float16),
                        O_w_ret=np.where(outp, w_ret, 0).astype(np.float16), frame=np.array([x0, y0, x1, y1]))
    json.dump(meta, open(out + '.json', 'w'), indent=1)
    print('truth atlas:', json.dumps({k: v for k, v in meta['stats'].items() if k in ('H_ever_visible', 'O_ever_visible')}))


def from_app(probe, out, truth=None):
    m = json.load(open(os.path.join(probe, 'meta.json'))); pw, ph = m['pw'], m['ph']
    def ld(n, dt):
        p = os.path.join(probe, n); return np.fromfile(p, dt).reshape(ph, pw) if os.path.exists(p) else None
    dis = ld('disocc.u8', np.uint8); ff = ld('farField.f32', np.float32); bd = ld('backDepth.f32', np.float32); bm = ld('backMode.u8', np.uint8); dq = ld('dQ.f32', np.float32); pf = ld('plateF.f32', np.float32)
    outer, inner, pn = m['outer'], m['inner'], m['pn']
    z = lambda d: -app_z_of_d(d, pn, outer, inner)
    band = dis > 0
    # the app has no canvas margin: its atlas is the plate itself (frame = whole canvas)
    K = 3  # layer 1 = far field on the band, layer 2 = back layer
    H_depth = np.full((ph, pw, K), np.nan, np.float32); H_cls = np.full((ph, pw, K), -1, np.int8); H_prov = np.full((ph, pw, K), -1, np.int8)
    if ff is not None:
        H_depth[..., 1] = np.where(band, z(ff), np.nan); H_cls[..., 1] = np.where(band, -1, -1); H_prov[..., 1] = np.where(band, PROV['app_far'], -1)
    back = None
    if bd is not None:
        back = (bm > 0) if bm is not None else np.isfinite(bd) & (bd > 0)
        H_depth[..., 2] = np.where(back, z(bd), np.nan); H_cls[..., 2] = np.where(back, 4, -1); H_prov[..., 2] = np.where(back, PROV['app_back'], -1)
    w1 = np.zeros((ph, pw, K), np.float16)   # the app carries no visibility weight; 1 on the band, else 0
    w1[..., 1] = band;
    if back is not None: w1[..., 2] = back
    meta = {'source': 'app', 'probe': os.path.abspath(probe), 'canvas': [pw, ph], 'frame': [0, 0, pw, ph], 'K': K, 'mapping': {'W': m.get('terrariumWidth'), 'H': m.get('terrariumHeight'), 'D': m['D'], 'pn': pn, 'outer': outer, 'inner': inner},
            'stats': {'band_px': int(band.sum()), 'band_frac': float(band.mean()), 'back_px': int(back.sum()) if back is not None else 0,
                      'far_field_depth_m': {'median': float(np.median(z(ff)[band])) if ff is not None and band.any() else None}}}
    np.savez_compressed(out + '.npz', A0_depth_m=z(dq).astype(np.float32) if dq is not None else np.zeros((ph, pw), np.float32), plate_final_depth_m=z(pf[::-1]).astype(np.float32) if pf is not None else None,
                        H_depth_m=H_depth, H_cls=H_cls, H_prov=H_prov, H_w_disp=w1, H_w_ret=w1, frame=np.array([0, 0, pw, ph]))
    json.dump(meta, open(out + '.json', 'w'), indent=1)
    print('app atlas:', json.dumps(meta['stats']))


def sheet(atlas_path, rgb_path, out):
    from PIL import Image, ImageDraw
    a = np.load(atlas_path, allow_pickle=True); j = json.load(open(os.path.splitext(atlas_path)[0] + '.json'))
    x0, y0, x1, y1 = a['frame']; ny, nx = a['H_cls'].shape[:2]
    rgb = np.array(Image.open(rgb_path).convert('RGB')).astype(float) / 255
    canvas = np.zeros((ny, nx, 3)) + 0.12
    rh, rw = rgb.shape[:2]
    if (rw, rh) != (x1 - x0, y1 - y0):
        rgb = np.array(Image.fromarray(to_u8(rgb)).resize((x1 - x0, y1 - y0))).astype(float) / 255
    canvas[y0:y1, x0:x1] = rgb
    if 'A0_rgb' in a:
        canvas = a['A0_rgb'].astype(float) / 255
        canvas[:y0] *= 0.45; canvas[y1:] *= 0.45; canvas[:, :x0] *= 0.45; canvas[:, x1:] *= 0.45
    cls = a['H_cls']; w = a['H_w_disp'].astype(float); K = cls.shape[-1]
    tiles = [(Image.fromarray(to_u8(canvas)), 'A0 photographed (frame bright)')]
    # per-pixel strongest hidden sample
    wk = np.where(cls != -100, w, 0); kb = np.argmax(wk, axis=-1)
    cb = np.take_along_axis(cls, kb[..., None], -1)[..., 0]; wb = np.take_along_axis(w, kb[..., None], -1)[..., 0]
    col = CLASS_RGB[np.clip(np.where(cb < 0, 1, cb), 0, 6)]   # unknown class (app) drawn orange
    al = np.where(wb > 0, 0.8 * np.sqrt(np.clip(wb, 0, 1)), 0)
    tiles.append((Image.fromarray(to_u8(canvas * (1 - al[..., None]) + col * al[..., None])), 'H: hidden scope, strongest layer per pixel (alpha = visibility weight)'))
    dep = a['H_depth_m']
    for k in range(1, min(K, 3)):
        d = dep[..., k]; ok = np.isfinite(d)
        if not ok.any():
            continue
        lo, hi = np.nanpercentile(d[ok], 1), np.nanpercentile(d[ok], 99)
        vis = np.where(ok, 1 - np.clip((d - lo) / max(1e-9, hi - lo), 0, 1), 0)
        tiles.append((Image.fromarray(to_u8(np.repeat(vis[..., None], 3, -1))), f'H_{k} depth (bright = near; range {lo:.3f}-{hi:.3f} m; {int(ok.sum())} samples)'))
        if 'H_rgb' in a:
            tiles.append((Image.fromarray(a['H_rgb'][..., k, :]), f'H_{k} RGB placeholder'))
    if 'O_w_disp' in a:
        ow = a['O_w_disp'].astype(float).max(axis=-1)
        tiles.append((Image.fromarray(to_u8(canvas * (1 - 0.8 * np.sqrt(ow)[..., None]) + CLASS_RGB[1] * 0.8 * np.sqrt(ow)[..., None])), 'O: outpaint scope beyond the frame (alpha = visibility weight)'))
    sc = min(1.0, 760 / nx); tiles = [(im.resize((int(im.width * sc), int(im.height * sc))), t) for im, t in tiles]
    Wt, Ht = tiles[0][0].size; pad = 6; cols = 2; rows = (len(tiles) + 1) // 2
    sh = Image.new('RGB', (cols * (Wt + pad) + pad, 28 + rows * (Ht + 22 + pad)), (20, 20, 20)); d = ImageDraw.Draw(sh)
    d.text((pad, 6), f'gap atlas v0 [{j["source"]}] {os.path.basename(atlas_path)}: orange outpaint/unknown, blue bg, red thing, green own side, magenta own interior', fill=(255, 255, 255))
    for k, (im, t) in enumerate(tiles):
        x = pad + (k % cols) * (Wt + pad); y = 28 + (k // cols) * (Ht + 22 + pad); d.text((x, y), t, fill=(255, 230, 120)); sh.paste(im, (x, y + 16))
    sh.save(out); print('wrote', out)


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('mode', choices=['truth', 'app', 'sheet']); ap.add_argument('src'); ap.add_argument('out'); ap.add_argument('extra', nargs='?')
    a = ap.parse_args()
    if a.mode == 'truth':
        from_truth(a.src, a.out)
    elif a.mode == 'app':
        from_app(a.src, a.out)
    else:
        sheet(a.src, a.out, a.extra)
