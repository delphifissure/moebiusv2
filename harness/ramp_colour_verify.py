"""Python side of the app-port check: the colour-guided collapse on each picture's RAW 16-bit map (what the 16-bit path
hands the app's collapse) in both modes; writes ref_<pic>_<mode>.f32 for ramp_colour_verify.js to compare against."""
import os, sys, json, numpy as np
from PIL import Image
sys.path.insert(0, '/home/user/moebiusv2/harness')
from ramp_colour import collapse_colour
from ramp_collapse import visible_step
OUT = sys.argv[1]; os.makedirs(OUT, exist_ok=True); R = '/home/user/moebiusv2'
PIC = {'troll': ('defaultImgDepth.png', 'defaultImgColor.png'), 'vermeer': ('harness/batchB/vermeer_da3_16.png', 'harness/batchB/vermeer_color.png'),
       'sunflowers': ('harness/batchB/room_da3_16.png', 'harness/batchB/room_color.png'), 'starwatcher': ('harness/batchB/starwatcher_da3_16.png', 'harness/batchB/starwatcher_color.png')}
res = {}
for p, (dp, cp) in PIC.items():
    d = (np.asarray(Image.open(os.path.join(R, dp))).astype(np.float64) / 65535).astype(np.float32); ph, pw = d.shape
    rgb = np.asarray(Image.open(os.path.join(R, cp)).convert('RGB').resize((pw, ph)), np.float64)
    st = visible_step(pw, ph, 0.02, 0.04, 0.2); d.tofile(os.path.join(OUT, 'in_%s.f32' % p)); np.asarray(Image.open(os.path.join(R, cp)).convert('RGBA').resize((pw, ph)), np.uint8).tofile(os.path.join(OUT, 'rgba_%s.u8' % p))
    for mode, se in (('strong', False), ('safe', True)):
        c, n, stt = collapse_colour(d.astype(np.float64), rgb, 0.02, 0.04, 0.5, 0.2, st, single_edge=se)
        c.astype(np.float32).tofile(os.path.join(OUT, 'ref_%s_%s.f32' % (p, mode))); res['%s_%s' % (p, mode)] = {'changed': n, 'stats': stt}
    res[p] = {'pw': pw, 'ph': ph, 'step': st}
    print(p, {k: v for k, v in res.items() if k.startswith(p + '_')}, flush=True)
json.dump(res, open(os.path.join(OUT, 'ref.json'), 'w'), indent=1)
