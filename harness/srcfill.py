"""The source-anchored hole, all in 2-D: no per-line value anywhere (user, 2026-09-23, after the S59 A/B found all three
arms noisy: "drop per-line, and also the stopping law. This needs to work no matter what"; "naturally I want smooth
(disocclusions never look like scraggly lines)").

Reads a streak_class dump (dQ.f32 source depth, color.png, meta.json) -- NOT its band -- and writes a full-frame plate.

  1. edges     DA3's blurred occlusion edges -- a torn run (the rim law) plus its steep blurry tails -- collapse to one-texel
               cliffs at the centre of the painting's own colour change; surfaces with no occlusion are left alone
  2. rims      every 4-neighbour pair, rows AND columns, torn by the rim law as the app has it (bgRimLawFor): the ratio
               test on eye distance (t = 1 + (hfov/pw)/tan 2 deg), unless the pair continues the straight slope of the
               texels beside it; a run of torn steps across an edge is one rim, top texel to bottom texel
  3. the hole  a rim reveals, at the envelope's edge, the app's own shift difference of its two sides:
               R = s(near) - s(far) texels, s(d) = D tan(45) z/(D-z) px/m (bgShiftLUTFor's fwd table); vertically
               R tan30/tan45 (the rectangular envelope, bgEnvAspect). The reach spreads from the rim through the
               occluder only -- texels in front of the background that rim reveals by more than two visible steps
               (S35 s47) -- in the envelope's box norm, plus the same-depth pinholes it encloses (S61 s10). Its outline
               is the silhouette swept by the envelope, clipped to the object: no scanline anywhere.
  4. depth     a membrane on the hole, pinned at every neighbour outside it that lies behind the adjacent hole texel by
               more than two steps (the background), free elsewhere (the occluder side); a pin more than two steps from
               the consensus of a first solve with every pin soft (one edge's weight) is the blur's leftover and is
               dropped; a hole texel whose fill is not behind its own source depth by two steps is not uncovered: it
               leaves the hole and the fill is solved again; a component with no pin is flat at its farthest border
               depth (counted)
  5. wash      the same membrane per RGB channel, pinned at the same texels to their own source colour
  Outside the hole the plate is the source depth (ramps collapsed, as the app draws it with ramps = safe) and the
  source colour.

  python3 srcfill.py <dump dir> <out dir>
Writes plateD.f32 (source rows), washD.png, hole.u8, depthD16.png (the corrected depth, for the bake), stats.json.
"""
import sys, os, json, time
import numpy as np
from PIL import Image
from scipy import sparse
from scipy.ndimage import label, binary_fill_holes, binary_dilation
import pyamg
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ramp_collapse import rim_t, law, joined_lines, visible_step, TW, TH

D0, OUT = sys.argv[1], sys.argv[2]; os.makedirs(OUT, exist_ok=True); t0 = time.time()
m = json.load(open(os.path.join(D0, 'meta.json'))); pw, ph = m['pw'], m['ph']; N = pw * ph
outer, inner, pn, D = m['outer'], m['inner'], m['pn'], m['D']
# the visible step 1/k (bgShiftLUTFor at the fade end). NOT meta.quantum: on a 16-bit map that field is the grid
# (1/65535), which made every two-step test ~170x too strict on sunflowers and starwatcher
step = visible_step(pw, ph, outer, inner, D)
src = np.fromfile(os.path.join(D0, 'dQ.f32'), np.float32).astype(np.float64).reshape(ph, pw)
rgb = np.asarray(Image.open(os.path.join(D0, 'color.png')).convert('RGB')).astype(np.float64)
st = {'pw': pw, 'ph': ph, 'step': step}

