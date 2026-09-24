"""truthkit scenes. Each builder returns (prims, meta). Geometry in metres behind a window of width W;
depth extent chosen so the app's mapping (pn, outer, inner) can represent it: outer = the deepest z
behind the window, inner = the largest pop-out. Every scene states which R1 element it isolates."""
import numpy as np
from tk import Quad, Box, Sphere, Cylinder, Ellipsoid, Disc, Canopy, tex_checker, tex_stripes, tex_bricks, tex_noise, tex_solid, tex_text_like

STUFF, THING = 1, 2


def room(W, H, depth, floor_y=None, ceil_y=None, back_tex=None, side_tex=None, floor_tex=None, ceil_tex=None):
    """Fishtank: back wall at z=-depth, side walls at x=±W/2 extended (so off-axis rays hit them), floor/ceiling.
    Walls extend well beyond the frame so the beside-frame region has a surface."""
    fy = -H / 2 if floor_y is None else floor_y; cy = H / 2 if ceil_y is None else ceil_y
    ext = 3.0  # walls extend 3x beyond the frame laterally so the enlarged canvas and off-axis rays find them
    prims = []
    prims.append(Quad([0, (fy + cy) / 2, -depth], [1, 0, 0], [0, 1, 0], W * ext, (cy - fy) / 2 * ext, back_tex or (lambda p: tex_bricks(p, bw=W * 0.12, bh=W * 0.06, mortar=W * 0.008, axes=(0, 1))), STUFF, 'back_wall'))
    prims.append(Quad([0, fy, -depth / 2], [1, 0, 0], [0, 0, 1], W * ext, depth / 2 + 0.001, floor_tex or (lambda p: tex_checker(p, scale=W * 0.1, axes=(0, 2))), STUFF, 'floor'))
    prims.append(Quad([0, cy, -depth / 2], [1, 0, 0], [0, 0, 1], W * ext, depth / 2 + 0.001, ceil_tex or (lambda p: tex_noise(p, scale=W * 0.05, base=(0.85, 0.85, 0.88), amp=0.1, axes=(0, 2))), STUFF, 'ceiling'))
    for sx, nm in ((-1, 'wall_left'), (1, 'wall_right')):
        prims.append(Quad([sx * W / 2 * ext, (fy + cy) / 2, -depth / 2], [0, 0, 1], [0, 1, 0], depth / 2 + 0.001, (cy - fy) / 2 * ext, side_tex or (lambda p: tex_stripes(p, scale=W * 0.05, axis=2)), STUFF, nm))
    return prims


def S27_fishtank(W=0.16, H=0.09, depth=None):
    """V1: a room deeper than the window is wide; back wall, side walls, floor, ceiling, one box on the floor."""
    depth = depth or 1.5 * W
    prims = room(W, H, depth)
    b = W * 0.12
    prims.append(Box([-W * 0.05, -H / 2, -depth * 0.45 - b], [-W * 0.05 + b, -H / 2 + 1.4 * b, -depth * 0.45], lambda p: tex_noise(p, scale=W * 0.02, base=(0.75, 0.45, 0.30), amp=0.3, axes=(0, 1)), THING, 'box'))
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'V1 outpaint at depth; B1/B2 planes; E1'}


def S28_fishtank_depths(W=0.16, H=0.09):
    """V6: the same room at three diorama depths."""
    return [(f'S28_d{k}', S27_fishtank(W, H, depth=W * f)) for k, f in enumerate((0.25, 0.75, 2.0))]


def S11_rounded(W=0.16, H=0.09):
    """E4: sphere, cylinder (limb) and ellipsoid (torso) in front of a back wall at several distances; side thickness truth."""
    depth = 0.6 * W
    prims = room(W, H, depth)
    r = W * 0.06
    prims.append(Sphere([-W * 0.28, 0.0, -0.10 * W - r], r, lambda p: tex_checker(p, scale=W * 0.02, c1=(0.9, 0.5, 0.3), c2=(0.6, 0.2, 0.1), axes=(1, 2)), THING, 'sphere'))
    prims.append(Cylinder([-W * 0.05, -H * 0.4, -0.25 * W], [-W * 0.05, H * 0.4, -0.25 * W], r * 0.6, lambda p: tex_stripes(p, scale=W * 0.015, c1=(0.4, 0.6, 0.9), c2=(0.2, 0.3, 0.6), axis=1), THING, 'limb'))
    prims.append(Ellipsoid([W * 0.25, 0.0, -0.40 * W], [r * 1.6, r * 2.4, r * 0.9], lambda p: tex_noise(p, scale=W * 0.015, base=(0.7, 0.65, 0.5), amp=0.3, axes=(0, 1)), THING, 'torso'))
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'E4 object sides; E1'}


def S1_corner(W=0.16, H=0.09):
    """B1/M7: two walls meeting in a corner plus a floor; nothing else. Slow gradients for terraces."""
    depth = 0.8 * W
    prims = []
    ext = 3.0
    fy = -H / 2
    # left wall receding from the frame's left edge to the corner at the back centre
    prims.append(Quad([-W * 0.25, 0, -depth / 2], [1, 0, -depth / (W * 0.5)], [0, 1, 0], np.hypot(W * 0.5, depth) / 2 * 1.02, H * ext, lambda p: tex_bricks(p, bw=W * 0.1, bh=W * 0.05, mortar=W * 0.006, axes=(2, 1)), STUFF, 'wall_left'))
    prims.append(Quad([W * 0.25 + W * ext / 2, 0, -depth], [1, 0, 0], [0, 1, 0], W * ext / 2 + W * 0.25, H * ext, lambda p: tex_noise(p, scale=W * 0.03, base=(0.8, 0.78, 0.7), amp=0.15, axes=(0, 1)), STUFF, 'wall_back'))
    prims.append(Quad([0, fy, -depth / 2], [1, 0, 0], [0, 0, 1], W * ext, depth / 2 + 0.001, lambda p: tex_checker(p, scale=W * 0.08, axes=(0, 2)), STUFF, 'floor'))
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'B1 planes, E3 glancing wall, M7 terraces'}


def S2_contact(W=0.16, H=0.09, floating=False):
    """E9/B2: boxes on a textured floor (contact) or lifted (S3)."""
    depth = 0.8 * W
    prims = room(W, H, depth)
    fy = -H / 2; lift = 0.06 * W if floating else 0.0
    for k, (x, z, b) in enumerate(((-W * 0.25, -0.30 * W, W * 0.10), (W * 0.05, -0.20 * W, W * 0.07), (W * 0.3, -0.5 * W, W * 0.14))):
        prims.append(Box([x - b / 2, fy + lift, z - b / 2], [x + b / 2, fy + lift + b * 1.2, z + b / 2], (lambda k: (lambda p: tex_checker(p, scale=W * 0.02, c1=(0.85, 0.3 + 0.2 * k, 0.3), c2=(0.3, 0.2, 0.5), axes=(0, 1))))(k), THING, f'box{k}'))
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'E9 contact (floating=%s)' % floating}


def S5_pole(W=0.16, H=0.09, px_width_at=1200):
    """E7: thin vertical poles (0.5-3 px at the given plate width) in front of a textured wall."""
    depth = 0.5 * W
    prims = room(W, H, depth)
    for k, pxw in enumerate((0.5, 1.0, 2.0, 3.0)):
        r = (pxw / px_width_at) * W / 2
        x = -W * 0.3 + k * W * 0.2
        prims.append(Cylinder([x, -H * 0.6, -0.15 * W], [x, H * 0.6, -0.15 * W], r, tex_solid((0.15, 0.15, 0.18)), THING, f'pole_{pxw}px'))
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'E7 thin features'}


