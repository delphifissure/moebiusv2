#!/usr/bin/env python3
"""Does a86's dequantiser bring the a102 tear back under control?

tearcount.py showed the exact fold law tears 33.6% of the troll's cells and
13.3% of the star's ON RAW 8-BIT DEPTH -- because the corrected fold limit
(sqrt(2)/k) is 0.28-0.47 of ONE 8-bit level at every shipping resolution, so a
single quantisation step already folds. The shipped pipeline does not tear raw
depth: a86 reconstructs the continuous signal first. This measures the tear on
BOTH, so the dequantiser's contribution is a number rather than a hope.

a86 replicated exactly: along each axis, find constant runs; a run whose
neighbour differs by EXACTLY one quantum is part of one sloped surface, so
interpolate linearly between run centres; runs >= 2 quanta apart keep their
hard break. The two axis passes average.

    python3 harness/tearcount2.py starwatcher_depth.png [more...]
"""
import sys, math
import numpy as np
from PIL import Image

INNER, OUTER, TW, TH, D, PN, FADE = 0.04, 0.02, 0.16, 0.09, 0.2, 0.5, 45.0


def shift_table(pw, ph, levels):
    layer_aspect, frame_aspect = pw / ph, TW / TH
    layer_w = TW if layer_aspect > frame_aspect else TH * layer_aspect
    px_per_world = pw / layer_w
    ex = D * math.tan(math.radians(FADE))
    s = lambda t: t * t * (3 - 2 * t)
    out = np.empty(levels + 1)
    for i in range(levels + 1):
        d = i / levels
        z = -OUTER + OUTER * s(d / PN) if d < PN else INNER * s((d - PN) / (1 - PN))
        out[i] = (ex * z / max(1e-4, D - z)) * px_per_world
    return out


def dequant_axis(lv, q, horiz):
    """a86, one axis. lv = integer level image, q = quantum. Returns float image."""
    a = lv if horiz else lv.T
    rows, n = a.shape
    out = np.empty(a.shape, dtype=np.float64)
    for r in range(rows):
        row = a[r]
        # run boundaries
        brk = np.flatnonzero(row[1:] != row[:-1]) + 1
        starts = np.concatenate(([0], brk))
        ends = np.concatenate((brk - 1, [n - 1]))
        ctr = (starts + ends) / 2.0
        val = row[starts].astype(np.float64) * q
        nr = len(starts)
        for i in range(nr):
            cL = i > 0 and abs(val[i] - val[i - 1]) <= 1.001 * q
            cR = i < nr - 1 and abs(val[i + 1] - val[i]) <= 1.001 * q
            k = np.arange(starts[i], ends[i] + 1, dtype=np.float64)
            v = np.full(k.shape, val[i])
            if cL:
                m = k < ctr[i]
                t = (k[m] - ctr[i - 1]) / max(1e-6, ctr[i] - ctr[i - 1])
                v[m] = val[i - 1] + (val[i] - val[i - 1]) * t
            if cR:
                m = k > ctr[i]
                t = (k[m] - ctr[i]) / max(1e-6, ctr[i + 1] - ctr[i])
                v[m] = val[i] + (val[i + 1] - val[i]) * t
            out[r, starts[i]:ends[i] + 1] = v
    return out if horiz else out.T


def torn_fraction(depth01, pw, ph, sh_of):
    """fraction of mesh triangles whose screen-shift span exceeds sqrt(2) px"""
    s = sh_of(depth01)
    a, b = s[:-1, :-1], s[:-1, 1:]
    c, d = s[1:, :-1], s[1:, 1:]
    t1 = np.maximum(np.maximum(a, b), c) - np.minimum(np.minimum(a, b), c)
    t2 = np.maximum(np.maximum(b, c), d) - np.minimum(np.minimum(b, c), d)
    n = t1.size + t2.size
    return 100.0 * (int((t1 > math.sqrt(2)).sum()) + int((t2 > math.sqrt(2)).sum())) / n


for pathname in sys.argv[1:]:
    im = Image.open(pathname).convert('L')
    pw, ph = im.size
    lv = np.asarray(im, dtype=np.int32)          # (ph, pw)
    q = 1.0 / 255.0
    tab = shift_table(pw, ph, 4096)
    sh_of = lambda d01: tab[np.clip((d01 * 4096).astype(np.int32), 0, 4096)]

    raw = lv.astype(np.float64) * q
    deq = 0.5 * (dequant_axis(lv, q, True) + dequant_axis(lv, q, False))

    print('%-26s %dx%d' % (pathname.split('/')[-1], pw, ph))
    print('    raw 8-bit depth        %7.3f%% of cells torn' % torn_fraction(raw, pw, ph, sh_of))
    print('    a86 dequantised        %7.3f%%' % torn_fraction(deq, pw, ph, sh_of))
    # how much of the raw depth field sits ON the 1-quantum grid at all
    dx = np.abs(np.diff(lv, axis=1))
    dy = np.abs(np.diff(lv, axis=0))
    tot = dx.size + dy.size
    one = int((dx == 1).sum()) + int((dy == 1).sum())
    big = int((dx >= 2).sum()) + int((dy >= 2).sum())
    print('    neighbour steps: %.1f%% flat, %.1f%% exactly 1 level, %.1f%% >= 2 levels'
          % (100.0 * (tot - one - big) / tot, 100.0 * one / tot, 100.0 * big / tot))
