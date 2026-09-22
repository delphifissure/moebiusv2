#!/usr/bin/env python3
"""S53 / R8 Tier 1 — SIMPLICITY AS AN OBJECTIVE, AND WHETHER THE PUBLISHED PRIOR HOLDS ON OUR DATA.

WHY THIS MATTERS MORE THAN IT LOOKS. S51's entire cost function was VISIBLE WALL LENGTH -- minimise the perimeter
of disagreement between adjacent texels. Wall length is a perimeter measure with NO published prior saying which
direction is correct; the sprint assumed less wall is better and then could not see the 33.5% it bought.

The amodal survey (Tab.1) and AmodalSynthDrive (Tab.II) supply the missing prior, on five datasets:

    simplicity(S) = sqrt(4 pi Area) / Perimeter        convexity(S) = Area / Area(ConvexHull)      (1 for a circle)

                     modal   amodal
    BSDS              .718     .834
    COCO              .746     .856
    KINS              .709     .830
    KITTI-360-APS     .778     .884
    BDD100K-APS       .697     .821

"amodal segments have simpler shapes than the modal segments ... independent of scene geometry and occlusion
patterns." Universal, parameter-free, and it says WHICH WAY IS UP -- completing a surface should RAISE its
simplicity. That is exactly what wall length lacks.

BUT IT MUST BE CHECKED ON OUR DATA BEFORE IT IS USED AS AN OBJECTIVE, and that is what this does. Their segments
are OBJECTS (a car, a person) whose amodal extent is a compact blob. Ours are BACKGROUND SURFACES revealed behind
things, which is a different kind of region and the prior may simply not transfer. The kit has exact hidden truth,
so the question is answerable rather than arguable:

    does completing the band with TRUTH raise the simplicity of the surfaces, as the prior predicts?

If yes, simplicity is a legitimate objective for a far-field construction and constructions can be ranked by how
close their simplicity gain is to truth's. If no, the prior does not transfer and S51 should NOT be reopened with
it -- which is just as useful an answer and much cheaper than discovering it after building the labelling.

SEGMENTS, ON OUR GRID. A surface is a connected component of texels whose depth varies continuously: adjacent
texels join when |d_i - d_j| < tol. Perimeter is counted as boundary EDGES (4-neighbour), which overestimates a
smooth boundary by roughly the usual staircase factor, so the absolute simplicity numbers here are LOWER than the
papers'. That is fine and is stated: every arm is measured the same way and only the comparison is read.

  python3 simplicity.py                    # all kit scenes with truth
  python3 simplicity.py S10 S11            # named scenes
"""
import sys, os, json
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from ordinal_pairs import load_probe

TOL = 0.01          # in normalised d; the same continuity tolerance the occluder study used
MINAREA = 64        # ignore specks: a component under 64 texels has a perimeter dominated by its own staircase


def components(d, valid, tol=TOL):
    """Connected components of continuous depth, 4-neighbour, iterative (no recursion limit)."""
    H, W = d.shape
    lab = np.full((H, W), -1, np.int32)
    n = 0
    stack = np.empty(H * W, np.int64)
    for s in range(H * W):
        sy, sx = divmod(s, W)
        if lab[sy, sx] >= 0 or not valid[sy, sx]:
            continue
        top = 0; stack[top] = s; top += 1; lab[sy, sx] = n
        while top:
            top -= 1; i = stack[top]; y, x = divmod(int(i), W); dv = d[y, x]
            for yy, xx in ((y-1, x), (y+1, x), (y, x-1), (y, x+1)):
                if 0 <= yy < H and 0 <= xx < W and lab[yy, xx] < 0 and valid[yy, xx] and abs(d[yy, xx] - dv) < tol:
                    lab[yy, xx] = n; stack[top] = yy * W + xx; top += 1
        n += 1
    return lab, n


def shape_stats(lab, n, minarea=MINAREA):
    """Area-weighted mean simplicity and convexity over components above minarea."""
    H, W = lab.shape
    areas = np.bincount(lab.ravel() + 1, minlength=n + 1)[1:]
    # perimeter: 4-neighbour boundary edges, including the image border
    per = np.zeros(n, np.int64)
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        sh = np.roll(np.roll(lab, dy, axis=0), dx, axis=1)
        if dy: sh[-1 if dy < 0 else 0, :] = -2
        if dx: sh[:, -1 if dx < 0 else 0] = -2
        diff = (lab >= 0) & (sh != lab)
        per += np.bincount(lab[diff] + 1, minlength=n + 1)[1:]
    keep = areas >= minarea
    if not keep.any():
        return {'n': 0}
    a, p = areas[keep].astype(np.float64), np.maximum(per[keep], 1).astype(np.float64)
    simp = np.sqrt(4 * np.pi * a) / p
    w = a / a.sum()
    out = {'n': int(keep.sum()), 'px': int(a.sum()),
           'simplicity_w': float((simp * w).sum()), 'simplicity_mean': float(simp.mean()),
           'area_p50': float(np.median(a)), 'largest': float(a.max())}
    # convexity on the biggest few, where a hull is meaningful and affordable
    try:
        from scipy.spatial import ConvexHull
        order = np.argsort(-areas)[:12]
        cvs, ws = [], []
        for c in order:
            if areas[c] < minarea: continue
            ys, xs = np.nonzero(lab == c)
            if len(xs) < 8: continue
            pts = np.stack([xs, ys], 1).astype(np.float64)
            if np.ptp(pts[:, 0]) < 2 or np.ptp(pts[:, 1]) < 2: continue
            try: h = ConvexHull(pts)
            except Exception: continue
            if h.volume > 0: cvs.append(areas[c] / h.volume); ws.append(areas[c])
        if cvs:
            cvs, ws = np.array(cvs), np.array(ws, np.float64)
            out['convexity_w'] = float((cvs * ws / ws.sum()).sum()); out['convexity_n'] = len(cvs)
    except ImportError:
        pass
    return out


