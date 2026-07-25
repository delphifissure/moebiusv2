#!/usr/bin/env python3
"""Prototype: tear at genuine cliffs, then BAND-LIMIT the depth inside each piece.

Motivation (measured in tearcount2.py): with the corrected fold law, one 8-bit
level is 2.2-3.5x the fold limit, so 4-34% of mesh cells fold and must be torn,
and every torn cell is a hole the plate has to back. Tearing is the correct
response to a fold, but most of those folds are not silhouettes -- they are a
smooth surface that the depth format cannot express gently enough.

So separate the two:
  1. a cliff is a step >= fgTearStep (0.06 = 15 8-bit levels). Those are real
     occlusion boundaries and MUST tear -- that is the disocclusion.
  2. everywhere else, project the depth onto the nearest field whose per-texel
     screen-shift gradient is within the fold limit, WITHOUT crossing a cliff.
     A surface at exactly the grazing limit is the steepest thing the display
     can show without folding, so this is the best available representation of
     a steeper surface, and it is strictly better than deleting it.

The projection is the standard Lipschitz projection: while any 4-neighbour pair
exceeds the limit, move both halfway toward each other. It converges to a field
satisfying the bound, and it moves depth as little as possible to get there.

Reported: torn % before/after, and how far the depth had to move (RMS and max,
in 8-bit levels) -- the cost side of the trade.

RESULT: NEGATIVE, AND THE IDEA IS DEAD. On the troll the projection does not
converge (3000 damped iterations leave a 15.5 px residual against a 0.71 px
bound) and the depth it has already moved is rms 9.4 / max 63 levels. The
reason is arithmetic, not implementation: the cliff scale (fgTearStep = 0.06 =
15 8-bit levels) is 34x the fold limit (0.0017 = 0.44 levels), so there is a
wide band of steps -- 1 to 15 levels -- that are far too steep to display
without folding and not steep enough to be called a cliff. Flattening a
14-level step to the fold limit means spreading it over ~64 texels, which is
not a filter, it is a redesign of the scene. Those steps are near-
discontinuities and TEARING them is the right answer; the plate behind them is
what has to be good. Kept in the tree as the record of a plausible idea that
measurement killed.

    python3 harness/slopelimit.py starwatcher_depth.png [more...]
"""
import sys, math
import numpy as np
from PIL import Image

INNER, OUTER, TW, TH, D, PN, FADE = 0.04, 0.02, 0.16, 0.09, 0.2, 0.5, 45.0
TEAR_STEP = 0.06          # fgTearStep: the cliff scale, unchanged
MAX_ITERS = 3000
DAMP = 0.8        # Jacobi-style simultaneous correction overshoots at 1.0


def tables(pw, ph):
    layer_aspect, frame_aspect = pw / ph, TW / TH
    layer_w = TW if layer_aspect > frame_aspect else TH * layer_aspect
    px_per_world = pw / layer_w
    ex = D * math.tan(math.radians(FADE))
    s = lambda t: t * t * (3 - 2 * t)
    N = 4096
    sh = np.empty(N + 1)
    for i in range(N + 1):
        d = i / N
        z = -OUTER + OUTER * s(d / PN) if d < PN else INNER * s((d - PN) / (1 - PN))
        sh[i] = (ex * z / max(1e-4, D - z)) * px_per_world
    return sh, N


def shift_of(d01, sh, N):
    return sh[np.clip((d01 * N).astype(np.int32), 0, N)]


def torn_pct(d01, sh, N):
    s = shift_of(d01, sh, N)
    a, b, c, e = s[:-1, :-1], s[:-1, 1:], s[1:, :-1], s[1:, 1:]
    t1 = np.maximum(np.maximum(a, b), c) - np.minimum(np.minimum(a, b), c)
    t2 = np.maximum(np.maximum(b, c), e) - np.minimum(np.minimum(b, c), e)
    return 100.0 * (int((t1 > math.sqrt(2)).sum()) + int((t2 > math.sqrt(2)).sum())) / (t1.size + t2.size)


def band_limit(d01, sh, N, limit_px=1.0/math.sqrt(2)):
    """Lipschitz-project the SHIFT field, never across a cliff. Works in shift
    space because that is where the physical bound lives; depth is recovered by
    inverting the (monotone) shift table.

    The per-AXIS limit is 1/sqrt(2), not 1: bounding each axis difference by L
    bounds the gradient MAGNITUDE by L*sqrt(2), and the fold limit is on the
    magnitude (a diagonal gradient is what a triangle of extent (1,1) presents
    across its sqrt(2) diagonal). Limiting the axes at 1.0 leaves diagonal
    gradients up to sqrt(2), which still folds -- measured: 33.6% -> 30.7%
    only, versus the number below."""
    s = shift_of(d01, sh, N).astype(np.float64)
    cliff_x = np.abs(np.diff(d01, axis=1)) >= TEAR_STEP
    cliff_y = np.abs(np.diff(d01, axis=0)) >= TEAR_STEP
    it = 0
    for it in range(MAX_ITERS):
        moved = 0.0
        for axis in (1, 0):
            dif = np.diff(s, axis=axis)
            cl = cliff_x if axis == 1 else cliff_y
            over = np.abs(dif) - limit_px
            act = (over > 0) & (~cl)
            if not act.any():
                continue
            corr = np.where(act, DAMP * np.sign(dif) * over / 2.0, 0.0)
            moved = max(moved, float(np.abs(corr).max()))
            if axis == 1:
                s[:, :-1] += corr
                s[:, 1:] -= corr
            else:
                s[:-1, :] += corr
                s[1:, :] -= corr
        if moved < 1e-4:
            break
    else:
        print('    [warn] Lipschitz projection did not converge in %d iterations' % MAX_ITERS)
    # residual: how far outside the bound anything still is (non-cliff pairs)
    for axis, cl in ((1, cliff_x), (0, cliff_y)):
        r = np.abs(np.diff(s, axis=axis))[~cl]
        if r.size:
            print('    axis %d residual max %.4f px (bound %.4f), iters %d' % (axis, r.max(), limit_px, it + 1))
    # invert the monotone shift table back to depth
    lo, hi = sh[0], sh[N]
    s = np.clip(s, lo, hi)
    idx = np.searchsorted(sh, s.ravel()).clip(1, N)
    a0, a1 = sh[idx - 1], sh[idx]
    frac = np.where(a1 > a0, (s.ravel() - a0) / np.maximum(1e-12, a1 - a0), 0.0)
    return ((idx - 1 + frac) / N).reshape(s.shape)


for pathname in sys.argv[1:]:
    im = Image.open(pathname).convert('L')
    pw, ph = im.size
    d01 = np.asarray(im, dtype=np.float64) / 255.0
    sh, N = tables(pw, ph)
    before = torn_pct(d01, sh, N)
    lim = band_limit(d01, sh, N)
    after = torn_pct(lim, sh, N)
    delta = (lim - d01) * 255.0
    print('%-26s %dx%d' % (pathname.split('/')[-1], pw, ph))
    print('    torn   %7.3f%%  ->  %7.3f%%' % (before, after))
    print('    depth moved: rms %.2f levels, p99 %.2f, max %.2f (8-bit levels)'
          % (float(np.sqrt((delta ** 2).mean())), float(np.percentile(np.abs(delta), 99)), float(np.abs(delta).max())))
