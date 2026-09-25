#!/usr/bin/env python3
"""Round-trip holes with known answers on REAL pictures (Geometric Reciprocity / TrajectoryCrafter / Invisible Stitch
style, S63c): warp the picture to a side view with its own depth and the app's shift law; the source pixels that are
OCCLUDED from that view are the test hole. Their true colour is the picture itself. The hole has the shape of a real
reveal (a strip on the background side of every silhouette, as wide as the parallax step), mirrored to the visible side.

Painters (all general, no per-image setting):
  lama     LaMa (simple_lama_inpainting)
  pp       push-pull (Solh & AlRegib's hierarchical fill): 5x5 Gaussian over non-hole pixels only, pyramid to no holes
  pp_far   the same, seeded only from pixels on the hole's own side of the depth edge: a known pixel is excluded when
           its app metric distance is nearer than the hole component's nearest pixel by more than the continuity ratio
           t = 1.05 (reveal.py's join test, Depth Pro's occluding-contour threshold)

Scores inside the hole only (PROVE): MAE, masked LPIPS on the hole's bounding box (truth outside the hole), and the
gradient-energy ratio fill/truth inside the hole (< 1 = blurrier than the truth; blur must not win).

  python3 grt_eval.py --pics NAME=color.png:depth16.png ... [--deg 30,60] [--long 768] [--out DIR] [--painters lama,pp,pp_far]
"""
import argparse, json, os, sys, time
import numpy as np
from PIL import Image
from scipy.ndimage import label, convolve, zoom
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'truthkit'))
from reveal import shift_px
from tk import app_z_of_d

ap = argparse.ArgumentParser()
ap.add_argument('--pics', nargs='+', default=[])
ap.add_argument('--deg', default='30,60'); ap.add_argument('--long', type=int, default=768)
ap.add_argument('--painters', default='lama,pp,pp_far'); ap.add_argument('--out', default=None)
ap.add_argument('--W', type=float, default=0.16); ap.add_argument('--D', type=float, default=0.2)
ap.add_argument('--pn', type=float, default=0.5); ap.add_argument('--outer', type=float, default=0.02); ap.add_argument('--inner', type=float, default=0.04)   # the app's defaults, moebius.js L2959-2960
A = ap.parse_known_args()[0]
if A.out: os.makedirs(A.out, exist_ok=True)


def load(pc, pd):
    c = Image.open(pc).convert('RGB'); d = Image.open(pd)
    s = A.long / max(c.size)
    size = (int(round(c.size[0] * s)), int(round(c.size[1] * s)))
    c = np.asarray(c.resize(size, Image.LANCZOS), np.float32) / 255
    dd = np.asarray(d, np.float32); dd = dd / (65535.0 if dd.max() > 255 else 255.0)
    dd = np.asarray(Image.fromarray(dd).resize(size, Image.NEAREST), np.float32)   # nearest: no invented mid-depths
    return c, dd


def occluded(dn, sig, f):
    """Source pixels hidden from the view at pose fraction f (rows): forward-warp every texel by sig*f to its nearest
    cell, the nearest texel (largest dn) wins each cell. A source pixel is OCCLUDED when the texel that wins its cell is
    nearer than it by more than the join ratio t = 1.05 in app metric distance — a receding surface that merely
    compresses (several texels of one surface per cell) is not a hole."""
    H, W = dn.shape
    tx = np.rint(np.arange(W)[None, :] + sig * f).astype(int)
    ok = (tx >= 0) & (tx < W)
    win = np.full((H, W), -1, np.int64)
    order = np.argsort(dn, axis=None)                               # far first, near overwrite
    r, c = np.unravel_index(order, dn.shape)
    keep = ok[r, c]; r, c = r[keep], c[keep]
    win[r, tx[r, c]] = c                                            # last write (nearest) wins
    m = A.D - app_z_of_d(dn, A.pn, A.outer, A.inner)                # metric distance from the rest eye
    rows = np.repeat(np.arange(H)[:, None], W, 1)
    txc = np.clip(tx, 0, W - 1)
    w = win[rows, txc]
    mw = np.where(w >= 0, m[rows, np.clip(w, 0, W - 1)], np.inf)
    return ok & (mw * 1.05 < m)


def pushpull(img, known):
    """Solh & AlRegib HHF: Reduce = 5x5 Gaussian over known pixels only; stop when no holes; Expand + Fill back up."""
    g1 = np.array([1, 4, 6, 4, 1], np.float32) / 16; k = np.outer(g1, g1)
    levels = [(img * known[..., None], known.astype(np.float32))]
    while (levels[-1][1] <= 0).any() and min(levels[-1][1].shape) > 2:
        c, w = levels[-1]
        cs = np.stack([convolve(c[..., i], k, mode='nearest') for i in range(3)], -1); ws = convolve(w, k, mode='nearest')
        levels.append((cs[::2, ::2], ws[::2, ::2]))
    c, w = levels[-1]
    cur = c / np.maximum(w, 1e-8)[..., None]
    for c, w in reversed(levels[:-1]):
        up = np.stack([zoom(cur[..., i], (c.shape[0] / cur.shape[0], c.shape[1] / cur.shape[1]), order=1) for i in range(3)], -1)
        own = c / np.maximum(w, 1e-8)[..., None]
        cur = np.where((w > 1e-6)[..., None], own, up)
    return cur


