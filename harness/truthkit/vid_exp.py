#!/usr/bin/env python3
"""S63 §9 experiments 1 and 2 on the synthetic video shots (tk_video.py output), scored against exact truth.

The hole of frame t is every pixel the foreground touches: first hit a thing, or any share of the blurred pixel's rays
hitting a thing (alpha_thing > 0). Under it the truth gives the background point (first 'stuff' hit among the K hits):
its colour (pinhole, sharp) and its metric depth. This is the whole plate hole, the most a layered atlas can need; the
reveal at a given head offset is a subset of it.

Experiment 1 (coverage): a hole pixel is SEEN in frame s when its background point projects inside frame s onto a pixel
the foreground does not touch there and whose depth agrees (z-test). The tolerance is derived, not chosen: the depth
range over the 2x2 bilinear footprint of the projected position (the sampling error), plus float16 storage precision
(2^-10 relative). Reported: share seen in any other frame, in an earlier frame only (a causal, streaming pass), and
never seen (what must be painted).

Experiment 2 (stability), three arms, all on the camera's own frames (rgb_*, blur included):
  A   per-frame LaMa over the whole hole (today's tool run naively on video)
  B1  gather (median of every frame that saw the point, bilinear) + per-frame LaMa for the never-seen remainder
  B2  gather + paint once: a remainder pixel takes the value it was given in the previous frame when its point was in
      that frame's hole too (carried with the background depth), LaMa only for points never painted before
Scores inside the hole only (PROVE rules): MAE to the truth background colour, masked LPIPS on the hole's bounding box
(truth outside the hole, arm inside), and the warp error between consecutive frames (hole points present in both
frames' holes, t -> t+1 with the true pose and background depth), next to the same number for the truth itself (its
floor: shading and resampling). Geometry here is the truth's: this is the ceiling of the world-canvas path; with
estimated pose and depth it can only lose.

  B3  THE METHOD (S68 §4): as B2, but the paint is stored in world space and reprojected from its first painting every
      frame (no chain), each stored point splatted at its projected footprint
  python3 vid_exp.py <shot> [--root OUT/video] [--out OUT/video_exp] [--arms A,B1,B2,B3] [--nolpips]
"""
import argparse, json, os, sys, time
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument('shot')
ap.add_argument('--root', default='/home/user/moebiusv2/harness/truthkit/out/video')
ap.add_argument('--out', default='/home/user/moebiusv2/harness/truthkit/out/video_exp')
ap.add_argument('--arms', default='A,B1,B3')   # B3 (world-space paint, footprint splats) is the method (S68 §4); B2 on request
ap.add_argument('--nolpips', action='store_true')
A = ap.parse_args()
D = os.path.join(A.root, A.shot); O = os.path.join(A.out, A.shot); os.makedirs(O, exist_ok=True)
meta = json.load(open(os.path.join(D, 'shot.json')))
nx, ny, fpx = meta['nx'], meta['ny'], meta['fpx']; F = len(meta['frames'])
POS = [np.array(f['pos']) for f in meta['frames']]; ROT = [np.array(f['R']) for f in meta['frames']]
F16 = 2.0 ** -10

rgb = np.stack([np.asarray(Image.open(os.path.join(D, 'rgb_%03d.png' % i)).convert('RGB'), np.float32) / 255 for i in range(F)])
T = [np.load(os.path.join(D, 'truth_%03d.npz' % i)) for i in range(F)]
lab0 = np.stack([t['label'][..., 0] for t in T]); alpha = np.stack([t['alpha_thing'] for t in T])
dep0 = np.stack([t['depth'][..., 0].astype(np.float32) for t in T])
hole = (lab0 == 2) | (alpha > 0)
clean = ~hole & np.isfinite(dep0)

# background (first 'stuff' hit) under each pixel
bgz = np.full((F, ny, nx), np.nan, np.float32); bgc = np.full((F, ny, nx, 3), np.nan, np.float32)
for i, t in enumerate(T):
    L = t['label']; Z = t['depth'].astype(np.float32); C = t['rgb'].astype(np.float32) / 255
    done = np.zeros((ny, nx), bool)
    for k in range(L.shape[-1]):
        s = (L[..., k] == 1) & ~done & np.isfinite(Z[..., k])
        bgz[i][s] = Z[..., k][s]; bgc[i][s] = C[..., k, :][s]; done |= s
