#!/usr/bin/env python3
"""Closed-form reveal / scope instrument for a real depth map (Sprint 1b).

Given only a normalised depth map and the app's mapping (W, D, pn, outer, inner) this computes, with
no rendering, what the portal must show beyond the photograph over an eye envelope:

  * the app's shift law per texel: sigma(d) = e * z(d) / (D - z(d)) * pxPerWorld  (bgShiftLUTFor),
    z(d) the app's smoothstep depth law (app_z_of_d);
  * per pose (eye at fraction f of e_max along an axis) the 1-D forward warp of every scanline:
    texels are unit segments displaced by sigma * f; neighbouring texels stay joined (the mesh
    stretches) while their step |d sigma| * f <= tear px, and tear beyond it; display cells no
    segment covers are holes;
  * each hole cell q is owed content at the far rim's depth, which lives in the rest image at
    q - sigma_far * f: under the NEAR texel beside the rim (the disocclusion band, source rows), or
    beyond the frame (the outpaint strip);
  * weights: for every band/strip texel, the fraction of envelope poses that reveal it (w_disp)
    and the cos^3-weighted fraction (w_ret; theta from e = f * e_max at distance D).

Envelope: the app's sweep grid (NX x NY poses on +-e_max, e_max = D tan(fadeDeg), vertical extent
scaled by H/W) or an explicit list of window angles. Poses are taken along the two axes (the union
over a rectangular grid is dominated by its axis extremes for straight rims; corners differ at the
second order — measured, not assumed: see --grid-check).

  python3 reveal.py --depth out/S27/rest_depth16.png --W 0.16 --D 0.2 --pn 0.5 --outer 0.24 --inner 0.0001 --fade 45
  python3 reveal.py --probe harness/shots/a257probe/troll     # the app's dump: dQ.f32 + disocc.u8 + meta.json
"""
import argparse, json, os, sys, time
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from tk import app_z_of_d, load_gray, to_u8, save_png


def shift_px(dn, e, D, pn, outer, inner, px_per_world):
    z = app_z_of_d(dn, pn, outer, inner)
    return e * z / np.maximum(1e-4, D - z) * px_per_world


def scanline_reveal(sig, f, joined):
    """1-D forward warp of every row of `sig` (rows x n texel shifts at f = 1) at pose fraction f.
    `joined` (rows x n-1) says which neighbouring texels are one continuous surface (the mesh
    stretches between them; no hidden content). Returns (band, outp): band[r, x] = 1 where rest
    texel x of row r is owed far content (a hole attributed to it); outp[r, side] = strip width in
    px needed beyond the frame (0 = left, 1 = right)."""
    R, n = sig.shape
    s = sig * f
    x = np.arange(n)[None, :]
    L = x + s; Rr = L + 1
    Rext = Rr.copy()
    Rext[:, :-1] = np.where(joined, np.maximum(Rr[:, :-1], L[:, 1:]), Rr[:, :-1])
    # coverage over display cells [0, n) by difference array
    lo = np.clip(np.ceil(L).astype(int), 0, n); hi = np.clip(np.ceil(Rext).astype(int), 0, n)
    cov = np.zeros((R, n + 1), np.int32)
    rows = np.repeat(np.arange(R), n)
    np.add.at(cov, (rows, lo.ravel()), 1); np.add.at(cov, (rows, hi.ravel()), -1)
    cov = np.cumsum(cov, axis=1)[:, :n]
    hole = cov <= 0
    band = np.zeros((R, n), np.uint8); outp = np.zeros((R, 2), np.float32)
    if not hole.any():
        return band, outp
    # Attribution by rim. A rim is a discontinuous pair (i, i+1). At this pose it opens a gap
    # [R_i, L_{i+1}) when the two move apart; the gap shows the FAR side's continuation (the texel of
    # the pair with the smaller shift at f = 1: behind-content shifts negative, farther more so), whose
    # rest position is q - sigma_far * f — under the near texel beside the rim. Only gap cells that are
    # holes (covered by no displaced segment, z-order included) are owed content; gap cells outside the
    # display are never seen. Holes touching the display edge with no rim are the frame's own
    # continuation beyond the plate (outpaint), attributed to the edge texel's shift.
    rr, ri = np.nonzero(~joined)
    glo = Rr[rr, ri]; ghi = L[rr, ri + 1]
    op = ghi > glo
    rr, ri, glo, ghi = rr[op], ri[op], glo[op], ghi[op]
    c0 = np.clip(np.ceil(glo).astype(int), 0, n); c1 = np.clip(np.ceil(ghi).astype(int), 0, n)
    w = np.maximum(c1 - c0, 0)
    claimed = np.zeros((R, n), bool)
    if w.sum() > 0:
        rep = np.repeat(np.arange(len(w)), w)
        offs = np.arange(w.sum()) - np.repeat(np.cumsum(w) - w, w)
        qc = c0[rep] + offs; qr = rr[rep]
        keep = hole[qr, qc]
        qr, qc, rep = qr[keep], qc[keep], rep[keep]
        claimed[qr, qc] = True
        far_i = np.where(sig[rr, ri] <= sig[rr, ri + 1], ri, ri + 1)[rep]
        src = qc + 0.5 - sig[qr, far_i] * f
        inside = (src >= 0) & (src < n)
        band[qr[inside], np.floor(src[inside]).astype(int)] = 1
        if (src < 0).any():
            np.add.at(outp[:, 0], qr[src < 0], 1)
        if (src >= n).any():
            np.add.at(outp[:, 1], qr[src >= n], 1)
    # unclaimed holes: the frame edge's continuation
    rest = hole & ~claimed
    if rest.any():
        hr, hq = np.nonzero(rest)
        left = (hq + 0.5) < (L[hr, 0] + Rext[hr, 0]) / 2   # nearer the first texel than the last
        np.add.at(outp[:, 0], hr[left], 1); np.add.at(outp[:, 1], hr[~left], 1)
    return band, outp


