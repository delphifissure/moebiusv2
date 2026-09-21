"""truthkit — exact ground truth for a single-image parallax portal.

An analytic multi-hit ray-caster (numpy) with the portal's own camera: a window rect of width W and
height H in the plane z = 0, the eye at (ex, ey, D) in front of it (z toward the viewer), content
behind the window at z < 0 and pop-out content at 0 < z < D. The image is the window itself: pixel
(i, j) is a point on the rect (optionally on an enlarged canvas with a margin beyond the rect), the
ray runs from the eye through it. The rest camera is the eye at (0, 0, D).

Per pixel the caster returns every surface the ray crosses, sorted front to back (up to K), so the
hidden layers behind any occluder, an object's own back, and the surfaces beside the photographed
frustum are all exact. Scenes are built from planes/quads, boxes, spheres, cylinders (rods) and
card canopies with procedural textures; shading is Lambert + ambient with a fixed light so sides
read as sides. No shadows.

Conventions
- world units: metres; depth behind the window d = -z (positive behind); the app's normalised
  depth is derived through its own mapping (see app_norm_depth).
- labels: 0 sky (never hit; the ray escapes), 1 stuff (walls, floor, ceiling, ground), 2 thing.
"""
import numpy as np

INF = np.inf


# ----------------------------------------------------------------------------- textures
def tex_checker(p, scale=0.05, c1=(0.82, 0.80, 0.76), c2=(0.35, 0.36, 0.40), axes=(0, 1)):
    a = np.floor(p[..., axes[0]] / scale).astype(int) + np.floor(p[..., axes[1]] / scale).astype(int)
    m = (a % 2 == 0)[..., None]
    return np.where(m, np.array(c1), np.array(c2))


def tex_stripes(p, scale=0.02, c1=(0.75, 0.55, 0.35), c2=(0.45, 0.30, 0.20), axis=0):
    m = ((np.floor(p[..., axis] / scale).astype(int) % 2) == 0)[..., None]
    return np.where(m, np.array(c1), np.array(c2))


def tex_bricks(p, bw=0.06, bh=0.03, mortar=0.004, c1=(0.62, 0.32, 0.26), c2=(0.80, 0.78, 0.74), axes=(0, 1)):
    x, y = p[..., axes[0]], p[..., axes[1]]
    row = np.floor(y / bh).astype(int)
    xo = x + (row % 2) * bw / 2
    fx = np.mod(xo, bw); fy = np.mod(y, bh)
    m = ((fx < mortar) | (fy < mortar))[..., None]
    return np.where(m, np.array(c2), np.array(c1))


def tex_noise(p, scale=0.01, base=(0.5, 0.6, 0.35), amp=0.25, seed=3, axes=(0, 1)):
    # value noise on a lattice, deterministic
    rs = np.random.RandomState(seed); lut = rs.rand(257, 257)
    x = p[..., axes[0]] / scale; y = p[..., axes[1]] / scale
    xi = np.floor(x).astype(int); yi = np.floor(y).astype(int); fx = x - xi; fy = y - yi
    def v(i, j): return lut[np.mod(i, 257), np.mod(j, 257)]
    n = (v(xi, yi) * (1 - fx) * (1 - fy) + v(xi + 1, yi) * fx * (1 - fy) + v(xi, yi + 1) * (1 - fx) * fy + v(xi + 1, yi + 1) * fx * fy)
    return np.clip(np.array(base) * (1 + amp * (n[..., None] - 0.5) * 2), 0, 1)


def tex_solid(c):
    c = np.array(c)
    return lambda p: np.broadcast_to(c, p.shape[:-1] + (3,)).copy()


def tex_text_like(p, cell=0.04, c1=(0.95, 0.95, 0.92), c2=(0.08, 0.08, 0.1), axes=(0, 1), seed=7):
    # blocky glyph-like pattern: a fraction of cells filled, deterministic
    rs = np.random.RandomState(seed); lut = rs.rand(257, 257) < 0.45
    xi = np.floor(p[..., axes[0]] / cell).astype(int); yi = np.floor(p[..., axes[1]] / cell).astype(int)
    m = lut[np.mod(xi, 257), np.mod(yi, 257)][..., None]
    return np.where(m, np.array(c2), np.array(c1))


