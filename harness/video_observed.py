#!/usr/bin/env python3
"""How much of what is hidden behind the moving foreground at frame t was SEEN in another frame?
Gladiator clip (1080x608, letterbox rows 74-534, depth = inferno colour video). Half resolution.
Foreground = decoded depth above an Otsu split. Background motion between consecutive frames = a homography fitted
(RANSAC) to Farneback flow on background pixels; chained to map a pixel of frame t into frame s.
Hidden sets at frame t:
  band  = foreground pixels within B px of the silhouette (what head motion inside the window reveals; B = 2% of width)
  whole = the whole foreground footprint (what removing the object would reveal)
A hidden pixel counts as observed within a window of +-K frames if it maps inside frame s and onto background there
(foreground at s dilated by 3 px to be safe)."""
import cv2, numpy as np, json, sys
from matplotlib import colormaps
R = '/home/user/moebiusv2/'; Y0, Y1 = 74, 535; S = 0.5
lut = (np.array([colormaps['inferno'](i / 255)[:3] for i in range(256)]) * 255).astype(np.float32)
def decode(bgr):
    rgb = bgr[..., ::-1].reshape(-1, 3).astype(np.float32)
    # nearest LUT entry (chunked)
    out = np.empty(len(rgb), np.float32)
    for i in range(0, len(rgb), 65536):
        dd = ((rgb[i:i + 65536, None, :] - lut[None]) ** 2).sum(-1); out[i:i + 65536] = dd.argmin(1) / 255
    return out.reshape(bgr.shape[:2])
c = cv2.VideoCapture(R + 'gladiator-video-rgb.mp4'); d = cv2.VideoCapture(R + 'gladiator-video-depth.mp4')
G, F = [], []
while True:
    ok, a = c.read(); ok2, b = d.read()
    if not ok or not ok2: break
    a = cv2.resize(a[Y0:Y1], None, fx=S, fy=S, interpolation=cv2.INTER_AREA); b = cv2.resize(b[Y0:Y1], None, fx=S, fy=S, interpolation=cv2.INTER_NEAREST)
    G.append(cv2.cvtColor(a, cv2.COLOR_BGR2GRAY)); F.append(decode(b))
n = len(G); h, w = G[0].shape
thr = [cv2.threshold((f * 255).astype(np.uint8), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[0] / 255 for f in F]
th = float(np.median(thr)); FG = [f > th for f in F]
print('frames', n, 'size', w, h, 'otsu split (median)', round(th, 3), 'fg share', round(float(np.mean([m.mean() for m in FG])), 3), flush=True)
# consecutive background homographies t -> t+1
Hs = []
ys, xs = np.mgrid[0:h:4, 0:w:4]
for t in range(n - 1):
    fl = cv2.calcOpticalFlowFarneback(G[t], G[t + 1], None, 0.5, 4, 21, 3, 5, 1.2, 0)
    bg = ~cv2.dilate(FG[t].astype(np.uint8), np.ones((9, 9), np.uint8)).astype(bool)
    sel = bg[ys, xs]; p = np.stack([xs[sel], ys[sel]], -1).astype(np.float32); q = p + fl[ys[sel], xs[sel]]
    H, _ = cv2.findHomography(p, q, cv2.RANSAC, 1.5) if len(p) > 50 else (None, None)
    Hs.append(H if H is not None else np.eye(3))
B = int(round(0.02 * w * 2 * S * 1)) or 1   # 2% of the full-res width, in half-res px
k3 = np.ones((7, 7), np.uint8)
def chain(t, s):
    M = np.eye(3)
    if s > t:
        for u in range(t, s): M = Hs[u] @ M
    else:
        for u in range(s, t): M = np.linalg.inv(Hs[u]) @ M
    return M
res = {'band': {}, 'whole': {}}; Ks = [6, 24, 72, 100000]
samples = list(range(0, n, 10))
acc = {kind: {K: [] for K in Ks} for kind in res}
for t in samples:
    m = FG[t].astype(np.uint8)
    band = m.astype(bool) & cv2.dilate(1 - m, np.ones((2 * B + 1, 2 * B + 1), np.uint8)).astype(bool)
    sets = {'band': band, 'whole': m.astype(bool)}
    for kind, hid in sets.items():
        yy, xx = np.nonzero(hid)
        if len(yy) == 0: continue
        pts = np.stack([xx, yy, np.ones_like(xx)], 0).astype(np.float64)
        seenAt = np.full(len(yy), 10 ** 9)
        for s in range(n):
            if s == t: continue
            q = chain(t, s) @ pts; qx = q[0] / q[2]; qy = q[1] / q[2]
            ins = (qx >= 0) & (qx < w - 1) & (qy >= 0) & (qy < h - 1)
            fgS = cv2.dilate(FG[s].astype(np.uint8), k3).astype(bool)
            ok = ins.copy(); ok[ins] = ~fgS[qy[ins].astype(int), qx[ins].astype(int)]
            seenAt = np.where(ok, np.minimum(seenAt, abs(s - t)), seenAt)
        for K in Ks: acc[kind][K].append(float((seenAt <= K).mean()))
out = {kind: {('all' if K == 100000 else f'+-{K}f ({K/24:.2f}s)'): round(float(np.mean(v)), 3) for K, v in d_.items()} for kind, d_ in acc.items()}
print(json.dumps({'band_px_halfres': B, 'observed_fraction': out}, indent=1))
cam = np.array([[H[0, 2], H[1, 2]] for H in Hs]); print('background shift per frame (half-res px): median |dx| %.2f |dy| %.2f; total path %.0f px' % (np.median(abs(cam[:, 0])), np.median(abs(cam[:, 1])), np.abs(cam).sum()))
