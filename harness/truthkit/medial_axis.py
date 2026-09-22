#!/usr/bin/env python3
"""S57 / task 61 -- DOES THE BAND'S DEPTH ERROR FOLLOW THE BAND'S MEDIAL AXIS?

THE PREDICTION, AND WHERE IT COMES FROM. Two papers, one empirical and one analytic, say the same thing about
any fill that advances at uniform speed from the whole rim:

  Criminisi, Perez & Toyama (TIP 13(9) 2004) Fig. 20 caption, on concentric-layer filling:
    "The deformation of the horizon is caused by the fact that in the concentric-layer filling sky and sea grow
     inwards at uniform speed. Thus, the reconstructed sky-sea boundary tends to follow the SKELETON of the
     selected target region."

  Bornemann & Maerz (J. Math. Imaging Vis. 28, 2007) Theorem 1 derives it: the vanishing-viscosity limit of
  distance-ordered weighted-mean filling is n.grad(u) = 0 with n = grad(T), T the distance map, and
    "There is no transport of information across [the skeleton]."
  The skeleton being "the set of singularities (locations of the ridges) of the distance map".

Our band fill is SIMULTANEOUS -- there is no ordering at all -- and our band is long and thin, so its medial
axis runs roughly rim-parallel, which is what class 1 looks like. If the error concentrates on the medial axis,
fill ORDER is a lever this project has never pulled and Criminisi's product priority P = C(p)*D(p) is the
canonical way to pull it. If it does not, that whole line closes and Sprint 30/31 keep the budget.

RESULT, 2026-09-22, 11 scenes (research/S57_direction_review.md section 5): NOT SUPPORTED. At fixed distance from
the rim the ridge is better than the basin in 22 of 39 cells and worse in 12, weighted mean ridge-minus-basin bad
rate -0.050; only S2 and S27 show the predicted excess. The angle trend appears on S2, S10, S12 and reverses on S9
and S16. Fill order is not a lever for this far field; the line is closed.

THE CONFOUND THIS IS BUILT TO AVOID, WHICH IS THE ENTIRE POINT OF THE SCRIPT.
Error grows with distance from the rim for a boring reason: an extrapolation gets worse the further it reaches.
The skeleton hypothesis says something STRONGER and different -- that the error spikes specifically where
characteristics from DIFFERENT rim points meet, which is a ridge of the distance map, not merely a large value
of it. Binning by distance alone cannot tell the two apart.

So the test is conditional. For every band texel we compute

  T(p)     the euclidean distance to the nearest non-band texel (the rim), and
  near(p)  the coordinates of that nearest rim texel, and
  skel(p)  max over the 4 neighbours q of |near(p) - near(q)|

skel is large exactly where the nearest-rim assignment flips between neighbours -- the medial axis -- and small
in the interior of a "basin" that all drains to one stretch of rim. Then we ask: AT FIXED T, is the error higher
where skel is large? That holds distance constant and varies only ridge-ness, so a positive answer is the
skeleton and not the reach.

A SECOND PREDICTION FROM THE SAME READING. Bornemann Fig. 8 measures the fill degrading as the structure's angle
to the hole falls: perfect at 11.3 degrees, a clearly visible shock at 5.7, and at 0 it reproduces plain
distance-normal transport. In his terms the failure is c perpendicular to n, where n = grad(T) and c is the
transport direction. Here n points across the band and c is taken as the TRUE depth's isophote direction,
grad-perp(d_true) -- the direction along which the hidden surface is constant, which is the thing the fill has
to continue. So we also bin by |cos(angle(n, c))| and expect, if he is right, worse error as that goes to zero.

WHAT IS SCORED. The app's far field on the band against the truth kit's first ever-visible hidden layer, both in
the app's normalised d, exactly as check_app_band.py does it -- same masks, same conversion, so the numbers are
commensurable with every band score this project has reported. Sky-reveal texels have no finite truth depth and
are excluded.

TWO DEFECTS IN THE FIRST VERSION OF THIS SCRIPT, FOUND BEFORE ANY NUMBER WAS REPORTED, AND WHY THEY MATTER.
(1) It reported the MEDIAN error per bin. The band error is BIMODAL: on S10, 60-75% of scorable texels have truth
    at the back wall (d = 0, the far end of the normalised law) and our fill puts them there too, so their error
    is ~0; the rest sit at ~0.2-0.3. A median then reports only which mode a bin happens to be majority in. It
    produced a flat 1.00x on the conditional test AND a dramatic-looking monotone trend on the angle test, and
    both were artefacts of mode membership. Replaced by BAD-PIXEL RATES at fixed thresholds -- the stereo
    literature's own convention (bad@0.5, bad@1, bad@2 px), chosen there for exactly this reason -- plus the mean.
(2) It computed the truth's gradient with missing truth replaced by 0, so every texel beside a hole in the truth
    got a huge spurious gradient whose DIRECTION came from the validity boundary rather than the scene. That is
    the unnormalised-boundary defect Bornemann S5 describes and that return_align.py was fixed for the same day
    (S56 Part II). The gradient is now taken only where the full central-difference stencil is valid.
The lesson is recorded here rather than silently corrected because it is the SAME lesson twice in one afternoon.

  python3 medial_axis.py                    # every scene with truth and a current-law probe
  python3 medial_axis.py S10_16plane_c      # one
"""
import sys, os, json
import numpy as np
from scipy import ndimage
from tk import app_norm_depth