# ----------------------------------------------------------------------------- primitives
class Prim:
    """Base: intersect(o, d) -> list of (t, normal_fn) candidates; each candidate t is an array (N,) with inf for misses.
    normal(p) -> (N,3); colour(p) -> (N,3)."""
    label = 2  # thing
    name = 'prim'

    def __init__(self, tex, label=2, name=None, pid=None):
        self.tex = tex; self.label = label; self.name = name or self.__class__.__name__; self.pid = pid

    def hits(self, o, d):
        raise NotImplementedError

    def normal(self, p):
        raise NotImplementedError

    def colour(self, p):
        return self.tex(p)


class Quad(Prim):
    """Finite rectangle: centre c, unit axes u, v (half-extents hu, hv); normal n = u x v (two-sided)."""

    def __init__(self, c, u, v, hu, hv, tex, label=1, name=None):
        super().__init__(tex, label, name)
        self.c = np.array(c, float); self.u = np.array(u, float) / np.linalg.norm(u); self.v = np.array(v, float) / np.linalg.norm(v)
        self.n = np.cross(self.u, self.v); self.n /= np.linalg.norm(self.n); self.hu = hu; self.hv = hv
        # non-orthogonal axes make a parallelogram (S16's ledge between two parallel wall lines offset in z);
        # the in-plane coordinates come from the Gram system, which is the identity for the usual rectangle
        self._uv = float(self.u @ self.v); self._det = 1.0 - self._uv * self._uv

    def hits(self, o, d):
        denom = d @ self.n
        with np.errstate(divide='ignore', invalid='ignore'):
            t = ((self.c - o) @ self.n) / denom
            p = o + t[:, None] * d
            rel = p - self.c
            a0 = rel @ self.u; b0 = rel @ self.v
            if self._uv != 0.0: a = (a0 - self._uv * b0) / self._det; b = (b0 - self._uv * a0) / self._det
            else: a = a0; b = b0
        ok = (np.abs(denom) > 1e-12) & (t > 1e-9) & (np.abs(a) <= self.hu) & (np.abs(b) <= self.hv)
        return [np.where(ok, t, INF)]

    def normal(self, p):
        return np.broadcast_to(self.n, p.shape).copy()


class Box(Prim):
    """Axis-aligned box [lo, hi]; returns entry and exit."""

    def __init__(self, lo, hi, tex, label=2, name=None):
        super().__init__(tex, label, name)
        self.lo = np.array(lo, float); self.hi = np.array(hi, float)

    def hits(self, o, d):
        with np.errstate(divide='ignore', invalid='ignore'):
            inv = 1.0 / d
            t0 = (self.lo - o) * inv; t1 = (self.hi - o) * inv
        tmin = np.max(np.minimum(t0, t1), axis=1); tmax = np.min(np.maximum(t0, t1), axis=1)
        ok = (tmax > np.maximum(tmin, 1e-9))
        te = np.where(ok & (tmin > 1e-9), tmin, INF); tx = np.where(ok, tmax, INF)
        return [te, tx]

    def normal(self, p):
        c = (self.lo + self.hi) / 2; h = (self.hi - self.lo) / 2
        rel = (p - c) / h
        idx = np.argmax(np.abs(rel), axis=1)
        n = np.zeros_like(p); n[np.arange(len(p)), idx] = np.sign(rel[np.arange(len(p)), idx])
        return n


class Sphere(Prim):
    def __init__(self, c, r, tex, label=2, name=None):
        super().__init__(tex, label, name); self.c = np.array(c, float); self.r = r

    def hits(self, o, d):
        oc = o - self.c
        b = np.sum(oc * d, axis=1); c = np.sum(oc * oc, axis=1) - self.r ** 2
        disc = b * b - c
        ok = disc > 0
        s = np.sqrt(np.where(ok, disc, 0))
        t0 = -b - s; t1 = -b + s
        return [np.where(ok & (t0 > 1e-9), t0, INF), np.where(ok & (t1 > 1e-9), t1, INF)]

    def normal(self, p):
        n = p - self.c; return n / np.linalg.norm(n, axis=1, keepdims=True)


