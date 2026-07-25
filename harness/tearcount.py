#!/usr/bin/env python3
"""Count the FG cells each fold law tears, straight from the depth map.

No GL, no bake: the per-cell tear is a pure function of the depth image and the
displacement law, so it can be measured exactly and cheaply. Reports, per asset,
the fraction of mesh cells dropped by

    a88/a90  scalar cone, threshold sqrt(2) * 0.0025 * 1920/pw   (depth units)
    a101     per-depth slope, sqrt(2) / k(mean cell depth)       (depth units)
    a102     exact envelope, |shift(dmax) - shift(dmin)| > sqrt(2) px

Torn cells are not free: every one of them is a hole the plate has to back, so
this number is the direct cost of the fold law, and the three laws disagreeing
is the whole point of the a101/a102 arc.

    python3 harness/tearcount.py starwatcher_depth.png [more...]
"""
import sys, math
from PIL import Image

INNER, OUTER, TW, TH, D, PN, FADE = 0.04, 0.02, 0.16, 0.09, 0.2, 0.5, 60.0

def law(pw, ph):
    layer_aspect, frame_aspect = pw / ph, TW / TH
    layer_w = TW if layer_aspect > frame_aspect else TH * layer_aspect
    px_per_world = pw / layer_w
    ex = D * math.tan(math.radians(FADE))
    def z_of(d):
        s = lambda t: t * t * (3 - 2 * t)
        return -OUTER + OUTER * s(d / PN) if d < PN else INNER * s((d - PN) / (1 - PN))
    def shift(d):
        z = z_of(d)
        return (ex * z / max(1e-4, D - z)) * px_per_world
    def g_of(d):
        if d < PN:
            t = d / PN;         return OUTER * (6 * t * (1 - t)) / PN
        t = (d - PN) / (1 - PN); return INNER * (6 * t * (1 - t)) / (1 - PN)
    def k_of(d):
        z = z_of(d)
        return (ex * D / max(1e-8, (D - z) ** 2)) * g_of(d) * px_per_world
    return shift, k_of

for pathname in sys.argv[1:]:
    im = Image.open(pathname).convert('L')
    pw, ph = im.size
    px = im.load()
    shift, k_of = law(pw, ph)
    s_cone = 0.0025 * 1920 / pw
    t88 = math.sqrt(2) * s_cone
    ceil88 = 0.06
    # precompute per-level shift and per-level a101 threshold (depth is 8-bit here)
    sh = [shift(i / 255.0) for i in range(256)]
    a101 = []
    for i in range(256):
        k = k_of(i / 255.0)
        a101.append(math.sqrt(2) * (min(ceil88, 1.0 / k) if k > 1e-6 else ceil88))
    n = t_88 = t_101 = t_102 = 0
    for y in range(ph - 1):
        for x in range(pw - 1):
            a, b, c, d2 = px[x, y], px[x + 1, y], px[x, y + 1], px[x + 1, y + 1]
            for tri in ((a, b, c), (b, c, d2)):
                mn, mx = min(tri), max(tri)
                n += 1
                span = (mx - mn) / 255.0
                if span > t88:                              t_88 += 1
                if span > a101[(sum(tri) // 3)]:            t_101 += 1
                if sh[mx] - sh[mn] > math.sqrt(2):          t_102 += 1
    print('%-28s %dx%d  cells %d' % (pathname.split('/')[-1], pw, ph, n))
    print('    a88/a90 scalar   %8.4f%%   (threshold %.5f depth)' % (100.0 * t_88 / n, t88))
    print('    a101 per-depth   %8.4f%%' % (100.0 * t_101 / n))
    print('    a102 exact       %8.4f%%   (threshold sqrt(2) px of screen shift)' % (100.0 * t_102 / n))