HERE = os.path.dirname(os.path.abspath(__file__))
BAD = 0.02      # a texel is 'bad' if |err| > 2% of the normalised depth range (stereo's bad@t convention)
PROBE = os.path.join(HERE, '..', 'shots', 'a257probe')

# (probe directory, truth scene) for every kit scene that has both
PAIRS = [('S2_16plane', 'S2'), ('S5_16plane_c', 'S5'), ('S7_16plane_c', 'S7'), ('S9_16plane_c', 'S9'),
         ('S10_16plane_c', 'S10'), ('S11_16plane_c', 'S11'), ('S12_16plane', 'S12'), ('S16_16plane', 'S16'),
         ('S26_16plane', 'S26'), ('S27_16plane', 'S27'), ('S31_16plane', 'S31')]


def load(probe_dir, scene):
    """The band, the app's far field, and the truth depth on it -- in the app's normalised d."""
    p = os.path.join(PROBE, probe_dir)
    meta = json.load(open(os.path.join(p, 'meta.json')))
    pw, ph = meta['pw'], meta['ph']
    dis = np.fromfile(os.path.join(p, 'disocc.u8'), np.uint8).reshape(ph, pw) > 0
    ff = np.fromfile(os.path.join(p, 'farField.f32'), np.float32).reshape(ph, pw).astype(np.float64)
    gt = np.load(os.path.join(HERE, 'out', scene + '_env45', 'scope_gt.npz'))
    cls, w, dep = gt['cls'], gt['w_disp'].astype(np.float32), gt['depth']
    H, W, _ = cls.shape
    y0, x0 = (H - ph) // 2, (W - pw) // 2
    cls_c, w_c, dep_c = cls[y0:y0 + ph, x0:x0 + pw], w[y0:y0 + ph, x0:x0 + pw], dep[y0:y0 + ph, x0:x0 + pw]
    vis_hidden = (cls_c >= 2) & (cls_c <= 5) & (w_c > 0)
    kk = np.argmax(vis_hidden, axis=-1)
    d_true_m = np.take_along_axis(dep_c, kk[..., None], axis=-1)[..., 0]     # metres
    has = vis_hidden.any(axis=-1)
    dT = np.where(np.isfinite(d_true_m), app_norm_depth(-d_true_m, meta['pn'], meta['outer'], meta['inner']), np.nan)
    m = dis & has & np.isfinite(dT)      # the scorable band, same mask as check_app_band
    return dis, ff, dT, m, meta


def geometry(band):
    """T = distance to the rim; skel = how far apart neighbouring texels' nearest rim points are; n = grad(T)."""
    T, idx = ndimage.distance_transform_edt(band, return_indices=True)
    iy, ix = idx[0].astype(np.int32), idx[1].astype(np.int32)
    skel = np.zeros_like(T)
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        sy, sx = np.roll(iy, (dy, dx), (0, 1)), np.roll(ix, (dy, dx), (0, 1))
        skel = np.maximum(skel, np.hypot(iy - sy, ix - sx))
    gy, gx = np.gradient(T)
    return T, skel, gx, gy


def isophote_cos(dT, gx, gy, m):
    """|cos| of the angle between n = grad(T) and c = grad-perp(d_true), Bornemann's theta.
    1 = the structure runs ACROSS the band (his good case); 0 = along it (his failure case)."""
    fin = np.isfinite(dT)
    d = np.where(fin, dT, 0.0)
    ty, tx = np.gradient(d)
    # only where the whole central-difference stencil is valid truth (see defect (2) in the docstring)
    st = fin.copy()
    st[1:, :] &= fin[:-1, :]; st[:-1, :] &= fin[1:, :]; st[:, 1:] &= fin[:, :-1]; st[:, :-1] &= fin[:, 1:]
    cx, cy = -ty, tx                                  # grad-perp
    nn = np.hypot(gx, gy); cc = np.hypot(cx, cy)
    ok = m & st & (nn > 1e-9) & (cc > 1e-6)
    out = np.full(dT.shape, np.nan)
    out[ok] = np.abs((gx[ok] * cx[ok] + gy[ok] * cy[ok]) / (nn[ok] * cc[ok]))
    return out