class Cylinder(Prim):
    """Finite cylinder from a to b with radius r (no caps by default; caps optional)."""

    def __init__(self, a, b, r, tex, label=2, name=None, caps=True):
        super().__init__(tex, label, name)
        self.a = np.array(a, float); self.b = np.array(b, float); self.r = r; self.caps = caps
        self.ax = self.b - self.a; self.L = np.linalg.norm(self.ax); self.ax /= self.L

    def hits(self, o, d):
        oa = o - self.a
        dd = d - (d @ self.ax)[:, None] * self.ax
        od = oa - (oa @ self.ax)[:, None] * self.ax
        A = np.sum(dd * dd, axis=1); B = 2 * np.sum(dd * od, axis=1); C = np.sum(od * od, axis=1) - self.r ** 2
        disc = B * B - 4 * A * C
        ok = (disc > 0) & (A > 1e-14)
        s = np.sqrt(np.where(ok, disc, 0)); Aq = np.where(ok, A, 1)
        out = []
        for t in ((-B - s) / (2 * Aq), (-B + s) / (2 * Aq)):
            p = o + t[:, None] * d; h = (p - self.a) @ self.ax
            out.append(np.where(ok & (t > 1e-9) & (h >= 0) & (h <= self.L), t, INF))
        if self.caps:
            for cen, sgn in ((self.a, -1), (self.b, 1)):
                denom = d @ self.ax
                with np.errstate(divide='ignore', invalid='ignore'):
                    t = ((cen - o) @ self.ax) / denom
                p = o + t[:, None] * d; rad = np.linalg.norm(p - cen - ((p - cen) @ self.ax)[:, None] * self.ax, axis=1)
                out.append(np.where((np.abs(denom) > 1e-12) & (t > 1e-9) & (rad <= self.r), t, INF))
        return out

    def normal(self, p):
        h = (p - self.a) @ self.ax
        n = p - self.a - h[:, None] * self.ax
        rad = np.linalg.norm(n, axis=1)
        side = n / np.maximum(rad, 1e-12)[:, None]
        capn = np.broadcast_to(self.ax, p.shape)
        oncap = (np.abs(h) < 1e-6) | (np.abs(h - self.L) < 1e-6)
        return np.where(oncap[:, None], np.where((h < 1e-6)[:, None], -capn, capn), side)


class Ellipsoid(Prim):
    """Axis-aligned ellipsoid centre c, radii (rx, ry, rz)."""

    def __init__(self, c, radii, tex, label=2, name=None):
        super().__init__(tex, label, name); self.c = np.array(c, float); self.R = np.array(radii, float)

    def hits(self, o, d):
        oc = (o - self.c) / self.R; dn = d / self.R
        a = np.sum(dn * dn, axis=1); b = np.sum(oc * dn, axis=1); c = np.sum(oc * oc, axis=1) - 1
        disc = b * b - a * c; ok = disc > 0
        s = np.sqrt(np.where(ok, disc, 0)); aq = np.where(ok, a, 1)
        t0 = (-b - s) / aq; t1 = (-b + s) / aq
        return [np.where(ok & (t0 > 1e-9), t0, INF), np.where(ok & (t1 > 1e-9), t1, INF)]

    def normal(self, p):
        n = (p - self.c) / (self.R ** 2); return n / np.linalg.norm(n, axis=1, keepdims=True)


class Disc(Prim):
    """Flat disc (leaf card): centre c, normal n, radius r; two-sided."""

    def __init__(self, c, n, r, tex, label=2, name=None):
        super().__init__(tex, label, name); self.c = np.array(c, float); self.n = np.array(n, float) / np.linalg.norm(n); self.r = r

    def hits(self, o, d):
        denom = d @ self.n
        with np.errstate(divide='ignore', invalid='ignore'):
            t = ((self.c - o) @ self.n) / denom
        p = o + t[:, None] * d
        ok = (np.abs(denom) > 1e-12) & (t > 1e-9) & (np.linalg.norm(p - self.c, axis=1) <= self.r)
        return [np.where(ok, t, INF)]

    def normal(self, p):
        return np.broadcast_to(self.n, p.shape).copy()