# 1. blurred occlusion edges, collapsed where they occlude. A run of torn steps across an edge (the rim law) is an occlusion
#    edge; DA3 blurs it, so the run continues on both sides in steep steps the rim law joins (each more than one visible
#    step: the law's own tolerance tolAt, S10) that are still curving -- each step outward smaller than the last by more
#    than that tolerance; a straight slope, however steep, stops the tail (a receding ground is not a blur). The whole stretch, torn core plus blurry tails, is one edge; it becomes a
#    one-texel cliff at the centre of the colour change inside it (the painting's own edge; the centre, not the peak,
#    so neighbouring lines agree): texels on the near side of that
#    change take the near end's depth, the rest the far end's. A stretch is taken if it holds a torn step or continues,
#    on the next line, a stretch that was taken (one contour); a surface with no occlusion on its contour (a faceted
#    mountain, a steep ground) is left as DA3 drew it (the 'strong' ramp collapse
#    striped the crystal mountain because it had no such anchor, S62 s4). Rows and columns; a texel collapsed both ways
#    takes the steeper stretch.
disp0, _ = law(outer, inner, pn, D); Dq = disp0(src); tolq = np.abs(disp0(np.minimum(1, src + step)) - disp0(np.maximum(0, src - step))) + 1e-12
t0_ = rim_t(pw, ph, D); newD = src.copy(); score = np.full((ph, pw), -1.0); ncol = 0; nprop = 0
for ax in (0, 1):
    V = src if ax == 1 else src.T; Dl = Dq if ax == 1 else Dq.T; Tl = tolq if ax == 1 else tolq.T; C = rgb if ax == 1 else rgb.transpose(1, 0, 2)
    Zl = 1.0 / Dl; torn = ~joined_lines(Zl, Dl, Tl, t0_); dD = Dl[:, 1:] - Dl[:, :-1]; TE = np.maximum(Tl[:, 1:], Tl[:, :-1])
    dC = np.abs(np.diff(C, axis=1)).sum(-1); nr, nc_ = V.shape; ND = newD if ax == 1 else newD.T; SC = score if ax == 1 else score.T
    # candidate stretches, per line: from each steepest step outward (largest first), the curving tails of the same sign
    cands = []                                         # (line, a, b, sign, anchored)
    for y in range(nr):
        ad = np.abs(dD[y]); sg = np.sign(dD[y]); used = np.zeros(nc_ - 1, bool)
        for x in np.argsort(-ad):
            if ad[x] <= TE[y, x]: break                # not steep: nothing further on this line
            if used[x]: continue
            a_ = b_ = x; s_ = sg[x]
            while a_ - 2 >= 0 and not used[a_ - 1] and sg[a_ - 1] == s_ and ad[a_ - 1] > TE[y, a_ - 1] and ad[a_ - 1] - ad[a_ - 2] > Tl[y, a_ - 1]: a_ -= 1
            while b_ + 2 < nc_ - 1 and not used[b_ + 1] and sg[b_ + 1] == s_ and ad[b_ + 1] > TE[y, b_ + 1] and ad[b_ + 1] - ad[b_ + 2] > Tl[y, b_ + 2]: b_ += 1
            used[a_:b_ + 1] = True
            if b_ + 1 - a_ >= 2: cands.append((y, a_, b_, s_, bool(torn[y, a_:b_ + 1].any())))
    # an edge is one contour: a stretch is taken if it holds a torn step (an occlusion by the rim law) or if the stretch
    # of the same sign on the next line over, overlapping it, was taken -- so a soft edge is sharpened along its whole
    # length, not only where DA3 happened to make it steep enough to tear; a surface with no occlusion on its contour
    # (a faceted mountain, a receding ground) has nothing to start from
    byline = {}
    for k, c in enumerate(cands): byline.setdefault(c[0], []).append(k)
    acc = np.array([c[4] for c in cands], bool); stack = list(np.flatnonzero(acc))
    while stack:
        k = stack.pop(); y, a_, b_, s_, _ = cands[k]
        for yy in (y - 1, y + 1):
            for k2 in byline.get(yy, ()):
                if acc[k2]: continue
                _, a2, b2, s2, _ = cands[k2]
                if s2 == s_ and a2 <= b_ + 1 and b2 >= a_ - 1: acc[k2] = True; stack.append(k2); nprop += 1
    for k in np.flatnonzero(acc):
        y, a_, b_, s_, _ = cands[k]
        wC = dC[y, a_:b_ + 1]                            # the colour change across the stretch; its CENTRE is the cut
        e = a_ + int(np.round((wC * np.arange(wC.size)).sum() / max(1e-9, wC.sum())))   # (a peak jumps between neighbouring lines)
        L_ = b_ + 1 - a_; sc = abs(V[y, b_ + 1] - V[y, a_]) / max(1, L_)
        seg = np.r_[np.full(e + 1 - a_, V[y, a_]), np.full(b_ + 1 - e, V[y, b_ + 1])]
        idx_ = np.arange(a_, b_ + 2); w = sc > SC[y, idx_]
        ND[y, idx_[w]] = seg[w]; SC[y, idx_[w]] = sc; ncol += 1
