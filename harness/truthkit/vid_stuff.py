#!/usr/bin/env python3
"""S65 experiment 1b: coverage of the app's band where STUFF hides stuff (a near hill over a far one), by the camera's
own motion. vid_exp.py only followed points hidden by things.

Per frame t (every --every-th): the app's band over +-90 deg (reveal90.band90 on the frame's per-frame normalised
disparity), minus the texels a thing touches. For each remaining band texel the hidden point is the first hit BEHIND
the visible one that belongs to a DIFFERENT primitive (a same-primitive second hit is the ray leaving the back of the
visible surface) and is stuff. It is SEEN in frame s when it projects into s onto a pixel whose first hit is clean stuff
at the same depth (2x2 footprint range + float16 precision, as in vid_exp.py). Weighted by cos^2(theta_first).

  python3 vid_stuff.py [--every 4] [--step 3]
"""
import argparse, json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from reveal90 import band90, RINGS

ap = argparse.ArgumentParser()
ap.add_argument('--root', default='/home/user/moebiusv2/harness/truthkit/out/video')
ap.add_argument('--out', default='/home/user/moebiusv2/harness/truthkit/out/video_exp')
ap.add_argument('--every', type=int, default=4); ap.add_argument('--step', type=float, default=3.0)
ap.add_argument('--shots', default='truck_trunks,push_in,pan,walker_handheld,crowd_pan,walker_tripod,runner_blur,rack_focus,bokeh')
A = ap.parse_args()
F16 = 2.0 ** -10
res = {}
for shot in A.shots.split(','):
    D = os.path.join(A.root, shot); meta = json.load(open(os.path.join(D, 'shot.json')))
    nx, ny, fpx = meta['nx'], meta['ny'], meta['fpx']; F = len(meta['frames'])
    POS = [np.array(f['pos']) for f in meta['frames']]; ROT = [np.array(f['R']) for f in meta['frames']]
    T = [np.load(os.path.join(D, 'truth_%03d.npz' % i)) for i in range(F)]
    dep0 = np.stack([t['depth'][..., 0].astype(np.float32) for t in T])
    lab0 = np.stack([t['label'][..., 0] for t in T]); alpha = np.stack([t['alpha_thing'] for t in T])
    clean = (lab0 == 1) & (alpha == 0) & np.isfinite(dep0)
    ys, xs = np.mgrid[0:ny, 0:nx]
    num = np.zeros(len(RINGS)); den = np.zeros(len(RINGS)); npx = np.zeros(len(RINGS), int)
    for i in range(0, F, A.every):
        t = T[i]; L = t['label']; P = t['pid']; Z = t['depth'].astype(np.float32)
        inv = 1.0 / dep0[i]; dn = (inv - inv.min()) / max(1e-12, inv.max() - inv.min())
        r = band90(dn, step=A.step); th, w = r['first_theta'], r['weight']
        # hidden point: first k >= 1 with a different primitive than hit 0, stuff, finite
        hz = np.full((ny, nx), np.nan, np.float32); done = np.zeros((ny, nx), bool)
        for k in range(1, L.shape[-1]):
            s = ~done & (P[..., k] != P[..., 0]) & (P[..., k] >= 0) & np.isfinite(Z[..., k])
            ok = s & (L[..., k] == 1); hz[ok] = Z[..., k][ok]; done |= s
        m = np.isfinite(th) & clean[i] & np.isfinite(hz)
        if not m.any(): continue
        z = hz[m]; x = xs[m] + 0.5; y = ys[m] + 0.5
        Xc = np.stack([(x - nx / 2) / fpx * z, -(y - ny / 2) / fpx * z, -z], -1)
        X = Xc @ ROT[i].T + POS[i]
        seen = np.zeros(len(X), bool)
        for s_ in range(F):
            if s_ == i: continue
            C = (X - POS[s_]) @ ROT[s_]; zz = -C[:, 2]
            u = fpx * C[:, 0] / zz + nx / 2 - 0.5; v = -fpx * C[:, 1] / zz + ny / 2 - 0.5
            ok = (u >= 0) & (v >= 0) & (u < nx - 1) & (v < ny - 1) & (zz > 0)
            u0 = np.floor(np.where(ok, u, 0)).astype(int); v0 = np.floor(np.where(ok, v, 0)).astype(int)
            fp = [(v0, u0), (v0, u0 + 1), (v0 + 1, u0), (v0 + 1, u0 + 1)]
            zs = np.stack([dep0[s_][a, b] for a, b in fp], -1)
            cl = np.all(np.stack([clean[s_][a, b] for a, b in fp], -1), -1)
            one = zs.max(-1) <= zs.min(-1) * 1.05      # the footprint is one surface (join ratio, reveal.py) -- else its range spans an edge
            ok &= cl & one & (zz >= zs.min(-1) * (1 - F16)) & (zz <= zs.max(-1) * (1 + F16))
            seen |= ok
        tm = th[m]; wm = w[m]
        for k, (a, b) in enumerate(RINGS):
            q = (tm > a) & (tm <= b)
            num[k] += wm[q & seen].sum(); den[k] += wm[q].sum(); npx[k] += int(q.sum())
    tot = num.sum() / max(den.sum(), 1e-9)
    res[shot] = {'seenWeighted': float(tot), 'rings': [{'deg': list(RINGS[k]), 'seenWeighted': float(num[k] / den[k]) if den[k] else None, 'px': int(npx[k])} for k in range(len(RINGS))]}
    print(shot.ljust(16), 'stuff-behind-stuff band seen (weighted) %5.1f%%' % (100 * tot), ' | ',
          '  '.join('%d-%d: %s (%dk)' % (g['deg'][0], g['deg'][1], ('%5.1f%%' % (100 * g['seenWeighted'])) if g['seenWeighted'] is not None else '  -  ', g['px'] // 1000) for g in res[shot]['rings']), flush=True)
json.dump(res, open(os.path.join(A.out, 'stuff_band90_coverage.json'), 'w'), indent=1)
