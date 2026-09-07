#!/usr/bin/env python3
"""Degradation ladder: turn a truthkit scene's exact depth into the kinds of depth map a monocular
estimator actually delivers, one defect per rung, so the pipeline can be scored against the truth
with the defect isolated (R1 §4 degradation ladder; M1 soft edges, M2 halos, M3 quantisation, M4
affine/relative depth, M5 thin-structure loss, M6 noise).

Input: out/<scene>/rest_depth16.png (the app's normalised depth, bright = near) and
rest_layers.npz (metric depth of layer 0). Output: out/<scene>/degrade/<rung>.png + manifest.json.
Every rung is an image the app can load in place of the estimator's depth.

  python3 degrade.py S27 [--out DIR]
"""
import argparse, json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from tk import save_png, load_gray


def gauss_blur(a, sigma):
    if sigma <= 0:
        return a.copy()
    r = int(np.ceil(3 * sigma)); x = np.arange(-r, r + 1); k = np.exp(-0.5 * (x / sigma) ** 2); k /= k.sum()
    def conv1(v, axis):
        p = np.pad(v, [(r, r) if ax == axis else (0, 0) for ax in range(v.ndim)], mode='reflect')
        out = np.zeros_like(v)
        for i, w in enumerate(k):
            sl = [slice(None)] * v.ndim; sl[axis] = slice(i, i + v.shape[axis]); out += w * p[tuple(sl)]
        return out
    return conv1(conv1(a, 0), 1)


def rank_filter(a, r, op):
    """Disc max (op=np.maximum) or min filter of radius r pixels."""
    p = np.pad(a, r, mode='edge'); out = None
    H, W = a.shape
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy > r * r + r:
                continue
            v = p[r + dy:r + dy + H, r + dx:r + dx + W]
            out = v.copy() if out is None else op(out, v)
    return out


def dilate(a, r): return rank_filter(a, r, np.maximum)     # near (bright) grows: foreground halo
def erode(a, r): return rank_filter(a, r, np.minimum)      # near shrinks


def opening(a, r): return dilate(erode(a, r), r)             # removes near structures thinner than ~2r


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('scene'); ap.add_argument('--out', default=None); ap.add_argument('--seed', type=int, default=1)
    a = ap.parse_args()
    base = a.out or os.path.join(os.path.dirname(__file__), 'out', a.scene)
    out = os.path.join(base, 'degrade'); os.makedirs(out, exist_ok=True)
    dn = load_gray(os.path.join(base, 'rest_depth16.png')).astype(np.float64)
    meta = json.load(open(os.path.join(base, 'meta.json')))
    L = np.load(os.path.join(base, 'rest_layers.npz')); dep = L['depth'][..., 0].astype(np.float64)
    D = meta['D']; outer = meta['outer']
    dist = np.where(np.isfinite(dep), dep, outer) + D            # metric distance from the rest eye
    rs = np.random.RandomState(a.seed)
    rungs = {}

    def put(name, img, bits, emulates, **params):
        save_png(os.path.join(out, name + '.png'), np.clip(img, 0, 1), bits=bits)
        rungs[name] = {'file': name + '.png', 'bits': bits, 'emulates': emulates, **params}

    put('exact16', dn, 16, 'the truth through the app mapping (control)')
    put('q8_linear', np.round(dn * 255) / 255, 8, 'M3 8-bit quantisation of normalised depth (256 steps; terraces on slow gradients)')
    disp = 1.0 / dist; disp = (disp - disp.min()) / max(1e-12, disp.max() - disp.min())
    put('q8_disparity', np.round(disp * 255) / 255, 8, 'M4 relative inverse depth (MiDaS-style affine-invariant disparity) fed to the app as if it were its depth; 8-bit', note='changes the depth law, not just its resolution')
    for s in (1, 2, 4):
        put(f'blur_s{s}', gauss_blur(dn, s), 16, 'M1 soft depth edges (estimator smoothing across occlusion boundaries)', sigma_px=s)
    for r in (2, 4):
        put(f'halo_dilate_r{r}', dilate(dn, r), 16, 'M2 foreground fattening: near depth bleeds r px over the background', radius_px=r)
    put('halo_erode_r2', erode(dn, 2), 16, 'M2 foreground thinning: near depth retreats 2 px', radius_px=2)
    put('blur_s2_dilate_r2', dilate(gauss_blur(dn, 2), 2), 16, 'M1+M2 the common combination: soft, fattened edges', sigma_px=2, radius_px=2)
    put('affine_a08_b01', 0.8 * dn + 0.1, 16, 'M4 unknown scale/shift: depth range compressed to 80 % and lifted', a=0.8, b=0.1)
    put('gamma_15', dn ** 1.5, 16, 'M4 monotone nonlinearity in the estimator (relative ordering kept, spacing wrong)', gamma=1.5)
    put('thin_loss_r1', opening(dn, 1), 16, 'M5 thin near structures under ~2 px vanish (opening)', radius_px=1)
    put('thin_loss_r2', opening(dn, 2), 16, 'M5 thin near structures under ~4 px vanish (opening)', radius_px=2)
    n = gauss_blur(rs.normal(size=dn.shape), 1.5); n /= n.std()
    put('noise_002', dn + 0.02 * n, 16, 'M6 pixel-scale estimator noise (1.5 px correlation), 0.02 of the normalised range', sigma=0.02, corr_px=1.5)
    put('noise_005', dn + 0.05 * n, 16, 'M6 pixel-scale estimator noise (1.5 px correlation), 0.05 of the normalised range', sigma=0.05, corr_px=1.5)
    nl = gauss_blur(rs.normal(size=dn.shape), 25.0); nl /= nl.std()
    put('bias_lowfreq_005', dn + 0.05 * nl, 16, 'M6 low-frequency depth bias (25 px correlation): bowed planes, drifting floors', sigma=0.05, corr_px=25)
    json.dump({'scene': a.scene, 'source': 'rest_depth16.png', 'rungs': rungs}, open(os.path.join(out, 'manifest.json'), 'w'), indent=1)
    print(f'{a.scene}: {len(rungs)} rungs ->', out)


if __name__ == '__main__':
    main()