st['edgesPropagated'] = nprop
dQ = newD; st['edgesCollapsed'] = ncol; st['texelsChanged'] = int((np.abs(dQ - src) > 0).sum())
# the corrected depth, for the app to bake from (16-bit, value / 65535 = the app's normalised depth)
Image.fromarray(np.round(np.clip(dQ, 0, 1) * 65535).astype(np.uint16)).save(os.path.join(OUT, 'depthD16.png'))

# the app's depth law and shift at the envelope's edge
def z_of_d(d):
    d = np.clip(d, 0, 1); s1 = d / pn; s2 = (d - pn) / (1 - pn)
    return np.where(d < pn, -outer + outer * (s1 * s1 * (3 - 2 * s1)), inner * (s2 * s2 * (3 - 2 * s2)))
la, fa = pw / ph, TW / TH; layerW = TW if la > fa else TH * la; ppm = pw / layerW
ex = D * np.tan(np.radians(45)); env = np.tan(np.radians(30)) / np.tan(np.radians(45))
z = z_of_d(dQ); ze = D - z; s = ex * z / ze * ppm                      # px at the envelope's horizontal edge
disp, _ = law(outer, inner, pn, D); Dsp = disp(dQ)                  # 1/ze, and the rim law's tolerance at one visible step (S10)
tol = np.abs(disp(np.minimum(1, dQ + step)) - disp(np.maximum(0, dQ - step))) + 1e-12

# 2. rims, both axes. A silhouette DA3 blurred over several texels is a RUN of torn steps of one sign across the edge
#    (S59 s2: 88 % of ring texels still descending three texels out); the rim is the whole run: its near side is the run's
#    top texel and the background it reveals is the run's bottom texel (the edge's own depth profile, in both axes)
t = rim_t(pw, ph, D); R = np.zeros((ph, pw)); F = np.full((ph, pw), np.inf); rampF = np.full((ph, pw), -np.inf)
def runs(T):                                          # consecutive True pairs along axis 1: (row, first pair, last pair)
    Tp = np.pad(T, ((0, 0), (1, 1))); d = np.diff(Tp.astype(np.int8), axis=1)
    sy, sx = np.nonzero(d == 1); ey, ex_ = np.nonzero(d == -1); return sy, sx, ex_ - 1
for ax in (0, 1):
    V = dQ if ax == 1 else dQ.T; Z = ze if ax == 1 else ze.T; Sx = s if ax == 1 else s.T
    # the rim law as the app has it (bgRimLawFor): joined if the eye-distance ratio is within t OR the pair continues the
    # straight slope of the texels before or after it -- a steeply receding ground is one surface, not a tear per texel
    torn = ~joined_lines(Z, Dsp if ax == 1 else Dsp.T, tol if ax == 1 else tol.T, t)
    for down in (True, False):                        # depth falling toward higher index, or toward lower index
        T = torn & ((V[:, :-1] > V[:, 1:]) if down else (V[:, :-1] < V[:, 1:]))
        y, x0, x1 = runs(T)
        nx, fx = (x0, x1 + 1) if down else (x1 + 1, x0)
        r = Sx[y, nx] - Sx[y, fx]; f = V[y, fx]
        ny_, nx_ = (y, nx) if ax == 1 else (nx, y)
        o = np.argsort(r); ny_, nx_, r, f = ny_[o], nx_[o], r[o], f[o]     # larger reach written last wins
        upd = r > R[ny_, nx_]; R[ny_[upd], nx_[upd]] = r[upd]; F[ny_[upd], nx_[upd]] = f[upd]
        # the run's interior texels (the blur itself) belong to the hole: they stand between the object and its background
        L = x1 - x0; ks = np.repeat(np.arange(L.size), L); off = np.arange(L.sum()) - np.repeat(np.cumsum(L) - L, L)
        ix = x0[ks] + 1 + off; iy = y[ks]; fv = f[ks]
        ry, rx = (iy, ix) if ax == 1 else (ix, iy); rampF[ry, rx] = np.maximum(rampF[ry, rx], fv)
