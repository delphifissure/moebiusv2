#!/usr/bin/env python3
"""Envelope ground truth for a truthkit scene: what the portal must show beyond the photograph.

Two exact products, no tolerances:

A. Rest-atlas GT (per rest-canvas pixel, per hidden layer k): class, and for every eye of the envelope
   whether that surface sample is seen through the window (window-pass test + a shadow ray to the eye).
   From the bits: w_disp = fraction of envelope eyes that see the sample; w_ret = the same fraction with
   each eye weighted by the window's retinal solid angle, cos^3(theta) for a viewer on the plane z = D
   (solid angle of a flat patch = A cos(theta) / r^2 with r = D / cos(theta)).
B. Display GT (per envelope eye, per display pixel of the window): what the viewer would see there,
   classified against the photograph: photographed / outpaint (beside the frame) / disocclusion of
   background / disocclusion of another thing / an object's own side / an object's own interior / sky.
   Per-eye fractions of the display, and the closed-form check f(d, e) = 1 - e d / (W (D + d)) on the
   scene's back wall.

Classes: 0 photographed, 1 outpaint, 2 bg-disocclusion, 3 thing-disocclusion, 4 side (same object,
back-facing to the rest eye), 5 interior (same object, front-facing), 6 sky, -1 none.

  python3 scope.py S27 [--nx 600] [--thx 0,15,30,45,60,75,85] [--thy 0,25] [--margin 0.5] [--K 6]
"""
import argparse, json, os, sys, time
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from tk import Portal, render, save_png, to_u8, INF
from scenes import SCENES
from PIL import Image, ImageDraw

CLASS_NAMES = ['photographed', 'outpaint', 'bg_disocclusion', 'thing_disocclusion', 'side', 'interior', 'sky']
CLASS_RGB = np.array([[0, 0, 0], [255, 140, 0], [40, 120, 255], [255, 60, 60], [60, 220, 90], [230, 60, 230], [120, 200, 255]], float) / 255


# ----------------------------------------------------------------------------- shadow rays
def first_t(scene, o, d, chunk=400000):
    """Nearest hit distance along each ray (inf if none)."""
    N = len(o); out = np.full(N, INF)
    for s in range(0, N, chunk):
        oo = o[s:s + chunk]; dd = d[s:s + chunk]
        best = np.full(len(oo), INF)
        for prim in scene:
            for t in prim.hits(oo, dd):
                best = np.minimum(best, t)
        out[s:s + chunk] = best
    return out


def visible_from(scene, eye, Q, portal, rel_eps=1e-4):
    """Exact visibility of surface points Q (N,3) from `eye` through the window rect: the segment eye->Q
    crosses the rect and no surface lies strictly before Q along it."""
    eye = np.array(eye, float)
    v = Q - eye; L = np.linalg.norm(v, axis=1); d = v / np.maximum(L, 1e-12)[:, None]
    with np.errstate(divide='ignore', invalid='ignore'):
        s = eye[2] / (eye[2] - Q[:, 2])
    x = eye[0] + v[:, 0] * s; y = eye[1] + v[:, 1] * s
    through = portal.in_frame(x, y) & (Q[:, 2] < eye[2])
    vis = np.zeros(len(Q), bool)
    idx = np.nonzero(through)[0]
    if len(idx):
        o = np.broadcast_to(eye, (len(idx), 3)).copy()
        t = first_t(scene, o, d[idx])
        vis[idx] = t >= L[idx] * (1 - rel_eps)
    return vis


# ----------------------------------------------------------------------------- envelope
def envelope(D, thx, thy):
    eyes = []
    for ty in thy:
        for tx in thx:
            e = np.array([D * np.tan(np.radians(tx)), D * np.tan(np.radians(ty)), D])
            th = np.degrees(np.arctan2(np.hypot(e[0], e[1]), D))
            eyes.append({'thx': float(tx), 'thy': float(ty), 'theta': float(th), 'eye': e})
    return eyes


def retinal_weight(theta_deg, n=3):
    return np.cos(np.radians(theta_deg)) ** n


