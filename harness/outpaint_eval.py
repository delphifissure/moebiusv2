#!/usr/bin/env python3
"""Outpainting with a known answer on REAL pictures: take the picture's outer ring as the "beyond the frame" strip, keep
only the inner rectangle as the photograph, fill the ring, score against the true border (inside the ring only).

The ring is as wide as the strip the app needs beyond its frame at a head angle theta: the farthest content's shift at
theta under the app law, sigma_far * tan(theta) (reveal.shift_px at 45 deg, f = tan theta; note S64). Nothing is chosen
per picture. A ring wider than a quarter of the picture's short side leaves too little photograph to outpaint from and
is reported as infeasible rather than run.

Painters (general, fixed for every picture):
  clamp   what the app shows today: the inner rectangle's edge pixels stretched outward (ClampToEdge)
  pp      push-pull from the inner rectangle (Solh & AlRegib)
  lama    LaMa
  sd      SD 1.5 inpainting + depth ControlNet (the pipeline of sd_return.py); depth = the source depth clamp-extended,
          which is what the bundle's plane_out_depth16 carries; one prompt for all pictures

  python3 outpaint_eval.py --pics NAME=color:depth16 ... [--deg 10,20] [--painters clamp,pp,lama] [--out DIR]
"""
import argparse, json, os, sys, time
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'truthkit'))
from reveal import shift_px

ap = argparse.ArgumentParser()
ap.add_argument('--pics', nargs='+', required=True); ap.add_argument('--deg', default='10,20'); ap.add_argument('--long', type=int, default=768)
ap.add_argument('--painters', default='clamp,pp,lama'); ap.add_argument('--out', required=True)
ap.add_argument('--steps', type=int, default=20); ap.add_argument('--seed', type=int, default=1234)
ap.add_argument('--prompt', default='the same scene continuing beyond the edge of the picture, natural texture'); ap.add_argument('--negative', default='text, frame, border, watermark')
ap.add_argument('--W', type=float, default=0.16); ap.add_argument('--D', type=float, default=0.2)
ap.add_argument('--pn', type=float, default=0.5); ap.add_argument('--outer', type=float, default=0.02); ap.add_argument('--inner', type=float, default=0.04)   # the app's defaults, moebius.js L2959-2960
A = ap.parse_args(); os.makedirs(A.out, exist_ok=True)
sys.argv = [sys.argv[0]]
import grt_eval as G    # reuses load / pushpull / lama / scores (grt_eval parses no args when imported with --pics absent)


def clamp_fill(img, m):
    H, W = img.shape[:2]
    yy = np.clip(np.arange(H), m, H - 1 - m); xx = np.clip(np.arange(W), m, W - 1 - m)
    return img[np.ix_(yy, xx)]


_pipe = None
def sd_fill(img, dn, hole):
    global _pipe
    import torch
    from diffusers import StableDiffusionControlNetInpaintPipeline, ControlNetModel, UniPCMultistepScheduler
    if _pipe is None:
        torch.set_num_threads(4)
        cn = ControlNetModel.from_pretrained('lllyasviel/control_v11f1p_sd15_depth', variant='fp16', torch_dtype=torch.float32)
        _pipe = StableDiffusionControlNetInpaintPipeline.from_pretrained('stable-diffusion-v1-5/stable-diffusion-inpainting', controlnet=cn, variant='fp16',
                                                                          torch_dtype=torch.float32, safety_checker=None, requires_safety_checker=False)
        _pipe.scheduler = UniPCMultistepScheduler.from_config(_pipe.scheduler.config); _pipe.set_progress_bar_config(disable=True)
    H, W = hole.shape; Ws, Hs = int(round(W / 8) * 8), int(round(H / 8) * 8)
    ctl = Image.fromarray(np.round(np.clip(dn, 0, 1) * 255).astype(np.uint8)).convert('RGB').resize((Ws, Hs), Image.BILINEAR)
    r = _pipe(prompt=A.prompt, negative_prompt=A.negative, image=Image.fromarray((img * 255).astype(np.uint8)).resize((Ws, Hs), Image.LANCZOS),
              mask_image=Image.fromarray((hole * 255).astype(np.uint8)).resize((Ws, Hs), Image.NEAREST), control_image=ctl,
              num_inference_steps=A.steps, generator=torch.Generator().manual_seed(A.seed), strength=1.0, width=Ws, height=Hs).images[0]
    return np.asarray(r.resize((W, H), Image.LANCZOS), np.float32) / 255


resf = os.path.join(A.out, 'outpaint.json')
res = json.load(open(resf)) if os.path.exists(resf) else {}
for spec in A.pics:
    name, rest = spec.split('='); pc, pd = rest.split(':')
    G.A.long = A.long
    img, dn = G.load(pc, pd)
    H, W = dn.shape
    Wl = A.W if W / H > A.W / (A.W * 9 / 16) else (A.W * 9 / 16) * W / H
    sig = shift_px(dn, A.D, A.D, A.pn, A.outer, A.inner, W / Wl)
    sfar = float(np.abs(sig).max())
    res.setdefault(name, {})
    for deg in [float(x) for x in A.deg.split(',')]:
        key = '%g' % deg; m = int(round(sfar * np.tan(np.radians(deg))))
        r = res[name].setdefault(key, {}); r.update({'ringPx': m, 'sigmaFar45': sfar})
        if m < 2 or m > min(H, W) / 4:
            r['infeasible'] = True; print(name, key, 'ring', m, 'px: infeasible', flush=True); continue
        hole = np.ones((H, W), bool); hole[m:H - m, m:W - m] = False
        seen = img.copy(); seen[hole] = 0
        dclamp = clamp_fill(dn[..., None], m)[..., 0]
        for p in A.painters.split(','):
            t0 = time.time()
            if p == 'clamp': fill = clamp_fill(img, m)
            elif p == 'pp': fill = G.pushpull(img, ~hole)
            elif p == 'lama': fill = G.lama(seen, hole)
            elif p == 'sd': fill = sd_fill(seen, dclamp, hole)
            comp = img.copy(); comp[hole] = fill[hole]
            Image.fromarray((np.clip(comp, 0, 1) * 255).astype(np.uint8)).save(os.path.join(A.out, '%s_%s_%s.png' % (name, key, p)))
            r[p] = G.scores(fill, img, hole); r[p]['secs'] = round(time.time() - t0, 1)
            print(name, key, 'ring', m, p, {k: round(v, 4) for k, v in r[p].items()}, flush=True)
            json.dump(res, open(resf, 'w'), indent=1)
