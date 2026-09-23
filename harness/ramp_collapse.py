"""The ramp collapse on the 16-bit path, re-derived (S61 section 2), offline prototype.

WHY. REVIEW's RAMP COLLAPSE (a52-a61b) traced silhouette streaks to 3-10 px transition aprons and collapsed each to a
one-texel cliff ("the streak fields at the figure edge ... are gone"). Two things undid it: its cliff test is
fgTearStep = 0.06 normalised depth, which a107 showed opens a 7 px reveal in one place and 97 px in another within one
image (rule 2); and it lives in the live bake, which reads the depth at 8 bits -- with a 16-bit map the quick bake takes
the raw decode and the collapse never reaches what ships (CODEMAP 8, 10). S59 section 2 met the aprons again: the ring
around every hole is the ramp.

THE TEST (S35 section 38's ramp test, in the rim law's own units; no new constant):
  along each row and column, in disparity 1/ze(d) (the app's depth law), an edge is STEEP when it crosses more than the
  tolerance at its texels (tolAt: the disparity spanned by +-one visible step 1/k, S10); a maximal run of same-sign steep
  edges with a FLAT edge on both ends is a candidate; each flank is extrapolated by its own slope to the run's middle,
  and the run is a RAMP when the two extrapolations disagree by more than L x tolerance (it bridges two surfaces that
  each continue past it). A crease meets in value there and a grazing plane's near part predicts its far part: both
  are left alone.
THE COLLAPSE: every interior texel of a ramp takes the nearer flank's extrapolation to it (the affine form of the
original "binarise to the closer side", so a sloped surface stays sloped), and the ramp becomes a one-texel cliff.
Rows and columns are tested on the input; a texel in a ramp both ways takes the direction whose step is steeper
(larger |predA - predB| / L, the direction across the edge).

  python3 ramp_collapse.py kit            (the kit's blur rungs against exact truth; exact16 must be untouched)
  python3 ramp_collapse.py pictures       (the four A/B dumps: texels changed, ramp width before/after)
"""
import sys, os, json
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ramp_width import widths

TW, TH = 0.16, 0.09     # the app's terrarium (terrariumWidth / terrariumHeight)

def law(outer, inner, pn, D):
    def z_of_d(d):
        d = np.clip(d, 0, 1); s1 = d / pn; s2 = (d - pn) / (1 - pn)
        return np.where(d < pn, -outer + outer * (s1 * s1 * (3 - 2 * s1)), inner * (s2 * s2 * (3 - 2 * s2)))
    disp = lambda d: 1.0 / np.maximum(1e-4, D - z_of_d(d))
    grid = np.linspace(0, 1, 65536); dg = disp(grid)
    inv = lambda v: np.interp(v, dg, grid)          # disp is monotone increasing in d
    return disp, inv

def visible_step(pw, ph, outer, inner, D):
    la, fa = pw / ph, TW / TH
    layerW = TW if la > fa else TH * la
    k = D * max(outer / (D + outer), inner / (D - inner)) * (pw / layerW)   # bgShiftLUTFor at the 45-degree fade end
    return 1.0 / k

def rim_t(pw, ph, D, gmin_deg=2.0):
    la, fa = pw / ph, TW / TH; layerW = TW if la > fa else TH * la
    hfov = 2 * np.arctan((layerW / 2) / D); return 1 + (hfov / pw) / np.tan(np.radians(gmin_deg))   # bgRimLawFor

def joined_lines(ze, Dl, Tl, t):
    # the rim law per edge along each line (bgRimLawFor / sheets.py joined_arr): the eye-distance ratio within t, or the
    # affine prediction from the texel before (or after) lands within the tolerance
    a, b = ze[:, :-1], ze[:, 1:]; ratio = np.maximum(a, b) / np.minimum(a, b) <= t
    da, db = Dl[:, :-1], Dl[:, 1:]; tl = np.maximum(Tl[:, :-1], Tl[:, 1:])
    lin1 = np.zeros_like(ratio); lin1[:, 1:] = np.abs(db[:, 1:] - (2 * da[:, 1:] - Dl[:, :-2])) <= tl[:, 1:]
    lin2 = np.zeros_like(ratio); lin2[:, :-1] = np.abs(da[:, :-1] - (2 * db[:, :-1] - Dl[:, 2:])) <= tl[:, :-1]
    return ratio | lin1 | lin2

