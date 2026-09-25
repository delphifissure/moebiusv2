#!/usr/bin/env python3
"""A cut between two focal lengths, checked in closed form (S67 §6).

The same real scene is shot twice, at 24 mm and 200 mm full-frame equivalent (hfov = 2 atan(18/f)), the camera placed
so the head-sized subject fills the same fraction of the frame. Each shot is shown through the fixed portal (W = 0.16 m)
as the app builds it: the real scene scaled uniformly by m_i = W / (2 Z_s tan(hfov_i/2)) about the subject plane, the
subject plane pinned on the portal, the virtual eye at the scaled camera D_i = m_i Z_s = (W/2)/tan(hfov_i/2). Points are
projected from the virtual eye onto the portal plane (Portal.project's formula; portal units = metres on the 0.16 m rect).

Head mappings (real eye E = (x, 0, d_real) about the portal centre, d_int = intended viewing distance):
  A  angle-preserving, window._headByAngle:  E_v = E * D_i / d_int         (every viewing angle kept)
  B  constant metres (the dolly as built):   E_v = (x, 0, D_i * d_real / d_int)  (lateral offset unchanged in metres)
Depth arms:
  true   the scaled real scene in 3-D, depths m_i (Z - Z_s) (the whole ellipsoid: its silhouette is exact);
  app    the app's fixed volume: the rest photograph's texels (rest-visible surface only) re-placed along their rest rays
         at z = app_z_of_d(d; pn, outer 0.02 behind, inner 0.04 in front), d = min-max normalised disparity (1 near) over
         the shot's visible range, pn = d(subject plane) (the subject pinned);
  prop   the per-shot law proposed below (exact inverse of the affine disparity), which must reproduce `true` on the
         rest-visible texels.

Closed form behind the proposal: a texel's screen shift per unit virtual eye offset is g = -z/(D - z) (the app's
e z/(D - z) law), and for the scaled scene g = 1 - Z_s/Z. With affine disparity 1/Z = 1/Z_f + d (1/Z_n - 1/Z_f),
g(d) = kappa (pn - d), kappa = Z_s (1/Z_n - 1/Z_f): parallax is LINEAR in normalised disparity with one per-shot slope,
and z(d) = -D g/(1 - g).

  python3 cut_check.py [--fill 0.4] [--wphys 0.16] [--dint 0.5]
Writes out/cut_check.json and prints the table.
"""
import argparse, json, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from tk import app_z_of_d

W, H = 0.16, 0.09
OUTER, INNER = 0.02, 0.04            # moebius.js outerVolumeDepth (behind, d < pn) / innerVolumeDepth (in front, d > pn)

# ------------------------------------------------------------------ the real scene (metres; S = distance behind the
# subject plane, which is the plane of the eyes; X right, Y up). Camera at S = -Z_s.
HEAD_C = np.array([0.0, 0.0, 0.07])  # ellipsoid centre: 0.16 wide, 0.22 high, 0.20 deep; nose tip 0.03 in front of the eyes
HEAD_R = np.array([0.08, 0.11, 0.10])
AZ_EAR = np.radians(70.0)            # "ear": side of the head, 70 deg round from the nose (visible at rest in both shots)
PTS = {
    'nose': HEAD_C + np.array([0.0, 0.0, -HEAD_R[2]]),
    'ear': HEAD_C + np.array([HEAD_R[0] * np.sin(AZ_EAR), 0.0, -HEAD_R[2] * np.cos(AZ_EAR)]),
    'mid': np.array([0.20, 0.0, 1.5]),       # a mid object 1.5 m behind the subject
    'bg': np.array([1.0, 0.5, 50.0]),        # the far background (clouds / billboard) 50 m behind
}
S_FAR = 50.0


def ellipsoid(nu=240, nv=120):
    u = np.linspace(0, 2 * np.pi, nu, endpoint=False); v = np.linspace(0, np.pi, nv)[1:-1]
    U, V = np.meshgrid(u, v)
    dirs = np.stack([np.sin(V) * np.sin(U), np.cos(V), -np.sin(V) * np.cos(U)], -1).reshape(-1, 3)   # U = 0 is the nose
    P = HEAD_C + dirs * HEAD_R
    N = dirs / HEAD_R; N /= np.linalg.norm(N, axis=1, keepdims=True)
    return P, N


