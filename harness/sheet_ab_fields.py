"""S59 sheet A/B (S37 Phase C, stopping rule second edition): build the band depth of arms B and C and the one wash.

  C  the plain fill: per band component, a membrane (Laplace) pinned at the hole's BACKGROUND EDGE and free (zero flux)
     everywhere else. The background edge is the band texels with a non-band 4-neighbour lying behind them by more than
     two visible steps (S35 section 47's lip criterion, used only to tell the background side from the occluder side).
     The pinned value there is the per-line law's own (arm A's) value: the law has just left its far rim, past the
     silhouette ramp. (Pinned to the ring texels themselves, as first specified, the fill took the RAMP's depth: on the
     troll the ring's median is 3.2 steps behind the occluder and 37 steps nearer than the law's far rim, 88 % of ring
     texels still descending -- a near clone. Found by the guard below before any frame was rendered; S59 section 2.)
     No constant of its own. Texels where the membrane is not behind the occluder by two steps (the max principle bounds
     it by the component's pins, not by each texel's occluder), and components with no pin, keep arm A (counted).
  B  the sheets: S35's measured arm (RWCPh) where a sheet owns the texel (who >= 0); arm C's value where none does
     (the occluder's depth there would be a clone by construction, S35 section 47).
  wash  the same membrane per RGB channel, pinned at the same edge texels to the colour of the per-line law's own far rim
     (farRimJ, its two candidates weighted by farRimW), identical for every arm. Components with no background edge are
     pinned to their ring's source colour (counted).

  python3 sheet_ab_fields.py <dump dir> <sheets out dir> <visible step> <out dir containing rimJ.i32 rimW.f32>
Writes: fieldC.f32, fieldB.f32 (source rows, full plate: dQ outside the band), wash.png, stats.json.
"""
import sys, os, json
import numpy as np
from PIL import Image
from scipy import sparse
from scipy.sparse.linalg import splu
from scipy.sparse.csgraph import connected_components

dump, sdir, step, out = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4]
os.makedirs(out, exist_ok=True)
sz = json.load(open(os.path.join(dump, 'size.json'))); pw, ph = sz['pw'], sz['ph']; N = pw * ph
b = np.fromfile(os.path.join(dump, 'disocc.u8'), np.uint8) > 0
dQ = np.fromfile(os.path.join(dump, 'dQ.f32'), np.float32).astype(np.float64)
A = np.fromfile(os.path.join(dump, 'farField.f32'), np.float32).astype(np.float64)
rgb = np.asarray(Image.open(os.path.join(dump, 'color.png')).convert('RGB'), np.float64).reshape(-1, 3)
assert len(rgb) == N and len(b) == N
rimJ = np.fromfile(os.path.join(out, 'rimJ.i32'), np.int32).reshape(N, 2)
rimW = np.fromfile(os.path.join(out, 'rimW.f32'), np.float32).astype(np.float64).reshape(N, 2)

bi = np.flatnonzero(b); n = len(bi); idx = -np.ones(N, np.int64); idx[bi] = np.arange(n); x = bi % pw
edge = np.zeros(n, bool); ringcol = np.zeros((n, 3)); ringcnt = np.zeros(n)
R, C = [], []
for d, ok in ((-1, x > 0), (1, x < pw - 1), (-pw, bi >= pw), (pw, bi < N - pw)):
    a = np.flatnonzero(ok); j = bi[ok] + d
    nb = b[j]; R.append(a[nb]); C.append(idx[j[nb]])
    a2, j2 = a[~nb], j[~nb]
    edge[a2[dQ[j2] < dQ[bi[a2]] - 2 * step]] = True
    np.add.at(ringcol, a2, rgb[j2]); np.add.at(ringcnt, a2, 1)
R = np.concatenate(R); C = np.concatenate(C)
Lap = sparse.coo_matrix((-np.ones(len(R)), (R, C)), shape=(n, n)).tocsr()
deg = np.bincount(R, minlength=n).astype(np.float64)
Lap = Lap + sparse.diags(deg)
nc, lab = connected_components(Lap != 0, directed=False)