def S9_stacked(W=0.16, H=0.09):
    """E5: three cards at three depths, overlapping, in front of a back wall."""
    depth = 0.7 * W
    prims = room(W, H, depth)
    th = W * 0.004
    for k, (x, z, cw, chh, col) in enumerate(((-W * 0.12, -0.12 * W, W * 0.18, H * 0.5, (0.9, 0.3, 0.3)), (0.0, -0.30 * W, W * 0.22, H * 0.6, (0.3, 0.8, 0.3)), (W * 0.12, -0.50 * W, W * 0.26, H * 0.7, (0.3, 0.4, 0.9)))):
        prims.append(Box([x - cw / 2, -chh / 2, z - th], [x + cw / 2, chh / 2, z], (lambda c: (lambda p: tex_text_like(p, cell=W * 0.02, c1=c, c2=(0.05, 0.05, 0.05), axes=(0, 1))))(col), THING, f'card{k}'))
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'E5 stacked occluders'}


def S10_limb(W=0.16, H=0.09):
    """E2: a horizontal 'thigh' cylinder with a vertical 'calf' cylinder crossing in front of it, and an 'arm' in front of a 'torso' — interior steps; on a wall."""
    depth = 0.6 * W
    prims = room(W, H, depth)
    r = W * 0.045
    prims.append(Cylinder([-W * 0.45, -H * 0.05, -0.30 * W], [W * 0.05, -H * 0.05, -0.30 * W], r, lambda p: tex_stripes(p, scale=W * 0.015, c1=(0.85, 0.65, 0.5), c2=(0.65, 0.45, 0.35), axis=0), THING, 'thigh'))
    prims.append(Cylinder([-W * 0.2, -H * 0.6, -0.30 * W + 2.2 * r], [-W * 0.2, H * 0.6, -0.30 * W + 2.2 * r], r * 0.8, lambda p: tex_stripes(p, scale=W * 0.015, c1=(0.55, 0.75, 0.55), c2=(0.35, 0.55, 0.35), axis=1), THING, 'calf'))
    prims.append(Ellipsoid([W * 0.27, 0.0, -0.36 * W], [r * 1.8, r * 2.6, r * 1.0], lambda p: tex_noise(p, scale=W * 0.015, base=(0.7, 0.6, 0.5), amp=0.3, axes=(0, 1)), THING, 'torso'))
    prims.append(Cylinder([W * 0.12, H * 0.3, -0.36 * W + 2.4 * r], [W * 0.42, -H * 0.25, -0.36 * W + 2.4 * r], r * 0.55, lambda p: tex_stripes(p, scale=W * 0.012, c1=(0.8, 0.5, 0.4), c2=(0.6, 0.35, 0.3), axis=0), THING, 'arm'))
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'E2 interior self-occlusion; E4 per-part sides'}


def S7_canopy(W=0.16, H=0.09):
    """E6: a porous crown (discs) on a trunk against a far back wall / sky-like plane; background through the holes."""
    depth = 1.2 * W
    prims = room(W, H, depth, back_tex=lambda p: tex_noise(p, scale=W * 0.2, base=(0.55, 0.7, 0.95), amp=0.15, axes=(0, 1)))
    prims.append(Cylinder([-W * 0.05, -H / 2, -0.35 * W], [-W * 0.05, H * 0.05, -0.35 * W], W * 0.012, tex_solid((0.35, 0.25, 0.18)), THING, 'trunk'))
    prims.append(Canopy([-W * 0.05, H * 0.2, -0.35 * W], [W * 0.22, H * 0.28, W * 0.12], 900, W * 0.012, tex_solid((0.25, 0.5, 0.2)), name='crown'))
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'E6 porous silhouette'}


def S4_figure_popout(W=0.16, H=0.09):
    """E1 + pop-out: a standing figure (capsule) half in front of the window plane, wall behind."""
    depth = 0.6 * W
    prims = room(W, H, depth)
    r = W * 0.05
    prims.append(Cylinder([0.0, -H * 0.45, 0.04 * W], [0.0, H * 0.25, 0.04 * W], r, lambda p: tex_stripes(p, scale=W * 0.02, c1=(0.8, 0.55, 0.45), c2=(0.5, 0.3, 0.3), axis=1), THING, 'figure_body'))
    prims.append(Sphere([0.0, H * 0.25 + r * 0.9, 0.04 * W], r * 0.9, lambda p: tex_checker(p, scale=W * 0.015, c1=(0.9, 0.7, 0.55), c2=(0.6, 0.4, 0.3), axes=(1, 2)), THING, 'figure_head'))
    return prims, {'outer': depth, 'inner': 0.1 * W, 'element': 'E1 with pop-out'}


def S12_framecut(W=0.16, H=0.09):
    """E10: objects cut by the frame edge — a sphere straddling the right edge, a box straddling the bottom edge,
    a pole leaving through the top. Their hidden parts are outpaint of the object itself, not of the background."""
    depth = 0.8 * W
    prims = room(W, H, depth)
    prims.append(Sphere([W / 2, 0.0, -0.2 * W - 0.09 * W], 0.09 * W, lambda p: tex_checker(p, scale=W * 0.02, c1=(0.9, 0.6, 0.3), c2=(0.5, 0.25, 0.1), axes=(1, 2)), THING, 'sphere_right_edge'))
    b = 0.07 * W
    prims.append(Box([-0.25 * W, -H / 2 - 0.05 * W, -0.25 * W - b], [-0.25 * W + 1.3 * b, -H / 2 + 0.06 * W, -0.25 * W], lambda p: tex_stripes(p, scale=W * 0.012, c1=(0.4, 0.7, 0.9), c2=(0.2, 0.4, 0.6), axis=0), THING, 'box_bottom_edge'))
    prims.append(Cylinder([0.1 * W, -H * 0.1, -0.3 * W], [0.1 * W, H, -0.3 * W], 0.012 * W, tex_solid((0.2, 0.2, 0.22)), THING, 'pole_top_edge'))
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'E10 objects cut by the frame edge'}


def S15_open(W=0.16, H=0.09):
    """B3/B4: an open scene — ground plane to the horizon, distant hills, sky (rays that escape), a near tree and a
    signpost as occluders. No walls: outpaint beside the frame is ground and sky; the far parallax is near zero."""
    far = 60 * W
    prims = []
    prims.append(Quad([0, -H / 2, -far / 2], [1, 0, 0], [0, 0, 1], 60 * W, far / 2 + 0.001, lambda p: tex_checker(p, scale=W * 0.3, c1=(0.45, 0.55, 0.3), c2=(0.35, 0.45, 0.25), axes=(0, 2)), STUFF, 'ground'))
    for k, (x, z, r) in enumerate(((-12 * W, -45 * W, 10 * W), (6 * W, -50 * W, 13 * W), (20 * W, -40 * W, 8 * W), (-2 * W, -25 * W, 4 * W))):
        prims.append(Sphere([x, -H / 2 - 0.55 * r, z], r, (lambda k: (lambda p: tex_noise(p, scale=W * 0.5, base=(0.5 - 0.05 * k, 0.5, 0.6 + 0.05 * k), amp=0.2, axes=(0, 1))))(k), STUFF, f'hill{k}'))
    prims.append(Cylinder([-0.15 * W, -H / 2, -0.45 * W], [-0.15 * W, H * 0.1, -0.45 * W], W * 0.014, tex_solid((0.35, 0.25, 0.18)), THING, 'trunk'))
    prims.append(Canopy([-0.15 * W, H * 0.25, -0.45 * W], [W * 0.18, H * 0.3, W * 0.12], 400, W * 0.014, tex_solid((0.25, 0.5, 0.2)), name='crown'))
    prims.append(Cylinder([0.25 * W, -H / 2, -0.3 * W], [0.25 * W, H * 0.3, -0.3 * W], W * 0.008, tex_solid((0.3, 0.3, 0.32)), THING, 'signpost'))
    prims.append(Box([0.25 * W - 0.06 * W, H * 0.15, -0.3 * W - 0.004 * W], [0.25 * W + 0.06 * W, H * 0.3, -0.3 * W + 0.004 * W], lambda p: tex_text_like(p, cell=W * 0.012, axes=(0, 1)), THING, 'sign'))
    return prims, {'outer': far * 0.9, 'inner': 0.0, 'element': 'B3 sky, B4 distant terrain, open outpaint'}


