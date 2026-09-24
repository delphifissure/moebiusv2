#!/usr/bin/env python3
"""S64 x S63 experiment 1: video coverage restricted to the app's band over +-90 deg, weighted by seen size.

Per frame (every --every-th): the app's normalised disparity from the frame's true first-hit depth (normalised per frame,
as a per-frame depth model would), reveal90.band90 -> the first angle that reveals each band texel and its weight
cos^2(theta_first). Coverage uses vid_exp.py's masks (same frames): 'known' = texels a thing hides whose background the
truth resolves, 'seen' = that background point is visible, z-tested, in another frame. Band texels on stuff/stuff rims
(a near hill over a far one) are counted separately: vid_exp does not test them (no moving occluder there).

  python3 vid_band90.py [--every 4] [--step 3]
"""
import argparse, json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from reveal90 import band90, RINGS

ap = argparse.ArgumentParser()
ap.add_argument('--root', default='/home/user/moebiusv2/harness/truthkit/out/video')
ap.add_argument('--exp', default='/home/user/moebiusv2/harness/truthkit/out/video_exp')
ap.add_argument('--every', type=int, default=4); ap.add_argument('--step', type=float, default=3.0)
ap.add_argument('--shots', default='walker_tripod,walker_handheld,crowd_pan,runner_blur,truck_trunks,push_in,pan,rack_focus,bokeh')
A = ap.parse_args()
out = {}
for s in A.shots.split(','):
    M = np.load(os.path.join(A.exp, s, 'masks.npz')); K, S = M['known'], M['seen']
    F = len(K); acc = {r: [0.0, 0.0, 0, 0] for r in range(len(RINGS))}   # weighted seen, weighted total, px, stuff px
    tot = [0.0, 0.0]
    for i in range(0, F, A.every):
        z = np.load(os.path.join(A.root, s, 'truth_%03d.npz' % i))['depth'][..., 0].astype(np.float32)
        inv = 1.0 / z; dn = (inv - inv.min()) / max(1e-12, inv.max() - inv.min())
        r = band90(dn, step=A.step)
        th, w = r['first_theta'], r['weight']
        for k, (a, b) in enumerate(RINGS):
            m = (th > a) & (th <= b)
            mk = m & K[i]
            acc[k][0] += float(w[mk & S[i]].sum()); acc[k][1] += float(w[mk].sum())
            acc[k][2] += int(mk.sum()); acc[k][3] += int((m & ~K[i]).sum())
        mk = np.isfinite(th) & K[i]
        tot[0] += float(w[mk & S[i]].sum()); tot[1] += float(w[mk].sum())
    out[s] = {'seenWeighted': tot[0] / max(tot[1], 1e-9),
              'rings': [{'deg': list(RINGS[k]), 'seenWeighted': acc[k][0] / acc[k][1] if acc[k][1] else None,
                         'thingPx': acc[k][2], 'stuffPx': acc[k][3]} for k in range(len(RINGS))]}
    print(s.ljust(16), 'band seen (weighted) %5.1f%%' % (100 * out[s]['seenWeighted']), ' | ',
          '  '.join(('%d-%d: %s (%dk/%dk)' % (g['deg'][0], g['deg'][1], ('%5.1f%%' % (100 * g['seenWeighted'])) if g['seenWeighted'] is not None else '   - ',
                     g['thingPx'] // 1000, g['stuffPx'] // 1000)) for g in out[s]['rings']), flush=True)
json.dump(out, open(os.path.join(A.exp, 'band90_coverage.json'), 'w'), indent=1)
