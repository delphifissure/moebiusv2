"""S63 shot library for tk_video.py. Each shot: scene(t) -> primitives, camera(t) -> (position, rotation world<-camera,
focus distance), frames, and lens/shutter settings. World units as the kit's scenes: the window is W = 0.16 wide at z = 0,
the scene behind it (z < 0); a person is about H = 0.09 tall (so 1 m ~ 0.053 units; walking 1.4 m/s ~ 0.074 units/s).
The camera's default place is the kit's rest eye (0, 0, 0.2), whose 44-degree horizontal field frames the window."""
import numpy as np
from scenes import (_hills, _figure, _figure_open, H3_star, H4_rolling, H6_gap, Quad, Sphere, Cylinder, tex_stripes, tex_solid,
                    tex_noise, STUFF, THING)

def look_rot(pos, target, up=(0, 1, 0)):
    """World<-camera rotation for a camera at pos looking at target (camera -z forward, +y up)."""
    f = np.asarray(target, float) - np.asarray(pos, float); f /= np.linalg.norm(f)
    r = np.cross(f, up); r /= np.linalg.norm(r); u = np.cross(r, f)
    return np.stack([r, u, -f], axis=1)


W, H = 0.16, 0.09
EYE = np.array([0.0, 0.0, 0.2])
WALK = 0.074                      # units per second (1.4 m/s)


def _static(fn):
    prims = fn(W, H)[0]
    return lambda t: prims


def _fixed(pos=EYE, target=None, focus=0.25):
    pos = np.asarray(pos, float); target = pos + np.array([0, 0, -1.0]) if target is None else np.asarray(target, float)
    R = look_rot(pos, target)
    return lambda t: (pos, R, focus)


def _walker(prims, x, z, phase, name, stride=0.06 * W):
    """The H1 figure walking along x: legs swing about the hip (feet +-stride), arms swing against the legs."""
    body = lambda p: tex_stripes(p, scale=W * 0.02, c1=(0.25, 0.28, 0.45), c2=(0.18, 0.20, 0.32), axis=1)
    skin = tex_solid((0.85, 0.66, 0.52))
    yf, yh, ys = -H / 2, -0.10 * H, 0.20 * H
    rl, rt, ra = W * 0.018, W * 0.040, W * 0.012
    s = np.sin(phase)
    for k, sg in ((-1, 1), (1, -1)):
        foot = x + sg * stride * s
        lift = max(0.0, sg * np.cos(phase)) * 0.04 * H        # the swinging foot clears the ground
        prims.append(Cylinder([x + k * 0.012 * W, yh, z], [foot, yf + rl + lift, z + k * 0.004], rl, body, THING, f'{name}_leg{k:+d}'))
        hand = x + k * 0.05 * W - sg * 0.6 * stride * s
        prims.append(Cylinder([x + k * 0.045 * W, ys, z], [hand, -0.12 * H, z + 0.01 * k], ra, body, THING, f'{name}_arm{k:+d}'))
    prims.append(Cylinder([x, yh - 0.02 * H, z], [x, ys, z], rt, body, THING, name + '_torso'))
    prims.append(Sphere([x, ys + 0.14 * H, z], W * 0.035, skin, THING, name + '_head'))


def _walk_phase(t, speed):
    return 2 * np.pi * t * speed / (4 * 0.06 * W)            # one stride cycle covers two steps of 2*stride


def shot_truck_trunks():
    """1. The camera slides sideways past two near trunks (H6), the crest and far hills showing through the gap."""
    def cam(t):
        pos = EYE + np.array([-0.03 + 0.03 * t, 0, 0]); return pos, look_rot(pos, pos + [0, 0, -1]), 0.25
    return dict(what='truck sideways past near trunks (H6)', scene=_static(H6_gap), camera=cam, frames=48)


def shot_push_in():
    """2. The camera pushes in on the H4 scene: parallax grows through the shot."""
    def cam(t):
        pos = EYE + np.array([0.004, 0.002, 0.05 - 0.05 * t]); return pos, look_rot(pos, pos + [0, 0, -1]), 0.25
    return dict(what='push in on H4 (two crests, half-hidden far figure)', scene=_static(H4_rolling), camera=cam, frames=48)


def shot_pan():
    """3. A pan across H3: rotation only, no new parallax (the control)."""
    def cam(t):
        a = np.radians(-10 + 10 * t); tgt = EYE + np.array([np.sin(a), 0, -np.cos(a)]); return EYE, look_rot(EYE, tgt), 0.25
    return dict(what='pan across H3 (rotation only)', scene=_static(H3_star), camera=cam, frames=48)


def _walker_scene(speed, x0, z=-0.30 * W, crest=0.08 * H):
    base = _hills(W, H, crest, 4.0 * W)
    def scene(t):
        prims = list(base); _walker(prims, x0 + speed * t, z, _walk_phase(t, speed), 'walker'); return prims
    return scene


def shot_walker_tripod():
    """4. Tripod; a figure walks across in front of the hills: the moving-object case (the gladiator clip's kind)."""
    return dict(what='tripod, figure walking across the hills', scene=_walker_scene(WALK, -0.45 * W), camera=_fixed(), frames=48)


