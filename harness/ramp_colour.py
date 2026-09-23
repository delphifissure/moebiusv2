"""The colour-guided ramp collapse (S61 section 6's candidate), offline, tested on the truth kit first.

The 1-D depth-only ramp test cannot tell an estimator's blur from real geometry (S61 section 6). The image can: an
estimator's ramp sits where the colour has ONE sharp edge but the depth spreads over several texels, and it spreads on
BOTH sides of that edge (a blur is centred on what it blurs). Real geometry beside a cliff -- exact S31's two texels of
grazing surface next to a 104-step cliff -- deviates on ONE side only, and a real slope with no colour edge has none.

THE TEST, per row and per column, no new constant:
  1. candidate: a maximal run of same-sign steep edges (|dDisp| > tolAt, the rim law's tolerance at one visible step
     1/k) with a flat edge on both ends;
  2. the colour edge: the run edge with the largest colour change |dRGB|; it counts only if it exceeds the colour
     change on both flank edges (relative, not a threshold), and it must be the ONLY such edge in the run (every other
     run edge changes colour no more than the flanks do): an estimator blurs one boundary, real faceted geometry shows
     several (exact S2); otherwise leave the run alone;
  3. intermediate texels: interior texels strictly between the two flanks' affine extrapolations to them;
  4. the blur signature: intermediate texels on BOTH sides of the colour edge; one-sided -> real geometry, left alone;
  5. the collapse: every intermediate texel takes its own side's flank extrapolation (the colour edge becomes the
     one-texel cliff).
  Rows and columns on the input; a texel collapsed both ways takes the steeper direction (larger |pA - pB| / L).

  python3 ramp_colour.py kit          (blur rungs vs exact truth; exact16 must come through untouched)
  python3 ramp_colour.py pictures     (the four A/B dumps with their colour.png: texels changed, ramp width)
"""
import sys, os, json
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ramp_width import widths
from ramp_collapse import law, visible_step, load16

def collapse_colour(d, rgb, outer, inner, pn, D, step):
    disp, inv = law(outer, inner, pn, D)
    Dsp = disp(d); tol = np.abs(disp(np.minimum(1, d + step)) - disp(np.maximum(0, d - step))) + 1e-12
    best = np.full(d.shape, -1.0); newD = Dsp.copy(); stats = {'candidates': 0, 'noColourEdge': 0, 'oneSided': 0, 'collapsed': 0}
    for axis in (0, 1):
        Dl = Dsp if axis == 1 else Dsp.T; Tl = tol if axis == 1 else tol.T
        Cl = rgb if axis == 1 else rgb.transpose(1, 0, 2)
        nb = newD if axis == 1 else newD.T; bs = best if axis == 1 else best.T
        dD = Dl[:, 1:] - Dl[:, :-1]; tE = np.maximum(Tl[:, 1:], Tl[:, :-1])
        sgn = np.sign(dD) * (np.abs(dD) > tE); flat = np.abs(dD) <= tE
        dC = np.sqrt(((Cl[:, 1:] - Cl[:, :-1]) ** 2).sum(-1))          # colour change per edge
        for li in range(Dl.shape[0]):
            s = sgn[li]; n = len(s); i = 0
            while i < n:
                if s[i] == 0: i += 1; continue
                j = i
                while j + 1 < n and s[j + 1] == s[i]: j += 1
                a, b = i, j + 1                                   # the run joins texels a..b over edges a..b-1
                if b - a >= 2 and a - 1 >= 0 and b < n and flat[li, a - 1] and flat[li, b]:
                    stats['candidates'] += 1
                    row = Dl[li]; sA = row[a] - row[a - 1]; sB = row[b + 1] - row[b]
                    ce = a + int(np.argmax(dC[li, a:b]))            # the colour edge lies between texels ce and ce+1
                    fl = max(dC[li, a - 1], dC[li, b])            # the local colour texture: the flank edges
                    if not dC[li, ce] > fl:
                        stats['noColourEdge'] += 1; i = j + 1; continue
                    # ONE colour edge: an estimator blurs one boundary; real faceted geometry (exact S2: a dark one-texel
                    # rim, a sloped face, a second face) shows several colour edges inside the run -> left alone
                    others = np.delete(dC[li, a:b], ce - a)
                    if others.size and others.max() > fl:
                        stats['manyColourEdges'] = stats.get('manyColourEdges', 0) + 1; i = j + 1; continue
                    L = b - a; pAm = row[a] + sA * (0.5 * (a + b) - a); pBm = row[b] - sB * (b - 0.5 * (a + b)); steep_ = abs(pAm - pBm) / L
                    inter = []
                    for k in range(a, b + 1):
                        ea = row[a] + sA * (k - a); eb = row[b] - sB * (b - k); lo, hi = min(ea, eb), max(ea, eb)
                        tk = Tl[li, k]
                        if lo + tk < row[k] < hi - tk: inter.append((k, ea, eb))      # strictly between the two surfaces
                    left = [x for x in inter if x[0] <= ce]; right = [x for x in inter if x[0] > ce]
                    if not left or not right: stats['oneSided'] += 1; i = j + 1; continue
                    stats['collapsed'] += 1
                    for k, ea, eb in inter:
                        v = ea if k <= ce else eb
                        if steep_ > bs[li, k]: bs[li, k] = steep_; nb[li, k] = v
                i = j + 1
    out = d.copy(); ch = best >= 0; out[ch] = inv(newD[ch])
    return out, int(ch.sum()), stats