known = hole & np.isfinite(bgz)          # hole pixels whose background the truth resolves (K hits may run out)

ys, xs = np.mgrid[0:ny, 0:nx]
def backproject(i, m):
    z = bgz[i][m]; x = xs[m] + 0.5; y = ys[m] + 0.5
    Xc = np.stack([(x - nx / 2) / fpx * z, -(y - ny / 2) / fpx * z, -z], -1)
    return Xc @ ROT[i].T + POS[i]
def project(s, X):
    Xc = (X - POS[s]) @ ROT[s]; z = -Xc[:, 2]
    u = fpx * Xc[:, 0] / z + nx / 2 - 0.5; v = -fpx * Xc[:, 1] / z + ny / 2 - 0.5   # pixel-centre coordinates
    return u, v, z

def lookup(s, u, v, z):
    """Seen test and bilinear colour in frame s: all four footprint pixels clean, depth within the footprint range."""
    ok = (u >= 0) & (v >= 0) & (u < nx - 1) & (v < ny - 1) & (z > 0)
    u0 = np.floor(np.where(ok, u, 0)).astype(int); v0 = np.floor(np.where(ok, v, 0)).astype(int)
    fu = (np.where(ok, u, 0) - u0)[:, None]; fv = (np.where(ok, v, 0) - v0)[:, None]
    zz = np.stack([dep0[s][v0, u0], dep0[s][v0, u0 + 1], dep0[s][v0 + 1, u0], dep0[s][v0 + 1, u0 + 1]], -1)
    cl = clean[s][v0, u0] & clean[s][v0, u0 + 1] & clean[s][v0 + 1, u0] & clean[s][v0 + 1, u0 + 1]
    lo = zz.min(-1) * (1 - F16); hi = zz.max(-1) * (1 + F16)
    one = zz.max(-1) <= zz.min(-1) * 1.05                       # footprint is one surface (join ratio), else the range spans an edge
    ok &= cl & one & (z >= lo) & (z <= hi)
    c = (rgb[s][v0, u0] * (1 - fu) * (1 - fv) + rgb[s][v0, u0 + 1] * fu * (1 - fv) +
         rgb[s][v0 + 1, u0] * (1 - fu) * fv + rgb[s][v0 + 1, u0 + 1] * fu * fv)
    return ok, c


def zfoot(field, s, u, v, z):
    """Depth agreement on the 2x2 bilinear footprint of (u, v) in frame s's field (NaN counts as disagreement):
    the same derived tolerance as the seen test (footprint range + float16 precision)."""
    uc = np.clip(u, 0, nx - 1.001); vc = np.clip(v, 0, ny - 1.001)
    u0 = np.floor(uc).astype(int); v0 = np.floor(vc).astype(int)
    zz = np.stack([field[s][v0, u0], field[s][v0, u0 + 1], field[s][v0 + 1, u0], field[s][v0 + 1, u0 + 1]], -1)
    with np.errstate(invalid='ignore'):
        return (z >= np.nanmin(zz, -1) * (1 - F16)) & (z <= np.nanmax(zz, -1) * (1 + F16)) & np.isfinite(zz).all(-1)

# ---------------- experiment 1: coverage, and the gathered colours
t0 = time.time()
cov = []; gathered = []; seenmask = []
for i in range(F):
    m = known[i]; X = backproject(i, m); n = len(X)
    obs = np.zeros((F, n, 3), np.float32); okall = np.zeros((F, n), bool)
    for s in range(F):
        if s == i: continue
        u, v, z = project(s, X); ok, c = lookup(s, u, v, z); okall[s] = ok; obs[s] = c
    anyseen = okall.any(0); past = okall[:i].any(0) if i else np.zeros(n, bool)
    med = np.full((n, 3), np.nan, np.float32)
    if anyseen.any():
        o = np.where(okall[..., None], obs, np.nan)[:, anyseen]
        med[anyseen] = np.nanmedian(o, 0)
    g = np.full((ny, nx, 3), np.nan, np.float32); g[m] = med; gathered.append(g)
    sm = np.zeros((ny, nx), bool); sm[m] = anyseen; seenmask.append(sm)
    cov.append({'frame': i, 'hole': int(hole[i].sum()), 'known': int(n), 'seen': int(anyseen.sum()), 'seenPast': int(past.sum()),
                'views': float(okall.sum(0)[anyseen].mean()) if anyseen.any() else 0.0})