def project(P, eye):
    """Ray from eye through P meets the portal plane z = 0 (tk.Portal.project)."""
    s = eye[2] / (eye[2] - P[..., 2])
    return np.stack([eye[0] + (P[..., 0] - eye[0]) * s, eye[1] + (P[..., 1] - eye[1]) * s], -1)


class Shot:
    def __init__(self, f_mm, fill):
        self.f = f_mm; self.hfov = 2 * np.degrees(np.arctan(18.0 / f_mm))
        t = np.tan(np.radians(self.hfov) / 2)
        self.Zs = (2 * HEAD_R[0] / fill) / (2 * t)          # frame width at the subject plane = head width / fill
        self.m = W / (2 * self.Zs * t)                      # uniform scale real -> portal
        self.D = (W / 2) / t                                 # centre of projection (= m Zs)
        assert abs(self.D - self.m * self.Zs) < 1e-12
        # the depth estimator's normalised disparity over the shot's visible range (nose tip .. background)
        self.Zn = self.Zs + PTS['nose'][2]; self.Zf = self.Zs + S_FAR
        self.pn = self.d_of_Z(self.Zs)
        self.kappa = self.Zs * (1 / self.Zn - 1 / self.Zf)

    def d_of_Z(self, Z):
        return (1 / Z - 1 / self.Zf) / (1 / self.Zn - 1 / self.Zf)

    def virt(self, P):                                       # real scene -> portal world (z toward the viewer)
        return np.stack([self.m * P[..., 0], self.m * P[..., 1], -self.m * P[..., 2]], -1)

    def z_app(self, Z):
        return app_z_of_d(self.d_of_Z(Z), self.pn, OUTER, INNER)

    def z_prop(self, Z):
        g = self.kappa * (self.pn - self.d_of_Z(Z))
        return -self.D * g / (1 - g)

    def on_rest_ray(self, Pv, z):                            # the app keeps each texel on its rest ray (a104 ray law)
        u = project(Pv, np.array([0.0, 0.0, self.D]))
        k = (self.D - z) / self.D
        return np.stack([u[..., 0] * k, u[..., 1] * k, z], -1)

    def eye(self, mapping, x, d_real, d_int):
        if mapping == 'A':
            return np.array([x, 0.0, d_real]) * self.D / d_int
        if mapping.startswith('C'):                          # the true-window eye: the real eye in portal units
            return np.array([x, 0.0, d_real]) * self.D_ref / d_int
        return np.array([x, 0.0, self.D * d_real / d_int])

    def rest_eye(self, mapping):
        return np.array([0.0, 0.0, self.D_ref if mapping.startswith('C') else self.D])

    def g_C(self, gB, mode='C'):
        """Mapping C's parallax remap: g = gB (a + (1 - a) gB), a = D_i / D_true. Slope a at the pin plane (A's relief),
        g -> 1 as gB -> 1 (B's background: nothing past infinity).
        'Cf': C with A's linear law in front of the portal (removes C's fold for a < 1).
        'Cm': the projective remap g = a gB / (1 + (a - 1) gB) -- same slope a at 0 and g -> 1, monotone for every a, and
              identically g = b/(D_true + b): the shot's scaled METRIC depth b kept, on the true-window eye's rest rays."""
        a = self.D / self.D_ref
        if mode == 'Cm':
            return a * gB / (1 + (a - 1) * gB)
        g = gB * (a + (1 - a) * gB)
        return np.where(gB < 0, a * gB, g) if mode == 'Cf' else g

    def remap_C(self, P, mode='C'):
        """Each point re-placed on its REST ray from the reference eye at D_true (so the rest view is the photograph)
        at the depth behind the glass whose parallax is g_C(g_B), g_B = b/(D_i + b) its parallax in the shot."""
        u = project(P, np.array([0.0, 0.0, self.D]))
        b = -P[..., 2]; gB = b / (self.D + b)
        g = self.g_C(gB, mode)
        zb = self.D_ref * g / (1 - g)
        k = (self.D_ref + zb) / self.D_ref
        return np.stack([u[..., 0] * k, u[..., 1] * k, -zb], -1)