def S16_ridge(W=0.16, H=0.09):
    """E3: a wall receding at a grazing angle from the left frame edge; in the top half it folds (a crease: continuous
    surface, direction change), in the bottom half it steps (a jump: a pilaster face 0.06 W deeper). A rim detector must
    call the crease continuous and the jump a rim."""
    depth = 1.0 * W
    prims = []
    ext = 3.0
    a0 = np.array([-W / 2, 0, 0.0]); a1 = np.array([0.1 * W, 0, -0.6 * W])          # wall A from the frame's left edge to the fold line
    def wall(p0, p1, y0, y1, tex, name):
        c = (p0 + p1) / 2; c[1] = (y0 + y1) / 2; u = p1 - p0; L = np.linalg.norm(u)
        return Quad(c, u / L, [0, 1, 0], L / 2, (y1 - y0) / 2, tex, STUFF, name)
    brick = lambda p: tex_bricks(p, bw=W * 0.08, bh=W * 0.04, mortar=W * 0.005, axes=(2, 1))
    prims.append(wall(a0, a1, -H * ext, H * ext, brick, 'wall_A'))
    b1 = np.array([0.55 * W, 0, -0.78 * W])                                          # crease continuation (top half)
    prims.append(wall(a1, b1, 0.0, H * ext, lambda p: tex_bricks(p, bw=W * 0.08, bh=W * 0.04, mortar=W * 0.005, axes=(0, 1)), 'wall_B_crease'))
    j0 = a1 + np.array([0.0, 0, -0.06 * W]); j1 = b1 + np.array([0.0, 0, -0.06 * W])  # jump: same direction, 0.06 W deeper (bottom half)
    prims.append(wall(j0, j1, -H * ext, 0.0, lambda p: tex_bricks(p, bw=W * 0.08, bh=W * 0.04, mortar=W * 0.005, axes=(0, 1)), 'wall_B_jump'))
    # the ledge closing the step at y = 0 (the crease wall's foot meets the jump wall's top 0.06 W further back);
    # without it the kit saw the back wall through an open slot from every low eye (S2 report §3)
    uB = b1 - a1; LB = np.linalg.norm(uB)
    prims.append(Quad((a1 + b1) / 2 + np.array([0, 0, -0.03 * W]), uB / LB, [0, 0, -1], LB / 2, 0.03 * W, tex_solid((0.6, 0.55, 0.5)), STUFF, 'jump_ledge'))
    # the pilaster's return face closing the jump (perpendicular, faces +x)
    prims.append(Quad(a1 + np.array([0, -H * ext / 2, -0.03 * W]), [0, 0, -1], [0, 1, 0], 0.03 * W, H * ext / 2, tex_solid((0.6, 0.55, 0.5)), STUFF, 'jump_return'))
    prims.append(Quad([0, 0, -depth], [1, 0, 0], [0, 1, 0], W * ext, H * ext, lambda p: tex_noise(p, scale=W * 0.03, base=(0.8, 0.78, 0.7), amp=0.15, axes=(0, 1)), STUFF, 'wall_back'))
    prims.append(Quad([0, -H / 2, -depth / 2], [1, 0, 0], [0, 0, 1], W * ext, depth / 2 + 0.001, lambda p: tex_checker(p, scale=W * 0.08, axes=(0, 2)), STUFF, 'floor'))
    prims.append(Quad([0, H / 2, -depth / 2], [1, 0, 0], [0, 0, 1], W * ext, depth / 2 + 0.001, lambda p: tex_noise(p, scale=W * 0.05, base=(0.85, 0.85, 0.88), amp=0.1, axes=(0, 2)), STUFF, 'ceiling'))
    prims.append(Quad([W / 2 * ext, 0, -depth / 2], [0, 0, 1], [0, 1, 0], depth / 2 + 0.001, H * ext, lambda p: tex_stripes(p, scale=W * 0.05, axis=2), STUFF, 'wall_right'))
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'E3 grazing wall: crease (top) vs jump (bottom)'}


def S26_overhang(W=0.16, H=0.09):
    """V2: vertical reveals — a table top with objects on it (its underside and the floor under it), a ceiling beam,
    a wall shelf; things the vertical sweep exists for."""
    depth = 0.7 * W
    prims = room(W, H, depth)
    t = 0.02 * W; ty = -0.1 * H
    prims.append(Box([-0.3 * W, ty - t, -0.45 * W], [0.1 * W, ty, -0.2 * W], lambda p: tex_stripes(p, scale=W * 0.02, c1=(0.7, 0.5, 0.3), c2=(0.55, 0.38, 0.22), axis=0), THING, 'table_top'))
    for (x, z) in ((-0.28 * W, -0.43 * W), (0.08 * W, -0.43 * W), (-0.28 * W, -0.22 * W), (0.08 * W, -0.22 * W)):
        prims.append(Box([x - 0.008 * W, -H / 2, z - 0.008 * W], [x + 0.008 * W, ty - t, z + 0.008 * W], tex_solid((0.4, 0.3, 0.2)), THING, 'table_leg'))
    prims.append(Cylinder([-0.15 * W, ty, -0.33 * W], [-0.15 * W, ty + 0.05 * W, -0.33 * W], 0.025 * W, lambda p: tex_checker(p, scale=W * 0.01, c1=(0.9, 0.9, 0.9), c2=(0.2, 0.3, 0.7), axes=(1, 2)), THING, 'mug'))
    prims.append(Box([-0.02 * W, ty, -0.4 * W], [0.05 * W, ty + 0.035 * W, -0.3 * W], lambda p: tex_noise(p, scale=W * 0.01, base=(0.8, 0.3, 0.3), amp=0.3, axes=(0, 1)), THING, 'book'))
    prims.append(Box([-W * 3, H / 2 - 0.03 * W, -0.36 * W], [W * 3, H / 2, -0.28 * W], lambda p: tex_stripes(p, scale=W * 0.03, c1=(0.5, 0.4, 0.3), c2=(0.4, 0.3, 0.22), axis=0), THING, 'ceiling_beam'))
    prims.append(Box([0.22 * W, 0.15 * H, -0.5 * W], [0.5 * W, 0.15 * H + 0.012 * W, -0.32 * W], lambda p: tex_stripes(p, scale=W * 0.02, c1=(0.75, 0.7, 0.6), c2=(0.6, 0.55, 0.45), axis=2), THING, 'shelf'))
    prims.append(Sphere([0.36 * W, 0.15 * H + 0.012 * W + 0.02 * W, -0.41 * W], 0.02 * W, lambda p: tex_checker(p, scale=W * 0.008, c1=(0.3, 0.7, 0.4), c2=(0.1, 0.4, 0.2), axes=(1, 2)), THING, 'ball_on_shelf'))
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'V2 vertical reveals: table underside, beam, shelf'}


def S31_hedge(W=0.16, H=0.09):
    """S3 column rule: a low box spanning the whole frame width (and beyond) on the floor of a room. No row rim exists
    inside the frame; behind the hedge, per column, the truth is the back wall down to its foot and the floor below
    that. The far side must come from the floor's line (from below) crossing the wall's line (from above)."""
    depth = 0.8 * W
    prims = room(W, H, depth)
    ext = 3.0; hz = -0.3 * W; hh = 0.35 * H
    prims.append(Box([-W * ext / 2, -H / 2, hz - 0.06 * W], [W * ext / 2, -H / 2 + hh, hz], lambda p: tex_noise(p, scale=W * 0.015, base=(0.3, 0.5, 0.25), amp=0.3, axes=(0, 1)), THING, 'hedge'))
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'S3 column rule: full-width occluder, floor meets wall behind it'}


