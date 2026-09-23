"""S51's cross-line labelling, solved EXACTLY by one s-t min-cut.

WHY THIS EXISTS. S51 minimised its labelling energy with ICM (red-black, greedy, one texel at a time) and got a 33 %
artefact reduction against an oracle bound of 80.7 %. Its restarts did not agree (law seed 438 955, all-row 440 523,
all-column 507 839, random 458-464 k), which is the signature of a weak search, not of a found minimum -- Szeliski et
al. (ECCV 2006) and Boykov, Veksler & Zabih (PAMI 2001) both single out standard-move methods like ICM as far from the
optimum. So "the energy does not say what we want" and "ICM did not find the energy's minimum" could not be told
apart. This settles it.

WHY ONE CUT IS EXACT. Every free texel has two candidates (row axis, column axis). Order each texel's two labels by
their screen position s (label x=0 is the smaller s). The pairwise term is k * |s_i - s_j|, a convex function of the
difference, so with both variables ordered it satisfies E(0,0)+E(1,1) <= E(0,1)+E(1,0): the binary energy is
submodular, and a single min-cut gives the GLOBAL minimum (Greig, Porteous & Seheult 1989; Kolmogorov & Zabih 2004).
Texels with one candidate are fixed and enter as unary terms on their free neighbours. The submodularity is asserted
per pair below, not assumed.

THE ENERGY IS S51's, NOT A RE-DERIVATION. s51_label.js with DUMP=1 writes the exact quantities its own energy() uses:
s(d) = Z/(D+Z) for both candidates, the half-angle factors sH/sV, the data costs in screen px, the pair lists and
S33's classes on the original choice. Guards: the energy of ICM's labelling computed here must equal the JS energy;
the cut's value plus its constant must equal the energy of the labelling it returns; the cut must not be worse than
ICM or the law.

RESULT (troll, 2026-09-23, research/S58): ICM stopped 23.9 % above the true minimum (437 677 vs 353 333 px of
wall). At the exact optimum the artefact wall falls 52.0 % (class 3 -79.7 %, class 1 only -8.4 %) and REAL steps fall
21.3 %. The solver was a limit; the energy, minimised properly, still erodes real steps and cannot reach class 1.

  DUMP=1 RESTARTS=5 node harness/s51_label.js     # bake, ICM, and the energy dump
  python3 harness/s51_mincut.py [shots/s51_label/troll]   # needs PyMaxflow
"""
import sys, os, json, base64
import numpy as np
import maxflow

D = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), 'shots', 's51_label', 'troll')
dump = json.load(open(os.path.join(D, 'energy_dump.json')))
lab = json.load(open(os.path.join(D, 'label.json')))
f64 = lambda k: np.frombuffer(base64.b64decode(dump[k]), dtype='<f8')
u8 = lambda k: np.frombuffer(base64.b64decode(dump[k]), dtype=np.uint8)
i32 = lambda k: np.frombuffer(base64.b64decode(dump[k]), dtype='<i4')
pw, ph = lab['pw'], lab['ph']; N = pw * ph
sH, sV, VIS = dump['sH'], dump['sV'], dump['VISIBLE']
band, free = u8('band').astype(bool), u8('free').astype(bool)
S = np.stack([f64('s0'), f64('s1')], 1)          # screen position per texel per label (label 0 = row, 1 = column)
DATA = np.stack([f64('d0'), f64('d1')], 1)
lawL, icmL = u8('lawL'), u8('icmL')
pv, phz, cv, ch = i32('pv'), i32('ph'), u8('cv'), u8('ch')
ffS = f64('ffS')
assert len(S) == N and len(pv) == lab['pairsV'] and len(phz) == lab['pairsH']
# pairs: (i, j, k, class)
PI = np.concatenate([pv, phz]); PJ = np.concatenate([pv + pw, phz + 1])
PK = np.concatenate([np.full(len(pv), sV), np.full(len(phz), sH)]); PC = np.concatenate([cv, ch])

def svals(L):
    return S[np.arange(N), L.astype(np.int64)]

def wall_pairs(sv):
    return PK * np.abs(sv[PI] - sv[PJ])

