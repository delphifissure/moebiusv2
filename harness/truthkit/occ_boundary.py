#!/usr/bin/env python3
"""S53 — OCCLUSION-BOUNDARY DETECTION, ON THE FIELD'S OWN METRIC, AGAINST THE FIELD'S OWN PRACTICE.

Infinigen Indoors S4.3/Tab.4 treats occlusion-boundary estimation as a named task with the BSDS protocol (ODS,
OIS, mAP) and reports how hard it is: the best ODS across their table is 0.29. S33's "visible wall length" and
bend classes are a home-grown version of the same measurement, with no number anyone outside this project can read.

And their G.2 says how the field builds the ground truth when it has none:

    "Due to the absence of ground truth occlusion boundaries in Hypersim (or any other photorealistic dataset), we
     approximate them by thresholding the gradient of the provided depth maps. WE CAREFULLY TUNED THIS THRESHOLD
     on Hypersim to give the best results."

That is exactly S33's construction -- a bend is adjacent samples differing by more than a threshold -- and the
published practice HAND-TUNES the threshold. S48's reveal field instead derives the quantity from the viewing
envelope: two depths matter exactly as much as the screen-pixel gap they open at the rim, and nothing is tuned.

THE ANSWER, UP FRONT, BECAUSE IT IS NEGATIVE. On 30 kit scenes the two rankings are indistinguishable: ODS 0.833
for the reveal field against 0.835 for the raw depth gradient, per-scene mean F 0.887 each, and the reveal field
wins on only 12 of 30. **R8's claim that "on this narrow point our instrument is better than the published
practice" is NOT SUPPORTED.** What survives is narrower and should be stated as such: the reveal field gives a
threshold that needs no tuning and is in units the artefact appears in, which is a practical advantage and not a
detection-accuracy one. This script sweeps the threshold for BOTH, so it scores ranking quality alone.

And the absolute numbers here are NOT comparable to Infinigen's 0.29. They detect occlusion boundaries from RGB
with a network; we threshold a depth map whose truth comes from the same geometry. Ours is a far easier task and
the high F values say nothing about the published one.

THE QUESTION, POSED SO IT IS SCALE-FREE. Whether our absolute threshold is right is a separate matter; the claim
worth testing is that the REVEAL TRANSFORM IS A BETTER DETECTOR THAN THE RAW DEPTH GRADIENT, at every operating
point. So both are scored as rankings -- precision/recall swept over all thresholds, best F reported (ODS) -- and
the winner is the one whose curve dominates. Only the RATIO exH/exV enters the reveal ranking (a global scale
cancels), and that ratio is fixed by the envelope's half-angles (45 deg horizontal, 30 deg vertical), so no
per-scene constant is guessed.

GROUND TRUTH, from the kit's multi-hit ray-caster: an edge between two adjacent pixels is an occlusion boundary
when their visible surfaces belong to different primitives AND something is hidden behind one of them -- i.e. a
real depth discontinuity, not a texture edge and not two parts of one surface.

  python3 occ_boundary.py [S10 S11 ...]
"""
import sys, os, json
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tk import app_z_of_d
from ordinal_pairs import load_probe

SCENES = '/tmp/claude-0/-home-user-moebius/989b3965-28fd-58c7-96b5-b4b22c709919/scratchpad/i2/scenes.txt'
TAN45, TAN30 = np.tan(np.radians(45.0)), np.tan(np.radians(30.0))


def s_of_d(d, meta):
    """The reveal law's screen term: Z/(D+Z) with Z the distance behind the window."""
    Z = -app_z_of_d(np.clip(d, 0, 1), meta['pn'], meta['outer'], meta['inner'])
    return Z / (meta['D'] + Z)