def retinal_weight(e, D, n=3):
    return (D / np.hypot(e, D)) ** n


def continuity(dn, D, pn, outer, inner, mode='ratio', t=1.05, tear=1.0, sig=None):
    """Which neighbouring texels (along axis 1) are one surface. 'ratio': metric eye-distance ratio
    max/min <= t (Depth Pro's occluding-contour test uses t in [1.05, 1.25]; a ratio is invariant to
    the scene's scale). 'tear': the app's display rule, |step of the shift at f = 1| <= tear px
    (holes then also open on continuous glancing surfaces — a rendering fact, not hidden content)."""
    if mode == 'tear':
        return np.abs(np.diff(sig, axis=1)) <= tear
    m = D - app_z_of_d(dn, pn, outer, inner)          # metric distance from the rest eye
    a, b = m[:, :-1], m[:, 1:]
    return np.maximum(a, b) / np.maximum(1e-9, np.minimum(a, b)) <= t


def run(dn, W, D, pn, outer, inner, fade_deg=45.0, nx_poses=17, ny_poses=5, tear=1.0, H=None, join='ratio', t=1.05, log=print, fade_deg_v=30.0):
    ph, pw = dn.shape
    H = H if H is not None else W * 9 / 16
    # the app's bgShiftLUTFor: the layer is fitted inside the frame, so a portrait plate is height-limited
    layer_aspect = pw / ph; frame_aspect = W / H
    layer_w = W if layer_aspect > frame_aspect else H * layer_aspect
    ppw = pw / layer_w
    aspect = np.tan(np.radians(fade_deg_v)) / np.tan(np.radians(fade_deg))          # S2a: the vertical rim is an ANGLE (30 deg), not the window's aspect
    e_max = D * np.tan(np.radians(fade_deg))
    sig_x = shift_px(dn, e_max, D, pn, outer, inner, ppw)                       # at f = 1 along x
    sig_y = shift_px(dn, e_max * aspect, D, pn, outer, inner, ppw)              # vertical poses reach D*tan(30 deg)
    log(f'  plate {pw}x{ph}: layer width {layer_w:.4f} m, {ppw:.0f} px/m; max |shift| at e_max: {np.abs(sig_x).max():.1f} px (x), {np.abs(sig_y).max():.1f} px (y)')
    # pose fractions along each axis, from the grid (symmetric, excluding rest)
    def grid(n):
        v = np.array([2 * i / (n - 1) - 1 for i in range(n)]) if n > 1 else np.zeros(0)
        return v[v != 0]
    fx = grid(nx_poses); fy = grid(ny_poses)
    poses = [('x', f) for f in fx] + [('y', f) for f in fy]
    jx = continuity(dn, D, pn, outer, inner, join, t, tear, sig_x)
    jy = continuity(dn.T[:, ::-1], D, pn, outer, inner, join, t, tear, sig_y.T[:, ::-1])
    log(f'  continuity ({join}{" t=" + str(t) if join == "ratio" else " tear=" + str(tear) + "px"}): {int((~jx).sum())} horizontal + {int((~jy).sum())} vertical discontinuous pairs')
    band_cnt = np.zeros((ph, pw), np.float32); band_ret = np.zeros((ph, pw), np.float32)
    outp = {'left': np.zeros(ph, np.float32), 'right': np.zeros(ph, np.float32), 'top': np.zeros(pw, np.float32), 'bottom': np.zeros(pw, np.float32)}
    wsum = 0.0; per_pose = []
    t0 = time.time()
    for axis, f in poses:
        e = e_max * abs(f) * (1 if axis == 'x' else aspect)
        wr = retinal_weight(e, D)
        if axis == 'x':
            b, o = scanline_reveal(sig_x, f, jx)
            outp['left'] = np.maximum(outp['left'], o[:, 0]); outp['right'] = np.maximum(outp['right'], o[:, 1])
        else:
            # image rows run top to bottom; a positive eye offset upward is the transposed problem with rows flipped
            b, o = scanline_reveal(sig_y.T[:, ::-1], f, jy)
            b = b[:, ::-1].T
            outp['bottom'] = np.maximum(outp['bottom'], o[:, 0]); outp['top'] = np.maximum(outp['top'], o[:, 1])
        band_cnt += b; band_ret += b * wr; wsum += wr
        per_pose.append({'axis': axis, 'f': float(f), 'e': float(e), 'theta': float(np.degrees(np.arctan2(e, D))), 'w_ret': float(wr), 'band_px': int(b.sum()), 'outpaint_px': float(o.sum())})
    w_disp = band_cnt / len(poses); w_ret = band_ret / wsum
    log(f'  reveal: {pw}x{ph}, e_max {e_max:.4f} m ({fade_deg} deg), {len(poses)} axis poses in {time.time() - t0:.1f}s; band union {int((w_disp > 0).sum())} px ({100 * (w_disp > 0).mean():.2f}% of plate)')
    return {'w_disp': w_disp, 'w_ret': w_ret, 'sig_x': sig_x, 'sig_y': sig_y, 'outpaint': outp, 'per_pose': per_pose, 'e_max': e_max, 'poses': len(poses)}