def S32_hedge_open(W=0.16, H=0.09):
    """S3 horizon: the same hedge on an open ground plane with sky and nothing else. Behind the hedge, per column, the
    truth is the ground up to the horizon (the ground line's zero disparity: eye level) and sky above. The ground
    extends 300 W (48 m) so its finite edge sits within one row of the true horizon at 800 px. The hedge is taller
    than eye level (0.7 H on a floor at -H/2) so that both the ground and the sky lie behind it."""
    far = 300 * W
    prims = []
    prims.append(Quad([0, -H / 2, -far / 2], [1, 0, 0], [0, 0, 1], 300 * W, far / 2 + 0.001, lambda p: tex_checker(p, scale=W * 0.3, c1=(0.45, 0.55, 0.3), c2=(0.35, 0.45, 0.25), axes=(0, 2)), STUFF, 'ground'))
    ext = 3.0; hz = -0.3 * W; hh = 0.7 * H
    prims.append(Box([-W * ext / 2, -H / 2, hz - 0.06 * W], [W * ext / 2, -H / 2 + hh, hz], lambda p: tex_noise(p, scale=W * 0.015, base=(0.3, 0.5, 0.25), amp=0.3, axes=(0, 1)), THING, 'hedge'))
    return prims, {'outer': far * 0.9, 'inner': 0.0, 'element': 'S3 horizon: full-width occluder, ground meets sky behind it'}


def S30_dolly(W=0.16, H=0.09):
    """Dolly family: a subject pinned at the window plane (so it keeps its frame position and size for every focal
    length), a mid box, a fishtank behind. Render with make.py --D for each focal length: D = (W/2)(f/18 mm)."""
    depth = 1.5 * W
    prims = room(W, H, depth)
    r = 0.05 * W
    prims.append(Cylinder([-0.12 * W, -H / 2, 0.0], [-0.12 * W, H * 0.2, 0.0], r, lambda p: tex_stripes(p, scale=W * 0.02, c1=(0.8, 0.55, 0.45), c2=(0.5, 0.3, 0.3), axis=1), THING, 'subject_body'))
    prims.append(Sphere([-0.12 * W, H * 0.2 + 0.9 * r, 0.0], 0.9 * r, lambda p: tex_checker(p, scale=W * 0.015, c1=(0.9, 0.7, 0.55), c2=(0.6, 0.4, 0.3), axes=(1, 2)), THING, 'subject_head'))
    b = 0.1 * W
    prims.append(Box([0.15 * W, -H / 2, -0.5 * W - b], [0.15 * W + b, -H / 2 + 1.2 * b, -0.5 * W], lambda p: tex_noise(p, scale=W * 0.02, base=(0.75, 0.45, 0.30), amp=0.3, axes=(0, 1)), THING, 'mid_box'))
    return prims, {'outer': depth, 'inner': r, 'element': 'dolly family: subject at the window plane'}


# ---- Sprint 16 (2026-09-12): the porous-silhouette family (S7's class), one variable per scene, S7's room and framing ----
def _porous_room(W, H):
    depth = 1.2 * W
    return depth, room(W, H, depth, back_tex=lambda p: tex_noise(p, scale=W * 0.2, base=(0.55, 0.7, 0.95), amp=0.15, axes=(0, 1)))

def P1_canopy_sparse(W=0.16, H=0.09):
    """E6 porous, density low: S7's crown with a third of the discs (300 of 900), same disc size."""
    depth, prims = _porous_room(W, H)
    prims.append(Cylinder([-W * 0.05, -H / 2, -0.35 * W], [-W * 0.05, H * 0.05, -0.35 * W], W * 0.012, tex_solid((0.35, 0.25, 0.18)), THING, 'trunk'))
    prims.append(Canopy([-W * 0.05, H * 0.2, -0.35 * W], [W * 0.22, H * 0.28, W * 0.12], 300, W * 0.012, tex_solid((0.25, 0.5, 0.2)), name='crown'))
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'E6 porous silhouette, sparse (300 discs)'}

def P2_canopy_dense(W=0.16, H=0.09):
    """E6 porous, density high: 1800 discs (twice S7)."""
    depth, prims = _porous_room(W, H)
    prims.append(Cylinder([-W * 0.05, -H / 2, -0.35 * W], [-W * 0.05, H * 0.05, -0.35 * W], W * 0.012, tex_solid((0.35, 0.25, 0.18)), THING, 'trunk'))
    prims.append(Canopy([-W * 0.05, H * 0.2, -0.35 * W], [W * 0.22, H * 0.28, W * 0.12], 1800, W * 0.012, tex_solid((0.25, 0.5, 0.2)), name='crown'))
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'E6 porous silhouette, dense (1800 discs)'}

def P3_canopy_fine(W=0.16, H=0.09):
    """E6 porous, leaf size small: discs at half S7's radius, four times as many (same covered area)."""
    depth, prims = _porous_room(W, H)
    prims.append(Cylinder([-W * 0.05, -H / 2, -0.35 * W], [-W * 0.05, H * 0.05, -0.35 * W], W * 0.012, tex_solid((0.35, 0.25, 0.18)), THING, 'trunk'))
    prims.append(Canopy([-W * 0.05, H * 0.2, -0.35 * W], [W * 0.22, H * 0.28, W * 0.12], 3600, W * 0.006, tex_solid((0.25, 0.5, 0.2)), name='crown'))
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'E6 porous silhouette, fine leaves (3600 discs, r/2)'}

def P4_canopy_layered(W=0.16, H=0.09):
    """E6 porous, layered: S7's crown and a second crown behind it, offset right and 0.3 W deeper, seen through the first."""
    depth, prims = _porous_room(W, H)
    prims.append(Cylinder([-W * 0.05, -H / 2, -0.35 * W], [-W * 0.05, H * 0.05, -0.35 * W], W * 0.012, tex_solid((0.35, 0.25, 0.18)), THING, 'trunk'))
    prims.append(Canopy([-W * 0.05, H * 0.2, -0.35 * W], [W * 0.22, H * 0.28, W * 0.12], 900, W * 0.012, tex_solid((0.25, 0.5, 0.2)), name='crown'))
    prims.append(Cylinder([W * 0.12, -H / 2, -0.65 * W], [W * 0.12, H * 0.1, -0.65 * W], W * 0.012, tex_solid((0.3, 0.22, 0.16)), THING, 'trunk2'))
    prims.append(Canopy([W * 0.12, H * 0.22, -0.65 * W], [W * 0.2, H * 0.26, W * 0.12], 900, W * 0.012, tex_solid((0.2, 0.42, 0.22)), seed=23, name='crown2'))
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'E6 porous silhouette, two crowns layered'}

def P5_fence(W=0.16, H=0.09):
    """E6 porous, regular: a picket fence — 13 vertical slats 1.2 % of W wide with 2.5 % gaps, 0.35 W in front of the back wall."""
    depth, prims = _porous_room(W, H)
    pitch = W * 0.037; sw = W * 0.012; z = -0.35 * W
    for k in range(13):
        x = -W * 0.22 + k * pitch
        prims.append(Box([x, -H / 2, z - 0.004 * W], [x + sw, H * 0.15, z + 0.004 * W], lambda p: tex_stripes(p, scale=W * 0.01, c1=(0.75, 0.7, 0.6), c2=(0.6, 0.55, 0.45), axis=1), THING, f'slat{k}'))
    prims.append(Box([-W * 0.24, H * 0.02, z - 0.004 * W], [W * 0.26, H * 0.04, z + 0.004 * W], tex_solid((0.7, 0.65, 0.55)), THING, 'rail'))
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'E6 porous silhouette, picket fence (regular slats)'}

def P6_grille(W=0.16, H=0.09):
    """E6 porous, regular in both axes: a grille of thin bars (0.6 % of W) on a 3 % pitch, 0.35 W in front of the back wall."""
    depth, prims = _porous_room(W, H)
    pitch = W * 0.03; bw = W * 0.006; z = -0.35 * W
    for k in range(16):
        x = -W * 0.24 + k * pitch
        prims.append(Box([x, -H * 0.4, z - 0.003 * W], [x + bw, H * 0.4, z + 0.003 * W], tex_solid((0.25, 0.25, 0.28)), THING, f'vbar{k}'))
    for k in range(9):
        y = -H * 0.4 + k * pitch
        prims.append(Box([-W * 0.24, y, z - 0.003 * W], [W * 0.24, y + bw, z + 0.003 * W], tex_solid((0.25, 0.25, 0.28)), THING, f'hbar{k}'))
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'E6 porous silhouette, grille (thin bars both axes)'}