# the colour of the law's own far rim at each edge texel
jj = rimJ[bi]; ww = rimW[bi]; valid = (jj >= 0) & (jj < N)
wv = np.where(valid, np.where(ww > 0, ww, 0.0), 0.0); wv[valid.any(1) & (wv.sum(1) == 0)] = valid[valid.any(1) & (wv.sum(1) == 0)]
rimcol = (rgb[np.clip(jj[:, 0], 0, N - 1)] * wv[:, :1] + rgb[np.clip(jj[:, 1], 0, N - 1)] * wv[:, 1:]) / np.maximum(wv.sum(1, keepdims=True), 1e-12)
has_rim = wv.sum(1) > 0
rim_behind = float(np.mean(dQ[np.clip(jj[valid[:, 0], 0], 0, N - 1)] < dQ[bi[valid[:, 0]]] - 2 * step)) if valid[:, 0].any() else float('nan')

def membrane(fix, vals):
    """solve Lap u = 0 on free texels, u = vals on fixed ones; components with no fixed texel return None (mask)."""
    hasfix = np.bincount(lab, weights=fix.astype(float), minlength=nc) > 0
    nofix = ~hasfix[lab]
    F = fix | nofix
    M = sparse.diags((~F).astype(float)) @ Lap + sparse.diags(F.astype(float))
    rhs = np.where(F[:, None], vals, 0.0)
    u = splu(M.tocsc()).solve(rhs)
    res = np.abs(M @ u - rhs).max()
    assert res < 1e-6 * max(1.0, np.abs(rhs).max()), 'membrane residual %g' % res
    return u, nofix, res

# ---- depth (arm C) ----
dfix = edge.copy()
u, nofixD, resD = membrane(dfix, A[bi][:, None])
u = u[:, 0]; u[nofixD] = A[bi][nofixD]
# max principle guard: within each pinned component, u within [min pin, max pin]
lo = np.full(nc, np.inf); hi = np.full(nc, -np.inf); np.minimum.at(lo, lab[dfix], A[bi][dfix]); np.maximum.at(hi, lab[dfix], A[bi][dfix])
m = ~nofixD
assert np.all((u[m] >= lo[lab[m]] - 1e-9) & (u[m] <= hi[lab[m]] + 1e-9)), 'maximum principle violated -- construction wrong'
notbehind = (u >= dQ[bi] - 2 * step) & ~nofixD
u[notbehind] = A[bi][notbehind]
fieldC = dQ.copy(); fieldC[bi] = u
# ---- the wash ----
cfix = edge & has_rim
cvals = np.where(cfix[:, None], rimcol, 0.0)
# components with no rim-coloured edge: pin at their ring's source colour (every texel with a non-band neighbour)
hasc = np.bincount(lab, weights=cfix.astype(float), minlength=nc) > 0
need = ~hasc[lab] & (ringcnt > 0)
cfix2 = cfix | need
cvals[need] = ringcol[need] / ringcnt[need][:, None]
w, nofixC, resC = membrane(cfix2, cvals)
wash = rgb.copy(); wash[bi] = np.clip(w, 0, 255)
wash[bi[nofixC]] = rgb[bi[nofixC]]

# ---- arm B ----
ffS = np.fromfile(os.path.join(sdir, 'farField_stop.f32'), np.float32).astype(np.float64)
who = np.fromfile(os.path.join(sdir, 'who_stop.i32'), np.int32)
owned = b & (who >= 0)
fieldB = fieldC.copy(); fieldB[owned] = ffS[owned]

fieldC.astype(np.float32).tofile(os.path.join(out, 'fieldC.f32'))
fieldB.astype(np.float32).tofile(os.path.join(out, 'fieldB.f32'))
Image.fromarray(np.round(wash).reshape(ph, pw, 3).astype(np.uint8)).save(os.path.join(out, 'wash.png'))
st = {'pw': pw, 'ph': ph, 'band': int(n), 'components': int(nc), 'step': step,
      'edge_pins': int(edge.sum()), 'C_kept_A_no_pin': int(nofixD.sum()), 'C_kept_A_not_behind': int(notbehind.sum()),
      'lawRim_behind_frac': rim_behind, 'wash_edge_pins': int(cfix.sum()), 'wash_ring_pinned_texels': int(need.sum()),
      'wash_unpinned_kept_source': int(nofixC.sum()), 'residual_depth': float(resD), 'residual_colour': float(resC),
      'sheets_owned_frac': float(owned.sum() / n),
      'B_not_behind': int((b & (fieldB >= dQ - 2 * step)).sum()), 'A_not_behind': int((b & (A >= dQ - 2 * step)).sum())}
json.dump(st, open(os.path.join(out, 'stats.json'), 'w'), indent=1)
print(json.dumps(st))