def collapse(d, outer, inner, pn, D, step):
    disp, inv = law(outer, inner, pn, D); ph_, pw_ = d.shape; t = rim_t(pw_, ph_, D)
    Dsp = disp(d); tol = np.abs(disp(np.minimum(1, d + step)) - disp(np.maximum(0, d - step))) + 1e-12; ZE = 1.0 / Dsp
    best = np.full(d.shape, -1.0); newD = Dsp.copy(); nRamps = [0, 0]
    for axis in (0, 1):
        Dl = Dsp if axis == 1 else Dsp.T; Tl = tol if axis == 1 else tol.T
        nb = newD if axis == 1 else newD.T; bs = best if axis == 1 else best.T      # views: writes land in newD / best
        Zl = ZE if axis == 1 else ZE.T; J = joined_lines(Zl, Dl, Tl, t)
        dD = Dl[:, 1:] - Dl[:, :-1]; tE = np.maximum(Tl[:, 1:], Tl[:, :-1])
        # S35 section 38: only JOINED steep edges make a ramp (an unjoined edge is a cliff the tear already takes, and it
        # breaks the run: without this a one-texel cliff next to a real two-texel slope read as one 'ramp', exact S31);
        # flanks must be joined and flat
        sgn = np.sign(dD) * ((np.abs(dD) > tE) & J); flat = J & (np.abs(dD) <= tE)
        for li in range(Dl.shape[0]):
            s = sgn[li]; n = len(s); i = 0
            while i < n:
                if s[i] == 0: i += 1; continue
                j = i
                while j + 1 < n and s[j + 1] == s[i]: j += 1
                a, b = i, j + 1                                   # the run joins texels a..b
                if b - a >= 2 and a - 1 >= 0 and b < n and flat[li, a - 1] and flat[li, b]:
                    row = Dl[li]; sA = row[a] - row[a - 1]; sB = row[b + 1] - row[b]; L = b - a; m = 0.5 * (a + b)
                    pA = row[a] + sA * (m - a); pB = row[b] - sB * (b - m)
                    if abs(pA - pB) > L * float(Tl[li, a:b + 1].max()):
                        nRamps[axis] += 1; steep_ = abs(pA - pB) / L
                        for k in range(a + 1, b):
                            ea = row[a] + sA * (k - a); eb = row[b] - sB * (b - k)
                            v = ea if abs(row[k] - ea) <= abs(row[k] - eb) else eb
                            if steep_ > bs[li, k]: bs[li, k] = steep_; nb[li, k] = v
                i = j + 1
    out = d.copy(); ch = best >= 0; out[ch] = inv(newD[ch])
    return out, int(ch.sum()), nRamps

def load16(p):
    a = np.asarray(Image.open(p)).astype(np.float64); return a / (65535.0 if a.max() > 255 else 255.0)

if __name__ == '__main__':
    H = os.path.dirname(os.path.abspath(__file__)); mode = sys.argv[1] if len(sys.argv) > 1 else 'kit'; res = {}
    if mode == 'kit':
        for S in ['S2', 'S27', 'S31', 'S15']:
            G = os.path.join(H, 'truthkit', 'out', S, 'degrade'); P = os.path.join(H, 'shots', 'a257probe', S + '_16plane', 'meta.json')
            if not os.path.exists(G): continue
            m = json.load(open(P)) if os.path.exists(P) else {'outer': 0.128, 'inner': 1e-4, 'pn': 0.5, 'D': 0.2}
            ex = load16(os.path.join(G, 'exact16.png')); ph, pw = ex.shape
            st = visible_step(pw, ph, m['outer'], m['inner'], m['D']); r = {'step': st}
            for rung in ['exact16', 'blur_s1', 'blur_s2', 'blur_s4']:
                d = load16(os.path.join(G, rung + '.png')); c, n, nr = collapse(d, m['outer'], m['inner'], m['pn'], m['D'], st)
                touched = np.abs(d - ex) > st        # where the rung departs from the truth by a visible step
                e0 = np.abs(d - ex)[touched].mean() / st if touched.any() else 0.0; e1 = np.abs(c - ex)[touched].mean() / st if touched.any() else 0.0
                moved_ok = np.abs(c - ex)[~touched] ; worse = int((np.abs(c - ex) > np.abs(d - ex) + st).sum())
                w0 = widths(d, st, 10)[0]; w1 = widths(c, st, 10)[0]
                r[rung] = {'changed': n, 'ramps': nr, 'errOnDeparted_steps': [round(e0, 2), round(e1, 2)], 'texelsMadeWorseByAStep': worse,
                           'medianWidth': [round(float(np.median(w0)), 2) if len(w0) else None, round(float(np.median(w1)), 2) if len(w1) else None]}
            res[S] = r; print(S, json.dumps(r))
        json.dump(res, open(os.path.join(H, 'shots', 'sheet_ab', 'ramp_collapse_kit.json'), 'w'), indent=1)
    else:
        for P, st in [('troll', 1.760e-3), ('vermeer', 1.786e-3), ('sunflowers', 2.679e-3), ('starwatcher', 2.571e-3)]:
            Dd = os.path.join(H, 'shots', 'streakclass', 'ab_' + P); m = json.load(open(os.path.join(Dd, 'meta.json'))); pw, ph = m['pw'], m['ph']
            d = np.fromfile(os.path.join(Dd, 'dQ.f32'), np.float32).reshape(ph, pw).astype(np.float64)
            c, n, nr = collapse(d, m['outer'], m['inner'], m['pn'], m['D'], st)
            w0 = widths(d, st, 10)[0]; w1 = widths(c, st, 10)[0]
            r = {'changed': n, 'changedFrac': round(n / d.size, 4), 'ramps': nr, 'medianWidth': [round(float(np.median(w0)), 2), round(float(np.median(w1)), 2)]}
            c.astype(np.float32).tofile(os.path.join(Dd, 'dQ_rampcollapsed.f32')); res[P] = r; print(P, json.dumps(r))
        json.dump(res, open(os.path.join(H, 'shots', 'sheet_ab', 'ramp_collapse_pictures.json'), 'w'), indent=1)