def energy(L):
    return float(wall_pairs(svals(L)).sum())

def data_of(L):
    return float(DATA[np.arange(N), L.astype(np.int64)][free].sum())

def score(sv):
    w = wall_pairs(sv); vis = w > VIS
    return {'total': float(w.sum()), 'visible': int(vis.sum()),
            'wall': [float(w[vis & (PC == c)].sum()) for c in range(5)],
            'count': [int((vis & (PC == c)).sum()) for c in range(5)]}

# ---- guard 1: the JS and Python energies agree on the same labellings ----
js_best = min(r['energy'] for r in lab['seedLog'])
e_icm, e_law = energy(icmL), energy(lawL)
seed_law_js = next(r['energy'] for r in lab['seedLog'] if r['seed'] == 'law')
print('plate %dx%d, band %d, free %d, pairs %d' % (pw, ph, band.sum(), free.sum(), len(PI)))
print('guard: ICM best energy  JS %d   here %.1f' % (js_best, e_icm))
assert abs(e_icm - js_best) <= 1.0, 'energy definitions disagree -- do not read anything below'
before = score(ffS)
assert abs(score(svals(lawL))['total'] - before['total']) < 1e-3 * max(before['total'], 1), 'law labelling does not reconstruct ff'

# ---- the cut ----
# order each free texel's labels by s: x = 0 is the smaller s. lo[i] = original label that x=0 means.
lo = np.where(S[:, 0] <= S[:, 1], 0, 1).astype(np.uint8)
Sx = np.stack([S[np.arange(N), lo], S[np.arange(N), 1 - lo]], 1)          # Sx[i, x]
Dx = np.stack([DATA[np.arange(N), lo], DATA[np.arange(N), 1 - lo]], 1)

def solve(lam, eps_data):
    """minimise  lam*sum(wall) + eps_data*sum(data)  exactly. Returns original-label array and the cut's energy."""
    ids = -np.ones(N, dtype=np.int64); fi = np.flatnonzero(free); ids[fi] = np.arange(len(fi))
    g = maxflow.Graph[float](len(fi), 3 * len(PI)); g.add_nodes(len(fi))
    const = 0.0
    un1 = np.zeros(len(fi))            # cost added if x=1, relative to x=0
    # data
    const += eps_data * Dx[fi, 0].sum(); un1 += eps_data * (Dx[fi, 1] - Dx[fi, 0])
    worst = 0.0
    fa, fb = free[PI], free[PJ]
    # both fixed: constant
    m = ~fa & ~fb
    const += lam * (PK[m] * np.abs(S[PI[m], 0] - S[PJ[m], 0])).sum()
    # one free: unary on the free one
    for a_free, A, B in ((True, PI, PJ), (False, PJ, PI)):
        m = (fa & ~fb) if a_free else (~fa & fb)
        a, b, k = A[m], B[m], PK[m]
        c0 = lam * k * np.abs(Sx[a, 0] - S[b, 0]); c1 = lam * k * np.abs(Sx[a, 1] - S[b, 0])
        const += c0.sum(); np.add.at(un1, ids[a], c1 - c0)
    # both free: the submodular pairwise term
    m = fa & fb; a, b, k = PI[m], PJ[m], PK[m]
    E00 = lam * k * np.abs(Sx[a, 0] - Sx[b, 0]); E01 = lam * k * np.abs(Sx[a, 0] - Sx[b, 1])
    E10 = lam * k * np.abs(Sx[a, 1] - Sx[b, 0]); E11 = lam * k * np.abs(Sx[a, 1] - Sx[b, 1])
    w = E01 + E10 - E00 - E11
    worst = float(w.min()) if len(w) else 0.0
    assert worst >= -1e-9 * max(1.0, float(np.abs(E01).max())), 'NOT submodular (min %.3g) -- the cut would not be exact' % worst
    w = np.maximum(w, 0.0)
    const += E00.sum(); np.add.at(un1, ids[a], E10 - E00); np.add.at(un1, ids[b], E11 - E10)
    for ia, ib, ww in zip(ids[a], ids[b], w):
        if ww > 0: g.add_edge(int(ia), int(ib), float(ww), 0.0)   # paid when x_a = 0 and x_b = 1
    # unary: x=1 is the sink segment; add_tedge(i, cap_source, cap_sink) pays cap_source if x=1, cap_sink if x=0
    pos = np.maximum(un1, 0.0); neg = np.maximum(-un1, 0.0); const -= neg.sum()
    for i in range(len(fi)):
        if pos[i] > 0 or neg[i] > 0: g.add_tedge(i, float(pos[i]), float(neg[i]))
    flow = g.maxflow()
    x = np.array([g.get_segment(i) for i in range(len(fi))], dtype=np.uint8)
    L = np.zeros(N, dtype=np.uint8); L[fi] = np.where(x == 0, lo[fi], 1 - lo[fi])
    return L, flow + const, worst

