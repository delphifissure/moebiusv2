#!/usr/bin/env python3
"""S64 item 3 prototype: the strip beyond the frame stored BY ANGLE, with a known answer.

A wide picture stands in for the far plane: its central half is "the photograph" (the window at rest), the quarters on
either side are the truth beyond the frame. At head angle theta the window shows the far plane shifted by s = sigma*tan(theta)
(content at one depth moves by a pure translation in screen pixels; S64), so with sigma = quarter / tan(85 deg) the
truth reaches the picture's edge exactly at 85 deg. The eye sees the screen foreshortened: a screen pixel at theta is
seen cos^2(theta) wide (along the offset) and cos(theta) tall.

Stores (per side, texels):
  glass   plane columns 1:1 -> sigma*tan(theta_max) (unbounded as theta_max -> 90)
  angle   u = sigma*atan(s/sigma) -> sigma*theta_max  (sigma*pi/2 at 90: finite)
Arms (one painter, LaMa, for all; nothing chosen per picture):
  G  paint on the glass, glass store (the reference: full storage)
  U  paint in the angle store directly (isotropic painter on a canvas squeezed by cos^2 along the offset)
  M  paint the plane ring by ring outward, ring [theta_k, theta_k+1] on the plane downscaled by cos(theta_k) (the
     vertical seen scale there, the larger of the two), glass-parametrised store at that ring's scale
  A  M's paint, kept in the angle store (paint on the plane, store by angle)
Score: for views at +-theta, the outpainted part of the window only, at the SEEN resolution (crop resized by cos^2 x cos),
MAE and gradient-energy ratio (detail; < 1 smoother than the truth); the outpainted part is seen at most
(sigma/2) sin(2 theta) px wide, so LPIPS is taken on the screen crop (not foreshortened) where that is >= 64 px wide.

  python3 angle_strip.py --pics NAME=color.png ... --out DIR [--tmax 85]
"""
import argparse, json, os, sys
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('--pics', nargs='+', required=True); ap.add_argument('--out', required=True)
ap.add_argument('--tmax', type=float, default=85.0); ap.add_argument('--rings', default='0,30,45,60,75')
ap.add_argument('--views', default='15,30,45,60,70,80,85')
A = ap.parse_args(); os.makedirs(A.out, exist_ok=True)
sys.argv = [sys.argv[0]]
import grt_eval as G      # lama, scores (LPIPS model)

TM = np.radians(A.tmax); RINGS = [np.radians(float(x)) for x in A.rings.split(',')] + [TM]


def resample_cols(img, xs):
    """img HxWxC, xs float column coordinates -> HxlenxC, linear."""
    x0 = np.clip(np.floor(xs).astype(int), 0, img.shape[1] - 1); x1 = np.clip(x0 + 1, 0, img.shape[1] - 1)
    w = np.clip(xs - np.floor(xs), 0, 1)[None, :, None]
    return img[:, x0] * (1 - w) + img[:, x1] * w


def resize(img, w, h):
    return np.asarray(Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).resize((max(1, w), max(1, h)), Image.BOX if w < img.shape[1] else Image.BILINEAR), np.float32) / 255


def lama(img, mask):
    return G.lama(img, mask)


def to_angle_store(plane, Xa, Xb, sig, Nu):
    """plane columns beyond the window -> angle store (Nu texels per side); a texel averages the plane span it covers."""
    H = plane.shape[0]; out = []
    for side in (-1, 1):
        cols = []
        for k in range(Nu):
            s0, s1 = sig * np.tan(min(k / sig, TM)), sig * np.tan(min((k + 1) / sig, TM))
            if side > 0: a, b = Xb + s0, Xb + s1
            else: a, b = Xa - s1, Xa - s0
            ia, ib = int(np.floor(a)), max(int(np.floor(a)) + 1, int(np.ceil(b)))
            ia, ib = max(0, ia), min(plane.shape[1], ib)
            cols.append(plane[:, ia:ib].mean(1) if ib > ia else plane[:, min(max(ia, 0), plane.shape[1] - 1)])
        st = np.stack(cols, 1)
        out.append(st[:, ::-1] if side < 0 else st)       # left store ordered outward-to-window like the plane
    return out


