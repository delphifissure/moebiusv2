"""The SD stage as a tool: an exported plane bundle in, the app's plane-return files out (Import plane return reads them).

This is the stage the atlas exists for (user, 2026-09-23: "clean holes for later inpainting via diffusion ... then we use
SD later"). It uses the contract S52 found best (PACO arm A): the image is the bundle's plane_color_occluder_removed.png
(every occluder footprint replaced by a harmonic continuation of the legal background), the mask is plane_mask_inpaint.png
(the S61 section 10 pinhole rule applied, on branch rule5-pass), and the depth condition is the atlas's own hole depth
(plane_plate_depth16.png) through a depth ControlNet. The app writes returned colour on the mask and nowhere else.

  --depth   ask for depth back too (Phase B / R6's "ask for depth back, not only colour"): DA3-Mono-Large on the
            completed picture, fitted to the app's own source depth by least squares on the LEGAL BACKGROUND (plane_mask_context)
            in whichever affine form fits it better (DA3's value or its inverse), written for the mask texels as return_band_depth16.png; the app removes any
            remaining constant bias per component on import.

CPU works (no GPU here): SD 1.5 inpainting + control_v11f1p_sd15_depth at the working size (--long, multiple of 8), the
result resized back to the bundle's grid.

  python3 sd_return.py <bundle.zip> <out dir> [--steps 20] [--long 768] [--seed 1234] [--prompt "..."] [--depth]
Writes return_band_color.png (+ return_band_depth16.png), sd_return.json.
"""
import sys, os, io, json, time, zipfile, argparse
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser(); ap.add_argument('bundle'); ap.add_argument('out')
ap.add_argument('--steps', type=int, default=20); ap.add_argument('--long', type=int, default=768); ap.add_argument('--seed', type=int, default=1234)
ap.add_argument('--prompt', default='the background behind, continuous surfaces, natural texture'); ap.add_argument('--negative', default='person, figure, object, text')
ap.add_argument('--depth', action='store_true')
ap.add_argument('--grow', type=int, default=0, help='widen the mask SD paints by this many texels (the app still reads the bundle mask only)')
ap.add_argument('--image', default='occluder_removed', choices=['occluder_removed', 'plate'], help='occluder_removed: PACO arm A (S52); plate: the source with only the hole washed (plane_plate_color.png)'); A = ap.parse_args()
os.makedirs(A.out, exist_ok=True); z = zipfile.ZipFile(A.bundle); names = z.namelist()
rd = lambda n: Image.open(io.BytesIO(z.read(n)))
img_name = 'plane_color_occluder_removed.png' if (A.image == 'occluder_removed' and 'plane_color_occluder_removed.png' in names) else 'plane_plate_color.png'
img = rd(img_name).convert('RGB'); pw, ph = img.size
mask = np.asarray(rd('plane_mask_inpaint.png').convert('L')) > 127
mask_app = mask.copy()
if A.grow > 0:
    from scipy.ndimage import binary_dilation
    mask = binary_dilation(mask, iterations=A.grow)
ctl16 = np.asarray(rd('plane_plate_depth16.png')).astype(np.float64); ctl16 = ctl16 / (65535.0 if ctl16.max() > 255 else 255.0)
s = A.long / max(pw, ph); W, H = int(round(pw * s / 8) * 8), int(round(ph * s / 8) * 8)
import torch
from diffusers import StableDiffusionControlNetInpaintPipeline, ControlNetModel, UniPCMultistepScheduler
torch.set_num_threads(4)
cn = ControlNetModel.from_pretrained('lllyasviel/control_v11f1p_sd15_depth', variant='fp16', torch_dtype=torch.float32)
pipe = StableDiffusionControlNetInpaintPipeline.from_pretrained('stable-diffusion-v1-5/stable-diffusion-inpainting', controlnet=cn, variant='fp16',
                                                                torch_dtype=torch.float32, safety_checker=None, requires_safety_checker=False)
pipe.scheduler = UniPCMultistepScheduler.from_config(pipe.scheduler.config); pipe.set_progress_bar_config(disable=True)
t0 = time.time()
ctl = Image.fromarray(np.round(np.clip(ctl16, 0, 1) * 255).astype(np.uint8)).convert('RGB').resize((W, H), Image.BILINEAR)
res = pipe(prompt=A.prompt, negative_prompt=A.negative, image=img.resize((W, H), Image.LANCZOS), mask_image=Image.fromarray((mask * 255).astype(np.uint8)).resize((W, H), Image.NEAREST),
           control_image=ctl, num_inference_steps=A.steps, generator=torch.Generator().manual_seed(A.seed), strength=1.0, width=W, height=H).images[0]
