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


SCENES = {
    'S27': S27_fishtank, 'S11': S11_rounded, 'S1': S1_corner, 'S2': S2_contact, 'S3': lambda W=0.16, H=0.09: S2_contact(W, H, floating=True),
    'S5': S5_pole, 'S9': S9_stacked, 'S10': S10_limb, 'S7': S7_canopy, 'S4': S4_figure_popout,
    # S28 = V6 the same room at three diorama depths (0.25, 0.75, 2.0 window widths)
    'S28_d0': lambda W=0.16, H=0.09: S27_fishtank(W, H, depth=W * 0.25),
    'S28_d1': lambda W=0.16, H=0.09: S27_fishtank(W, H, depth=W * 0.75),
    'S28_d2': lambda W=0.16, H=0.09: S27_fishtank(W, H, depth=W * 2.0),
}
