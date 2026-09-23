"""S59, advisory: arm C (the plain fill) on the truth kit, beside the per-line law (A) and, where S35's measured arm was
run on the scene, the sheets (B, as in the A/B: the sheets where owned, C elsewhere). The A/B is decided on the user's
screen; this answers the "plausible" half of the standard where the photographs cannot (they have no truth).

Per scene: truth error of the band depth against the first hidden layer (S35's truth_err: |z_app - z_true| in metres,
median and p90), walls (adjacent band texels differing by more than the visible step: count and summed length in
steps, S35's walls), and texels not behind their occluder by two steps.

  python3 sheet_ab_kit.py            (scenes with a recorded visible step: C1 C2 C3 L1 L2 L3 L4)
"""
import os, json, sys
import numpy as np
from scipy import sparse
from scipy.sparse.linalg import splu
from scipy.sparse.csgraph import connected_components

H = os.path.dirname(os.path.abspath(__file__)); PR = os.path.join(H, 'shots', 'a257probe'); TK = os.path.join(H, 'truthkit', 'out')
STEPS = {'C1': 2.563e-3, 'C2': 2.563e-3, 'C3': 1.833e-3, 'L1': 2.042e-3, 'L2': 1.312e-3, 'L3': 2.563e-3, 'L4': 2.042e-3}

def plain_fill(b, dQ, A, pw, ph, step):
    N = pw * ph; bi = np.flatnonzero(b); n = len(bi); idx = -np.ones(N, np.int64); idx[bi] = np.arange(n); x = bi % pw
    edge = np.zeros(n, bool); R, C = [], []
    for d, ok in ((-1, x > 0), (1, x < pw - 1), (-pw, bi >= pw), (pw, bi < N - pw)):
        a = np.flatnonzero(ok); j = bi[ok] + d; nb = b[j]; R.append(a[nb]); C.append(idx[j[nb]])
        a2, j2 = a[~nb], j[~nb]; edge[a2[dQ[j2] < dQ[bi[a2]] - 2 * step]] = True
    R = np.concatenate(R); C = np.concatenate(C)
    Lap = sparse.coo_matrix((-np.ones(len(R)), (R, C)), shape=(n, n)).tocsr() + sparse.diags(np.bincount(R, minlength=n).astype(float))
    nc, lab = connected_components(Lap != 0, directed=False)
    has = np.bincount(lab, weights=edge.astype(float), minlength=nc) > 0; F = edge | ~has[lab]
    M = sparse.diags((~F).astype(float)) @ Lap + sparse.diags(F.astype(float))
    u = splu(M.tocsc()).solve(np.where(F, A[bi], 0.0))
    nb_ = (u >= dQ[bi] - 2 * step) & has[lab]; u[nb_] = A[bi][nb_]
    out = A.copy(); out[bi] = u
    return out, {'noPin': int((~has[lab]).sum()), 'notBehindFellBack': int(nb_.sum())}

res = {}
for S, step in STEPS.items():
    P = os.path.join(PR, S + '_16plane'); T = os.path.join(TK, S + '_env45', 'scope_gt.npz')
    if not (os.path.exists(P) and os.path.exists(T)): print('skip', S); continue
    m = json.load(open(os.path.join(P, 'meta.json'))); pw, ph = m['pw'], m['ph']; outer, inner, pn = m['outer'], m['inner'], m['pn']
    dis = np.fromfile(os.path.join(P, 'disocc.u8'), np.uint8) > 0
    dQ = np.fromfile(os.path.join(P, 'dQ.f32'), np.float32).astype(np.float64)
    A = np.fromfile(os.path.join(P, 'farField.f32'), np.float32).astype(np.float64)
    b = dis & (A < dQ - 1 / 65535)            # streak_class.js's band: the law's fill lies behind the source
    Cf, cst = plain_fill(b, dQ, A, pw, ph, step)
    arms = {'A': A, 'C': Cf}
    sd = os.path.join(P, 's35_RWCPh')
    if os.path.exists(os.path.join(sd, 'farField_stop.f32')):
        ffS = np.fromfile(os.path.join(sd, 'farField_stop.f32'), np.float32).astype(np.float64); who = np.fromfile(os.path.join(sd, 'who_stop.i32'), np.int32)
        Bf = Cf.copy(); own = b & (who >= 0); Bf[own] = ffS[own]; arms['B'] = Bf
    def z_of_d(d):
        d = np.clip(d, 0, 1); s1 = d / pn; s2 = (d - pn) / (1 - pn)
        return np.where(d < pn, -outer + outer * (s1 * s1 * (3 - 2 * s1)), inner * (s2 * s2 * (3 - 2 * s2)))
    z = np.load(T); cls = z['cls']; w = z['w_disp'].astype(np.float32); dep = z['depth']; Hh, Ww, K = cls.shape; y0 = (Hh - ph) // 2; x0 = (Ww - pw) // 2
    cls_c = cls[y0:y0 + ph, x0:x0 + pw]; w_c = w[y0:y0 + ph, x0:x0 + pw]; dep_c = dep[y0:y0 + ph, x0:x0 + pw]
    vis = (cls_c >= 2) & (cls_c <= 5) & (w_c > 0); hasT = vis.any(-1); kk = np.argmax(vis, -1); d_true = np.take_along_axis(dep_c, kk[..., None], -1)[..., 0].ravel()
    mT = b & hasT.ravel() & np.isfinite(d_true)
    b2 = b.reshape(ph, pw); r = {'band': int(b.sum()), 'C': cst, 'arms': {}}
    for k, f in arms.items():
        e = (-z_of_d(f) - d_true)[mT]; F2 = f.reshape(ph, pw); wl = 0.0; wn = 0
        for a_, c_, mm in ((F2[1:, :], F2[:-1, :], b2[1:, :] & b2[:-1, :]), (F2[:, 1:], F2[:, :-1], b2[:, 1:] & b2[:, :-1])):
            dd = np.abs(a_ - c_)[mm]; wn += int((dd > step).sum()); wl += float((dd[dd > step] / step).sum())
        r['arms'][k] = {'truthMedianAbs_m': float(np.median(np.abs(e))), 'truthP90Abs_m': float(np.percentile(np.abs(e), 90)), 'n': int(mT.sum()),
                        'walls': wn, 'wallSteps': round(wl), 'notBehind': int((b & (f >= dQ - 2 * step)).sum())}
    res[S] = r
    print(S, json.dumps({k: (v['truthMedianAbs_m'], v['truthP90Abs_m'], v['walls'], v['wallSteps'], v['notBehind']) for k, v in r['arms'].items()}), cst)
json.dump(res, open(os.path.join(H, 'shots', 'sheet_ab', 'kit_plainfill.json'), 'w'), indent=1)