# ----------------------------------------------------------------------------- A: rest atlas GT
def rest_classes(R, canvas, eye0):
    """Class per (pixel, layer) of the rest canvas render."""
    ny, nx, K = R['valid'].shape
    P = canvas.pixel_centres()
    inframe = canvas.in_frame(P[..., 0], P[..., 1])[..., None]
    pid = R['pid']; lab = R['label']; valid = R['valid']
    pid0 = pid[..., :1]
    facing = np.sum(R['nrm'] * (np.array(eye0) - R['pts']), axis=-1) > 0   # front-facing to the rest eye
    k = np.arange(K)[None, None, :]
    cls = np.full((ny, nx, K), -1, np.int8)
    hidden = valid & (k >= 1)
    cls[valid & (k == 0) & inframe] = 0
    cls[valid & ~inframe] = 1
    m = hidden & inframe
    cls[m & (lab == 1)] = 2
    cls[m & (lab == 2) & (pid != pid0)] = 3
    cls[m & (pid == pid0) & ~facing] = 4
    cls[m & (pid == pid0) & facing] = 5
    return cls


def rest_atlas_gt(scene, plate, R, eyes, log=print):
    """Visibility of every rest-canvas sample from every eye THROUGH THE WINDOW (the plate rect, not the
    enlarged canvas)."""
    ny, nx, K = R['valid'].shape
    valid = R['valid']; idx = np.nonzero(valid.reshape(-1))[0]
    Q = R['pts'].reshape(-1, 3)[idx]
    E = len(eyes)
    bits = np.zeros((E, len(idx)), bool)
    t0 = time.time()
    for ei, ey in enumerate(eyes):
        bits[ei] = visible_from(scene, ey['eye'], Q, plate)
        if ei % 8 == 0 or ei == E - 1:
            log(f'  eye {ei + 1}/{E} ({ey["thx"]:+.0f},{ey["thy"]:+.0f}) visible {bits[ei].mean():.3f}  {time.time() - t0:.0f}s')
    wr = np.array([retinal_weight(e['theta']) for e in eyes])
    w_disp = np.zeros(ny * nx * K, np.float32); w_ret = np.zeros(ny * nx * K, np.float32)
    w_disp[idx] = bits.mean(axis=0); w_ret[idx] = (bits * wr[:, None]).sum(axis=0) / wr.sum()
    vis = np.zeros((E, ny * nx * K), bool); vis[:, idx] = bits
    return w_disp.reshape(ny, nx, K), w_ret.reshape(ny, nx, K), vis.reshape(E, ny, nx, K)


# ----------------------------------------------------------------------------- B: display GT per eye
def display_gt(scene, plate, canvas, R, eye, eye0):
    Rv = render(scene, plate, eye, K=1, shade=True)
    ny, nx = plate.ny, plate.nx
    hit = Rv['valid'][..., 0].reshape(-1)
    P = Rv['pts'][..., 0, :].reshape(-1, 3); n = Rv['nrm'][..., 0, :].reshape(-1, 3)
    pid = Rv['pid'][..., 0].reshape(-1); lab = Rv['label'][..., 0].reshape(-1)
    cls = np.full(ny * nx, 6, np.int8)   # sky where nothing is hit
    x, y, i, j = canvas.project(P, eye0)
    infr = plate.in_frame(x, y) & hit
    phot = np.zeros_like(hit)
    if infr.any():
        phot[infr] = visible_from(scene, eye0, P[infr], plate)
    cls[hit & ~infr] = 1
    hid = hit & infr & ~phot
    cls[hit & phot] = 0
    ii = np.clip(i, 0, canvas.nx - 1); jj = np.clip(j, 0, canvas.ny - 1)
    pid0 = R['pid'][jj, ii, 0]
    facing = np.sum(n * (np.array(eye0) - P), axis=1) > 0
    cls[hid & (lab == 1)] = 2
    cls[hid & (lab == 2) & (pid != pid0)] = 3
    cls[hid & (pid == pid0) & ~facing] = 4
    cls[hid & (pid == pid0) & facing] = 5
    frac = {CLASS_NAMES[c]: float((cls == c).mean()) for c in range(7)}
    # how much of the display's non-photographed content lands inside the rest canvas (the atlas can hold it)
    oncanvas = (i >= 0) & (i < canvas.nx) & (j >= 0) & (j < canvas.ny)
    out = cls == 1
    frac['outpaint_on_canvas'] = float((out & oncanvas).sum() / max(1, out.sum()))
    return cls.reshape(ny, nx), Rv['rgb'][..., 0, :], frac, {'pid': pid.reshape(ny, nx), 'depth': Rv['depth'][..., 0], 'phot': phot.reshape(ny, nx)}


