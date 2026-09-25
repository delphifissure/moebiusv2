#!/usr/bin/env python3
"""Continue without inventing: which painter fills a revealed hole with what is behind, and nothing else? (S71)

The user (2026-09-25): "the dune needs to continue, and without hallucination. Negative prompt?" SD from noise painted a
creature where the starwatcher's legs were (S70 item 5). Two questions, one test:
  the case    what failed on the starwatcher, with a known answer: a figure (the starwatcher's own, cut from its bundle:
              --figure, RGBA) is pasted into another picture, standing on its background, 45 % of the picture's height,
              where the depth under it is flattest among the far half of the picture (automatic); the HOLE is the band
              inside the figure's silhouette (within 1/10 of its width of the edge: the thin parts -- legs, staff -- are
              all hole, the body keeps an interior), i.e. an object-shaped hole with the object's own pixels beside it,
              which is what made SD regrow limbs. The truth in the hole is the picture without the figure. (grt_eval's
              round-trip holes were tried first: at 20 deg they are slivers a few texels wide along edges, where no
              object fits, so they cannot show invention.)
  fidelity    MAE / LPIPS / gradient ratio of the fill against the truth (grt_eval.scores)
  invention   NEW STRUCTURE against the truth: texels of the hole where the fill differs from the truth by more than the
              picture's own texture varies (CIELAB dE above the 95th percentile of dE between the truth and itself moved
              by two texels, inside the hole) AND carries more edge than the truth there (gradient above the truth's own
              95th percentile); connected pieces of at least 17 x 17 texels (the ink-line scale, 2 WASH_RUN + 1, below
              which a detail reads as a line) are counted as invented objects. A blur (LaMa) adds no edges and scores 0;
              a painted creature adds both. (Florence-2 object detection was tried first and dropped: on these paintings it
              finds the spaceship and misses the creature SD painted at the starwatcher's legs.)
Arms are INPUT:PAINTER. Input 'vis': the painter sees the figure beside the hole (sd_return --image plate). Input 'rm':
the figure's whole footprint is replaced by the background's push-pull wash first, so the painter never sees it
(sd_return's default, plane_color_occluder_removed.png, S52's PACO arm A); colour is still taken on the hole only.
Painters (one prompt, one seed, nothing chosen per picture; control depth = the background's push-pull in the hole):
  lama        LaMa alone
  sd          SD 1.5 inpainting + depth ControlNet from noise (strength 1), sd_return.py's prompt and negative
  sd_neg      the same with a fixed negative naming what appeared (creature, animal, figure, vehicle, debris, text ...)
  lamasd3/5   LaMa's fill, then SD at strength 0.3 / 0.5 (sd_return --painter lama+sd --refine)
  washsd5     the far-side wash, then SD at strength 0.5 (sd_return --painter wash+sd)

  python3 painter_bench.py --pics NAME=color:depth16 ... --out DIR --figure figure.png [--steps 20]
"""
import argparse, json, os, sys, time, gc
import numpy as np
from PIL import Image
ap = argparse.ArgumentParser()
ap.add_argument('--pics', nargs='+', required=True); ap.add_argument('--out', required=True)
ap.add_argument('--figure', required=True); ap.add_argument('--steps', type=int, default=20); ap.add_argument('--seed', type=int, default=1234)
ap.add_argument('--arms', default='vis:lama,vis:sd,rm:lama,rm:sd,rm:sd_neg,rm:lamasd3,rm:lamasd5,rm:washsd5')
A = ap.parse_args(); os.makedirs(A.out, exist_ok=True)
sys.argv = [sys.argv[0]]
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'truthkit'))
import grt_eval as G
from reveal import shift_px
PROMPT = 'the background behind, continuous surfaces, natural texture'           # sd_return.py's defaults
NEG = 'person, figure, object, text'
NEG_STRONG = NEG + ', creature, animal, character, face, vehicle, machine, debris, rubble, letters, writing, logo, signature'
ARMS = A.arms.split(',')


