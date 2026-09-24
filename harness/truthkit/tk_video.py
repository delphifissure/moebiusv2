#!/usr/bin/env python3
"""S63 synthetic video: the truth kit's ray caster behind an ordinary moving camera, with a thin lens (depth of field,
bokeh) and a shutter (motion blur), so every frame comes with its exact answers.

A shot = a scene that is a function of time + a camera path + lens and shutter settings. Per frame:
  rgb_%03d.png       what the camera records: the average over `spp` rays per pixel, each with its own lens point and
                     shutter time (a pinhole at one instant when the aperture and shutter are both zero)
  sharp_%03d.png     the same frame through a pinhole at the frame's own instant (the image with no blur at all)
  truth_%03d.npz     the pinhole frame's K nearest hits per pixel: rgb (uint8), metric depth along the camera axis
                     (float16, inf = none), primitive id (int16), class label (int8: 1 stuff, 2 thing);
                     alpha_thing (uint8): the share of the blurred pixel's rays whose first hit is a thing
                     (the exact soft-edge coverage of the foreground in the blurred image)
  shot.json          per-frame camera pose (position, rotation world<-camera), focal length in px, lens, shutter,
                     primitive names and labels
The camera looks down its own -z; image x right, y up. Lens: thin lens with aperture radius `ap` (world units) focused
at distance `focus` along the axis; `blades` > 0 samples a regular polygon aperture (bokeh shape), 0 a disc.
Shutter: `shutter` is the open fraction of the frame interval (0.5 = the 180-degree rule); times are stratified.

  python3 tk_video.py <shot> [--nx 480] [--frames N] [--spp 16] [--K 3] [--out DIR]
"""
import argparse, json, os, sys, time
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from tk import render, save_png, to_u8
import video_shots

FPS = 24.0


class _Rays:
    """Duck-typed stand-in for tk.Portal: render() only calls rays() and reads nx/ny."""
    def __init__(self, o, d, nx, ny): self.o, self.d, self.nx, self.ny = o, d, nx, ny
    def rays(self, eye): return self.o, self.d


def pixel_dirs(nx, ny, fpx, R, jitter=None):
    """Unit ray directions (world) through pixel centres (+ jitter in pixels) for a camera with rotation R, focal fpx."""
    xs = np.arange(nx) + 0.5; ys = np.arange(ny) + 0.5
    X, Y = np.meshgrid(xs, ys)
    if jitter is not None: X = X + jitter[0]; Y = Y + jitter[1]
    dc = np.stack([(X - nx / 2) / fpx, -(Y - ny / 2) / fpx, -np.ones_like(X)], -1).reshape(-1, 3)
    return dc @ R.T   # camera -> world