# ---- S35 §29 (2026-09-18): the layer family — the configurations §28 could not separate, with exact truth ----
def _figure(prims, W, H, x, z, r, name):
    """A standing figure: a capsule body and a sphere head, feet on the floor at y = -H/2."""
    prims.append(Cylinder([x, -H / 2, z], [x, H * 0.2, z], r, lambda p: tex_stripes(p, scale=W * 0.02, c1=(0.8, 0.55, 0.45), c2=(0.5, 0.3, 0.3), axis=1), THING, name + '_body'))
    prims.append(Sphere([x, H * 0.2 + 0.9 * r, z], 0.9 * r, lambda p: tex_checker(p, scale=W * 0.015, c1=(0.9, 0.7, 0.55), c2=(0.6, 0.4, 0.3), axes=(1, 2)), THING, name + '_head'))

def _forest(W, H, n_discs, seed=31):
    """The troll's kind of background: a LAYER of many small things (leaf discs) at overlapping depths filling the frame
    0.5..0.7 W behind the window, a far wall (the gap) 1.2 W behind it, and a figure 0.25 W behind the window in front.
    Behind the figure the truth is the leaf layer where a leaf is, the wall where the layer has a gap."""
    depth, prims = _porous_room(W, H)
    prims.append(Canopy([0.0, 0.0, -0.6 * W], [W * 1.1, H * 1.1, W * 0.1], n_discs, W * 0.08, tex_solid((0.25, 0.5, 0.2)), seed=seed, name='forest'))
    _figure(prims, W, H, -0.02 * W, -0.25 * W, W * 0.06, 'figure')
    return prims, depth

def L1_forest_dense(W=0.16, H=0.09):
    """Layer, dense: 300 discs of radius 0.08 W (about nine tenths of the frame covered, the troll's forest; 1200 discs of half the
    radius made every truth eye a multi-minute render)."""
    prims, depth = _forest(W, H, 300)
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'layer family: dense leaf layer before a gap, figure in front'}

def L4_forest_sparse(W=0.16, H=0.09):
    """Layer, sparse: 100 discs of radius 0.08 W (about half the frame covered) — the case where the layer and the gap are even."""
    prims, depth = _forest(W, H, 100)
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'layer family: sparse leaf layer before a gap, figure in front'}

def L2_disc_field(W=0.16, H=0.09):
    """The sunflowers: thin discs on thin stems before a ground plane, a big near head at the left, smaller heads deeper, two
    leaves per stem chaining the plants. The sky is a far wall 4 W back painted sky-blue (as in the picture, where the sky is the
    farthest surface, not infinity): with the ground running to 300 W the app's depth law put every plant and the near ground
    within ten tolerances of one depth (d 0.482..0.491), which no sheet model can resolve -- a kit artefact, not a finding. A head
    is a THING with next to no thickness: behind the big head the truth is the ground and the far wall (and one farther head
    where it lies behind it), never the head itself."""
    depth = 4.0 * W
    prims = []
    prims.append(Quad([0, -H / 2, -depth / 2], [1, 0, 0], [0, 0, 1], 3 * W, depth / 2 + 0.001, lambda p: tex_checker(p, scale=W * 0.3, c1=(0.45, 0.55, 0.3), c2=(0.35, 0.45, 0.25), axes=(0, 2)), STUFF, 'ground'))
    prims.append(Quad([0, 0, -depth], [1, 0, 0], [0, 1, 0], 3 * W, 3 * H, lambda p: tex_noise(p, scale=W * 0.4, base=(0.55, 0.7, 0.95), amp=0.08, axes=(0, 1)), STUFF, 'sky_wall'))
    heads = [(-0.18 * W, 0.05 * H, -0.25 * W, 0.11 * W), (-0.05 * W, 0.0, -0.55 * W, 0.07 * W), (0.12 * W, -0.05 * H, -0.5 * W, 0.075 * W),
             (0.28 * W, 0.05 * H, -0.7 * W, 0.06 * W), (0.02 * W, 0.12 * H, -1.0 * W, 0.05 * W), (0.38 * W, -0.1 * H, -0.45 * W, 0.065 * W), (-0.32 * W, -0.12 * H, -0.8 * W, 0.05 * W)]
    for k, (x, y, z, r) in enumerate(heads):
        n = np.array([0.15 * ((k % 3) - 1), 0.25, 1.0]); n /= np.linalg.norm(n)
        prims.append(Disc([x, y, z], n, r, (lambda k: (lambda p: tex_checker(p, scale=W * 0.012, c1=(0.95, 0.75, 0.15), c2=(0.35, 0.22, 0.08), axes=(0, 1))))(k), THING, f'head{k}'))
        prims.append(Cylinder([x, -H / 2, z - 0.004 * W], [x, y, z - 0.004 * W], 0.008 * W, tex_solid((0.3, 0.45, 0.2)), THING, f'stem{k}'))
        for j, (sx, dz) in enumerate(((-1, 0.06 * W), (1, -0.05 * W))):   # two leaves per stem, off to the sides and at other depths: the thicket that chains the heads
            ln = np.array([0.6 * sx, 0.5, 1.0]); ln /= np.linalg.norm(ln)
            prims.append(Disc([x + sx * 0.9 * r, y - 0.9 * r - 0.04 * W * j, z + dz], ln, 0.045 * W, tex_solid((0.28 + 0.04 * j, 0.5, 0.22)), THING, f'leaf{k}_{j}'))
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'layer family: thin discs (heads) before a far sky wall, big head in front'}

def L3_figure_cluster(W=0.16, H=0.09):
    """The milkmaid: a figure before a back wall, a table with a cluster of small things beside her and a little in
    front of her, a box on the floor behind her to the right. Behind the figure the truth is the wall and the floor,
    and the table's things only in the narrow strip the parallax uncovers next to them."""
    depth = 0.8 * W
    prims = room(W, H, depth)
    _figure(prims, W, H, 0.05 * W, -0.3 * W, W * 0.06, 'figure')
    t = -H / 2 + 0.3 * H
    prims.append(Box([-0.5 * W, -H / 2, -0.42 * W], [-0.02 * W, t, -0.18 * W], lambda p: tex_noise(p, scale=W * 0.02, base=(0.2, 0.3, 0.55), amp=0.2, axes=(0, 2)), THING, 'table'))
    prims.append(Sphere([-0.08 * W, t + 0.035 * W, -0.33 * W], 0.035 * W, lambda p: tex_checker(p, scale=W * 0.01, c1=(0.85, 0.8, 0.7), c2=(0.6, 0.5, 0.4), axes=(1, 2)), THING, 'loaf'))
    prims.append(Box([-0.2 * W, t, -0.38 * W], [-0.12 * W, t + 0.07 * W, -0.3 * W], lambda p: tex_stripes(p, scale=W * 0.01, c1=(0.3, 0.4, 0.7), c2=(0.2, 0.25, 0.5), axis=1), THING, 'jug'))
    prims.append(Cylinder([-0.05 * W, t, -0.24 * W], [-0.05 * W, t + 0.05 * W, -0.24 * W], 0.03 * W, lambda p: tex_noise(p, scale=W * 0.01, base=(0.7, 0.4, 0.3), amp=0.3, axes=(0, 1)), THING, 'bowl'))
    b = 0.06 * W
    prims.append(Box([0.25 * W, -H / 2, -0.7 * W], [0.25 * W + b, -H / 2 + b, -0.7 * W + b], lambda p: tex_noise(p, scale=W * 0.02, base=(0.75, 0.45, 0.30), amp=0.3, axes=(0, 1)), THING, 'foot_warmer'))
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'layer family: figure before a wall with a cluster of small things beside her'}