def load_probe(dirn):
    meta = json.load(open(os.path.join(dirn, 'meta.json')))
    pw, ph = meta['pw'], meta['ph']
    dQ = np.fromfile(os.path.join(dirn, 'dQ.f32'), np.float32).reshape(ph, pw)
    dis = np.fromfile(os.path.join(dirn, 'disocc.u8'), np.uint8).reshape(ph, pw)
    return meta, dQ, dis


def compare(analytic, empirical):
    a = analytic > 0; e = empirical > 0
    tp = (a & e).sum(); fp = (a & ~e).sum(); fn = (~a & e).sum()
    return {'analytic_px': int(a.sum()), 'empirical_px': int(e.sum()), 'overlap_px': int(tp), 'precision': float(tp / max(1, a.sum())), 'recall': float(tp / max(1, e.sum())), 'iou': float(tp / max(1, (a | e).sum()))}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--depth'); ap.add_argument('--probe'); ap.add_argument('--out', default=None)
    ap.add_argument('--W', type=float, default=0.16); ap.add_argument('--H', type=float, default=0.09); ap.add_argument('--D', type=float, default=0.2); ap.add_argument('--pn', type=float, default=0.5)
    ap.add_argument('--outer', type=float, default=0.02); ap.add_argument('--inner', type=float, default=0.04); ap.add_argument('--fade', type=float, default=45.0)
    ap.add_argument('--nx-poses', type=int, default=17); ap.add_argument('--ny-poses', type=int, default=5); ap.add_argument('--tear', type=float, default=1.0)
    ap.add_argument('--join', choices=['ratio', 'tear'], default='ratio'); ap.add_argument('--t', type=float, default=1.05, help='ratio test threshold (Depth Pro boundary metric range 1.05-1.25)')
    ap.add_argument('--rgb', default=None, help='optional colour image for the overlay sheet')
    a = ap.parse_args()
    if a.probe:
        meta, dn, dis = load_probe(a.probe)
        W = meta.get('terrariumWidth', a.W); H = meta.get('terrariumHeight', a.H); D = meta['D']; pn = meta['pn']; outer = meta['outer']; inner = meta['inner']
        out = a.out or os.path.join(a.probe, 'reveal')
        print(f'probe {a.probe}: {dn.shape[1]}x{dn.shape[0]} W {W} D {D:.4f} pn {pn} outer {outer} inner {inner}; app band {int((dis > 0).sum())} px')
    else:
        dn = load_gray(a.depth); dis = None
        W, H, D, pn, outer, inner = a.W, a.H, a.D, a.pn, a.outer, a.inner
        out = a.out or os.path.join(os.path.dirname(os.path.abspath(a.depth)), 'reveal')
    os.makedirs(out, exist_ok=True)
    res = run(dn, W, D, pn, outer, inner, a.fade, a.nx_poses, a.ny_poses, a.tear, H=H, join=a.join, t=a.t)
    summ = {'W': W, 'D': D, 'pn': pn, 'outer': outer, 'inner': inner, 'fade_deg': a.fade, 'e_max': res['e_max'], 'join': a.join, 't': a.t, 'tear_px': a.tear, 'poses': res['poses'],
            'band_union_px': int((res['w_disp'] > 0).sum()), 'band_w_disp_sum': float(res['w_disp'].sum()), 'band_w_ret_sum': float(res['w_ret'].sum()),
            'outpaint_max_px': {k: float(v.max()) for k, v in res['outpaint'].items()}, 'outpaint_mean_px': {k: float(v.mean()) for k, v in res['outpaint'].items()},
            'per_pose': res['per_pose']}
    if dis is not None:
        summ['vs_app_band'] = compare(res['w_disp'], dis)
        print('  vs app band:', json.dumps(summ['vs_app_band']))
    json.dump(summ, open(os.path.join(out, 'reveal_summary.json'), 'w'), indent=1)
    np.savez_compressed(os.path.join(out, 'reveal.npz'), w_disp=res['w_disp'], w_ret=res['w_ret'], sig_x=res['sig_x'].astype(np.float32), **{f'outpaint_{k}': v for k, v in res['outpaint'].items()})
    # sheet
    from PIL import Image, ImageDraw
    base = np.repeat(dn[..., None], 3, -1) if a.rgb is None else np.array(Image.open(a.rgb).convert('RGB').resize((dn.shape[1], dn.shape[0]))) / 255.0
    def ov(w, col):
        al = np.clip(w, 0, 1) ** 0.5 * 0.85
        return base * (1 - al[..., None]) + np.array(col) * al[..., None]
    tiles = [(Image.fromarray(to_u8(base)), 'input (depth or RGB)'), (Image.fromarray(to_u8(ov(res['w_disp'], (1, 0.55, 0)))), 'analytic band, alpha = fraction of poses that reveal (w_disp)'),
             (Image.fromarray(to_u8(ov(res['w_ret'], (1, 0.55, 0)))), 'analytic band, cos^3 retinal weight (w_ret)')]
    if dis is not None:
        a_ = res['w_disp'] > 0; e_ = dis > 0
        col = np.zeros(dn.shape + (3,)); col[a_ & e_] = (0.2, 0.9, 0.2); col[a_ & ~e_] = (1, 0.5, 0); col[~a_ & e_] = (0.3, 0.5, 1)
        m = (a_ | e_)[..., None]
        tiles.append((Image.fromarray(to_u8(np.where(m, col, base * 0.5))), f'analytic vs app band: green both, orange analytic only, blue app only  P {summ["vs_app_band"]["precision"]:.2f} R {summ["vs_app_band"]["recall"]:.2f} IoU {summ["vs_app_band"]["iou"]:.2f}'))
    Wt, Ht = tiles[0][0].size; sc = min(1.0, 700 / Wt); pad = 6; cols = 2; rows = (len(tiles) + 1) // 2
    tiles = [(im.resize((int(im.width * sc), int(im.height * sc))), t) for im, t in tiles]; Wt, Ht = tiles[0][0].size
    sh = Image.new('RGB', (cols * (Wt + pad) + pad, 28 + rows * (Ht + 22 + pad)), (20, 20, 20)); d = ImageDraw.Draw(sh)
    d.text((pad, 6), f'reveal instrument: W {W} D {D:.3f} pn {pn} outer {outer} inner {inner} fade {a.fade} deg e_max {res["e_max"]:.3f} m join {a.join} {a.t if a.join == "ratio" else str(a.tear) + "px"}; union {summ["band_union_px"]} px; outpaint max L/R/T/B ' + '/'.join(f'{summ["outpaint_max_px"][k]:.0f}' for k in ('left', 'right', 'top', 'bottom')), fill=(255, 255, 255))
    for k, (im, t) in enumerate(tiles):
        x = pad + (k % cols) * (Wt + pad); y = 28 + (k // cols) * (Ht + 22 + pad); d.text((x, y), t, fill=(255, 230, 120)); sh.paste(im, (x, y + 16))
    sh.save(os.path.join(out, 'reveal_sheet.png')); print('wrote', out)


if __name__ == '__main__':
    main()