rim = R > 0; st['rimTexels'] = int(rim.sum()); st['reachMaxPx'] = round(float(R.max()), 1)

# 3. the hole: what the occluder slides over. From each rim the reach spreads THROUGH the occluder only (texels in front of
#    the background that rim reveals by more than two visible steps, S35 s47). The envelope is a rectangle, |dx| <= R,
#    |dy| <= R env; its reach is measured in the ELLIPSE through the rectangle's corners (x^2 + (y/env)^2 <= 2 R^2), with
#    16 move directions (the 8 neighbours and the knight moves), so an outline is a smooth curve following the silhouette,
#    never a box or an octagon; it covers the rectangle, so nothing the envelope uncovers is left out
Bud = np.where(rim, R, -np.inf); Fc = F.copy(); iters = 0
moves = [(dy, dx, np.hypot(dx, dy / env) / np.sqrt(2)) for dy in (-2, -1, 0, 1, 2) for dx in (-2, -1, 0, 1, 2)
         if (dy or dx) and max(abs(dy), abs(dx)) <= 2 and not (abs(dy) == 2 and abs(dx) != 1) and not (abs(dx) == 2 and abs(dy) != 1)]
def sh(a, dy, dx, fill):
    o = np.full_like(a, fill); o[max(dy, 0):ph + min(dy, 0), max(dx, 0):pw + min(dx, 0)] = a[max(-dy, 0):ph + min(-dy, 0), max(-dx, 0):pw + min(-dx, 0)]; return o
# a move stays on one surface: the pair it crosses is joined by the rim law (both axes, as the rims above); a diagonal move
# is allowed where one of its two axis paths is joined all the way, so the reach cannot leave the object through a contact
JH = np.zeros((ph, pw), bool); JV = np.zeros((ph, pw), bool)
JH[:, :-1] = joined_lines(ze, Dsp, tol, t); JV[:-1, :] = joined_lines(ze.T, Dsp.T, tol.T, t).T
def ax_ok(dy, dx):                                    # the pair (i - (dy, dx), i) joined, at the receiving texel i
    if dy == 0: return sh(JH, 0, 1, False) if dx == 1 else JH
    return sh(JV, 1, 0, False) if dy == 1 else JV
same = {}
for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)): same[(dy, dx)] = ax_ok(dy, dx)
def compose(a, b):                                   # move a then move b, at the receiving texel
    return same[b] & sh(same[a], b[0], b[1], False)
for dy in (-1, 1):
    for dx in (-1, 1): same[(dy, dx)] = compose((dy, 0), (0, dx)) | compose((0, dx), (dy, 0))
for dy, dx, c in moves:                              # knight moves: an axis step and a diagonal step, either order
    if max(abs(dy), abs(dx)) == 2:
        ax_ = (0, int(np.sign(dx))) if abs(dx) == 2 else (int(np.sign(dy)), 0); dg = (dy - ax_[0], dx - ax_[1])
        same[(dy, dx)] = compose(ax_, dg) | compose(dg, ax_)