def far_seed(dn, hole):
    """Known pixels on the hole's own side: per hole component, exclude known pixels nearer than the component's nearest
    pixel by more than the ratio t = 1.05 in app metric distance from the rest eye."""
    m = A.D - app_z_of_d(dn, A.pn, A.outer, A.inner)
    lab, n = label(hole)
    allow = ~hole.copy()
    if n == 0: return allow
    mins = np.full(n + 1, np.inf); np.minimum.at(mins, lab[hole], m[hole])
    # nearest-component map by dilation of labels (a pixel takes the label of the nearest hole)
    from scipy.ndimage import distance_transform_edt
    _, (iy, ix) = distance_transform_edt(lab == 0, return_indices=True)
    near_lab = lab[iy, ix]
    thr = mins[near_lab] / 1.05
    return allow & (m >= thr)


KLEIN_PROMPT = 'the background behind, continuous surfaces, natural texture'   # sd_return.py's prompt, one for every picture
_lama = None
def lama(img, hole):
    global _lama
    if _lama is None:
        from simple_lama_inpainting import SimpleLama
        _lama = SimpleLama()
    out = np.asarray(_lama(Image.fromarray((img * 255).astype(np.uint8)), Image.fromarray((hole * 255).astype(np.uint8))), np.float32) / 255
    return out[:img.shape[0], :img.shape[1]]


lp = None
def scores(fill, truth, hole):
    global lp
    import torch, lpips
    if lp is None: lp = lpips.LPIPS(net='alex', verbose=False)
    comp = truth.copy(); comp[hole] = fill[hole]
    yy, xx = np.nonzero(hole)
    y0, y1, x0, x1 = max(yy.min() - 16, 0), yy.max() + 17, max(xx.min() - 16, 0), xx.max() + 17
    t = lambda a: torch.from_numpy(a[y0:y1, x0:x1].transpose(2, 0, 1)[None] * 2 - 1).float()
    with torch.no_grad(): L = float(lp(t(comp), t(truth)))
    def gE(a):
        l = a.mean(-1)
        g = np.abs(np.diff(l, axis=1))[:-1, :] + np.abs(np.diff(l, axis=0))[:, :-1]
        return float(g[hole[:-1, :-1]].mean())
    return {'mae': float(np.abs(fill[hole] - truth[hole]).mean()), 'lpips': L, 'gradRatio': gE(comp) / max(gE(truth), 1e-9)}


if __name__ == '__main__':
    res = {}
    painters = A.painters.split(',')
    for spec in A.pics:
        name, rest = spec.split('='); pc, pd = rest.split(':')
        img, dn = load(pc, pd)
        H, W = dn.shape
        Wl = A.W if W / H > A.W / (A.W * 9 / 16) else (A.W * 9 / 16) * W / H
        sig = shift_px(dn, A.D, A.D, A.pn, A.outer, A.inner, W / Wl)       # px at theta = 45 deg; f = tan(theta)
        res[name] = {}
        for deg in [float(x) for x in A.deg.split(',')]:
            f = np.tan(np.radians(deg))
            hole = occluded(dn, sig, f) | occluded(dn, sig, -f)
            key = '%g' % deg; res[name][key] = {'holePct': float(100 * hole.mean())}
            if hole.sum() < 50: continue
            Image.fromarray((hole * 255).astype(np.uint8)).save(os.path.join(A.out, '%s_%s_hole.png' % (name, key)))
            for p in painters:
                t0 = time.time()
                if p == 'lama': fill = lama(img, hole)
                elif p == 'pp': fill = pushpull(img, ~hole)
                elif p == 'pp_far': fill = pushpull(img, far_seed(dn, hole))
                elif p == 'klein':
                    import klein
                    fill = klein.paint((img * 255).astype(np.uint8), hole, KLEIN_PROMPT).astype(np.float32) / 255
                comp = img.copy(); comp[hole] = fill[hole]
                Image.fromarray((np.clip(comp, 0, 1) * 255).astype(np.uint8)).save(os.path.join(A.out, '%s_%s_%s.png' % (name, key, p)))
                res[name][key][p] = scores(fill, img, hole); res[name][key][p]['secs'] = round(time.time() - t0, 1)
                print(name, key, p, {k: round(v, 4) for k, v in res[name][key][p].items()}, 'hole %.2f%%' % res[name][key]['holePct'], flush=True)
        json.dump(res, open(os.path.join(A.out, 'grt.json'), 'w'), indent=1)
