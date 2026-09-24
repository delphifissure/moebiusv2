#!/usr/bin/env python3
# plate 1 and plate 2 depth against the kit's hidden layers of OTHER surfaces (class 2 background, 3 another object; the
# object's own side 4 and interior 5 are its volume, which a plate behind the object is not), where some pose shows the plate
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from tk import app_z_of_d
gt = np.load(sys.argv[1]); probe = sys.argv[2]
meta = json.load(open(os.path.join(probe, 'meta.json'))); pw, ph = meta['pw'], meta['ph']; o_, i_, pn = meta['outer'], meta['inner'], meta['pn']
rd = lambda n, t: np.fromfile(os.path.join(probe, n), t).reshape(ph, pw)
dis = rd('disocc.u8', np.uint8) > 0; vis = rd('vis.u8', np.uint8) > 0; vis2 = rd('vis2.u8', np.uint8) > 0
ff = rd('farField.f32', np.float32); ff2 = rd('farField2.f32', np.float32); has2 = ff2 >= 0
cls = gt['cls']; w = gt['w_disp']; dep = gt['depth']; H, W, K = cls.shape; y0 = (H - ph) // 2; x0 = (W - pw) // 2
cc = cls[y0:y0+ph, x0:x0+pw]; wc = w[y0:y0+ph, x0:x0+pw]; dc = dep[y0:y0+ph, x0:x0+pw]
other = ((cc == 2) | (cc == 3)) & (wc > 0)
order = np.argsort(~other, axis=-1, kind='stable'); n = other.sum(-1)
t1 = np.take_along_axis(dc, order[..., :1], -1)[..., 0]; t2 = np.take_along_axis(dc, order[..., 1:2], -1)[..., 0]
a1 = -app_z_of_d(ff, pn, o_, i_); a2 = -app_z_of_d(np.clip(ff2, 0, 1), pn, o_, i_)
def st(m, a, t):
    m = m & np.isfinite(t); e = np.abs(a - t)[m]
    return {'n': int(m.sum()), 'median_m': round(float(np.median(e)), 3) if m.any() else None, 'p90_m': round(float(np.percentile(e, 90)), 3) if m.any() else None, 'within_0.5m': round(float((e < 0.5).mean()), 3) if m.any() else None}
out = {'plate1_vs_other1_shown': st(dis & vis & (n >= 1), a1, t1),
       'plate2_vs_other2_shown': st(has2 & vis2 & (n >= 2), a2, t2),
       'plate2_vs_other1_shown': st(has2 & vis2 & (n >= 1), a2, t1),
       'plate2_shown_px': int((has2 & vis2).sum()), 'plate2_px': int(has2.sum()), 'kit_other2_px_in_hole': int((dis & (n >= 2)).sum())}
print(json.dumps(out))