def lens_samples(rng, n, s, spp, blades):
    """Per-pixel aperture points for pass s of spp: stratum s of a sqrt(spp) grid on the unit square, jittered
    independently for every pixel, then mapped to a disc (concentric map) or a regular polygon (triangle fan)."""
    g = int(np.ceil(np.sqrt(spp)))
    u = ((s % g) + rng.random(n)) / g; v = ((s // g % g) + rng.random(n)) / g
    if blades and blades >= 3:
        k = np.minimum((u * blades).astype(int), blades - 1); uu = u * blades - k
        a0 = 2 * np.pi * k / blades; a1 = 2 * np.pi * (k + 1) / blades
        r = np.sqrt(v)                                         # uniform in the triangle (centre, vertex k, vertex k+1)
        p1 = np.stack([np.cos(a0), np.sin(a0)], -1); p2 = np.stack([np.cos(a1), np.sin(a1)], -1)
        return r[:, None] * ((1 - uu)[:, None] * p1 + uu[:, None] * p2)
    r = np.sqrt(v); th = 2 * np.pi * u
    return np.stack([r * np.cos(th), r * np.sin(th)], -1)


def trace(scene, pos, R, fpx, nx, ny, K, ap=0.0, focus=1.0, lens=None, jitter=None):
    d0 = pixel_dirs(nx, ny, fpx, R, jitter)
    o = np.broadcast_to(np.asarray(pos, float), d0.shape).copy()
    if ap > 0:
        fwd = -R[:, 2]
        cosang = d0 @ fwd
        fp = o + d0 * (focus / cosang)[:, None]                 # the point on the focus plane this pixel sees
        o = o + (lens[:, :1] * ap) * R[:, 0] + (lens[:, 1:2] * ap) * R[:, 1]
        d = fp - o
    else:
        d = d0
    d = d / np.linalg.norm(d, axis=1, keepdims=True)
    return render(scene, _Rays(o, d, nx, ny), None, K=K), d0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('shot'); ap.add_argument('--nx', type=int, default=480); ap.add_argument('--frames', type=int, default=None)
    ap.add_argument('--spp', type=int, default=None, help='rays per pixel for the blurred frame (default: 1 if no blur, else 16)')
    ap.add_argument('--K', type=int, default=3); ap.add_argument('--out', default=None); ap.add_argument('--seed', type=int, default=7)
    A = ap.parse_args()
    S = video_shots.SHOTS[A.shot]()
    nx = A.nx; ny = int(round(nx * 9 / 16)); nf = A.frames or S['frames']
    fpx = nx / (2 * np.tan(np.radians(S.get('hfov', 44.0)) / 2))
    blur = S.get('ap', 0) > 0 or S.get('shutter', 0) > 0
    spp = A.spp or S.get('spp') or (16 if blur else 1)
    out = A.out or os.path.join(os.path.dirname(__file__), 'out', 'video', A.shot); os.makedirs(out, exist_ok=True)
    rng = np.random.default_rng(A.seed)
    meta = {'shot': A.shot, 'what': S['what'], 'nx': nx, 'ny': ny, 'fps': FPS, 'fpx': fpx, 'K': A.K, 'spp': spp,
            'ap': S.get('ap', 0), 'blades': S.get('blades', 0), 'shutter': S.get('shutter', 0), 'frames': []}
    t0 = time.time()
    for fi in range(nf):
        t = fi / FPS
        pos, R, focus = S['camera'](t)
        scene = S['scene'](t)
        truth, _ = trace(scene, pos, R, fpx, nx, ny, A.K, 0.0)
        c0 = np.clip(truth['rgb'][..., 0, :], 0, None)
        acc = np.zeros((ny * nx, 3)); thing = np.zeros(ny * nx)
        if spp == 1:
            acc = c0.reshape(-1, 3); thing = (truth['label'][..., 0] == 2).reshape(-1).astype(float)
        else:
            n1 = int(np.ceil(np.sqrt(spp)))
            for s in range(spp):
                ts = t + ((s + rng.random()) / spp - 0.5) * S.get('shutter', 0) / FPS   # stratified shutter times
                p_s, R_s, f_s = S['camera'](ts); sc_s = S['scene'](ts) if S.get('shutter', 0) > 0 else scene
                jit = ((s % n1 + rng.random()) / n1 - 0.5, (s // n1 % n1 + rng.random()) / n1 - 0.5)
                r_s, _ = trace(sc_s, p_s, R_s, fpx, nx, ny, 1, S.get('ap', 0), f_s, lens_samples(rng, nx * ny, s, spp, S.get('blades', 0)), jit)
                acc += np.clip(r_s['rgb'][..., 0, :], 0, None).reshape(-1, 3); thing += (r_s['label'][..., 0] == 2).reshape(-1)
            acc /= spp; thing /= spp
        save_png(os.path.join(out, 'rgb_%03d.png' % fi), acc.reshape(ny, nx, 3))
        save_png(os.path.join(out, 'sharp_%03d.png' % fi), c0)
        fwd = -R[:, 2]
        zc = np.where(truth['valid'], (truth['pts'] - np.asarray(pos)) @ fwd, np.inf)   # depth along the camera axis
        np.savez_compressed(os.path.join(out, 'truth_%03d.npz' % fi),
                            rgb=to_u8(np.clip(truth['rgb'], 0, 1)), depth=zc.astype(np.float16), pid=truth['pid'].astype(np.int16),
                            label=truth['label'], alpha_thing=np.round(thing.reshape(ny, nx) * 255).astype(np.uint8))
        meta['frames'].append({'t': t, 'pos': list(map(float, pos)), 'R': R.tolist(), 'focus': float(focus)})
        if fi == 0: meta['prims'] = [{'name': p.name, 'label': int(p.label)} for p in scene]
        print('frame %d/%d  %.1fs' % (fi + 1, nf, time.time() - t0), flush=True)
    json.dump(meta, open(os.path.join(out, 'shot.json'), 'w'), indent=1)
    print('wrote', out)


if __name__ == '__main__':
    main()