def paste_case(img, dn):
    """the figure pasted on the flattest far background; returns (picture with figure, hole, control depth, figure mask)"""
    from scipy import ndimage as ndi
    H, W = dn.shape; F = Image.open(A.figure).convert('RGBA'); fh = int(round(0.45 * H)); fw = max(1, int(round(F.size[0] * fh / F.size[1])))
    F = np.asarray(F.resize((fw, fh), Image.LANCZOS), np.float32) / 255; fa = F[..., 3] > 0.5
    far = dn <= np.median(dn); best = None
    for y in range(0, H - fh + 1, max(1, fh // 8)):
        for x in range(0, W - fw + 1, max(1, fw // 4)):
            d = dn[y:y + fh, x:x + fw][fa]
            if far[y:y + fh, x:x + fw][fa].mean() < 0.9: continue          # standing on background: 90 % of its footprint in the far half
            v = float(np.std(d))
            if best is None or v < best[0]: best = (v, y, x)
    if best is None: return None
    _, y, x = best; fig = np.zeros((H, W), bool); fig[y:y + fh, x:x + fw] = fa
    comp = img.copy(); a = F[..., 3:4]; comp[y:y + fh, x:x + fw] = F[..., :3] * a + comp[y:y + fh, x:x + fw] * (1 - a)
    r = max(2, int(round(0.1 * fw)))
    hole = fig & (ndi.distance_transform_edt(fig) <= r)
    dctl = dn.copy(); dctl[fig] = float(dn.max())                          # the figure is the nearest thing in the picture
    dpp = G.pushpull(np.repeat(dn[..., None], 3, -1), ~fig)[..., 0]; dctl[hole] = dpp[hole]   # the rule's depth in the hole: the background around it
    return comp, hole, dctl, fig


_pipe = None
def sd(img, dctl, hole, neg, strength):
    global _pipe
    import torch
    from diffusers import StableDiffusionControlNetInpaintPipeline, ControlNetModel, UniPCMultistepScheduler
    if _pipe is None:
        torch.set_num_threads(4)
        cn = ControlNetModel.from_pretrained('lllyasviel/control_v11f1p_sd15_depth', variant='fp16', torch_dtype=torch.float32)
        _pipe = StableDiffusionControlNetInpaintPipeline.from_pretrained('stable-diffusion-v1-5/stable-diffusion-inpainting', controlnet=cn, variant='fp16',
                                                                          torch_dtype=torch.float32, safety_checker=None, requires_safety_checker=False)
        _pipe.scheduler = UniPCMultistepScheduler.from_config(_pipe.scheduler.config); _pipe.set_progress_bar_config(disable=True)
    H, W = hole.shape; s = min(1.0, 768 / max(H, W)); Ws, Hs = int(round(W * s / 8) * 8), int(round(H * s / 8) * 8)   # sd_return's working size (--long 768)
    ctl = Image.fromarray(np.round(np.clip(dctl, 0, 1) * 255).astype(np.uint8)).convert('RGB').resize((Ws, Hs), Image.BILINEAR)
    r = _pipe(prompt=PROMPT, negative_prompt=neg, image=Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).resize((Ws, Hs), Image.LANCZOS),
              mask_image=Image.fromarray((hole * 255).astype(np.uint8)).resize((Ws, Hs), Image.NEAREST), control_image=ctl,
              num_inference_steps=A.steps, generator=torch.Generator().manual_seed(A.seed), strength=strength, width=Ws, height=Hs).images[0]
    return np.asarray(r.resize((W, H), Image.LANCZOS), np.float32) / 255


def lab(a):   # sRGB (D65) -> CIELAB, the standard formulas (as the app's own Lab in bgInkAdopt)
    c = np.clip(a, 0, 1); c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    X = (c @ np.array([0.4124, 0.3576, 0.1805])) / 0.95047; Y = c @ np.array([0.2126, 0.7152, 0.0722]); Z = (c @ np.array([0.0193, 0.1192, 0.9505])) / 1.08883
    f = lambda t: np.where(t > 216 / 24389, np.cbrt(t), (24389 / 27 * t + 16) / 116)
    fx, fy, fz = f(X), f(Y), f(Z); return np.stack([116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)], -1)
def grad(a):
    l = a.mean(-1); g = np.zeros_like(l); g[:-1, :-1] = np.abs(np.diff(l, axis=1))[:-1, :] + np.abs(np.diff(l, axis=0))[:, :-1]; return g
def novel(fill, truth, hole):
    from scipy import ndimage as ndi
    Lf, Lt = lab(fill), lab(truth); dE = np.linalg.norm(Lf - Lt, axis=-1)
    self_dE = np.linalg.norm(Lt - np.roll(Lt, 2, axis=1), axis=-1)            # the truth against itself moved by two texels
    tE = float(np.percentile(self_dE[hole], 95)); gt = grad(truth); tG = float(np.percentile(gt[hole], 95))
    nov = hole & (dE > tE) & (grad(fill) > tG) & (grad(fill) > gt)
    nov = ndi.binary_closing(nov, iterations=2) & hole
    lb, n = ndi.label(nov); sz = ndi.sum(nov, lb, range(1, n + 1)) if n else np.array([])
    big = [int(x) for x in sz if x >= 17 * 17]
    return {'inventedObjects': len(big), 'inventedTexels': int(sum(big)), 'inventedPctOfHole': float(100 * sum(big) / max(1, hole.sum())), 'dEthr': tE, 'gradThr': tG}, nov

resf = os.path.join(A.out, 'painter_bench.json')
res = json.load(open(resf)) if os.path.exists(resf) else {}
save = lambda: json.dump(res, open(resf, 'w'), indent=1)
u8 = lambda a: Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))