# ----------------------------------------------------------------------------- sheets
def overlay(rgb, cls, w=None, alpha=0.75):
    """Paint class colours over an RGB image; alpha scaled by w (weights in [0,1]) where given."""
    base = rgb.copy()
    a = np.where(cls >= 1, alpha, 0.0)
    if w is not None:
        a = a * np.clip(w, 0, 1) ** 0.5
    col = CLASS_RGB[np.clip(cls, 0, 6)]
    return base * (1 - a[..., None]) + col * a[..., None]


def sheet(tiles, cols, title, scale=1.0):
    tiles = [(im if scale == 1 else im.resize((int(im.width * scale), int(im.height * scale))), t) for im, t in tiles]
    W, H = max(im.size[0] for im, _ in tiles), max(im.size[1] for im, _ in tiles); pad = 6; rows = (len(tiles) + cols - 1) // cols
    sh = Image.new('RGB', (cols * (W + pad) + pad, 28 + rows * (H + 22 + pad)), (20, 20, 20)); d = ImageDraw.Draw(sh)
    d.text((pad, 6), title, fill=(255, 255, 255))
    for k, (im, t) in enumerate(tiles):
        x = pad + (k % cols) * (W + pad); y = 28 + (k // cols) * (H + 22 + pad)
        d.text((x, y), t, fill=(255, 230, 120)); sh.paste(im, (x, y + 16))
    return sh


def legend_text():
    return 'legend: orange outpaint, blue bg disocclusion, red thing disocclusion, green own side, magenta own interior, pale blue sky'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('scene'); ap.add_argument('--nx', type=int, default=600); ap.add_argument('--out', default=None)
    ap.add_argument('--W', type=float, default=0.16); ap.add_argument('--H', type=float, default=0.09); ap.add_argument('--D', type=float, default=0.2)
    ap.add_argument('--margin', type=float, default=0.5); ap.add_argument('--K', type=int, default=6)
    ap.add_argument('--thx', default='0,15,30,45,60,75,85'); ap.add_argument('--thy', default='0,25')
    ap.add_argument('--depth', type=float, default=None)
    ap.add_argument('--no-atlas', action='store_true', help='skip product A (shadow rays per rest sample)')
    a = ap.parse_args()
    out = a.out or os.path.join(os.path.dirname(__file__), 'out', a.scene); os.makedirs(out, exist_ok=True)
    build = SCENES[a.scene]
    prims, meta = build(a.W, a.H, a.depth) if a.depth is not None else build(a.W, a.H)
    thx = sorted({float(v) for v in a.thx.split(',')} | {-float(v) for v in a.thx.split(',')})
    thy = sorted({float(v) for v in a.thy.split(',')} | {-float(v) for v in a.thy.split(',')})
    eyes = envelope(a.D, thx, thy); eye0 = (0.0, 0.0, a.D)
    ny = int(round(a.nx * a.H / a.W))
    plate = Portal(a.W, a.H, a.D, a.nx, ny, 0.0)
    canvas = Portal(a.W, a.H, a.D, int(round(a.nx * (1 + 2 * a.margin))), int(round(ny * (1 + 2 * a.margin))), a.margin)
    t0 = time.time()
    R = render(prims, canvas, eye0, K=a.K)
    print(f'{a.scene}: rest canvas {canvas.nx}x{canvas.ny} K={a.K} in {time.time() - t0:.1f}s; eyes {len(eyes)} (thx {thx}, thy {thy})')
    cls = rest_classes(R, canvas, eye0)

    # ---- B: display GT per eye
    disp_cls = []; disp_rgb = {}; fracs = []
    back = [i for i, p in enumerate(prims) if p.name == 'back_wall']
    for ei, ey in enumerate(eyes):
        c, rgb, fr, aux = display_gt(prims, plate, canvas, R, ey['eye'], eye0)
        fr.update({'thx': ey['thx'], 'thy': ey['thy'], 'theta': ey['theta'], 'w_ret': float(retinal_weight(ey['theta']))})
        if back and ey['thy'] == 0:
            m = aux['pid'] == back[0]
            if m.any():
                d = float(np.median(aux['depth'][m])); e = ey['eye'][0]
                fr['backwall_photographed_measured'] = float(aux['phot'][m].mean())
                fr['backwall_photographed_closed_form'] = float(max(0.0, 1 - abs(e) * d / (a.W * (a.D + d))))
                # the same closed form with the room's side walls bounding the wall: visible strip [c-h, c+h] at depth d,
                # centred at c = -e d / D, clipped to the room [-xw, xw]; photographed part is [-h, h]
                side = [p for p in prims if p.name == 'wall_left']
                if side:
                    xw = abs(side[0].c[0]); h = a.W * (a.D + d) / (2 * a.D); cen = -e * d / a.D
                    lo, hi = max(cen - h, -xw), min(cen + h, xw)
                    plo, phi = max(lo, -h), min(hi, h)
                    fr['backwall_photographed_closed_form_room'] = float(max(0.0, phi - plo) / max(1e-12, hi - lo)) if hi > lo else float('nan')
        disp_cls.append(c); fracs.append(fr)
        if ey['thy'] == 0 and ey['thx'] in (0, 30, 60, 85):
            disp_rgb[ey['thx']] = (rgb, c)
    disp_cls = np.stack(disp_cls)
    print('  display fractions (thy=0):')
    print('   thx   theta  w_ret   phot   outp    bg  thing  side   int   sky | backwall meas / closed')
    for fr in fracs:
        if fr['thy'] == 0:
            bw = f"{fr.get('backwall_photographed_measured', float('nan')):.3f} / plane {fr.get('backwall_photographed_closed_form', float('nan')):.3f} / room {fr.get('backwall_photographed_closed_form_room', float('nan')):.3f}"
            print(f"  {fr['thx']:+5.0f} {fr['theta']:6.1f} {fr['w_ret']:6.3f} {fr['photographed']:6.3f} {fr['outpaint']:6.3f} {fr['bg_disocclusion']:5.3f} {fr['thing_disocclusion']:6.3f} {fr['side']:5.3f} {fr['interior']:5.3f} {fr['sky']:5.3f} | {bw}")

    # ---- A: rest atlas GT
    if not a.no_atlas:
        print('  rest-atlas visibility (shadow rays per sample per eye):')
        w_disp, w_ret, vis = rest_atlas_gt(prims, plate, R, eyes, log=print)
    else:
        w_disp = w_ret = None; vis = None

    # ---- summary
    summ = {'scene': a.scene, 'element': meta.get('element', ''), 'W': a.W, 'H': a.H, 'D': a.D, 'outer': meta['outer'], 'inner': meta.get('inner', 0.0), 'nx': a.nx, 'ny': ny,
            'canvas_nx': canvas.nx, 'canvas_ny': canvas.ny, 'margin': a.margin, 'K': a.K, 'eyes': [{k: v for k, v in e.items() if k != 'eye'} for e in eyes],
            'retinal_weight': 'cos^3(theta), viewer on the plane z = D', 'per_eye': fracs, 'classes': CLASS_NAMES}
    wr = np.array([f['w_ret'] for f in fracs])
    for c in CLASS_NAMES:
        v = np.array([f[c] for f in fracs])
        summ[f'envelope_mean_{c}'] = float(v.mean()); summ[f'envelope_retinal_{c}'] = float((v * wr).sum() / wr.sum())
    v = np.array([f['outpaint_on_canvas'] for f in fracs]); o = np.array([f['outpaint'] for f in fracs])
    summ['outpaint_on_canvas_retinal'] = float((v * o * wr).sum() / max(1e-12, (o * wr).sum()))
    if w_disp is not None:
        for c in range(1, 6):
            m = cls == c
            summ[f'atlas_{CLASS_NAMES[c]}_samples'] = int(m.sum())
            summ[f'atlas_{CLASS_NAMES[c]}_ever_visible'] = int((m & (w_disp > 0)).sum())
            summ[f'atlas_{CLASS_NAMES[c]}_w_disp_sum'] = float(w_disp[m].sum()); summ[f'atlas_{CLASS_NAMES[c]}_w_ret_sum'] = float(w_ret[m].sum())
    json.dump(summ, open(os.path.join(out, 'scope_summary.json'), 'w'), indent=1)
    np.savez_compressed(os.path.join(out, 'scope_display.npz'), cls=disp_cls, thx=np.array([e['thx'] for e in eyes]), thy=np.array([e['thy'] for e in eyes]))
    if w_disp is not None:
        np.savez_compressed(os.path.join(out, 'scope_gt.npz'), cls=cls, w_disp=w_disp.astype(np.float16), w_ret=w_ret.astype(np.float16),
                            vis_bits=np.packbits(vis, axis=0), n_eyes=len(eyes), depth=R['depth'].astype(np.float32), pid=R['pid'].astype(np.int16), label=R['label'],
                            rgb=(np.clip(R['rgb'], 0, 1) * 255).astype(np.uint8), valid=R['valid'], thx=np.array([e['thx'] for e in eyes]), thy=np.array([e['thy'] for e in eyes]))

    # ---- sheets
    rgb0 = np.clip(R['rgb'][..., 0, :], 0, 1)
    P = canvas.pixel_centres(); infr = canvas.in_frame(P[..., 0], P[..., 1])
    dim = np.where(infr[..., None], rgb0, rgb0 * 0.45)
    tiles = [(Image.fromarray(to_u8(dim)), 'rest canvas (frame bright, beyond-frame dimmed)')]
    if w_disp is not None:
        # per pixel: the hidden sample with the largest display weight
        wk = np.where(cls >= 1, w_disp, -1); kb = np.argmax(wk, axis=-1)
        cb = np.take_along_axis(cls, kb[..., None], axis=-1)[..., 0]; wb = np.take_along_axis(w_disp, kb[..., None], axis=-1)[..., 0]
        cb = np.where(wb > 0, cb, -1)
        tiles.append((Image.fromarray(to_u8(overlay(dim, cb, wb))), 'SCOPE: best hidden sample per pixel, alpha = fraction of envelope eyes that see it'))
        wrb = np.take_along_axis(w_ret, kb[..., None], axis=-1)[..., 0]
        tiles.append((Image.fromarray(to_u8(overlay(dim, np.where(wrb > 0, cb, -1), wrb))), 'SCOPE retinal: same, alpha = cos^3-weighted visibility'))
        for k in (1, 2):
            ck = np.where(w_disp[..., k] > 0, cls[..., k], -1)
            tiles.append((Image.fromarray(to_u8(overlay(np.clip(R['rgb'][..., k, :], 0, 1) * np.where(infr[..., None], 1, 0.45), ck, w_disp[..., k]))), f'hidden layer {k}: its RGB with scope overlay'))
        tiles.append((Image.fromarray(to_u8(np.repeat(np.clip(w_disp.max(axis=-1), 0, 1)[..., None], 3, -1))), 'max over layers of w_disp (white = every eye sees some hidden sample here)'))
    sh = sheet(tiles, 2, f'{a.scene} {meta.get("element", "")}  rest-atlas GT, {len(eyes)} eyes thx {thx[len(thx)//2:]} thy {thy[len(thy)//2:]}. {legend_text()}', scale=0.6)
    sh.save(os.path.join(out, 'scope_artist.png'))
    tiles = []
    for tx in (0, 30, 60, 85):
        if tx in disp_rgb:
            rgb, c = disp_rgb[tx]
            fr = [f for f in fracs if f['thy'] == 0 and f['thx'] == tx][0]
            tiles.append((Image.fromarray(to_u8(np.clip(rgb, 0, 1))), f'eye {tx:+d} deg: what the viewer sees through the window'))
            tiles.append((Image.fromarray(to_u8(overlay(np.clip(rgb, 0, 1), c))), f'classified: phot {fr["photographed"]:.2f} outp {fr["outpaint"]:.2f} bg {fr["bg_disocclusion"]:.2f} thing {fr["thing_disocclusion"]:.2f} side {fr["side"]:.2f} int {fr["interior"]:.2f}'))
    sh = sheet(tiles, 2, f'{a.scene}: display GT per eye (the window is the whole image; display area is the scope measure). {legend_text()}', scale=0.7)
    sh.save(os.path.join(out, 'scope_eyes.png'))
    print('wrote', out, f'total {time.time() - t0:.0f}s')


if __name__ == '__main__':
    main()