class Canopy(Prim):
    """A porous crown: many discs in an ellipsoidal volume, cast as one primitive with many candidates.
    For efficiency the discs are grouped; hits() returns up to `kmax` nearest disc hits per ray."""

    def __init__(self, c, radii, n_discs, disc_r, tex, seed=11, label=2, name='canopy', kmax=6):
        super().__init__(tex, label, name)
        rs = np.random.RandomState(seed)
        c = np.array(c, float); R = np.array(radii, float)
        u = rs.normal(size=(n_discs * 3, 3)); u /= np.linalg.norm(u, axis=1, keepdims=True)
        rad = rs.rand(n_discs * 3) ** (1 / 3)
        pts = c + u * rad[:, None] * R
        self.centres = pts[:n_discs]
        nn = rs.normal(size=(n_discs, 3)); self.normals = nn / np.linalg.norm(nn, axis=1, keepdims=True)
        self.r = disc_r; self.kmax = kmax
        self.bc = c; self.bR = R

    def hits(self, o, d):
        N = len(o)
        # bounding ellipsoid cull
        oc = (o - self.bc) / self.bR; dn = d / self.bR
        a = np.sum(dn * dn, axis=1); b = np.sum(oc * dn, axis=1); cc = np.sum(oc * oc, axis=1) - 1
        inside = (b * b - a * cc) > 0
        idx = np.nonzero(inside)[0]
        best = np.full((N, self.kmax), INF)
        if len(idx) == 0:
            return [best[:, k] for k in range(self.kmax)]
        oo = o[idx]; dd = d[idx]
        # chunk over discs and keep only the kmax nearest hits per ray as we go: concatenating every disc's t
        # (rays x discs) was 11 GB on a 3 600-disc canopy and the kernel killed the render; the running
        # partial sort gives the same kmax smallest values exactly.
        keep = np.full((len(idx), self.kmax), INF); m = 64
        for s in range(0, len(self.centres), m):
            C = self.centres[s:s + m]; Nn = self.normals[s:s + m]
            denom = dd @ Nn.T                                       # (n, m)
            with np.errstate(divide='ignore', invalid='ignore'):
                t = ((C[None, :, :] - oo[:, None, :]) * Nn[None, :, :]).sum(-1) / denom
            p = oo[:, None, :] + t[..., None] * dd[:, None, :]
            ok = (np.abs(denom) > 1e-12) & (t > 1e-9) & (np.linalg.norm(p - C[None], axis=-1) <= self.r)
            T = np.concatenate([keep, np.where(ok, t, INF)], axis=1)
            keep = np.partition(T, self.kmax - 1, axis=1)[:, :self.kmax] if T.shape[1] > self.kmax else T
        keep.sort(axis=1)
        best[idx, :keep.shape[1]] = keep
        return [best[:, k] for k in range(self.kmax)]

    def normal(self, p):
        # nearest disc's normal
        n = np.zeros_like(p)
        for s in range(0, len(p), 4096):
            q = p[s:s + 4096]
            d2 = ((q[:, None, :] - self.centres[None]) ** 2).sum(-1)
            j = np.argmin(d2, axis=1); n[s:s + 4096] = self.normals[j]
        return n


# ----------------------------------------------------------------------------- camera
class Portal:
    """Window rect W x H at z = 0; eye at (ex, ey, D). Canvas covers the rect enlarged by `margin`
    (fraction of W/H per side); nx, ny pixels over the enlarged canvas."""

    def __init__(self, W, H, D, nx, ny, margin=0.0):
        self.W = W; self.H = H; self.D = D; self.nx = nx; self.ny = ny; self.margin = margin
        self.cw = W * (1 + 2 * margin); self.ch = H * (1 + 2 * margin)

    def pixel_centres(self):
        xs = (np.arange(self.nx) + 0.5) / self.nx * self.cw - self.cw / 2
        ys = self.ch / 2 - (np.arange(self.ny) + 0.5) / self.ny * self.ch
        X, Y = np.meshgrid(xs, ys)
        return np.stack([X, Y, np.zeros_like(X)], axis=-1)

    def in_frame(self, x, y):
        return (np.abs(x) <= self.W / 2) & (np.abs(y) <= self.H / 2)

    def rays(self, eye):
        P = self.pixel_centres().reshape(-1, 3)
        o = np.broadcast_to(np.array(eye, float), P.shape).copy()
        d = P - o; d /= np.linalg.norm(d, axis=1, keepdims=True)
        return o, d

    def project(self, P, eye):
        """World points -> window-plane intercept (x, y) of the ray from `eye` through P, and pixel indices on the canvas."""
        eye = np.array(eye, float)
        s = eye[2] / (eye[2] - P[:, 2])
        x = eye[0] + (P[:, 0] - eye[0]) * s; y = eye[1] + (P[:, 1] - eye[1]) * s
        i = np.floor((x + self.cw / 2) / self.cw * self.nx).astype(int)
        j = np.floor((self.ch / 2 - y) / self.ch * self.ny).astype(int)
        return x, y, i, j


# ----------------------------------------------------------------------------- render
LIGHT = np.array([0.3, 0.6, 1.0]); LIGHT = LIGHT / np.linalg.norm(LIGHT)