# ---- S35 §39 (2026-09-18): the crease inside a hole — a hole wide enough that no data of either face lies beside it at the
# crease's rows, so an interpolating plate has only the wall above and the floor below to go by ----
def C1_screen(W=0.16, H=0.09):
    """A wide thin screen (a box 0.55 W wide standing on the floor 0.25 W behind the window) before the back wall's crease with
    the floor: behind it the truth is wall down to the crease line and floor below it, across most of the frame's width."""
    depth = 0.8 * W
    prims = room(W, H, depth)
    prims.append(Box([-0.275 * W, -H / 2, -0.26 * W], [0.275 * W, -H / 2 + 0.55 * H, -0.25 * W], lambda p: tex_noise(p, scale=W * 0.02, base=(0.55, 0.35, 0.3), amp=0.3, axes=(0, 1)), THING, 'screen'))
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'crease family: wall-floor crease hidden behind a wide screen'}

def C3_screen_deep(W=0.16, H=0.09):
    """C1 with the wall at a depth of its own: the room runs to 1.5 W and a wall stands across it at 0.8 W. In C1 the wall sits at
    the scene's outer depth, d = 0, which the app's depth law (and the prototype) treat as sky, so its crease with the floor is
    never a crease between two plates; here it is, and the screen hides it across most of the frame's width."""
    depth = 1.5 * W
    prims = room(W, H, depth)
    prims.append(Quad([0, 0, -0.8 * W], [1, 0, 0], [0, 1, 0], W * 3.0, H * 1.5, lambda p: tex_bricks(p, bw=W * 0.12, bh=W * 0.06, mortar=W * 0.008, axes=(0, 1)), STUFF, 'wall'))
    prims.append(Box([-0.275 * W, -H / 2, -0.26 * W], [0.275 * W, -H / 2 + 0.55 * H, -0.25 * W], lambda p: tex_noise(p, scale=W * 0.02, base=(0.55, 0.35, 0.3), amp=0.3, axes=(0, 1)), THING, 'screen'))
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'crease family: wall-floor crease between two plates hidden behind a wide screen'}

def C2_corner_figure(W=0.16, H=0.09):
    """The S1 corner (a receding left wall, a back wall, a floor: one vertical crease and two floor creases, one of them slanted
    in the image) with a broad figure standing before the corner, so all three creases run into its hole."""
    prims, m = S1_corner(W, H)
    _figure(prims, W, H, 0.0, -0.4 * W, W * 0.09, 'figure')
    return prims, {'outer': m['outer'], 'inner': 0.0, 'element': 'crease family: vertical and slanted creases hidden behind a figure'}


def L5_field(W=0.16, H=0.09):
    """S35 §54: the sunflowers' FIELD, graded and clumpy. L2's plants (a big near head, smaller heads deeper, stems, leaves)
    stand in a field of small round clumps resting on the ground, from just behind the picture plane to 2.5 W back, dense
    enough that the ground shows only between them near the camera. A clump stands a little in front of the clumps behind it
    (a stepped front on all sides: a thing by the wrap test, as SAM auto's field pieces were on the picture), and the truth
    behind the big head is farther clumps, the ground between them and the sky wall -- never the sky where a clump is.
    Labelled (truth_ids: every clump a thing) it is the auto map; with --unlabelled clump it is the map a person makes by
    clicking the heads."""
    depth = 4.0 * W
    prims = []
    prims.append(Quad([0, -H / 2, -depth / 2], [1, 0, 0], [0, 0, 1], 3 * W, depth / 2 + 0.001, lambda p: tex_checker(p, scale=W * 0.3, c1=(0.45, 0.55, 0.3), c2=(0.35, 0.45, 0.25), axes=(0, 2)), STUFF, 'ground'))
    prims.append(Quad([0, 0, -depth], [1, 0, 0], [0, 1, 0], 3 * W, 3 * H, lambda p: tex_noise(p, scale=W * 0.4, base=(0.55, 0.7, 0.95), amp=0.08, axes=(0, 1)), STUFF, 'sky_wall'))
    heads = [(-0.18 * W, 0.05 * H, -0.25 * W, 0.11 * W), (-0.05 * W, 0.0, -0.55 * W, 0.07 * W), (0.12 * W, -0.05 * H, -0.5 * W, 0.075 * W),
             (0.28 * W, 0.05 * H, -0.7 * W, 0.06 * W), (0.02 * W, 0.12 * H, -1.0 * W, 0.05 * W), (0.38 * W, -0.1 * H, -0.45 * W, 0.065 * W), (-0.32 * W, -0.12 * H, -0.8 * W, 0.05 * W)]
    for k, (x, y, z, r) in enumerate(heads):
        n = np.array([0.15 * ((k % 3) - 1), 0.25, 1.0]); n /= np.linalg.norm(n)
        prims.append(Disc([x, y, z], n, r, (lambda k: (lambda p: tex_checker(p, scale=W * 0.012, c1=(0.95, 0.75, 0.15), c2=(0.35, 0.22, 0.08), axes=(0, 1))))(k), THING, f'head{k}'))
        prims.append(Cylinder([x, -H / 2, z - 0.004 * W], [x, y, z - 0.004 * W], 0.008 * W, tex_solid((0.3, 0.45, 0.2)), THING, f'stem{k}'))
    rng = np.random.RandomState(35); k = 0
    for iz in range(14):                       # rows of clumps, near to far; a row's spacing grows with its distance
        z = -0.18 * W - 0.17 * W * iz * (1 + 0.06 * iz)
        nx_ = 9 + iz; xs = np.linspace(-1.3 * W, 1.3 * W, nx_)
        for x in xs:
            r = W * (0.03 + 0.015 * rng.rand()); x_ = x + W * 0.05 * (rng.rand() - 0.5); z_ = z + W * 0.05 * (rng.rand() - 0.5)
            g = 0.42 + 0.12 * rng.rand()
            prims.append(Sphere([x_, -H / 2 + r, z_], r, (lambda g: tex_solid((0.22, g, 0.18)))(g), THING, f'clump{k}')); k += 1
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'layer family: a graded clumpy field with heads in front (the sunflowers)'}


def L6_forest_graded(W=0.16, H=0.09):
    """S35 §56: the TROLL's configuration in exact truth. L1/L4 put their leaf layer in one narrow slab (0.5-0.7 W) with a flat
    wall 1.2 W behind; the troll stands before a forest that recedes continuously, so behind him the truth is foliage, trunks,
    ground and sky at many depths and never one plane. Here: a figure at 0.3 W, then forty trees (a trunk and a porous crown
    each) in ten ranks from 0.5 W to 3.2 W, shrinking with distance and dense enough to close the canopy across the frame, over
    a ground plane with a sky wall at 4 W. The forest is named tree* so that `truth_ids.py L6 --unlabelled tree` gives the map
    the troll has under a click mask (the figure labelled, the forest left as depth components), and `truth_ids.py L6` labels
    every tree."""
    depth = 4.0 * W
    prims = []
    prims.append(Quad([0, -H / 2, -depth / 2], [1, 0, 0], [0, 0, 1], 3 * W, depth / 2 + 0.001, lambda p: tex_checker(p, scale=W * 0.25, c1=(0.40, 0.46, 0.28), c2=(0.30, 0.38, 0.22), axes=(0, 2)), STUFF, 'ground'))
    prims.append(Quad([0, 0, -depth], [1, 0, 0], [0, 1, 0], 3 * W, 3 * H, lambda p: tex_noise(p, scale=W * 0.4, base=(0.55, 0.7, 0.95), amp=0.08, axes=(0, 1)), STUFF, 'sky_wall'))
    _figure(prims, W, H, -0.13 * W, -0.30 * W, W * 0.075, 'figure')
    rng = np.random.RandomState(56); k = 0
    for rank in range(10):
        z = -(0.50 + 0.28 * rank * (1 + 0.09 * rank)) * W          # ten ranks, 0.5 W to 3.2 W, spacing growing with distance
        sc = 1.0 / (1.0 + 0.30 * rank)                              # trees shrink with distance
        nT = 4 + rank // 3
        for j in range(nT):
            x = (-1.15 + 2.3 * (j + 0.5 + 0.7 * (rng.rand() - 0.5)) / nT) * W
            z_ = z + W * 0.10 * (rng.rand() - 0.5)
            th = H * (0.30 + 0.12 * rng.rand()) * sc                # trunk height
            prims.append(Cylinder([x, -H / 2, z_], [x, -H / 2 + th, z_], W * 0.020 * sc, tex_solid((0.34, 0.24, 0.17)), THING, f'tree{k}_trunk'))
            g = 0.42 + 0.14 * rng.rand()
            prims.append(Canopy([x, -H / 2 + th + H * 0.30 * sc, z_], [W * 0.34 * sc, H * 0.46 * sc, W * 0.10 * sc], 90, W * 0.020 * sc,
                                tex_solid((0.20, g, 0.17)), seed=56 + k, name=f'tree{k}_crown')); k += 1
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'layer family: a figure before a forest receding continuously (the troll)'}