out = {'before': before, 'icm': {'energy': e_icm, 'score': score(svals(icmL))}, 'law_energy': e_law, 'arms': {}}
for name, lam, eps in (('wall only (lambda = inf)', 1.0, 1e-6), ('lambda = 1', 1.0, 1.0), ('lambda = 0.25', 0.25, 1.0)):
    L, cutE, worst = solve(lam, eps)
    e = energy(L); tot = lam * e + eps * data_of(L)
    # guard 2: the cut's value is the energy of the labelling it returns
    assert abs(cutE - tot) <= 1e-6 * max(abs(tot), 1) + 1e-3, 'cut value %.3f != energy %.3f' % (cutE, tot)
    # guard 3: global optimum cannot lose to ICM or to the law on the same objective
    for ref_name, ref in (('ICM', icmL), ('law', lawL)):
        rt = lam * energy(ref) + eps * data_of(ref)
        assert tot <= rt + 1e-6 * max(rt, 1), 'cut (%.1f) worse than %s (%.1f) -- solver or construction is wrong' % (tot, ref_name, rt)
    sc = score(svals(L))
    out['arms'][name] = {'wall_energy': e, 'objective': tot, 'relabelled_vs_law': int(((L != lawL) & free).sum()),
                         'score': sc, 'min_submodular_margin': worst}
    np.save(os.path.join(D, 'mincut_labels_%s.npy' % name.split()[0 if 'wall' in name else 2].replace('.', 'p')), L)

def show(nm, o):
    print('  %-26s visible %7d  class1 %9.0f  class2 %9.0f  class3 %9.0f   total %9.0f' %
          (nm, o['visible'], o['wall'][1], o['wall'][2], o['wall'][3], o['total']))

print('\nVISIBLE WALL IN SCREEN PX AT THE RIM, by S33 class (partition from the original choice)')
show('before (the law)', before)
show('ICM, best of 5 restarts', out['icm']['score'])
for nm, a in out['arms'].items(): show('MIN-CUT ' + nm, a['score'])
a0 = before['wall'][1] + before['wall'][3]
print('\nartefact wall (class 1 + 3), reduction vs the law; the bar is 50 %, class 2 must survive')
for nm, sc in [('ICM', out['icm']['score'])] + [('MIN-CUT ' + k, v['score']) for k, v in out['arms'].items()]:
    a = sc['wall'][1] + sc['wall'][3]
    print('  %-34s %6.1f %%   class1 %+6.1f %%   class3 %+6.1f %%   class2 %+6.1f %%' % (nm, 100 * (1 - a / a0),
          100 * (sc['wall'][1] / before['wall'][1] - 1), 100 * (sc['wall'][3] / before['wall'][3] - 1), 100 * (sc['wall'][2] / before['wall'][2] - 1)))
print('\nenergy (total wall, px): law %.0f   ICM %.0f   global minimum %.0f   (ICM is %.2f %% above the optimum)' %
      (e_law, e_icm, out['arms']['wall only (lambda = inf)']['wall_energy'],
       100 * (e_icm / out['arms']['wall only (lambda = inf)']['wall_energy'] - 1)))
json.dump(out, open(os.path.join(D, 'mincut.json'), 'w'), indent=1)
print('-> ' + os.path.join(D, 'mincut.json'))