def from_angle_store(stores, window, Xa, Xb, Wp, sig):
    """angle store -> plane columns (glass) for rendering; the window itself is the photograph."""
    H = window.shape[0]; plane = np.zeros((H, Wp, 3), np.float32); plane[:, Xa:Xb] = window
    L, R = stores; Nu = R.shape[1]
    for X in range(Xb, Wp):
        u = sig * np.arctan((X - Xb + 0.5) / sig) - 0.5
        plane[:, X] = resample_cols(R, np.array([np.clip(u, 0, Nu - 1)]))[:, 0]
    for X in range(0, Xa):
        u = sig * np.arctan((Xa - X - 0.5) / sig) - 0.5
        plane[:, X] = resample_cols(L, np.array([np.clip(Nu - 1 - u, 0, Nu - 1)]))[:, 0]
    return plane


def seen_scores(f, t, m):
    """at the seen resolution: MAE, and the gradient-energy ratio fill / truth inside the mask (detail)."""
    def ge(x):
        gx = np.zeros(x.shape[:2]); gy = np.zeros(x.shape[:2])
        gx[:, :-1] = np.abs(np.diff(x, axis=1)).sum(-1); gy[:-1] = np.abs(np.diff(x, axis=0)).sum(-1)
        return (gx + gy)[m].sum()
    return {'mae': float(np.abs(f - t)[m].mean()), 'detail': float(ge(f) / max(ge(t), 1e-9)), 'px': int(m.sum())}