def geometry(shot, arm, P_head, N_head, mapping='A'):
    """Portal-world points of the subject samples and the named points under a depth arm (and mapping C's remap)."""
    if mapping.startswith('C'):
        Ph, named = geometry(shot, arm, P_head, N_head)
        return shot.remap_C(Ph, mapping), {k: shot.remap_C(v, mapping) for k, v in named.items()}
    Pv = shot.virt(P_head); named = {k: shot.virt(v) for k, v in PTS.items()}
    if arm == 'true':
        return Pv, named
    # rest-visible texels only (the depth map is the photograph's front surface)
    cam = np.array([0.0, 0.0, -shot.Zs])
    vis = np.einsum('ij,ij->i', N_head, cam - P_head) > 0
    law = shot.z_app if arm == 'app' else shot.z_prop
    Ph = shot.on_rest_ray(Pv[vis], law(shot.Zs + P_head[vis, 2]))
    named = {k: shot.on_rest_ray(shot.virt(v), law(shot.Zs + v[2])) for k, v in PTS.items()}
    return Ph, named


def measure(shot, arm, eye, P_head, N_head, mapping='A'):
    Ph, named = geometry(shot, arm, P_head, N_head, mapping)
    q = project(Ph, eye)
    x0, x1 = q[:, 0].min(), q[:, 0].max(); y0, y1 = q[:, 1].min(), q[:, 1].max()
    r = {'subj_cx': (x0 + x1) / 2, 'subj_cy': (y0 + y1) / 2, 'subj_w': x1 - x0, 'subj_h': y1 - y0, 'subj_L': x0, 'subj_R': x1}
    for k, v in named.items():
        r[k + '_x'] = float(project(v, eye)[0])
    return {k: float(v) for k, v in r.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fill', type=float, default=0.4, help='head width / frame width at the subject plane')
    ap.add_argument('--dint', type=float, default=0.5)
    ap.add_argument('--wphys', type=float, default=W, help='physical width of the portal on the screen (m); only the '
                    'viewer-frame figures (degrees, perceived background depth) use it')
    ap.add_argument('--f', default='24,200')
    a = ap.parse_args()
    here = os.path.dirname(os.path.abspath(__file__)); os.makedirs(os.path.join(here, 'out'), exist_ok=True)
    P_head, N_head = ellipsoid()
    shots = [Shot(float(f), a.fill) for f in a.f.split(',')]
    for sh in shots:
        sh.D_ref = a.dint * W / a.wphys                      # the true-window reference eye distance in portal units
    lats = [0.0, 0.05, -0.05, 0.1, -0.1, 0.2, -0.2]; leans = [0.35, 0.5, 0.7]
    k_phys = a.wphys / W                                      # portal metres -> screen metres

    out = {'W': W, 'H': H, 'outer': OUTER, 'inner': INNER, 'fill': a.fill, 'd_int': a.dint, 'w_phys': a.wphys,
           'scene_real': {k: v.tolist() for k, v in PTS.items()} | {'head_centre': HEAD_C.tolist(), 'head_semi': HEAD_R.tolist()},
           'shots': [], 'rows': []}
    for sh in shots:
        info = {'f_mm': sh.f, 'hfov_deg': sh.hfov, 'Z_subject': sh.Zs, 'm': sh.m, 'D': sh.D, 'pn_app': sh.pn, 'kappa': sh.kappa,
                'Z_near': sh.Zn, 'Z_far': sh.Zf}
        for k, v in PTS.items():
            Z = sh.Zs + v[2]
            info['z_' + k] = {'metric': float(-sh.m * v[2]), 'app': float(sh.z_app(Z)), 'prop': float(sh.z_prop(Z)),
                              'd': float(sh.d_of_Z(Z))}
        # the proposal's volume extents (what the app would set per shot)
        info['prop_outer'] = float(-sh.z_prop(sh.Zf)); info['prop_inner'] = float(sh.z_prop(sh.Zn))
        out['shots'].append(info)
        # mapping C's parallax remap: slope a at the pin plane; fold where dg/dgB = a + 2(1 - a) gB = 0
        aC = sh.D / sh.D_ref; gBs = {k: float(-sh.virt(v)[2] / (sh.D - sh.virt(v)[2])) for k, v in PTS.items()}
        gB_fold = (-aC / (2 * (1 - aC))) if aC < 1 else (aC / (2 * (aC - 1)) if aC > 1 else -np.inf)
        grid = np.linspace(gBs['nose'], gBs['bg'], 20001); gg = sh.g_C(grid)
        info['C'] = {'a': aC, 'D_true': sh.D_ref, 'gB': gBs, 'g': {k: float(sh.g_C(v)) for k, v in gBs.items()},
                     'gB_fold': gB_fold, 'monotone_over_scene': bool(np.all(np.diff(gg) > 0)),
                     'g_min_front': float(-aC * aC / (4 * (1 - aC))) if aC < 1 else None,
                     # the nearest pop-out C can express before folding, in real metres in front of the pin plane (a < 1)
                     'fold_real_m_in_front': float((-gB_fold * sh.D / (1 - gB_fold)) / sh.m) if aC < 1 else None,
                     'g_Cm': {k: float(sh.g_C(v, 'Cm')) for k, v in gBs.items()},
                     'monotone_over_scene_Cm': bool(np.all(np.diff(sh.g_C(grid, 'Cm')) > 0))}
        MAPS = ('A', 'B', 'C', 'Cf', 'Cm')
        rest = {(mp, arm): measure(sh, arm, sh.rest_eye(mp), P_head, N_head, mp) for mp in MAPS for arm in ('true', 'app', 'prop')
                if not (mp.startswith('C') and arm == 'app')}
        for mp in MAPS:
            for arm in ('true', 'app', 'prop'):
                if mp.startswith('C') and arm == 'app':
                    continue                                  # C remaps metric depth; the fixed volume has none
                for d in leans:
                    for x in lats:
                        eye = sh.eye(mp, x, d, a.dint)
                        r = measure(sh, arm, eye, P_head, N_head, mp); r0 = rest[(mp, arm)]
                        row = {'f_mm': sh.f, 'map': mp, 'arm': arm, 'x': x, 'd_real': d, 'eye_v': eye.tolist(), **r}
                        sh_ = {k: r[k + '_x'] - r0[k + '_x'] for k in PTS}
                        s_c = r['subj_cx'] - r0['subj_cx']
                        row.update({'dx_' + k: v for k, v in sh_.items()})
                        row['dx_subj'] = s_c
                        row['relief'] = sh_['nose'] - sh_['ear']                   # nose vs side-of-head parallax
                        row['bg_vs_frame'] = sh_['bg']; row['bg_vs_subj'] = sh_['bg'] - s_c; row['mid_vs_subj'] = sh_['mid'] - s_c
                        # viewer frame: a screen shift s (portal m) at distance d subtends s*k_phys/d rad
                        row['relief_deg'] = float(np.degrees(row['relief'] * k_phys / d))
                        row['bg_vs_subj_deg'] = float(np.degrees(row['bg_vs_subj'] * k_phys / d))
                        # the background's sweep in its own scene metres (screen shift / its screen scale D/Z_b per metre)
                        Zb = sh.Zs + PTS['bg'][2]
                        row['bg_sweep_scene_m'] = row['bg_vs_subj'] / (sh.D / Zb)
                        # motion-parallax depth the real viewer reads for the background: a point b behind a real window
                        # shifts x * b/(d + b) on it; k = screen shift / head shift
                        if x != 0:
                            kk = row['bg_vs_subj'] * k_phys / x
                            row['bg_k'] = kk; row['bg_perceived_m'] = (d * kk / (1 - kk)) if kk < 1 else float('inf')
                        out['rows'].append(row)

    # lateral parallax at each lean: the same quantities relative to the centred head at the same distance (a lean alone
    # changes the perspective, and that change is reported separately as lean_*)
    key = lambda r: (r['f_mm'], r['map'], r['arm'], r['d_real'])
    centred = {key(r): r for r in out['rows'] if r['x'] == 0.0}
    for r in out['rows']:
        c = centred[key(r)]
        r['relief_lat'] = r['relief'] - c['relief']; r['bg_vs_subj_lat'] = r['bg_vs_subj'] - c['bg_vs_subj']
        r['lean_relief'] = c['relief']; r['lean_subj_w'] = c['subj_w']
        # what the viewer reads from motion parallax, per point: k = lateral screen shift / head shift (screen metres),
        # depth behind the screen b = d k/(1 - k) (a real window's inverse; k >= 1 is at or past infinity)
        if r['x'] != 0:
            for k in PTS:
                kp = (r['dx_' + k] - c['dx_' + k]) * k_phys / r['x']
                r['k_' + k] = kp; r['perc_' + k] = (r['d_real'] * kp / (1 - kp)) if kp < 1 else float('inf')
            r['perc_relief'] = r['perc_ear'] - r['perc_nose']
            # a head of the on-screen size, correctly proportioned: m x real nose-to-side depth, in screen metres
            r['shape_ratio'] = r['perc_relief'] / (shots[0].m * (PTS['ear'][2] - PTS['nose'][2]) * k_phys)
    json.dump(out, open(os.path.join(here, 'out', 'cut_check.json'), 'w'), indent=1, default=float)

    # ------------------------------------------------------------------ print
    mm = 1000
    print(f"portal W {W} m, fill {a.fill}, d_int {a.dint} m, screen width {a.wphys} m; volume app outer {OUTER} (behind) / inner {INNER} (front)")
    print(f"{'shot':>6} {'hfov':>6} {'Z_s':>6} {'m':>5} {'D':>6} {'pn':>5} {'kappa':>6} | z nose/ear/mid/bg  metric (mm)          | app (mm)                  | prop outer/inner (mm)")
    for s in out['shots']:
        zz = lambda arm: '/'.join(f"{s['z_' + k][arm] * mm:.1f}" for k in ('nose', 'ear', 'mid', 'bg'))
        print(f"{s['f_mm']:4.0f}mm {s['hfov_deg']:6.2f} {s['Z_subject']:6.3f} {s['m']:5.3f} {s['D']:6.3f} {s['pn_app']:5.3f} {s['kappa']:6.3f} | {zz('metric'):36s} | {zz('app'):25s} | {s['prop_outer'] * mm:.0f}/{s['prop_inner'] * mm:.1f}")
    print("\nhead at x = +0.1 m, d = 0.5 m (shifts from the rest view, portal mm; + = right)")
    hdr = f"{'shot':>5} {'map':>3} {'depth':>5} | {'subj cx':>7} {'w':>6} {'L':>6} {'R':>6} | {'relief':>7} {'(deg)':>6} | {'mid-sub':>7} | {'bg-frm':>7} {'bg-sub':>7} {'(deg)':>6} {'sweep m':>7} {'k':>5} {'b_perc':>7}"
    print(hdr); print('-' * len(hdr))
    R = out['rows']
    pick = lambda f, mp, arm, x, d: next(r for r in R if r['f_mm'] == f and r['map'] == mp and r['arm'] == arm and r['x'] == x and r['d_real'] == d)
    for mp in ('A', 'B', 'C', 'Cf', 'Cm'):
        for arm in ('true', 'app', 'prop'):
            if mp.startswith('C') and arm == 'app':
                continue
            for s in shots:
                r = pick(s.f, mp, arm, 0.1, 0.5); r0 = pick(s.f, mp, arm, 0.0, 0.5)
                bp = r.get('bg_perceived_m', float('nan')); bps = 'inf' if bp == float('inf') else f"{bp:.2f}"
                print(f"{s.f:4.0f}m {mp:>3} {arm:>5} | {r['dx_subj'] * mm:7.2f} {r['subj_w'] * mm:6.2f} {(r['subj_L'] - r0['subj_L']) * mm:6.2f} {(r['subj_R'] - r0['subj_R']) * mm:6.2f} | "
                      f"{r['relief'] * mm:7.2f} {r['relief_deg']:6.2f} | {r['mid_vs_subj'] * mm:7.2f} | {r['bg_vs_frame'] * mm:7.1f} {r['bg_vs_subj'] * mm:7.1f} {r['bg_vs_subj_deg']:6.2f} {r['bg_sweep_scene_m']:7.3f} {r.get('bg_k', float('nan')):5.2f} {bps:>7}")
    print("(rest width: " + ', '.join(f"{s.f:.0f}mm {pick(s.f, 'A', 'true', 0.0, 0.5)['subj_w'] * mm:.2f}" for s in shots) + " mm; L/R = silhouette edge shifts)")

    print(f"\nacross the cut ({shots[1].f:.0f} mm / {shots[0].f:.0f} mm), all poses x = +-0.05..0.2, d = {leans}: lateral parallax "
          "ratios (relative to the centred head at the same d), subject-box differences, lean-only relief change (x = 0)")
    for mp in ('A', 'B', 'C', 'Cf', 'Cm'):
        for arm in ('true', 'app', 'prop'):
            if mp.startswith('C') and arm == 'app':
                continue
            rr = lambda q: [pick(shots[1].f, mp, arm, x, d)[q] / pick(shots[0].f, mp, arm, x, d)[q] for d in leans for x in lats if x != 0]
            rs, bs = rr('relief_lat'), rr('bg_vs_subj_lat')
            dw = [pick(shots[1].f, mp, arm, x, d)['subj_w'] - pick(shots[0].f, mp, arm, x, d)['subj_w'] for d in leans for x in lats]
            dc = [pick(shots[1].f, mp, arm, x, d)['dx_subj'] - pick(shots[0].f, mp, arm, x, d)['dx_subj'] for d in leans for x in lats]
            ln = ' '.join(f"{pick(s.f, mp, arm, 0.0, d)['relief'] * mm:+.2f}" for s in shots for d in (0.35, 0.7))
            print(f"  {mp} {arm:>5}: relief {min(rs):5.2f}..{max(rs):5.2f} | bg-subj {min(bs):5.2f}..{max(bs):5.2f} | width diff {min(dw) * mm:+7.2f}..{max(dw) * mm:+6.2f} mm"
                  f" | centre diff {min(dc) * mm:+7.2f}..{max(dc) * mm:+6.2f} mm | lean relief 24@.35/.7, 200@.35/.7 {ln} mm")
    print("\nmapping C's parallax remap per shot (g_B = shot parallax, g = shown parallax; fold where dg/dg_B = 0):")
    for s in out['shots']:
        c = s['C']
        print(f"  {s['f_mm']:.0f} mm: a {c['a']:.3f} | g_B nose/side/mid/bg " + '/'.join(f"{c['gB'][k]:+.4f}" for k in ('nose', 'ear', 'mid', 'bg'))
              + " -> g " + '/'.join(f"{c['g'][k]:+.4f}" for k in ('nose', 'ear', 'mid', 'bg'))
              + f" | fold at g_B {c['gB_fold']:+.4f}" + (f" (g_min {c['g_min_front']:+.4f}; pop-out limit {c['fold_real_m_in_front'] * mm:.1f} mm real in front of the pin plane)" if c['g_min_front'] is not None else ' (beyond infinity: none)')
              + f" | monotone over the scene: {c['monotone_over_scene']} | Cm: g " + '/'.join(f"{c['g_Cm'][k]:+.4f}" for k in ('nose', 'ear', 'mid', 'bg'))
              + f", monotone {c['monotone_over_scene_Cm']}")
    print("\nwhat the viewer reads (motion parallax, head x = +0.1 m at d = 0.5 m, true depth): depths behind the screen (mm; - = in front),"
          f" relief = side - nose, shape = relief / {shots[0].m * (PTS['ear'][2] - PTS['nose'][2]) * k_phys * mm:.1f} mm (a real head at its on-screen size)")
    print(f"  {'map':>3} {'shot':>5} | {'nose':>7} {'side':>7} {'relief':>7} {'shape':>6} | {'mid':>8} {'bg':>9} {'k_bg':>5}")
    fmt = lambda v: '   inf' if v == float('inf') else f"{v * mm:.0f}"
    for mp in ('A', 'B', 'C', 'Cf', 'Cm'):
        for s in shots:
            r = pick(s.f, mp, 'true', 0.1, 0.5)
            print(f"  {mp:>3} {s.f:4.0f}m | {r['perc_nose'] * mm:7.2f} {r['perc_ear'] * mm:7.2f} {r['perc_relief'] * mm:7.2f} {r['shape_ratio']:6.2f} | {fmt(r['perc_mid']):>8} {fmt(r['perc_bg']):>9} {r['k_bg']:5.2f}")
    print(f"\nwrote {os.path.join(here, 'out', 'cut_check.json')}")


if __name__ == '__main__':
    main()