def _shake(t, amp=0.0025, rot=0.5):
    f = np.array([[0.7, 1.3, 2.9], [0.9, 1.7, 3.3], [0.5, 1.1, 2.3]])
    ph = np.array([[0.3, 1.1, 2.0], [0.7, 2.3, 0.4], [1.9, 0.2, 1.4]])
    w = np.array([1.0, 0.5, 0.25])
    n = (np.sin(2 * np.pi * f * t + ph) * w).sum(1) / w.sum()
    return n * amp, np.radians(rot) * n[:2]


def shot_walker_handheld():
    """5. Handheld (smooth shake plus a slow drift) with the walker: moving camera and moving object together."""
    scene = _walker_scene(WALK, -0.45 * W)
    def cam(t):
        dp, dr = _shake(t); pos = EYE + np.array([0.01 * t, 0, 0]) + dp
        tgt = pos + np.array([np.sin(dr[0]), np.sin(dr[1]), -1.0]); return pos, look_rot(pos, tgt), 0.25
    return dict(what='handheld with drift, figure walking', scene=scene, camera=cam, frames=48)


def shot_runner_blur():
    """6. Tripod, a figure running (3x walking speed) with a 180-degree shutter: motion blur on the moving object."""
    return dict(what='tripod, runner, 180-degree shutter (motion blur)', scene=_walker_scene(3 * WALK, -0.9 * W), camera=_fixed(),
                frames=36, shutter=0.5)


def shot_rack_focus():
    """7. Focus pull from the near figure to the far hills on H4, wide aperture: depth of field changing over the shot."""
    near, far = 0.2 + 0.30 * W, 0.2 + 2.6 * W
    def cam(t):
        u = np.clip((t - 0.25) / 1.25, 0, 1); u = u * u * (3 - 2 * u)
        return EYE, look_rot(EYE, EYE + [0, 0, -1]), near + (far - near) * u
    return dict(what='rack focus figure -> far hills (H4)', scene=_static(H4_rolling), camera=cam, frames=36, ap=0.004, blades=0, spp=32)


def _bokeh_scene():
    prims = []
    prims.append(Quad([0, -H / 2, -2.0 * W], [1, 0, 0], [0, 0, 1], 3 * W, 2.0 * W, tex_solid((0.10, 0.10, 0.12)), STUFF, 'ground'))
    prims.append(Quad([0, 0, -4.0 * W], [1, 0, 0], [0, 1, 0], 3 * W, 3 * H,
                      lambda p: tex_noise(p, scale=W * 0.3, base=(0.08, 0.09, 0.14), amp=0.04, axes=(0, 1)), STUFF, 'night_wall'))
    rng = np.random.RandomState(11)
    for k in range(26):                                        # string lights: small, very bright spheres far behind
        z = -(1.6 + 2.0 * rng.rand()) * W; x = (-1.2 + 2.4 * rng.rand()) * W * (1 + (-z) / (2 * W)); y = (-0.1 + 0.9 * rng.rand()) * H * (1 + (-z) / (2 * W))
        c = [(8.0, 6.0, 3.0), (6.6, 6.6, 5.8), (3.2, 4.3, 8.0)][k % 3]   # point lights: bright enough to stay visible when spread into a disc
        prims.append(Sphere([x, y, z], W * 0.02, tex_solid(c), STUFF, f'light{k}'))
    _figure_open(prims, W, H, -0.02 * W, -0.30 * W, 'figure')
    return prims


def shot_bokeh():
    """8. Wide aperture, focus on the figure, bright small lights far behind: bokeh balls behind (and across) the silhouette."""
    prims = _bokeh_scene(); f = 0.2 + 0.30 * W
    def cam(t):
        pos = EYE + np.array([0.006 * t, 0, 0]); return pos, look_rot(pos, pos + [0, 0, -1]), f
    return dict(what='bokeh: figure in focus, string lights behind, hexagonal aperture', scene=lambda t: prims, camera=cam,
                frames=24, ap=0.006, blades=6, spp=64)


def shot_crowd_pan():
    """9. A pan across walkers at several depths moving both ways: layers crossing layers."""
    base = _hills(W, H, 0.02 * H, 4.0 * W)
    walkers = [(-0.8 * W, -0.25 * W, WALK), (0.6 * W, -0.55 * W, -0.8 * WALK), (-0.3 * W, -0.9 * W, 0.6 * WALK), (0.9 * W, -0.40 * W, -1.1 * WALK)]
    def scene(t):
        prims = list(base)
        for k, (x0, z, v) in enumerate(walkers): _walker(prims, x0 + v * t, z, _walk_phase(t, abs(v)) + k, f'walker{k}')
        return prims
    def cam(t):
        a = np.radians(-6 + 6 * t); return EYE, look_rot(EYE, EYE + np.array([np.sin(a), 0, -np.cos(a)])), 0.25
    return dict(what='pan across walkers at several depths', scene=scene, camera=cam, frames=48)


SHOTS = {'truck_trunks': shot_truck_trunks, 'push_in': shot_push_in, 'pan': shot_pan, 'walker_tripod': shot_walker_tripod,
         'walker_handheld': shot_walker_handheld, 'runner_blur': shot_runner_blur, 'rack_focus': shot_rack_focus,
         'bokeh': shot_bokeh, 'crowd_pan': shot_crowd_pan}