def run(scene, probe):
    gt = np.load('out/%s_env45/scope_gt.npz' % scene)
    meta, arr = load_probe(probe)
    pw, ph = meta['pw'], meta['ph']
    dis = arr['dis'] > 0
    obs = arr['dQ']
    if obs is None or arr['ff'] is None:
        return None
    cls, w, dep = gt['cls'], gt['w_disp'].astype(np.float32), gt['depth']
    H, W, K = cls.shape
    y0, x0 = (H - ph) // 2, (W - pw) // 2
    cls_c, w_c, dep_c = cls[y0:y0+ph, x0:x0+pw], w[y0:y0+ph, x0:x0+pw], dep[y0:y0+ph, x0:x0+pw]
    vh = (cls_c >= 2) & (cls_c <= 5) & (w_c > 0)
    hh = vh.any(-1)
    kk = np.argmax(vh, -1)
    zh = np.take_along_axis(dep_c, kk[..., None], -1)[..., 0]
    zv = dep_c[..., 0]
    # everything in the app's own normalised d, so the tolerance means one thing across arms
    lo, hi = np.nanmin(zv), np.nanmax(zv[np.isfinite(zv)])
    nz = lambda z: np.clip((z - lo) / max(hi - lo, 1e-9), 0, 1)
    truth = np.where(dis & hh, nz(zh), nz(zv))

    arms = {
        'MODAL (visible only, band excluded)': (nz(zv), ~dis),
        'amodal: TRUTH': (truth, np.ones_like(dis)),
        'amodal: far field (shipped)': (np.where(dis, arr['ff'], obs), np.ones_like(dis)),
        'amodal: do nothing': (obs.copy(), np.ones_like(dis)),
    }
    res = {}
    for name, (f, valid) in arms.items():
        lab, n = components(np.asarray(f, np.float64), valid.astype(bool))
        res[name] = shape_stats(lab, n)
    return res


def main(scenes):
    pairs = [l.split() for l in open(os.environ.get('SCENES',
             '/tmp/claude-0/-home-user-moebius/989b3965-28fd-58c7-96b5-b4b22c709919/scratchpad/i2/scenes.txt')) if l.strip()]
    if scenes:
        pairs = [p for p in pairs if p[0] in scenes]
    names = ['MODAL (visible only, band excluded)', 'amodal: TRUTH', 'amodal: far field (shipped)', 'amodal: do nothing']
    print('%-6s' % 'scene' + ''.join('%14s' % n.split(':')[-1].strip()[:13] for n in names))
    rows = []
    for S, P in pairs:
        try:
            r = run(S, P)
        except Exception as e:
            print('%-6s FAILED %s %s' % (S, type(e).__name__, str(e)[:60])); continue
        if not r: continue
        rows.append((S, r))
        print('%-6s' % S + ''.join('%14.4f' % r[n].get('simplicity_w', float('nan')) for n in names))
    if not rows:
        return
    print()
    arr = {n: np.array([r[n].get('simplicity_w', np.nan) for _, r in rows]) for n in names}
    print('%-38s %9s %9s' % ('', 'mean', 'median'))
    for n in names:
        print('  %-36s %9.4f %9.4f' % (n, np.nanmean(arr[n]), np.nanmedian(arr[n])))
    mo, tr = arr[names[0]], arr[names[1]]
    up = int((tr > mo).sum()); tot = int(np.isfinite(tr - mo).sum())
    print('\nTHE PRIOR: completing with TRUTH raises simplicity on %d of %d scenes (mean change %+.4f, %+.1f%%)'
          % (up, tot, np.nanmean(tr - mo), 100 * np.nanmean((tr - mo) / mo)))
    print('the papers report modal -> amodal rising on all five of their datasets, e.g. BSDS .718 -> .834 (+16%)')
    for n in names[2:]:
        d = arr[n] - mo
        print('  %-36s change %+.4f (%+.1f%%), and vs truth\'s change: %+.4f'
              % (n, np.nanmean(d), 100 * np.nanmean(d / mo), np.nanmean(arr[n] - tr)))
    json.dump({S: r for S, r in rows}, open(os.environ.get('DUMP', '/tmp/simplicity.json'), 'w'), indent=1)


if __name__ == '__main__':
    main(sys.argv[1:])
