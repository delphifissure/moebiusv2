#!/usr/bin/env python3
"""S64: the app's band over the design envelope, +-90 deg in both axes, weighted by how large it is SEEN.

The app's law (reveal.py): a texel's shift on the glass is e*z/(D-z) (app z, sign as in the app), linear in the eye's
lateral offset e = D*tan(theta) for an eye walking along the wall at the app's distance D. reveal.scanline_reveal gives,
per pose, the rest texels owed far content. Here the poses run to 89 deg on both axes, both signs, and every band texel
records the SMALLEST angle that reveals it. A texel of the glass seen from theta is foreshortened by cos(theta) and
the eye is D/cos(theta) away, so its seen size is cos^2(theta) of its size at rest: the weight of a band texel is
cos^2(theta_first) (its largest seen size; derived, no constant). The band as a whole on the glass grows as tan(theta);
seen, as sin(2 theta)/2 (note S64).

Also reported: the angle beyond which the band's newly revealed texels are seen smaller than a fraction of a display
pixel is NOT a free choice here -- per angle ring we give the band count and its seen-size sum, and the cut-off is where
the ring's seen width (px added x cos^2) falls below one pixel of the rest display.

  python3 reveal90.py --depth DEPTH16.png [--W 0.16 --D 0.2 --pn 0.5 --outer 0.24 --inner 0.0001] [--step 2] [--out DIR]
  (library use: band90(dn, ...) -> dict with first_theta (deg, NaN = never), weight, rings)
"""
import argparse, json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from reveal import shift_px, scanline_reveal, continuity

RINGS = [(0, 30), (30, 45), (45, 60), (60, 75), (75, 90)]


def band90(dn, W=0.16, D=0.2, pn=0.5, outer=0.02, inner=0.04,   # app defaults (moebius.js L2959-2960)
            H=None, step=2.0, t=1.05, max_deg=89.0):
    ph, pw = dn.shape
    H = H if H is not None else W * 9 / 16
    layer_w = W if pw / ph > W / H else H * pw / ph
    ppw = pw / layer_w
    sig = shift_px(dn, D, D, pn, outer, inner, ppw)                       # at e = D, i.e. theta = 45 deg (f = tan(theta))
    jx = continuity(dn, D, pn, outer, inner, 'ratio', t)
    dT = dn.T[:, ::-1]; sigT = sig.T[:, ::-1]
    jy = continuity(dT, D, pn, outer, inner, 'ratio', t)
    first = np.full((ph, pw), np.nan, np.float32)
    smax = float(np.abs(sig).max())                                       # px on the glass at 45 deg, farthest texel
    thetas = np.arange(step, max_deg + 1e-6, step)
    per = []
    for th in thetas:                                                      # increasing: first hit = smallest angle
        f = np.tan(np.radians(th))
        hit = np.zeros((ph, pw), bool)
        for sgn in (1, -1):
            b, _ = scanline_reveal(sig, sgn * f, jx); hit |= b > 0
            b, _ = scanline_reveal(sigT, sgn * f, jy); hit |= (b[:, ::-1].T > 0)
        new = hit & np.isnan(first)
        first[new] = th
        # the strip beyond the frame edge: the farthest content's shift, closed form (the scanline count saturates at
        # the window width). On the glass it grows as tan(theta); the strip ADDED per degree is seen at a constant
        # size (d(tan)/d(theta) * cos^2 = 1), so the thinning does not bound the outpaint the way it bounds the band.
        strip = smax * f
        per.append({'theta': float(th), 'band_px': int(hit.sum()), 'new_px': int(new.sum()),
                    'strip_px': float(strip), 'strip_x_window': float(strip / pw),
                    'strip_seen_px': float(min(strip, pw) * np.cos(np.radians(th)) ** 2)})
    wgt = np.where(np.isnan(first), 0.0, np.cos(np.radians(np.nan_to_num(first))) ** 2).astype(np.float32)
    rings = []
    for a, b in RINGS:
        m = (first > a) & (first <= b)
        rings.append({'deg': [a, b], 'px': int(m.sum()), 'seen_px': float(wgt[m].sum())})
    return {'first_theta': first, 'weight': wgt, 'rings': rings, 'per_theta': per, 'ppw': float(ppw), 'thetas': thetas.tolist()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--depth', required=True, help='16-bit normalised disparity PNG (1 near, 0 far)')
    ap.add_argument('--W', type=float, default=0.16); ap.add_argument('--D', type=float, default=0.2)
    ap.add_argument('--pn', type=float, default=0.5); ap.add_argument('--outer', type=float, default=0.02)
    ap.add_argument('--inner', type=float, default=0.04); ap.add_argument('--step', type=float, default=2.0)
    ap.add_argument('--out', default=None)
    A = ap.parse_args()
    from PIL import Image
    dn = np.asarray(Image.open(A.depth), np.float32); dn = dn / (65535.0 if dn.max() > 255 else 255.0)
    r = band90(dn, A.W, A.D, A.pn, A.outer, A.inner, step=A.step)
    for g in r['rings']:
        print('  %2d-%2d deg: %8d px  seen %10.0f px' % (g['deg'][0], g['deg'][1], g['px'], g['seen_px']))
    if A.out:
        os.makedirs(A.out, exist_ok=True)
        np.save(os.path.join(A.out, 'first_theta.npy'), r['first_theta'])
        json.dump({k: r[k] for k in ('rings', 'per_theta', 'ppw', 'thetas')}, open(os.path.join(A.out, 'band90.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
