"""The return contract's GRADIENT ENCODING, done the way InpaintFusion does it.

S48 established that the pure-gradient return beats the absolute return 2.57x, and R8 found that this was an
independent re-derivation of InpaintFusion (Mori et al., IEEE TVCG 26(10) 2020) S3.7, which inpaints depth in the
gradient domain with a Poisson solve for the same stated reason: absolute depth is "perspective and view-dependent",
gradients are not. The same section names a defect in how we were writing them.

  "directly sampling pixels from f* will introduce inconsistencies: Consider a pixel at u and its right neighbor at
   u+v. A naive horizontal gradient will usually not match the sampled depth gradient of the adjacent pixel,
   d(f*(u+v)) - d(f*(u+v) - v). Therefore, we minimize [...] where E-hat is the mean bi-directional depth gradient
   sample."                                                              -- InpaintFusion S3.7

WHAT THAT MEANS, AND WHAT IT DOES *NOT* MEAN FOR US. Their f* is an exemplar shift map, so two adjacent target pixels
can be copied from source locations far apart and the naive difference between them is a difference between two
unrelated places. Ours is a dense model prediction, so for any edge with both endpoints in the same field the forward
difference IS the within-source estimate and the bi-directional mean is identically equal to it. **On a dense field
this change is a no-op in the interior.** It is not a no-op where the field is a COMPOSITE OF TWO SOURCES, and ours
is exactly that: observed plate depth outside the band, model prediction inside it. Every edge straddling the rim is
a cross-source difference -- the naive gradient there is the difference between a measured depth and a rescaled
relative prediction, which is the literal case the paper says to avoid, and it is the one place in the picture where
a wrong gradient does the most damage, because the rim is where every streak starts.

So the correction is precise and small: an edge whose two endpoints come from the same source keeps the forward
difference; an edge that straddles the boundary takes the MEAN OF THE TWO WITHIN-SOURCE ONE-SIDED ESTIMATES -- the
gradient just inside the region on each side -- and never the cross-source difference.

MEASURED ON THE TROLL BUNDLE (851x1023, band 39.9%), rather than asserted. 42 586 edges straddle the rim, 2.45% of
all edges. On those edges the naive difference has median |g| 0.0828 in d and the bi-directional mean has 0.0004 --
the whole rim step was entering the guidance field, and the Poisson solve then reproduces it one texel inside the
band. Split by which side is nearer: 93.3% of the crossing edges have the OUTSIDE texel nearer than the band (an
occluder cliff; 42.0% are tagged occluder in plane_object_ids, the rest untagged self-occlusion), 70.7% have a step
over 0.05 in d, and only 6.4% are same-surface (|step| <= 0.01) -- where the two estimates agree to 0.006 anyway, so
continuity across the far-side rim is kept, not erased. Divergence over the band, which is what the solver actually
integrates, falls from |.| mean 0.0491 / p99 0.5682 to 0.0317 / 0.3347.

The app already refuses the occluder rim for the ABSOLUTE anchor -- window._shiftBandComponents takes the rim law's
"joined" (far-side) neighbours only, because "anchoring on it makes the shift absorb the cliff" (moebius.js ~10863).
The gradient guidance had no such protection. This is that same rule, applied to the other half of the return.

THE PLATE BORDER IS LEFT AT ZERO ON PURPOSE. gx at the last column names the edge to a column that does not exist.
The solver (moebius.js window._screenedPoissonBand) reads it and adds zero, which is the natural (Neumann) condition:
the field does not continue past the plate. That is correct and is not the defect above.

ENCODING, unchanged from meta.plane.returnContract: 16-bit grey, (g + 0.5) so 32768 is zero gradient,
gx[i] ~ d[i+1] - d[i], gy[i] ~ d[i+pw] - d[i], row-major, top-first.

  python3 harness/return_grad.py          # self-test
"""
import numpy as np