def edge_lists(scene, probe):
    gt = np.load('out/%s_env45/scope_gt.npz' % scene)
    meta, arr = load_probe(probe)
    pw, ph = meta['pw'], meta['ph']
    dQ = arr['dQ']
    if dQ is None:
        return None
    pid, dep, val = gt['pid'], gt['depth'], gt['valid']
    H, W, K = pid.shape
    y0, x0 = (H - ph) // 2, (W - pw) // 2
    pid0 = pid[y0:y0+ph, x0:x0+pw, 0]
    z0 = dep[y0:y0+ph, x0:x0+pw, 0]
    has_hidden = val[y0:y0+ph, x0:x0+pw, 1] if K > 1 else np.zeros((ph, pw), bool)

    sv = s_of_d(dQ.astype(np.float64), meta)
    out = {'truth': [], 'reveal': [], 'grad': []}
    for ax, scale in ((1, TAN45), (0, TAN30)):          # horizontal edges use exH, vertical use exV
        a = slice(None), slice(0, -1)
        b = slice(None), slice(1, None)
        if ax == 0:
            a = slice(0, -1), slice(None)
            b = slice(1, None), slice(None)
        # truth: different primitive AND a real step AND something hidden behind one of them
        diff_obj = pid0[a] != pid0[b]
        step = np.abs(z0[a] - z0[b]) > 0.02 * np.nanmax(z0[np.isfinite(z0)])
        occl = has_hidden[a] | has_hidden[b]
        t = diff_obj & step & occl & np.isfinite(z0[a]) & np.isfinite(z0[b])
        out['truth'].append(t.ravel())
        out['reveal'].append((np.abs(sv[a] - sv[b]) * scale).ravel())
        out['grad'].append(np.abs(dQ[a].astype(np.float64) - dQ[b].astype(np.float64)).ravel())
    return {k: np.concatenate(v) for k, v in out.items()}


def best_f(score, truth, n=400):
    """Sweep one global threshold; return best F, and the precision/recall there."""
    pos = truth.sum()
    if pos == 0:
        return None
    qs = np.unique(np.quantile(score, np.linspace(0.90, 0.99999, n)))
    bf, bp, br, bt = 0.0, 0.0, 0.0, 0.0
    for t in qs:
        pred = score > t
        tp = float((pred & truth).sum())
        if tp == 0:
            continue
        p, r = tp / pred.sum(), tp / pos
        f = 2 * p * r / (p + r)
        if f > bf:
            bf, bp, br, bt = f, p, r, t
    return {'F': bf, 'P': bp, 'R': br, 'thr': float(bt)}


def main(want):
    pairs = [l.split() for l in open(SCENES) if l.strip()]
    if want:
        pairs = [p for p in pairs if p[0] in want]
    allt, allr, allg = [], [], []
    print('%-6s %10s   %-24s %-24s' % ('scene', 'edges+', 'reveal, best F', 'depth gradient, best F'))
    rows = []
    for S, P in pairs:
        try:
            e = edge_lists(S, P)
        except Exception as ex:
            print('%-6s FAILED %s %s' % (S, type(ex).__name__, str(ex)[:50])); continue
        if e is None or e['truth'].sum() < 200:
            continue
        fr, fg = best_f(e['reveal'], e['truth']), best_f(e['grad'], e['truth'])
        if not fr or not fg:
            continue
        rows.append((S, fr, fg))
        allt.append(e['truth']); allr.append(e['reveal']); allg.append(e['grad'])
        print('%-6s %10d   F %.3f (P %.2f R %.2f)   F %.3f (P %.2f R %.2f)'
              % (S, e['truth'].sum(), fr['F'], fr['P'], fr['R'], fg['F'], fg['P'], fg['R']))
    if not rows:
        return
    t = np.concatenate(allt); r = np.concatenate(allr); g = np.concatenate(allg)
    ODSr, ODSg = best_f(r, t), best_f(g, t)
    print('\nODS (one global threshold over the whole set, the BSDS protocol Infinigen reports):')
    print('  reveal ranking          F %.3f  (P %.2f R %.2f)' % (ODSr['F'], ODSr['P'], ODSr['R']))
    print('  depth-gradient ranking  F %.3f  (P %.2f R %.2f)' % (ODSg['F'], ODSg['P'], ODSg['R']))
    print('  BOTH COLUMNS ARE BEST-F, i.e. both thresholds are tuned. This measures RANKING QUALITY only; the')
    print('  reveal field\'s separate claim -- that its threshold needs no tuning -- is not what is scored here.')
    print('  per-scene (OIS-style) mean F: reveal %.3f, gradient %.3f'
          % (np.mean([x[1]['F'] for x in rows]), np.mean([x[2]['F'] for x in rows])))
    print('  reveal wins on %d of %d scenes' % (sum(1 for x in rows if x[1]['F'] > x[2]['F']), len(rows)))
    print('\n  for scale, Infinigen Indoors Tab.4 reports ODS 0.1438 / 0.2602 / 0.2947 on three datasets, so')
    print('  occlusion-boundary detection is hard in absolute terms and these numbers are not comparable across')
    print('  datasets -- only the two columns here are comparable to each other.')


if __name__ == '__main__':
    main(sys.argv[1:])