def conditional(err, T, skel, lo_hi=(0.5, 1.5), tbins=(1, 2, 3, 5, 8, 13, 21)):
    """AT FIXED T, low-skel against high-skel. This is the confound-controlled comparison."""
    rows = []
    for a, b in zip(tbins[:-1], tbins[1:]):
        sel = (T >= a) & (T < b)
        if sel.sum() < 200:
            continue
        lo = sel & (skel <= lo_hi[0])
        hi = sel & (skel >= lo_hi[1])
        if lo.sum() < 50 or hi.sum() < 50:
            continue
        rows.append((a, b, int(sel.sum()), int(lo.sum()), int(hi.sum()),
                     float((err[lo] > BAD).mean()), float((err[hi] > BAD).mean()),
                     float(err[lo].mean()), float(err[hi].mean())))
    return rows


def main(only=None):
    allrows, ang_all, marg_all = [], [], []
    for probe_dir, scene in PAIRS:
        if only and probe_dir != only:
            continue
        if not os.path.exists(os.path.join(PROBE, probe_dir, 'farField.f32')):
            continue
        dis, ff, dT, m, meta = load(probe_dir, scene)
        if m.sum() < 500:
            print('%-16s too few scorable band texels (%d)' % (probe_dir, m.sum())); continue
        T, skel, gx, gy = geometry(dis)
        err = np.abs(ff - dT)
        print('\n=== %s   band %d px, scorable %d, T max %.1f' % (probe_dir, dis.sum(), m.sum(), T[dis].max()))

        # --- the marginal, which is the CONFOUNDED view, printed so the confound is visible ---
        print('  marginal BAD RATE by distance from the rim (confounded: reach and ridge-ness move together)')
        line = '   T '
        vals = '   e '
        for a, b in ((1, 2), (2, 3), (3, 5), (5, 8), (8, 13), (13, 21)):
            sel = m & (T >= a) & (T < b)
            if sel.sum() < 100:
                continue
            line += '%9s' % ('[%d,%d)' % (a, b)); vals += '%9.3f' % (err[sel] > BAD).mean()
        print(line); print(vals)

        # --- the conditional, which is the test ---
        rows = conditional(err[m], T[m], skel[m])
        if rows:
            print('  AT FIXED T: bad rate and mean |err|, basin (skel<=0.5) vs ridge (skel>=1.5)')
            print('     T-bin      n     n_lo     n_hi   bad_lo   bad_hi   mean_lo  mean_hi')
            for a, b, n, nl, nh, bl, bh, ml, mh in rows:
                print('     [%2d,%2d) %6d %8d %8d %8.3f %8.3f %9.4f %8.4f' % (a, b, n, nl, nh, bl, bh, ml, mh))
                allrows.append((probe_dir, a, b, nl, nh, bl, bh, ml, mh))
        else:
            print('  AT FIXED T: no bin had enough of both classes (band too thin or too uniform)')

        # --- Bornemann's angle ---
        ca = isophote_cos(dT, gx, gy, m)
        ok = m & np.isfinite(ca)
        if ok.sum() > 500:
            print('  by |cos(n, isophote)|  -- 1 = structure runs ACROSS the band, 0 = along it (his failure case)')
            hdr = '   |cos|'; val = '   e    '
            for a, b in ((0.0, 0.2), (0.2, 0.4), (0.4, 0.6), (0.6, 0.8), (0.8, 1.01)):
                sel = ok & (ca >= a) & (ca < b)
                if sel.sum() < 100:
                    continue
                hdr += '%10s' % ('[%.1f,%.1f)' % (a, b)); val += '%10.3f' % (err[sel] > BAD).mean()
                ang_all.append((probe_dir, a, b, int(sel.sum()), float((err[sel] > BAD).mean())))
            print(hdr); print(val)

    if allrows:
        d = np.array([x[6] - x[5] for x in allrows])            # ridge bad rate minus basin bad rate, same T
        w = np.array([min(x[3], x[4]) for x in allrows], float)   # weight each cell by its smaller class
        print('\n' + '=' * 78)
        print('POOLED, the conditional test: %d (scene, T-bin) cells, bad = |err| > %.2f' % (len(allrows), BAD))
        print('  ridge minus basin bad rate at fixed T: weighted mean %+.3f   median %+.3f   range [%+.3f, %+.3f]'
              % ((d * w).sum() / w.sum(), np.median(d), d.min(), d.max()))
        print('  cells where the ridge is worse: %d of %d' % ((d > 0.005).sum(), len(d)))
        print('  cells where the ridge is better: %d of %d' % ((d < -0.005).sum(), len(d)))
    if ang_all:
        print('\nPOOLED, Bornemann angle: bad rate by |cos| bin, median across scenes')
        for a, b in ((0.0, 0.2), (0.2, 0.4), (0.4, 0.6), (0.6, 0.8), (0.8, 1.01)):
            v = [x[4] for x in ang_all if x[1] == a]
            if v:
                print('  [%.1f,%.1f)  n_cells %2d   median of medians %.4f' % (a, b, len(v), np.median(v)))


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else None)