while True:
    ch = 0
    for dy, dx, c in moves:
        cb = sh(Bud, dy, dx, -np.inf) - c; cf = sh(Fc, dy, dx, np.inf)
        ok = (cb > Bud) & same[(dy, dx)] & (dQ > cf + 2 * step); n_ = int(ok.sum())
        if n_: Bud[ok] = cb[ok]; Fc[ok] = cf[ok]; ch += n_
    iters += 1
    if not ch: break
hole = (Bud >= 0) | (np.isfinite(rampF) & (dQ > rampF + 2 * step)); st['reachIters'] = iters; st['rampInHole'] = int((np.isfinite(rampF) & (dQ > rampF + 2 * step)).sum())
enc = binary_fill_holes(hole) & ~hole; lab, n = label(enc); joined = 0
for k in range(1, n + 1):
    mk = lab == k; ring = binary_dilation(mk) & hole
    if ring.any() and abs(np.median(dQ[mk]) - np.median(dQ[ring])) <= 2 * step: hole |= mk; joined += 1
st['hole'] = int(hole.sum()); st['pinholes'] = int(n); st['pinholesJoined'] = joined

# 4-5. membrane depth and wash on the hole, pinned at the background next to it
NB = ((0, 1), (0, -1), (1, 0), (-1, 0))
vals4 = np.stack([dQ, rgb[..., 0], rgb[..., 1], rgb[..., 2]], -1).reshape(N, 4); dq = dQ.ravel()
def solve(hole):
    di = np.flatnonzero(hole.ravel()); M = di.size; idx = -np.ones(N, np.int64); idx[di] = np.arange(M); ys, xs = np.divmod(di, pw); hv = hole.ravel()
    def build(pinOK):
        rows, cols = [], []; deg = np.zeros(M); b = np.zeros((M, 4)); hasPin = np.zeros(M, bool); pinSet = np.zeros(N, bool)
        for dy, dx in NB:
            y2, x2 = ys + dy, xs + dx; ok = (y2 >= 0) & (y2 < ph) & (x2 >= 0) & (x2 < pw); j = np.where(ok, y2 * pw + x2, 0)
            inH = ok & hv[j]; pin = ok & ~hv[j] & pinOK[j] & (dq[j] < dq[di] - 2 * step)
            rows.append(np.flatnonzero(inH)); cols.append(idx[j[inH]]); deg += inH + pin; b[pin] += vals4[j[pin]]; hasPin |= pin; pinSet[j[pin]] = True
        A = (sparse.diags(deg) - sparse.csr_matrix((np.ones(sum(r.size for r in rows)), (np.concatenate(rows), np.concatenate(cols))), shape=(M, M))).tocsr()
        return A, b, hasPin, pinSet
    A, b, hasPin, pinSet = build(np.ones(N, bool))
    # pins that disagree with the background around them are the blur's leftovers, not the background (each makes a cone
    # in a membrane). A first solve with every pin SOFT (tied to its value with the weight of one edge, so one pin cannot
    # pull the surface on its own) gives the consensus; a pin more than two visible steps from it (S35 s47's margin) is
    # dropped, and the final solve pins hard on the rest.
    pi = np.flatnonzero(pinSet); P = pi.size; pidx = -np.ones(N, np.int64); pidx[pi] = M + np.arange(P); er, ec = [], []
    for dy, dx in NB:
        y2, x2 = ys + dy, xs + dx; ok = (y2 >= 0) & (y2 < ph) & (x2 >= 0) & (x2 < pw); j = np.where(ok, y2 * pw + x2, 0)
        e = ok & (hv[j] | pinSet[j]); jj = np.where(hv[j], idx[j], pidx[j]); er.append(np.flatnonzero(e)); ec.append(jj[e])
    er = np.concatenate(er); ec = np.concatenate(ec)
    W = sparse.csr_matrix((np.ones(er.size), (er, ec)), shape=(M + P, M + P)); W = ((W + W.T) > 0).astype(np.float64)
    Ls = (sparse.diags(np.asarray(W.sum(1)).ravel() + np.r_[np.zeros(M), np.ones(P)]) - W).tocsr(); rhs = np.zeros(M + P); rhs[M:] = dq[pi]
    xs_ = pyamg.smoothed_aggregation_solver(Ls).solve(rhs, tol=1e-10, accel='cg')
    keep = np.ones(N, bool); keep[pi[np.abs(xs_[M:] - dq[pi]) > 2 * step]] = False
    A, b, hasPin, pinSet = build(keep)
    lab, nc = label(hole); comp = lab.ravel()[di] - 1; pinned = np.zeros(nc, bool); np.logical_or.at(pinned, comp, hasPin)
    live = pinned[comp]; li = np.flatnonzero(live); U = np.zeros((M, 4)); res = []
    if li.size:
        A2 = A[li][:, li].tocsr(); ml = pyamg.smoothed_aggregation_solver(A2)
        for ch in range(4):
            x = ml.solve(b[li, ch], tol=1e-10, accel='cg'); U[li, ch] = x; res.append(float(np.linalg.norm(b[li, ch] - A2 @ x) / max(1e-30, np.linalg.norm(b[li, ch]))))
    for k in np.flatnonzero(~pinned):
        mk = lab == k + 1; ring = binary_dilation(mk) & ~hole; sel = comp == k
        U[sel] = vals4[np.flatnonzero(ring.ravel())[np.argmin(dq[ring.ravel()])]] if ring.any() else vals4[di[sel]].min(0)
    info = {'pinsDropped': int((~keep).sum()), 'pins': int(pinSet.sum()), 'components': int(nc), 'componentsNoPin': int((~pinned).sum()),
            'texelsNoPin': int((~live).sum()), 'residual': res}
    return di, U, info