res = {}
for spec in A.pics:
    name, pc = spec.split('=')
    P = np.asarray(Image.open(pc).convert('RGB'), np.float32) / 255
    H, Wp = P.shape[:2]; Q = Wp // 4; Xa, Xb = Q, Wp - Q
    sig = Q / np.tan(TM); Nu = int(np.ceil(sig * TM))
    win = P[:, Xa:Xb]
    hole = np.ones((H, Wp), bool); hole[:, Xa:Xb] = False
    arms, store = {}, {}
    # G: glass paint, glass store
    seen = P.copy(); seen[hole] = 0
    arms['G'] = lama(seen, hole); arms['G'][~hole] = P[~hole]; store['G'] = 2 * Q * H
    # U: paint in the angle store
    ucan = np.zeros((H, Xb - Xa + 2 * Nu, 3), np.float32); ucan[:, Nu:Nu + Xb - Xa] = win
    um = np.ones(ucan.shape[:2], bool); um[:, Nu:Nu + Xb - Xa] = False
    uf = lama(ucan, um)
    arms['U'] = from_angle_store([uf[:, :Nu], uf[:, Nu + Xb - Xa:]], win, Xa, Xb, Wp, sig); store['U'] = 2 * Nu * H
    # M: ring by ring on the plane, each ring at the scale cos(theta_k)
    M = P.copy(); M[hole] = 0; known = ~hole; mstore = 0
    for k in range(len(RINGS) - 1):
        t0, t1 = RINGS[k], RINGS[k + 1]; s1 = sig * np.tan(t1); c = np.cos(t0)
        a, b = max(0, int(np.floor(Xa - s1))), min(Wp, int(np.ceil(Xb + s1)))
        ring = np.zeros((H, Wp), bool); ring[:, a:b] = True; ring &= ~known
        if not ring.any(): continue
        w, h = int(round((b - a) * c)), int(round(H * c))
        can = resize(np.where(known[..., None], M, 0)[:, a:b], w, h)
        msk = np.asarray(Image.fromarray((ring[:, a:b] * 255).astype(np.uint8)).resize((w, h), Image.NEAREST)) > 127
        f = lama(can, msk)
        up = resize(f, b - a, H)
        M[:, a:b][ring[:, a:b]] = up[ring[:, a:b]]; known |= ring
        mstore += int(round(ring.sum() / H * c)) * int(round(H * c))
    arms['M'] = M; store['M'] = mstore
    # A: M's paint in the angle store
    arms['A'] = from_angle_store(to_angle_store(M, Xa, Xb, sig, Nu), win, Xa, Xb, Wp, sig); store['A'] = 2 * Nu * H
    r = res[name] = {'H': H, 'W': Wp, 'windowPx': Xb - Xa, 'sigma': float(sig), 'tmaxDeg': A.tmax, 'store': store,
                     'storeGlassAt89': float(2 * sig * np.tan(np.radians(89)) * H), 'storeAngleAt90': float(2 * sig * np.pi / 2 * H), 'views': {}}
    for k_, v in arms.items(): Image.fromarray((np.clip(v, 0, 1) * 255).astype(np.uint8)).save(os.path.join(A.out, '%s_plane_%s.png' % (name, k_)))
    for deg in [float(x) for x in A.views.split(',') if float(x) <= A.tmax]:     # past tmax the truth runs out
        t = np.radians(deg); s = sig * np.tan(t); cx, cy = np.cos(t) ** 2, np.cos(t)
        vr = r['views']['%g' % deg] = {}
        for sgn in (1, -1):
            x0 = Xa + sgn * s; xs = x0 + np.arange(Xb - Xa)
            outm = (xs >= Xb) | (xs < Xa)
            w, h = int(round((Xb - Xa) * cx)), int(round(H * cy))
            mseen = np.asarray(Image.fromarray((np.repeat(outm[None], H, 0) * 255).astype(np.uint8)).resize((max(1, w), max(1, h)), Image.BOX)) > 127
            if not mseen.any(): continue
            tv = resize(resample_cols(P, xs), w, h)
            for k_, v in arms.items():
                fv = resize(resample_cols(v, xs), w, h)
                sc = seen_scores(fv, tv, mseen)
                ys_, xs_ = np.nonzero(np.repeat(outm[None], H, 0))
                if xs_.max() - xs_.min() + 1 >= 64:          # LPIPS on the screen crop (not foreshortened) where it is wide enough
                    sc['lpipsScreen'] = G.scores(resample_cols(v, xs), resample_cols(P, xs), np.repeat(outm[None], H, 0))['lpips']
                d = vr.setdefault(k_, []); d.append({kk: float(vv) for kk, vv in sc.items()})
                if sgn > 0 and deg in (30, 60, 80):
                    Image.fromarray((np.clip(resample_cols(v, xs), 0, 1) * 255).astype(np.uint8)).save(os.path.join(A.out, '%s_view%g_%s.png' % (name, deg, k_)))
            if sgn > 0 and deg in (30, 60, 80):
                Image.fromarray((np.clip(resample_cols(P, xs), 0, 1) * 255).astype(np.uint8)).save(os.path.join(A.out, '%s_view%g_truth.png' % (name, deg)))
        for k_ in arms:
            L = vr.get(k_, [])
            if L: vr[k_] = {m: float(np.mean([x[m] for x in L if m in x])) for m in L[0]}
        print(name, '%5.1f deg' % deg, ' | '.join('%s %s' % (k_, ' '.join('%s=%.4g' % (m, x) for m, x in vr[k_].items())) for k_ in arms if k_ in vr), flush=True)
    print(name, 'sigma %.1f px, store texels per side: glass %d, angle %d (glass at 89: %d, angle at 90: %d)' % (sig, Q, Nu, sig * np.tan(np.radians(89)), sig * np.pi / 2), flush=True)
    json.dump(res, open(os.path.join(A.out, 'angle_strip.json'), 'w'), indent=1)