def bidirectional_gradients(d, src=None):
    """Return (gx, gy) for the contract, InpaintFusion S3.7's bi-directional mean at source boundaries.

    d    : (H, W) float depth field, in the app's normalised d.
    src  : (H, W) integer/bool source labels -- which field each texel's value came from. None means one source
           everywhere, in which case this is a plain forward difference and says so in the report.

    Returns (gx, gy, report). report counts the edges by how they were resolved, so a caller can state the size of
    the correction rather than assert it.
    """
    d = np.asarray(d, dtype=np.float64)
    H, W = d.shape
    gx = np.zeros_like(d)
    gy = np.zeros_like(d)
    # the plain forward difference, which is also the answer for every same-source edge
    gx[:, :-1] = d[:, 1:] - d[:, :-1]
    gy[:-1, :] = d[1:, :] - d[:-1, :]
    rep = {'w': W, 'h': H, 'crossX': 0, 'crossY': 0, 'meanBoth': 0, 'oneSideOnly': 0, 'noEstimate': 0}
    if src is None:
        rep['sources'] = 1
        return gx.astype(np.float64), gy.astype(np.float64), rep
    s = np.asarray(src)
    rep['sources'] = int(np.unique(s).size)

    # ---- horizontal: the edge between (y, x) and (y, x+1) ----
    a = s[:, :-1]; b = s[:, 1:]
    cross = a != b                                    # straddles the boundary: the naive difference is cross-source
    if cross.any():
        rep['crossX'] = int(cross.sum())
        # the within-source estimate on a's side: d[x] - d[x-1], valid when x>0 and s[x-1]==s[x]
        left = np.zeros_like(cross, dtype=np.float64); lok = np.zeros_like(cross)
        left[:, 1:] = d[:, 1:-1] - d[:, :-2]
        lok[:, 1:] = s[:, 1:-1] == s[:, :-2]
        # the within-source estimate on b's side: d[x+2] - d[x+1], valid when x+2<W and s[x+2]==s[x+1]
        right = np.zeros_like(cross, dtype=np.float64); rok = np.zeros_like(cross)
        right[:, :-1] = d[:, 2:] - d[:, 1:-1]
        rok[:, :-1] = s[:, 2:] == s[:, 1:-1]
        gx[:, :-1] = np.where(cross, _mean_of_available(left, lok, right, rok, cross, rep), gx[:, :-1])

    # ---- vertical: the edge between (y, x) and (y+1, x) ----
    a = s[:-1, :]; b = s[1:, :]
    cross = a != b
    if cross.any():
        rep['crossY'] = int(cross.sum())
        up = np.zeros_like(cross, dtype=np.float64); uok = np.zeros_like(cross)
        up[1:, :] = d[1:-1, :] - d[:-2, :]
        uok[1:, :] = s[1:-1, :] == s[:-2, :]
        dn = np.zeros_like(cross, dtype=np.float64); dok = np.zeros_like(cross)
        dn[:-1, :] = d[2:, :] - d[1:-1, :]
        dok[:-1, :] = s[2:, :] == s[1:-1, :]
        gy[:-1, :] = np.where(cross, _mean_of_available(up, uok, dn, dok, cross, rep), gy[:-1, :])

    return gx, gy, rep


def _mean_of_available(e1, ok1, e2, ok2, cross, rep):
    """The mean bi-directional sample where both within-source estimates exist, the single one where only one does,
    and zero -- a flat edge, the least-committal guidance -- where neither does. Counted over the CROSSING edges
    only, since those are the only ones this branch decides; the rest keep the forward difference."""
    both = ok1 & ok2
    only1 = ok1 & ~ok2
    only2 = ok2 & ~ok1
    rep['meanBoth'] += int((both & cross).sum())
    rep['oneSideOnly'] += int(((only1 | only2) & cross).sum())
    rep['noEstimate'] += int((~ok1 & ~ok2 & cross).sum())
    out = np.zeros_like(e1)
    out[both] = 0.5 * (e1[both] + e2[both])
    out[only1] = e1[only1]
    out[only2] = e2[only2]
    return out


def encode_u16(g):
    """The contract's signed-gradient encoding: (g + 0.5) scaled to 16 bits, 32768 = zero."""
    return np.clip(np.round((g + 0.5) * 65535.0), 0, 65535).astype(np.uint16)


if __name__ == '__main__':
    # 1. a dense single-source field: the bi-directional mean must be EXACTLY the forward difference
    rng = np.random.default_rng(0)
    d = rng.random((40, 50))
    gx0, gy0, r0 = bidirectional_gradients(d, None)
    gx1, gy1, r1 = bidirectional_gradients(d, np.zeros((40, 50), np.uint8))
    assert np.array_equal(gx0, gx1) and np.array_equal(gy0, gy1), 'one source must be a no-op'
    print('single source: no-op confirmed, max|d| %.1e' % max(np.abs(gx0 - gx1).max(), np.abs(gy0 - gy1).max()))

    # 2. two sources with a step between them: the naive gradient carries the step, the bi-directional one does not
    d = np.zeros((9, 9)); src = np.zeros((9, 9), np.uint8)
    for x in range(9):
        d[:, x] = 0.01 * x            # a gentle ramp, the true structure
    d[:, 5:] += 0.40                  # the prediction sits 0.40 below the plate: a scale offset, not real geometry
    src[:, 5:] = 1
    gxn = np.zeros_like(d); gxn[:, :-1] = d[:, 1:] - d[:, :-1]
    gxb, gyb, rep = bidirectional_gradients(d, src)
    print('naive at the seam  %.4f   (the whole 0.40 offset enters the guidance field)' % gxn[4, 4])
    print('bi-directional     %.4f   (the ramp, which is the structure both sides agree on)' % gxb[4, 4])
    assert abs(gxn[4, 4] - 0.41) < 1e-9
    assert abs(gxb[4, 4] - 0.01) < 1e-9
    print('report', rep)

    # 3. the plate border stays zero (Neumann), on purpose
    assert gxb[:, -1].max() == 0 and gyb[-1, :].max() == 0
    print('plate border: zero kept (Neumann)')

    # 4. the encoding round-trips
    g = np.array([[-0.25, 0.0, 0.25]])
    back = encode_u16(g).astype(np.float64) / 65535.0 - 0.5
    print('encode round-trip max err %.2e' % np.abs(back - g).max())
    assert np.abs(back - g).max() < 1e-4
    print('OK')