if __name__ == '__main__':
    H = os.path.dirname(os.path.abspath(__file__)); mode = sys.argv[1] if len(sys.argv) > 1 else 'kit'; res = {}
    if mode == 'kit':
        for S in ['S2', 'S27', 'S31', 'S15']:
            G = os.path.join(H, 'truthkit', 'out', S, 'degrade'); P = os.path.join(H, 'shots', 'a257probe', S + '_16plane', 'meta.json')
            m = json.load(open(P)) if os.path.exists(P) else {'outer': 0.128, 'inner': 1e-4, 'pn': 0.5, 'D': 0.2}
            ex = load16(os.path.join(G, 'exact16.png')); ph, pw = ex.shape
            rgb = np.asarray(Image.open(os.path.join(H, 'truthkit', 'out', S, 'rest_rgb.png')).convert('RGB'), np.float64)
            st = visible_step(pw, ph, m['outer'], m['inner'], m['D']); r = {'step': st}
            for rung in ['exact16', 'blur_s1', 'blur_s2', 'blur_s4']:
                d = load16(os.path.join(G, rung + '.png')); c, n, sts = collapse_colour(d, rgb, m['outer'], m['inner'], m['pn'], m['D'], st)
                dep = np.abs(d - ex) > st
                e0 = float(np.abs(d - ex)[dep].mean() / st) if dep.any() else 0.0; e1 = float(np.abs(c - ex)[dep].mean() / st) if dep.any() else 0.0
                worse = int((np.abs(c - ex) > np.abs(d - ex) + st).sum()); better = int((np.abs(c - ex) + st < np.abs(d - ex)).sum())
                w0 = widths(d, st, 10)[0]; w1 = widths(c, st, 10)[0]
                r[rung] = {'changed': n, 'better': better, 'worse': worse, 'errOnDeparted': [round(e0, 2), round(e1, 2)],
                           'medianWidth': [round(float(np.median(w0)), 2), round(float(np.median(w1)), 2)], 'stats': sts}
            res[S] = r
            print(S, ' | '.join('%s ch %d better %d worse %d err %s w %s' % (k, v['changed'], v['better'], v['worse'], v['errOnDeparted'], v['medianWidth']) for k, v in r.items() if k != 'step'), flush=True)
        json.dump(res, open(os.path.join(H, 'shots', 'sheet_ab', 'ramp_colour_kit.json'), 'w'), indent=1)
    else:
        for P, st in [('troll', 1.760e-3), ('vermeer', 1.786e-3), ('sunflowers', 2.679e-3), ('starwatcher', 2.571e-3)]:
            Dd = os.path.join(H, 'shots', 'streakclass', 'ab_' + P); m = json.load(open(os.path.join(Dd, 'meta.json'))); pw, ph = m['pw'], m['ph']
            d = np.fromfile(os.path.join(Dd, 'dQ.f32'), np.float32).reshape(ph, pw).astype(np.float64)
            rgb = np.asarray(Image.open(os.path.join(Dd, 'color.png')).convert('RGB'), np.float64)
            c, n, sts = collapse_colour(d, rgb, m['outer'], m['inner'], m['pn'], m['D'], st)
            w0 = widths(d, st, 10)[0]; w1 = widths(c, st, 10)[0]
            r = {'changed': n, 'changedFrac': round(n / d.size, 4), 'stats': sts, 'medianWidth': [round(float(np.median(w0)), 2), round(float(np.median(w1)), 2)]}
            c.astype(np.float32).tofile(os.path.join(Dd, 'dQ_rampcolour.f32')); res[P] = r; print(P, json.dumps(r), flush=True)
        json.dump(res, open(os.path.join(H, 'shots', 'sheet_ab', 'ramp_colour_pictures.json'), 'w'), indent=1)