if True:
    for spec in A.pics:
        name, rest = spec.split('='); pc, pd = rest.split(':')
        img, dn = G.load(pc, pd)
        case = paste_case(img, dn)
        if case is None: print(name, 'no flat far background for the figure', flush=True); continue
        comp0, hole, dctl, fig = case; key = 'fig'
        if True:
            r = res.setdefault(name, {}).setdefault(key, {'holePct': float(100 * hole.mean()), 'figPct': float(100 * fig.mean())})
            np.save(os.path.join(A.out, '%s_%s_hole.npy' % (name, key)), hole); u8(img).save(os.path.join(A.out, '%s_%s_truth.png' % (name, key)))
            u8(comp0).save(os.path.join(A.out, '%s_%s_input.png' % (name, key)))
            wash = G.pushpull(comp0, ~fig)
            base = {'vis': comp0, 'rm': np.where(fig[..., None], wash, comp0)}; lam = {}
            for arm in ARMS:
                f = os.path.join(A.out, '%s_%s_%s.png' % (name, key, arm.replace(':', '_')))
                if arm in r and os.path.exists(f): continue
                t0 = time.time(); inp, pa = arm.split(':'); b = base[inp]; seen = b.copy(); seen[hole] = 0
                if (pa == 'lama' or pa.startswith('lamasd')) and inp not in lam: lam[inp] = G.lama(seen, hole)
                if pa == 'lama': fill = lam[inp]
                elif pa == 'sd': fill = sd(seen, dctl, hole, NEG, 1.0)
                elif pa == 'sd_neg': fill = sd(seen, dctl, hole, NEG_STRONG, 1.0)
                elif pa.startswith('lamasd'): init = b.copy(); init[hole] = lam[inp][hole]; fill = sd(init, dctl, hole, NEG, int(pa[-1]) / 10)
                elif pa.startswith('washsd'): init = b.copy(); init[hole] = wash[hole]; fill = sd(init, dctl, hole, NEG, int(pa[-1]) / 10)
                comp = comp0.copy(); comp[hole] = fill[hole]; u8(comp).save(f)
                r[arm] = G.scores(fill, img, hole); r[arm]['secs'] = round(time.time() - t0, 1)
                nv, nvm = novel(fill, img, hole); r[arm].update(nv)
                viz = comp.copy(); viz[nvm] = viz[nvm] * 0.4 + np.array([1.0, 0.0, 0.8]) * 0.6; u8(viz).save(os.path.join(A.out, '%s_%s_%s_invented.png' % (name, key, arm.replace(':', '_'))))
                print(name, key, arm, {k: round(v, 4) for k, v in r[arm].items()}, flush=True); save()
print('DONE', flush=True)