def render(scene, portal, eye, K=6, shade=True, ambient=0.35):
    """Returns dict of arrays shaped (ny, nx, K): t, depth (= -z), pid, label, rgb (…,3), nrm (…,3), pts (…,3); missing = inf/-1."""
    o, d = portal.rays(eye)
    N = len(o)
    # S35 §54: a running top-K of the nearest hits instead of stacking every primitive's candidates (that was O(prims x N):
    # L5's 180 primitives over the 1.44 M-sample canvas were 14 GB and the process was killed). Memory is O(N x K); the
    # result is the same K nearest hits in the same stable order.
    T = np.full((N, K), INF); PID = np.full((N, K), -1, dtype=np.int32)
    for pi, prim in enumerate(scene):
        for t in prim.hits(o, d):
            hit = np.isfinite(t) & (t < T[:, -1])
            if not hit.any(): continue
            idx = np.flatnonzero(hit); tt = t[idx]
            Ts = np.concatenate([T[idx], tt[:, None]], axis=1); Ps = np.concatenate([PID[idx], np.full((len(idx), 1), pi, dtype=np.int32)], axis=1)
            order = np.argsort(Ts, axis=1, kind='stable')
            T[idx] = np.take_along_axis(Ts, order, axis=1)[:, :K]; PID[idx] = np.take_along_axis(Ps, order, axis=1)[:, :K]
    # drop duplicate hits at the same t (touching surfaces)
    valid = np.isfinite(T)
    PID = np.where(valid, PID, -1)
    pts = o[:, None, :] + T[..., None] * d[:, None, :]
    pts = np.where(valid[..., None], pts, 0)
    rgb = np.zeros((N, K, 3)); nrm = np.zeros((N, K, 3)); label = np.full((N, K), -1, dtype=np.int8)
    for pi, prim in enumerate(scene):
        m = PID == pi
        if not m.any():
            continue
        p = pts[m]
        n = prim.normal(p)
        c = prim.colour(p)
        if shade:
            # two-sided Lambert: light the side facing the eye
            dirs = np.broadcast_to(d[:, None, :], pts.shape)[m]
            nf = np.where((np.sum(n * dirs, axis=1) > 0)[:, None], -n, n)
            lam = np.clip(nf @ LIGHT, 0, 1)
            c = c * (ambient + (1 - ambient) * lam)[:, None]
        rgb[m] = c; nrm[m] = n; label[m] = prim.label
    depth = np.where(valid, -pts[..., 2], INF)
    sh = (portal.ny, portal.nx)
    return {'t': T.reshape(sh + (K,)), 'depth': depth.reshape(sh + (K,)), 'pid': PID.reshape(sh + (K,)),
            'label': label.reshape(sh + (K,)), 'rgb': rgb.reshape(sh + (K, 3)), 'nrm': nrm.reshape(sh + (K, 3)),
            'pts': pts.reshape(sh + (K, 3)), 'valid': valid.reshape(sh + (K,)), 'dir': d.reshape(sh + (3,))}


# ----------------------------------------------------------------------------- the app's depth mapping
def app_z_of_d(dn, pn, outer, inner):
    """moebius.js viewSpaceDisplacement: d < pn -> z = -outer + outer*smoothstep(d/pn) (behind the portal);
    d >= pn -> z = inner*smoothstep((d-pn)/(1-pn)) (pop-out toward the viewer). z is world offset from the portal plane,
    positive toward the viewer."""
    dn = np.clip(dn, 0, 1)
    t1 = dn / pn; s1 = t1 * t1 * (3 - 2 * t1)
    t2 = (dn - pn) / (1 - pn); s2 = t2 * t2 * (3 - 2 * t2)
    return np.where(dn < pn, -outer + outer * s1, inner * s2)


def app_norm_depth(z, pn, outer, inner, n_tab=8193):
    """Inverse of app_z_of_d by table lookup (monotone). z in [-outer, inner]; outside is clamped."""
    dn = np.linspace(0, 1, n_tab); zt = app_z_of_d(dn, pn, outer, inner)
    return np.interp(np.clip(z, -outer, inner), zt, dn)