H = sum(c['known'] for c in cov); S_ = sum(c['seen'] for c in cov); P_ = sum(c['seenPast'] for c in cov)
exp1 = {'shot': A.shot, 'frames': F, 'holePx': int(sum(c['hole'] for c in cov)), 'knownPx': int(H),
        'seen': S_ / max(H, 1), 'seenPast': P_ / max(H, 1), 'neverSeen': 1 - S_ / max(H, 1),
        'framesWithHole': int(sum(c['known'] > 0 for c in cov)), 'perFrame': cov, 'secs': round(time.time() - t0, 1)}
json.dump(exp1, open(os.path.join(O, 'coverage.json'), 'w'), indent=1)
print('%s coverage: seen %.3f  seenPast %.3f  never %.3f  (%d hole px, %.0fs)' % (A.shot, exp1['seen'], exp1['seenPast'], exp1['neverSeen'], H, exp1['secs']), flush=True)

# ---------------- experiment 2: the arms
_lama = None
def lama(img, m):
    global _lama
    if not m.any(): return img
    if _lama is None:
        from simple_lama_inpainting import SimpleLama
        _lama = SimpleLama()
    out = np.asarray(_lama(Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)), Image.fromarray((m * 255).astype(np.uint8))))
    out = out[:ny, :nx].astype(np.float32) / 255
    r = img.copy(); r[m] = out[m]; return r

arms = [a for a in A.arms.split(',') if a]
plates = {a: [] for a in arms}
store_x, store_c, store_z0 = [], [], []   # B3's world-space paint (and each point's depth when painted)
for i in range(F):
    base = rgb[i].copy(); m = hole[i]
    if 'A' in arms: plates['A'].append(lama(base, m))
    g = gathered[i]; gm = m & np.isfinite(g[..., 0])
    b = base.copy(); b[gm] = g[gm]
    if 'B1' in arms: plates['B1'].append(lama(b, m & ~gm))
    if 'B2' in arms:
        rem = m & ~gm; b2 = b.copy()
        if i and rem.any():
            mm = rem & np.isfinite(bgz[i]); X = backproject(i, mm); u, v, z = project(i - 1, X)
            q = (u > -0.5) & (v > -0.5) & (u < nx - 0.5) & (v < ny - 0.5)
            ui = np.clip(np.round(u).astype(int), 0, nx - 1); vi = np.clip(np.round(v).astype(int), 0, ny - 1)
            q &= hole[i - 1][vi, ui] & zfoot(bgz, i - 1, u, v, z)
            carried = np.zeros((ny, nx), bool); idx = np.where(mm)
            carried[idx[0][q], idx[1][q]] = True
            b2[carried] = plates['B2'][i - 1][vi[q], ui[q]]
            rem = rem & ~carried
        plates['B2'].append(lama(b2, rem))
    if 'B3' in arms:
        # B3 (S65 reading): paint once, stored in WORLD space. A remainder pixel painted for the first time becomes a stored
        # 3-D point with its colour; every later frame reprojects the store (one resample from the original paint, never a
        # chain of frame-to-frame resamples as in B2) under the same z-footprint test, and LaMa paints only what the store
        # does not reach -- which is then added to the store.
        rem = m & ~gm; b3 = b.copy()
        if rem.any() and len(store_c):
            X = np.concatenate(store_x); C = np.concatenate(store_c); Z0 = np.concatenate(store_z0); u, v, z = project(i, X)
            ui = np.round(u).astype(int); vi = np.round(v).astype(int)
            q = (ui >= 0) & (vi >= 0) & (ui < nx) & (vi < ny) & (z > 0)
            q &= zfoot(bgz, i, u, v, z)
            zb = np.full((ny, nx), np.inf, np.float32); cb = np.zeros((ny, nx, 3), np.float32)
            order = np.argsort(-z[q])                                    # far first, near overwrite
            # footprint: a stored point covered one pixel at its painting depth z0; at depth z it spans z0/z pixels, so it is
            # splatted over ceil(z0/z) x ceil(z0/z) pixels (magnification opens no gaps; minification keeps one pixel)
            fp = np.maximum(1, np.ceil(Z0 / np.maximum(z, 1e-9) - 1e-6)).astype(int)
            for k in np.nonzero(q)[0][order]:
                r = fp[k]; y0, x0 = vi[k] - (r - 1) // 2, ui[k] - (r - 1) // 2
                sy, sx = slice(max(0, y0), min(ny, y0 + r)), slice(max(0, x0), min(nx, x0 + r))
                zb[sy, sx] = z[k]; cb[sy, sx] = C[k]
            carried = rem & np.isfinite(zb)
            b3[carried] = cb[carried]; rem = rem & ~carried
        p3 = lama(b3, rem)
        if rem.any():
            mm = rem & np.isfinite(bgz[i])
            if mm.any(): Xn = backproject(i, mm); store_x.append(Xn); store_c.append(p3[mm]); store_z0.append(project(i, Xn)[2])
        plates['B3'].append(p3)
    if i % 8 == 0: print('  frame %d/%d %.0fs' % (i + 1, F, time.time() - t0), flush=True)

