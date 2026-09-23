"""S61 section 7, the held-out test: v1 and v2 of the colour-guided ramp collapse, FROZEN as committed, on kit scenes
neither was tuned on (C1-C3, L1-L6, P1-P6), with the kit's own blur rungs (truthkit/degrade.py) and each scene's own
depth law (truthkit/out/<S>/meta.json). Pass: every exact16 untouched; blur error falls with few texels made worse.
  python3 ramp_colour_heldout.py
"""
import os, json
import numpy as np
from PIL import Image
from ramp_colour import collapse_colour
from ramp_collapse import visible_step, load16
from ramp_width import widths
H = os.path.dirname(os.path.abspath(__file__)); K = os.path.join(H, 'truthkit', 'out')
SC = ['C1', 'C2', 'C3', 'L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6']
res = {}
for S in SC:
    G = os.path.join(K, S, 'degrade')
    if not os.path.exists(os.path.join(G, 'blur_s2.png')): print('skip', S); continue
    m = json.load(open(os.path.join(K, S, 'meta.json'))); ex = load16(os.path.join(G, 'exact16.png')); ph, pw = ex.shape
    rgb = np.asarray(Image.open(os.path.join(K, S, 'rest_rgb.png')).convert('RGB'), np.float64)
    st = visible_step(pw, ph, m['outer'], m['inner'], m['D']); r = {}
    for ver, se in (('v1', False), ('v2', True)):
        for rung in ['exact16', 'blur_s1', 'blur_s2', 'blur_s4']:
            d = load16(os.path.join(G, rung + '.png')); c, n, _ = collapse_colour(d, rgb, m['outer'], m['inner'], m['pn'], m['D'], st, single_edge=se)
            dep = np.abs(d - ex) > st
            e0 = float(np.abs(d - ex)[dep].mean() / st) if dep.any() else 0.0; e1 = float(np.abs(c - ex)[dep].mean() / st) if dep.any() else 0.0
            r[ver + ':' + rung] = {'changed': n, 'better': int((np.abs(c - ex) + st < np.abs(d - ex)).sum()), 'worse': int((np.abs(c - ex) > np.abs(d - ex) + st).sum()),
                                   'err': [round(e0, 2), round(e1, 2)]}
    res[S] = r
    print(S, ' | '.join('%s ch%d +%d -%d %s' % (k, v['changed'], v['better'], v['worse'], v['err']) for k, v in r.items()), flush=True)
json.dump(res, open(os.path.join(H, 'shots', 'sheet_ab', 'ramp_colour_heldout.json'), 'w'), indent=1)