# --------------------------------------------------------------- S43 / Sprint 23: the score, defined once
# S38 found a metre score is not comparable across scenes: the depth law's gain dm/dd varies twentyfold across the kit (0.57
# on L1, 19.72 on S15), so a fixed relative error costs twenty times more in one scene than another for reasons that have
# nothing to do with a construction's quality. S42 caught the law doing it -- L1's band reads 0.0112 m / 0.0198 d and L6's
# reads 0.0154 m / 0.0106 d, so the two units RANK THOSE TWO SCENES IN OPPOSITE ORDERS.
#
# R7 found the fix is standard: every depth paper in that corpus reports a ratio metric alongside RMSE and both usual ones are
# exactly gain-invariant. Four families, all reported:
#   d      the app's own normalised depth. PRIMARY -- it is the space the app works in, parallax at the window follows it,
#          and it removes the law's gain entirely.
#   steps  the same over the scene's own visible quantisation step: "how many depth levels wrong", the §16 bar.
#   m      metres behind the window. Kept for continuity with every table written before today; no longer primary.
#   log10, delta   on the CAMERA distance D + metres behind the window, which is strictly positive so the log is defined.
#          These are the literature's metrics and they make our numbers comparable with published work for the first time.
def depth_scores(d_pred, d_true, mask, meta, step=None, prefix=''):
    """d_pred, d_true: the app's normalised depth in [0, 1]. mask: where to score. Returns a flat dict."""
    pn, outer, inner, D = meta['pn'], meta['outer'], meta['inner'], meta.get('D') or 0.0
    m = mask & np.isfinite(d_pred) & np.isfinite(d_true)
    n = int(m.sum()); out = {prefix + 'n': n}
    if n == 0:
        return out
    a, b = np.asarray(d_pred)[m], np.asarray(d_true)[m]
    ed = np.abs(a - b)
    mp = -app_z_of_d(a, pn, outer, inner); mt = -app_z_of_d(b, pn, outer, inner)   # metres behind the window
    em = np.abs(mp - mt)
    zp, zt = D + mp, D + mt                                                        # camera distance, strictly positive
    ok = (zp > 1e-9) & (zt > 1e-9)
    out.update({prefix + 'd_med': float(np.median(ed)), prefix + 'd_p90': float(np.percentile(ed, 90)),
                prefix + 'd_rms': float(np.sqrt(np.mean(ed ** 2))),
                prefix + 'm_med': float(np.median(em)), prefix + 'm_p90': float(np.percentile(em, 90)),
                prefix + 'm_rms': float(np.sqrt(np.mean(em ** 2)))})
    if step:
        out[prefix + 'steps_med'] = float(np.median(ed) / step)
        out[prefix + 'steps_p90'] = float(np.percentile(ed, 90) / step)
    if ok.any():
        r = np.maximum(zp[ok] / zt[ok], zt[ok] / zp[ok])
        out.update({prefix + 'log10': float(np.mean(np.abs(np.log10(zp[ok]) - np.log10(zt[ok])))),
                    prefix + 'd1': float(np.mean(r < 1.25)), prefix + 'd2': float(np.mean(r < 1.25 ** 2)),
                    prefix + 'd3': float(np.mean(r < 1.25 ** 3))})
    return out


def commit_scores(d_pred, d_occ, d_true, mask, meta, step, prefix='commit_'):
    """Gen3R's accuracy/completeness split, adapted to a depth band. One aggregate error lets two opposite failures hide
    behind each other: bleeding the occluder's own surface into the hole, and leaving the hole unfilled. A texel COUNTS AS
    COMMITTED when the prediction has moved off the occluder's plate depth by more than the visible step -- which is exactly
    §47's definition of a clone, since an unowned band texel keeps the occluder's depth by construction.
      completeness  the fraction of scored texels the method committed on
      accuracy      the error over those committed texels alone
    A timid fill scores well on accuracy and badly on completeness; a cloning fill scores badly on both."""
    fin = mask & np.isfinite(d_pred) & np.isfinite(d_true)
    committed = fin & (np.abs(np.asarray(d_pred) - np.asarray(d_occ)) > step)
    out = {prefix + 'completeness': float(committed.sum() / max(1, fin.sum()))}
    out.update(depth_scores(d_pred, d_true, committed, meta, step, prefix))
    return out


# ----------------------------------------------------------------------------- io helpers
def to_u8(img):
    return (np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)


def save_png(path, arr, bits=8):
    from PIL import Image
    if arr.ndim == 2:
        if bits == 16:
            Image.fromarray((np.clip(arr, 0, 1) * 65535 + 0.5).astype(np.uint16)).save(path)
        else:
            Image.fromarray(to_u8(arr)).save(path)
    else:
        Image.fromarray(to_u8(arr)).save(path)


def load_gray(path):
    from PIL import Image
    im = Image.open(path)
    a = np.array(im)
    if a.dtype == np.uint16:
        return a.astype(np.float32) / 65535
    if a.ndim == 3:
        a = a[..., 0]
    return a.astype(np.float32) / 255
