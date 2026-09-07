#!/usr/bin/env python3
"""Render a truthkit scene: rest view (RGB, float depth, normalised 16/8-bit depth through the app's mapping),
K hidden layers, and a preview sheet with three offset eyes.
  python3 make.py S27 [--nx 1200] [--out DIR] [--W 0.16] [--H 0.09] [--D 0.2] [--pn 0.5] [--margin 0.5]
"""
import argparse, json, os, sys, time
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from tk import Portal, render, app_norm_depth, save_png, to_u8
from scenes import SCENES
from PIL import Image, ImageDraw


def depth_vis(depth, dmin, dmax):
    d = np.where(np.isfinite(depth), depth, dmax)
    return 1 - np.clip((d - dmin) / max(1e-9, dmax - dmin), 0, 1)   # bright = near, like the app


def sheet(tiles, cols, title):
    W, H = tiles[0][0].size; pad = 6; rows = (len(tiles) + cols - 1) // cols
    sh = Image.new('RGB', (cols * (W + pad) + pad, 28 + rows * (H + 22 + pad)), (20, 20, 20)); d = ImageDraw.Draw(sh)
    d.text((pad, 6), title, fill=(255, 255, 255))
    for k, (im, t) in enumerate(tiles):
        x = pad + (k % cols) * (W + pad); y = 28 + (k // cols) * (H + 22 + pad)
        d.text((x, y), t, fill=(255, 230, 120)); sh.paste(im, (x, y + 16))
    return sh


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('scene'); ap.add_argument('--nx', type=int, default=1200); ap.add_argument('--out', default=None)
    ap.add_argument('--W', type=float, default=0.16); ap.add_argument('--H', type=float, default=0.09); ap.add_argument('--D', type=float, default=0.2)
    ap.add_argument('--pn', type=float, default=0.5); ap.add_argument('--margin', type=float, default=0.5); ap.add_argument('--K', type=int, default=6)
    ap.add_argument('--depth', type=float, default=None, help='override scene depth (S27/S28)')
    a = ap.parse_args()
    out = a.out or os.path.join(os.path.dirname(__file__), 'out', a.scene); os.makedirs(out, exist_ok=True)
    build = SCENES[a.scene]
    prims, meta = build(a.W, a.H, a.depth) if a.depth is not None else build(a.W, a.H)
    outer = meta['outer']; inner = max(meta.get('inner', 0.0), 1e-4)
    ny = int(round(a.nx * a.H / a.W))
    # the plate (no margin) and the enlarged canvas
    plate = Portal(a.W, a.H, a.D, a.nx, ny, margin=0.0)
    canvas = Portal(a.W, a.H, a.D, int(round(a.nx * (1 + 2 * a.margin))), int(round(ny * (1 + 2 * a.margin))), margin=a.margin)
    t0 = time.time()
    R = render(prims, plate, (0, 0, a.D), K=a.K)
    print(f'{a.scene}: rest {plate.nx}x{plate.ny} K={a.K} in {time.time() - t0:.1f}s; layers hit: ' + ', '.join(f'k{k}:{int(R["valid"][..., k].sum())}' for k in range(a.K)))
    # save rest products
    rgb0 = R['rgb'][..., 0, :]; dep0 = R['depth'][..., 0]
    dn = app_norm_depth(-np.where(np.isfinite(dep0), dep0, outer), a.pn, outer, inner)   # z = -depth
    save_png(os.path.join(out, 'rest_rgb.png'), rgb0)
    save_png(os.path.join(out, 'rest_depth16.png'), dn, bits=16)
    save_png(os.path.join(out, 'rest_depth8.png'), dn, bits=8)
    np.savez_compressed(os.path.join(out, 'rest_layers.npz'), depth=R['depth'].astype(np.float32), pid=R['pid'].astype(np.int16), label=R['label'], rgb=(np.clip(R['rgb'], 0, 1) * 255).astype(np.uint8), nrm=R['nrm'].astype(np.float16), valid=R['valid'])
    meta_out = {'scene': a.scene, 'W': a.W, 'H': a.H, 'D': a.D, 'pn': a.pn, 'outer': outer, 'inner': inner, 'nx': plate.nx, 'ny': plate.ny, 'margin': a.margin, 'canvas_nx': canvas.nx, 'canvas_ny': canvas.ny, 'K': a.K, 'element': meta.get('element', ''), 'prims': [{'pid': i, 'name': p.name, 'label': int(p.label)} for i, p in enumerate(prims)]}
    json.dump(meta_out, open(os.path.join(out, 'meta.json'), 'w'), indent=1)
    # preview: rest rgb, rest depth, layer1 rgb/depth, layer2 rgb, and three eyes
    dmax = outer + inner
    tiles = [(Image.fromarray(to_u8(rgb0)), 'rest RGB (the photograph)'), (Image.fromarray(to_u8(depth_vis(dep0, -inner, outer))), 'rest depth (bright = near)')]
    for k in (1, 2):
        tiles.append((Image.fromarray(to_u8(R['rgb'][..., k, :])), f'hidden layer {k} RGB'))
        tiles.append((Image.fromarray(to_u8(depth_vis(R['depth'][..., k], -inner, outer))), f'hidden layer {k} depth'))
    for th in (30, 60, 85):
        e = a.D * np.tan(np.radians(th))
        Rv = render(prims, plate, (e, 0, a.D), K=1)
        tiles.append((Image.fromarray(to_u8(Rv['rgb'][..., 0, :])), f'eye at {th} deg (through the window, full canvas)'))
    Rv = render(prims, plate, (0, a.D * np.tan(np.radians(40)), a.D), K=1)
    tiles.append((Image.fromarray(to_u8(Rv['rgb'][..., 0, :])), 'eye 40 deg above'))
    sh = sheet([(im.resize((im.width // 2, im.height // 2)), t) for im, t in tiles], 2, f'{a.scene}: {meta.get("element", "")}  W={a.W} D={a.D} depth={outer:.3f} pop-out={inner:.3f}')
    sh.save(os.path.join(out, 'preview.png')); print('wrote', out)


if __name__ == '__main__':
    main()
