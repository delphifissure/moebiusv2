"""Silhouette ramp width (task #67, from S59 section 2): how many texels a depth map takes to fall across a depth edge.

Along every row and column, an EDGE is a maximal run of consecutive same-sign differences each larger than one visible
step (1/k, the app's [S10] value), whose total change exceeds TOT visible steps (an instrument threshold: a real
step, not a slope). Its width is the 10-90 % transition length in texels, linearly interpolated within the run. A map
whose silhouettes are one-texel steps reads ~1; DA3's ramps read wider. Reported: count, median and p90 width, and the
drop-weighted mean width (a big silhouette counts more than a small one).

  python3 ramp_width.py <depth .f32 or 16-bit png> <pw> <ph> <step> [TOT=10]
"""
import sys
import numpy as np
from PIL import Image

def load(p, pw, ph):
    if p.endswith('.f32'): return np.fromfile(p, np.float32).reshape(ph, pw).astype(np.float64)
    a = np.asarray(Image.open(p)).astype(np.float64)
    return a / (65535.0 if a.max() > 255 else 255.0)

def widths(D, step, TOT):
    out_w, out_d = [], []
    for M in (D, D.T):
        for row in M:
            d = np.diff(row); s = np.sign(d) * (np.abs(d) > step)
            i = 0; n = len(d)
            while i < n:
                if s[i] == 0: i += 1; continue
                j = i
                while j + 1 < n and s[j + 1] == s[i]: j += 1
                seg = row[i:j + 2]; drop = abs(seg[-1] - seg[0])
                if drop > TOT * step:
                    c = np.abs(np.cumsum(np.abs(np.diff(seg)))) / drop   # 0..1 progress along the run
                    c = np.concatenate([[0.0], c]); x = np.arange(len(c))
                    w = np.interp(0.9, c, x) - np.interp(0.1, c, x)
                    out_w.append(w); out_d.append(drop / step)
                i = j + 1
    return np.array(out_w), np.array(out_d)

if __name__ == '__main__':
    p, pw, ph, step = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), float(sys.argv[4]); TOT = float(sys.argv[5]) if len(sys.argv) > 5 else 10
    w, dr = widths(load(p, pw, ph), step, TOT)
    print({'edges': int(len(w)), 'medianWidth': round(float(np.median(w)), 2), 'p90Width': round(float(np.percentile(w, 90)), 2),
           'dropWeightedMeanWidth': round(float((w * dr).sum() / dr.sum()), 2), 'medianDropSteps': round(float(np.median(dr)), 1)})