def _ground_and_sky(W, H, depth):
    prims = []
    prims.append(Quad([0, -H / 2, -depth / 2], [1, 0, 0], [0, 0, 1], 3 * W, depth / 2 + 0.001, lambda p: tex_checker(p, scale=W * 0.25, c1=(0.40, 0.46, 0.28), c2=(0.30, 0.38, 0.22), axes=(0, 2)), STUFF, 'ground'))
    prims.append(Quad([0, 0, -depth], [1, 0, 0], [0, 1, 0], 3 * W, 3 * H, lambda p: tex_noise(p, scale=W * 0.4, base=(0.55, 0.7, 0.95), amp=0.08, axes=(0, 1)), STUFF, 'sky_wall'))
    return prims


def L7_boulders(W=0.16, H=0.09):
    """S38/S39, the L5 regime, sparse and large: rounded boulders RESTING ON the ground at graded depths, with a figure in
    front. L5's clumps merge into the ground through their contact, so a click-the-heads map leaves them as part of the
    ground's join group and the construction collapses; L6's crowns sit in the air and stay their own components. This scene
    keeps L5's contact but makes the pieces far larger and sparser, so the ground shows between them -- the case where the
    arm might cope. Field named boulder* for `truth_ids.py L7 --unlabelled boulder`."""
    depth = 4.0 * W
    prims = _ground_and_sky(W, H, depth)
    _figure(prims, W, H, -0.12 * W, -0.30 * W, W * 0.085, 'figure')
    rng = np.random.RandomState(70); k = 0
    for rank in range(8):
        z = -(0.55 + 0.34 * rank * (1 + 0.10 * rank)) * W
        sc = 1.0 / (1.0 + 0.28 * rank)
        for j in range(4 + rank // 3):
            x = (-1.2 + 2.4 * (j + 0.5 + 0.6 * (rng.rand() - 0.5)) / (4 + rank // 3)) * W
            r = W * (0.085 + 0.045 * rng.rand()) * sc
            g = 0.40 + 0.16 * rng.rand()
            prims.append(Ellipsoid([x, -H / 2 + r * 0.75, z + W * 0.12 * (rng.rand() - 0.5)], [r * 1.35, r * 0.8, r],
                                   tex_solid((0.34 + 0.06 * rng.rand(), g * 0.7, 0.30)), THING, f'boulder{k}')); k += 1
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'L5 regime, sparse: boulders resting on the ground, figure in front'}


def L8_crowd(W=0.16, H=0.09):
    """S38/S39, the L5 regime with upright pieces: a CROWD of standing figures at graded depths on a ground, a larger figure
    in front. Every one of them meets the ground, as L5's clumps do, but they are tall and narrow rather than round, so the
    silhouette statistics are the opposite of L5's while the contact structure is the same. Field named crowd* for
    `truth_ids.py L8 --unlabelled crowd`."""
    depth = 4.0 * W
    prims = _ground_and_sky(W, H, depth)
    _figure(prims, W, H, -0.15 * W, -0.28 * W, W * 0.080, 'figure')
    rng = np.random.RandomState(80); k = 0
    for rank in range(9):
        z = -(0.55 + 0.30 * rank * (1 + 0.09 * rank)) * W
        sc = 1.0 / (1.0 + 0.30 * rank)
        for j in range(3 + rank // 2):
            n = 3 + rank // 2
            x = (-1.15 + 2.3 * (j + 0.5 + 0.7 * (rng.rand() - 0.5)) / n) * W
            r = W * (0.045 + 0.018 * rng.rand()) * sc
            z_ = z + W * 0.10 * (rng.rand() - 0.5)
            c1 = (0.35 + 0.45 * rng.rand(), 0.30 + 0.40 * rng.rand(), 0.35 + 0.40 * rng.rand())
            prims.append(Cylinder([x, -H / 2, z_], [x, -H / 2 + H * (0.34 + 0.10 * rng.rand()) * sc, z_], r,
                                  (lambda c: (lambda p: tex_stripes(p, scale=W * 0.02, c1=c, c2=(c[0] * 0.6, c[1] * 0.6, c[2] * 0.6), axis=1)))(c1), THING, f'crowd{k}_body'))
            prims.append(Sphere([x, -H / 2 + H * (0.34 + 0.10 * rng.rand()) * sc + 0.9 * r, z_], 0.9 * r,
                                tex_solid((0.80, 0.62, 0.50)), THING, f'crowd{k}_head')); k += 1
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'L5 regime, upright: a crowd of standing figures, larger figure in front'}


def L9_tufts(W=0.16, H=0.09):
    """S38/S39, the L5 regime at its extreme: a dense low field of small tufts sitting ON the ground, receding, with a figure
    in front. The finest contact case -- hundreds of small pieces every one of which touches the ground, so nothing survives
    as its own component under a click-the-heads map. Field named tuft* for `truth_ids.py L9 --unlabelled tuft`."""
    depth = 4.0 * W
    prims = _ground_and_sky(W, H, depth)
    _figure(prims, W, H, -0.10 * W, -0.30 * W, W * 0.080, 'figure')
    rng = np.random.RandomState(90); k = 0
    for rank in range(16):
        z = -(0.30 + 0.17 * rank * (1 + 0.07 * rank)) * W
        sc = 1.0 / (1.0 + 0.40 * rank)
        n = 10 + rank
        for j in range(n):
            x = (-1.25 + 2.5 * (j + 0.5 + 0.8 * (rng.rand() - 0.5)) / n) * W
            r = W * (0.028 + 0.016 * rng.rand()) * sc
            g = 0.40 + 0.18 * rng.rand()
            prims.append(Ellipsoid([x, -H / 2 + r * 0.9, z + W * 0.05 * (rng.rand() - 0.5)], [r * 0.8, r * 1.5, r * 0.8],
                                   tex_solid((0.22, g, 0.18)), THING, f'tuft{k}')); k += 1
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'L5 regime, extreme: a dense low field of tufts on the ground, figure in front'}


# ---- S62 §13 (2026-09-24): the starwatcher family -- a figure whose silhouette encloses windows onto the background, and a
# background with a depth step (a hill crest) running behind the figure. One defect per scene, then the combination.
def _figure_open(prims, W, H, x, z, name, akimbo=True):
    """A standing figure with its legs apart (a see-through window between them, closed at the hip) and, when akimbo, the
    right hand on the hip (a second window between the arm and the torso). Feet on y = -H/2, head top near y = +H/2."""
    body = lambda p: tex_stripes(p, scale=W * 0.02, c1=(0.25, 0.28, 0.45), c2=(0.18, 0.20, 0.32), axis=1)
    skin = tex_solid((0.85, 0.66, 0.52))
    yf, yh, ys = -H / 2, -0.10 * H, 0.20 * H           # feet, hip, shoulder
    rl, rt, ra = W * 0.018, W * 0.040, W * 0.012        # leg, torso, arm radii
    for s in (-1, 1):                                   # legs: hip joint to feet planted apart
        prims.append(Cylinder([x + s * 0.02 * W, yh, z], [x + s * 0.085 * W, yf + rl, z], rl, body, THING, f'{name}_leg{s:+d}'))
    prims.append(Cylinder([x, yh - 0.02 * H, z], [x, ys, z], rt, body, THING, name + '_torso'))
    prims.append(Sphere([x, ys + 0.14 * H, z], W * 0.035, skin, THING, name + '_head'))
    prims.append(Cylinder([x - 0.045 * W, ys, z], [x - 0.05 * W, -0.12 * H, z], ra, body, THING, name + '_armL'))   # left arm hangs
    if akimbo:                                          # right arm: shoulder -> elbow out -> hand back on the hip
        el = [x + 0.19 * W, 0.04 * H, z]
        prims.append(Cylinder([x + 0.045 * W, ys, z], el, ra, body, THING, name + '_armR_up'))
        prims.append(Cylinder(el, [x + 0.045 * W, -0.08 * H, z], ra, body, THING, name + '_armR_fore'))
    else:
        prims.append(Cylinder([x + 0.045 * W, ys, z], [x + 0.05 * W, -0.12 * H, z], ra, body, THING, name + '_armR'))


def _hills(W, H, crest_y, depth):
    """Ploughed ground (furrows receding to a vanishing point), a near hill whose crest runs across the frame at crest_y,
    a far range of hills above it, sky. The crest is a depth step inside the background: ground-side below, far hills above."""
    prims = []
    prims.append(Quad([0, -H / 2, -depth / 2], [1, 0, 0], [0, 0, 1], 3 * W, depth / 2 + 0.001,
                      lambda p: tex_stripes(p, scale=W * 0.035, c1=(0.55, 0.42, 0.28), c2=(0.42, 0.31, 0.20), axis=0), STUFF, 'ground'))
    ry = crest_y + H / 2 + 0.35 * H                     # the near hill: an ellipsoid sunk into the ground, top at crest_y
    prims.append(Ellipsoid([0.2 * W, crest_y - ry, -1.1 * W], [2.6 * W, ry, 0.45 * W],
                           lambda p: tex_noise(p, scale=W * 0.03, base=(0.42, 0.52, 0.26), amp=0.10, axes=(0, 1)), STUFF, 'hill_near'))
    ry2 = 0.95 * H
    prims.append(Ellipsoid([-0.6 * W, 0.22 * H - ry2, -2.6 * W], [3.2 * W, ry2, 0.6 * W],
                           lambda p: tex_noise(p, scale=W * 0.06, base=(0.45, 0.55, 0.68), amp=0.06, axes=(0, 1)), STUFF, 'hill_far'))
    prims.append(Quad([0, 0, -depth], [1, 0, 0], [0, 1, 0], 3 * W, 3 * H,
                      lambda p: tex_noise(p, scale=W * 0.4, base=(0.62, 0.74, 0.92), amp=0.05, axes=(0, 1)), STUFF, 'sky_wall'))
    return prims


def H1_open_figure(W=0.16, H=0.09):
    """The starwatcher's legs, isolated: a figure with its legs apart and a hand on the hip on flat furrowed ground before
    sky. Two windows enclosed by the figure; the ground and sky must continue through them and behind the whole silhouette."""
    depth = 4.0 * W
    prims = _ground_and_sky(W, H, depth)
    prims[0] = Quad([0, -H / 2, -depth / 2], [1, 0, 0], [0, 0, 1], 3 * W, depth / 2 + 0.001,
                    lambda p: tex_stripes(p, scale=W * 0.035, c1=(0.55, 0.42, 0.28), c2=(0.42, 0.31, 0.20), axis=0), STUFF, 'ground')
    _figure_open(prims, W, H, -0.05 * W, -0.30 * W, 'figure')
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'figure with enclosed windows (legs apart, hand on hip) on receding ground'}


