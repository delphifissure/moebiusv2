#!/usr/bin/env python3
"""Discontinuity-aware weighted median on a depth PNG (Shih et al., 3D Photography using Context-aware Layered
Depth Inpainting, CVPR 2020, `sparse_bilateral_filtering`): five passes with windows 7,7,5,5,5 at the paper's 960-px
long side; a pixel whose window touches a discontinuity is replaced by the median of the window's pixels that are not
themselves discontinuity pixels (the code path with a discontinuity map uses no spatial or range weights). The ramp
of a soft edge snaps to the plateau that dominates its window.

The discontinuity here is the app's own rim law (not the paper's |Δ 1/depth| > 0.04, which is a constant on MiDaS'
[0, 3] disparity): a 4-neighbour pair is a discontinuity when its eye-distance ratio exceeds t = 1 + (hfov/pw)/tan 2°
under the scene's depth law (meta.json: outer, inner, pn; layer width W, D = 0.2). Both pixels of the pair are marked,
as in the paper.

  python3 prefilter_shih.py <in.png> <out.png> --meta out/S2/meta.json [--windows 7,7,5,5,5] [--scale auto|1]
    --scale auto  multiplies the windows by longSide/960 (rounded to odd); 1 keeps the paper's pixels.
"""
import argparse, json, os, sys, time
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from tk import load_gray, save_png


def depth_law(meta, W=0.16, D=0.2):
    outer, inner, pn = float(meta['outer']), float(meta['inner']), float(meta.get('pn', 0.5))
    def z_of(d):
        d = np.clip(d, 0, 1); a = d / pn; b = (d - pn) / (1 - pn)
        return np.where(d < pn, -outer + outer * (a * a * (3 - 2 * a)), inner * (b * b * (3 - 2 * b)))
    ze = lambda d: np.maximum(1e-4, D - z_of(d))
    pw = meta['pw'] if 'pw' in meta else None
    return ze, W, D


def rims(d, ze, t):
    """4-neighbour pairs failing the rim law's ratio test; both pixels marked."""
    e = ze(d); m = np.zeros(d.shape, bool)
    r = e[1:, :] / e[:-1, :]; bad = np.maximum(r, 1 / r) > t; m[1:, :] |= bad; m[:-1, :] |= bad
    r = e[:, 1:] / e[:, :-1]; bad = np.maximum(r, 1 / r) > t; m[:, 1:] |= bad; m[:, :-1] |= bad
    return m


def masked_median_pass(d, disc, k):
    """For every pixel whose k×k window contains a discontinuity pixel: median of the window's non-discontinuity
    pixels (the centre keeps its value when none remain). Vectorised over the touched pixels."""
    h, w = d.shape; m = k // 2
    pd = np.pad(d, m, mode='edge'); pdisc = np.pad(disc, m, mode='edge')
    # which pixels' windows touch a discontinuity: dilate disc by the window
    from numpy.lib.stride_tricks import sliding_window_view as swv
    win_disc = swv(pdisc, (k, k)); touched = win_disc.any(axis=(2, 3))
    idx = np.nonzero(touched)
    if len(idx[0]) == 0: return d.copy(), 0
    win_d = swv(pd, (k, k))[idx].reshape(-1, k * k).astype(np.float64)
    keep = ~win_disc[idx].reshape(-1, k * k)
    vals = np.where(keep, win_d, np.nan)
    med = np.nanmedian(vals, axis=1)
    out = d.copy(); centre = d[idx]
    out[idx] = np.where(np.isnan(med), centre, med)
    return out, len(idx[0])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('src'); ap.add_argument('dst'); ap.add_argument('--meta', required=True)
    ap.add_argument('--windows', default='7,7,5,5,5'); ap.add_argument('--scale', default='1'); ap.add_argument('--W', type=float, default=0.16)
    a = ap.parse_args()
    meta = json.load(open(a.meta)); d0 = load_gray(a.src).astype(np.float64)
    h, w = d0.shape; ze, W, D = depth_law(meta, a.W)
    hfov = 2 * np.arctan((W / 2) / D); t = 1 + (hfov / w) / np.tan(np.radians(2))
    sc = (max(h, w) / 960.0) if a.scale == 'auto' else float(a.scale)
    wins = [max(3, int(round(int(x) * sc)) | 1) for x in a.windows.split(',')]
    d = d0.copy(); t0 = time.time(); log = []
    for k in wins:
        disc = rims(d, ze, t)
        d, n = masked_median_pass(d, disc, k)
        log.append((k, int(disc.sum()), n))
    save_png(a.dst, np.clip(d, 0, 1), bits=16)
    changed = np.abs(d - d0) > 1e-6
    print('rim law t = %.5f; passes (window, discontinuity px, filtered px): %s; %d px changed (%.2f%%), mean |Δ| %.5f on them; %.1fs' % (
        t, log, int(changed.sum()), 100 * changed.mean(), float(np.abs(d - d0)[changed].mean()) if changed.any() else 0, time.time() - t0))


if __name__ == '__main__': main()
