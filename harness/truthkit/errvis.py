#!/usr/bin/env python3
# depth error of the plate where some pose SHOWS it (vis.u8 from visplate.js), against the kit's first hidden layer
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from tk import app_z_of_d
gt = np.load(sys.argv[1]); probe = sys.argv[2]
meta = json.load(open(os.path.join(probe, 'meta.json'))); pw, ph = meta['pw'], meta['ph']
dis = np.fromfile(os.path.join(probe, 'disocc.u8'), np.uint8).reshape(ph, pw) > 0
vis = np.fromfile(os.path.join(probe, 'vis.u8'), np.uint8).reshape(ph, pw) > 0
ff = np.fromfile(os.path.join(probe, 'farField.f32'), np.float32).reshape(ph, pw)
cls = gt['cls']; w = gt['w_disp'].astype(np.float32); dep = gt['depth']; H, W, K = cls.shape
y0 = (H - ph) // 2; x0 = (W - pw) // 2
cls_c = cls[y0:y0+ph, x0:x0+pw]; w_c = w[y0:y0+ph, x0:x0+pw]; dep_c = dep[y0:y0+ph, x0:x0+pw]
vis_hidden = (cls_c >= 2) & (cls_c <= 5) & (w_c > 0)
kk = np.argmax(vis_hidden, axis=-1); has = vis_hidden.any(axis=-1)
d_true = np.take_along_axis(dep_c, kk[..., None], axis=-1)[..., 0]
o_, i_, pn = meta['outer'], meta['inner'], meta['pn']
d_app = -app_z_of_d(ff, pn, o_, i_)
out = {}
for name, m in [('allHole', dis & has), ('shownHole', dis & has & vis), ('hiddenNotShown', dis & has & ~vis)]:
    m = m & np.isfinite(d_true); e = np.abs(d_app[m] - d_true[m])
    out[name] = {'n': int(m.sum()), 'median_m': round(float(np.median(e)), 3) if m.any() else None, 'p90_m': round(float(np.percentile(e, 90)), 3) if m.any() else None}
# precision of the hole against what is shown: hole texels no pose shows
out['holeShownFrac'] = round(float((dis & vis).sum() / max(1, dis.sum())), 3)
print(json.dumps(out))