# a hole texel whose fill is not behind its own source depth by two steps (S35 s47) is not uncovered: it leaves the hole
# (clamping it there would copy the object's own relief into the plate), and the fill is solved again without it
dropped = 0; rounds = 0
while True:
    di, U, info = solve(hole); rounds += 1
    bad = U[:, 0] > dq[di] - 2 * step
    if not bad.any(): break
    hole.ravel()[di[bad]] = False; dropped += int(bad.sum())
st.update(info); st['notBehindLeftHole'] = dropped; st['solveRounds'] = rounds; st['hole'] = int(hole.sum())
plate = dq.copy(); plate[di] = U[:, 0]; plate = plate.reshape(ph, pw)      # outside the hole: the source, ramps collapsed (the app with ramps=safe draws the same)
wash = rgb.reshape(N, 3).copy(); wash[di] = np.clip(U[:, 1:], 0, 255); wash = wash.reshape(ph, pw, 3)
plate.astype(np.float32).tofile(os.path.join(OUT, 'plateD.f32')); hole.astype(np.uint8).tofile(os.path.join(OUT, 'hole.u8'))
Image.fromarray(np.round(wash).astype(np.uint8)).save(os.path.join(OUT, 'washD.png'))
# noise inside the hole, in visible steps: WALLS (neighbours more than one step apart: counts steep smooth slopes too) and
# KINKS (the second difference over one step: a smooth slope has none, a comb or a spike does)
w = 0; kk = 0
for p1, p2, mm in ((plate[1:], plate[:-1], hole[1:] & hole[:-1]), (plate[:, 1:], plate[:, :-1], hole[:, 1:] & hole[:, :-1])):
    w += int(((np.abs(p1 - p2) > step) & mm).sum())
for sec, mm in ((plate[2:] - 2 * plate[1:-1] + plate[:-2], hole[2:] & hole[1:-1] & hole[:-2]), (plate[:, 2:] - 2 * plate[:, 1:-1] + plate[:, :-2], hole[:, 2:] & hole[:, 1:-1] & hole[:, :-2])):
    kk += int(((np.abs(sec) > step) & mm).sum())
st['wallsInHole'] = w; st['kinksInHole'] = kk; st['secs'] = round(time.time() - t0, 1)
json.dump(st, open(os.path.join(OUT, 'stats.json'), 'w'), indent=1); print(json.dumps(st))