def H2_crest(W=0.16, H=0.09):
    """The depth step behind a figure, isolated: a plain standing figure before a hill whose crest crosses behind its waist,
    far hills above the crest. The hole straddles two background surfaces and the crest's hidden contour."""
    depth = 4.0 * W
    prims = _hills(W, H, 0.0, depth)
    _figure(prims, W, H, -0.05 * W, -0.30 * W, W * 0.09, 'figure')
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'background depth step (hill crest) behind a figure'}


def H3_star(W=0.16, H=0.09):
    """The starwatcher, harder: the open figure standing on the furrowed ground before the crest, the crest crossing the
    arm window, the leg window showing the near hill's face and the ground's contact line, far hills and sky above."""
    depth = 4.0 * W
    prims = _hills(W, H, 0.08 * H, depth)
    _figure_open(prims, W, H, -0.05 * W, -0.30 * W, 'figure')
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'open figure + crest behind: windows straddling a background depth step'}


def H4_rolling(W=0.16, H=0.09):
    """H3 with more depths and an object inside the hole: a second, nearer hill whose crest crosses the leg window, and a
    smaller figure further back standing half behind the main figure's arm -- its hidden half must be continued (or left as
    background), never replaced by an invented object. Three background surfaces and one thing behind one silhouette."""
    depth = 4.0 * W
    prims = _hills(W, H, 0.08 * H, depth)
    cy = -0.24 * H; ry = cy + H / 2 + 0.25 * H
    prims.append(Ellipsoid([-0.5 * W, cy - ry, -0.85 * W], [1.6 * W, ry, 0.3 * W],
                           lambda p: tex_noise(p, scale=W * 0.025, base=(0.52, 0.58, 0.30), amp=0.12, seed=5, axes=(0, 1)), STUFF, 'hill_mid'))
    _figure(prims, W, H, 0.10 * W, -0.47 * W, W * 0.05, 'figure_far')
    _figure_open(prims, W, H, -0.05 * W, -0.30 * W, 'figure')
    return prims, {'outer': depth, 'inner': 0.0, 'element': 'rolling hills (two crests) + a half-hidden far figure behind an open figure'}


SCENES = {
    'H1': H1_open_figure, 'H2': H2_crest, 'H3': H3_star, 'H4': H4_rolling,
    'C1': C1_screen, 'C2': C2_corner_figure, 'C3': C3_screen_deep,
    'L1': L1_forest_dense, 'L2': L2_disc_field, 'L3': L3_figure_cluster, 'L4': L4_forest_sparse,
    'P1': P1_canopy_sparse, 'P2': P2_canopy_dense, 'P3': P3_canopy_fine, 'P4': P4_canopy_layered, 'P5': P5_fence, 'P6': P6_grille,
    'S12': S12_framecut, 'S15': S15_open, 'S16': S16_ridge, 'S26': S26_overhang, 'S30': S30_dolly,
    'S31': S31_hedge, 'S32': S32_hedge_open, 'L5': L5_field, 'L6': L6_forest_graded, 'L7': L7_boulders, 'L8': L8_crowd, 'L9': L9_tufts,
    'S27': S27_fishtank, 'S11': S11_rounded, 'S1': S1_corner, 'S2': S2_contact, 'S3': lambda W=0.16, H=0.09: S2_contact(W, H, floating=True),
    'S5': S5_pole, 'S9': S9_stacked, 'S10': S10_limb, 'S7': S7_canopy, 'S4': S4_figure_popout,
    # S28 = V6 the same room at three diorama depths (0.25, 0.75, 2.0 window widths)
    'S28_d0': lambda W=0.16, H=0.09: S27_fishtank(W, H, depth=W * 0.25),
    'S28_d1': lambda W=0.16, H=0.09: S27_fishtank(W, H, depth=W * 0.75),
    'S28_d2': lambda W=0.16, H=0.09: S27_fishtank(W, H, depth=W * 2.0),
}