sd_full = np.asarray(res.resize((pw, ph), Image.LANCZOS)).astype(np.uint8)
out = np.asarray(img).copy(); out[mask] = sd_full[mask]                      # colour on the mask only (the app enforces it too)
Image.fromarray(out).save(os.path.join(A.out, 'return_band_color.png'))
info = {'bundle': A.bundle, 'image': img_name, 'grid': [pw, ph], 'work': [W, H], 'steps': A.steps, 'seed': A.seed, 'prompt': A.prompt,
        'maskTexels': int(mask.sum()), 'sdSecs': round(time.time() - t0)}
if A.depth:
    t1 = time.time(); B = '/tmp/claude-0/-home-user-moebius/989b3965-28fd-58c7-96b5-b4b22c709919/scratchpad/bakeoff'
    sys.path.insert(0, f'{B}/Depth-Anything-3/src'); from depth_anything_3.api import DepthAnything3
    m = DepthAnything3.from_pretrained('depth-anything/DA3MONO-LARGE').to(device='cpu').eval()
    with torch.no_grad(): pred = m.inference([Image.fromarray(out)], process_res=1008, process_res_method='upper_bound_resize')
    dep = np.asarray(Image.fromarray(pred.depth[0].astype(np.float32)).resize((pw, ph), Image.BILINEAR)).astype(np.float64)
    dep.astype(np.float32).tofile(os.path.join(A.out, 'da3_raw.f32'))           # kept, so the fit can be redone without the model
    src = np.asarray(rd('plane_source_depth16.png')).astype(np.float64); src = src / (65535.0 if src.max() > 255 else 255.0)
    # fit only where the picture and the app agree: the bundle's legal background (plane_mask_context: white = strictly
    # behind no occluder, no placeholder). Outside it the completed picture has the occluder REMOVED while the source
    # depth still has it, and a fit over all visible texels fits that contradiction (troll smoke test: residual 0.067).
    ctx = (np.asarray(rd('plane_mask_context.png').convert('L')) > 127) if 'plane_mask_context.png' in names else ~mask
    vis = ctx & ~mask; best = None
    # DA3's output convention is not assumed: fit the app's normalised disparity as an affine function of DA3's value AND of
    # its inverse, on the visible texels; keep the form with the smaller median residual, and say which
    for form, x in (('affine in DA3 value', dep), ('affine in 1/DA3 value', 1.0 / np.maximum(dep, 1e-6))):
        a, b = np.polyfit(x[vis].ravel(), src[vis].ravel(), 1); f = np.clip(a * x + b, 0, 1); r = float(np.median(np.abs(f[vis] - src[vis])))
        if best is None or r < best[3]: best = (form, a, b, r, f)
    form, a, b, resid, fit = best
    d16 = np.zeros((ph, pw), np.uint16); d16[mask] = np.round(fit[mask] * 65535).astype(np.uint16)
    Image.fromarray(d16).save(os.path.join(A.out, 'return_band_depth16.png'))
    # the GRADIENT return (Sprint 25): a second DA3 pass on a different picture (the occluder removed) rescales depth
    # non-uniformly, so no global fit brings its absolute values into line (troll smoke test: median residual ~33 visible
    # steps on the legal background). Its gradients carry the painted content's shape without the offset; the app's
    # screened Poisson solve integrates them from the hole's own rim. Encoded as the importer expects: (g + 0.5) * 65535,
    # gx[i] ~ d[i+1] - d[i], gy[i] ~ d[i+pw] - d[i]; zero outside the mask.
    gx = np.zeros((ph, pw)); gy = np.zeros((ph, pw)); gx[:, :-1] = fit[:, 1:] - fit[:, :-1]; gy[:-1, :] = fit[1:, :] - fit[:-1, :]
    gx[~mask] = 0; gy[~mask] = 0
    for nm, g in (('return_band_gradx16.png', gx), ('return_band_grady16.png', gy)):
        Image.fromarray(np.round(np.clip(g + 0.5, 0, 1) * 65535).astype(np.uint16)).save(os.path.join(A.out, nm))
    info['depth'] = {'model': 'DA3-Mono-Large', 'fit': {'form': form, 'a': float(a), 'b': float(b)}, 'visibleMedianAbsResidual': resid, 'secs': round(time.time() - t1)}
json.dump(info, open(os.path.join(A.out, 'sd_return.json'), 'w'), indent=1); print(json.dumps(info))
