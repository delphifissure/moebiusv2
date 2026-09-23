"""S59 sheet A/B: the advisory metrics, computed per picture and arm and written to shots/sheet_ab/metrics.json.
By the stopping rule (S37 Phase C, second edition) they are reported only after the user's verdicts and cannot overturn
one (A126). Everything is on the plate as RENDERED (plate_<arm>.f32 from sheet_ab.js), in visible steps (1/k, S10).

  bends       adjacent band-band pairs whose depth differs by more than one visible step (S33's "visible bend"), and
              their summed length in steps -- the combing and every other wall inside the hole
  edge        band texels on the background side against their background neighbour: pairs over one step and summed
              step length -- task #60, "does the filled band create new cliffs at the hole's edge?"
  notBehind   band texels not behind their occluder by two steps (a clone by S35 section 47's criterion)
  fallback / retear  copied from stats.json (C's arm-A fall-backs, B's owned share) and render.json (rim-law decisions
              each arm's field would change: the mesh's tears are the per-line bake's)

  python3 sheet_ab_metrics.py
"""
import os, json
import numpy as np

H = os.path.dirname(os.path.abspath(__file__)); SH = os.path.join(H, 'shots', 'sheet_ab')
out = {}
for p in ['troll', 'vermeer', 'sunflowers', 'starwatcher']:
    d = os.path.join(SH, p); dump = os.path.join(H, 'shots', 'streakclass', 'ab_' + p)
    if not os.path.exists(os.path.join(d, 'render.json')): continue
    rj = json.load(open(os.path.join(d, 'render.json'))); st = json.load(open(os.path.join(dump, 'ab_fields', 'stats.json')))
    pw, ph = rj['guard']['pw'], rj['guard']['ph']; N = pw * ph; step = st['step']
    b = np.fromfile(os.path.join(dump, 'disocc.u8'), np.uint8) > 0
    dQ = np.fromfile(os.path.join(dump, 'dQ.f32'), np.float32).astype(np.float64)
    bi = np.flatnonzero(b); x = bi % pw
    res = {'band': int(b.sum()), 'step': step, 'arms': {}}
    for arm in 'ABC':
        z = np.fromfile(os.path.join(d, 'plate_%s.f32' % arm), np.float32).astype(np.float64)
        bn = bl = en = el = 0.0
        for dd, ok in ((1, x < pw - 1), (pw, bi < N - pw), (-1, x > 0), (-pw, bi >= pw)):
            a = bi[ok]; j = a + dd
            inb = b[j]
            if dd > 0:                                   # each band-band pair once
                jump = np.abs(z[a[inb]] - z[j[inb]]) / step; v = jump > 1
                bn += v.sum(); bl += jump[v].sum()
            a2, j2 = a[~inb], j[~inb]; bg = dQ[j2] < dQ[a2] - 2 * step
            jump = np.abs(z[a2[bg]] - z[j2[bg]]) / step; v = jump > 1
            en += v.sum(); el += jump[v].sum()
        res['arms'][arm] = {'bends': int(bn), 'bendSteps': float(bl), 'edgeCliffs': int(en), 'edgeSteps': float(el),
                            'notBehind': int((z[bi] >= dQ[bi] - 2 * step).sum()),
                            'retearChanged': rj['arms'][arm]['retear']['decisionsChanged']}
    res['C_fallbacks'] = {'noPin': st['C_kept_A_no_pin'], 'notBehind': st['C_kept_A_not_behind']}
    res['B_ownedFrac'] = st['sheets_owned_frac']; res['wash'] = {k: st[k] for k in st if k.startswith('wash')}
    out[p] = res
json.dump(out, open(os.path.join(SH, 'metrics.json'), 'w'), indent=1)
print('written', os.path.join(SH, 'metrics.json'), 'pictures:', list(out))