# ---------------- scores
lp = None
if not A.nolpips:
    import torch, lpips
    lp = lpips.LPIPS(net='alex', verbose=False)
def lpips_box(x, ref, m):
    yy, xx = np.where(m); pad = 16
    y0, y1 = max(yy.min() - pad, 0), min(yy.max() + pad + 1, ny); x0, x1 = max(xx.min() - pad, 0), min(xx.max() + pad + 1, nx)
    if (y1 - y0) < 32 or (x1 - x0) < 32: return None
    comp = ref.copy(); comp[m] = x[m]
    t = lambda a: torch.from_numpy(a[y0:y1, x0:x1].transpose(2, 0, 1)[None] * 2 - 1).float()
    with torch.no_grad(): return float(lp(t(comp), t(ref)))

res = {}
truthplate = []
for i in range(F):
    tp = rgb[i].copy(); k = known[i]; tp[k] = bgc[i][k]; truthplate.append(tp)
for a in ['truth'] + arms:
    P = truthplate if a == 'truth' else plates[a]
    mae = []; lps = []; warp = []
    for i in range(F):
        k = known[i]
        if k.sum() == 0: continue
        if a != 'truth':
            mae.append(float(np.abs(P[i][k] - bgc[i][k]).mean()))
            if lp is not None:
                v = lpips_box(P[i], truthplate[i], k)
                if v is not None: lps.append(v)
        if i + 1 < F:
            X = backproject(i, k); u, v, z = project(i + 1, X)
            ui = np.round(u).astype(int); vi = np.round(v).astype(int)
            q = (ui >= 0) & (vi >= 0) & (ui < nx) & (vi < ny)
            ui = np.clip(ui, 0, nx - 1); vi = np.clip(vi, 0, ny - 1)
            q &= known[i + 1][vi, ui] & zfoot(bgz, i + 1, u, v, z)
            if q.sum(): warp.append(float(np.abs(P[i][k][q] - P[i + 1][vi[q], ui[q]]).mean()))
    res[a] = {'mae': float(np.mean(mae)) if mae else None, 'lpips': float(np.mean(lps)) if lps else None,
              'lpipsFrames': len(lps), 'warp': float(np.mean(warp)) if warp else None, 'warpPairs': len(warp)}
    print('  %-5s MAE %s  LPIPS %s  warp %s' % (a, *[('%.4f' % res[a][k]) if res[a][k] is not None else '-' for k in ('mae', 'lpips', 'warp')]), flush=True)
json.dump({'shot': A.shot, 'coverage': {k: v for k, v in exp1.items() if k != 'perFrame'}, 'arms': res,
           'secs': round(time.time() - t0, 1)}, open(os.path.join(O, 'stability.json'), 'w'), indent=1)
for a in arms:
    np.savez_compressed(os.path.join(O, 'plates_%s.npz' % a), p=(np.clip(np.stack(plates[a]), 0, 1) * 255).astype(np.uint8))
np.savez_compressed(os.path.join(O, 'masks.npz'), hole=hole, known=known, seen=np.stack(seenmask))
print('done', A.shot, round(time.time() - t0, 1))
