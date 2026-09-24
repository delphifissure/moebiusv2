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
Writes return_band_color.png (+ return_band_depth16.png), return_band2_color.png where the bundle has plate 2, sd_return.json.
"""
import sys, os, io, json, time, zipfile, argparse
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser(); ap.add_argument('bundle'); ap.add_argument('out')
ap.add_argument('--steps', type=int, default=20); ap.add_argument('--long', type=int, default=768); ap.add_argument('--seed', type=int, default=1234)
ap.add_argument('--prompt', default='the background behind, continuous surfaces, natural texture'); ap.add_argument('--negative', default='person, figure, object, text')
ap.add_argument('--depth', action='store_true')
ap.add_argument('--grow', default='auto', help="'auto' (default): the mask SD paints takes in the silhouette's colour fringe, measured per texel; N: widen by N texels; 0: the bundle mask as is. The app reads the bundle mask only")
ap.add_argument('--image', default='occluder_removed', choices=['occluder_removed', 'plate'], help='occluder_removed: PACO arm A (S52); plate: the source with only the hole washed (plane_plate_color.png)'); A = ap.parse_args()
os.makedirs(A.out, exist_ok=True); z = zipfile.ZipFile(A.bundle); names = z.namelist()
rd = lambda n: Image.open(io.BytesIO(z.read(n)))
img_name = 'plane_color_occluder_removed.png' if (A.image == 'occluder_removed' and 'plane_color_occluder_removed.png' in names) else 'plane_plate_color.png'
img = rd(img_name).convert('RGB'); pw, ph = img.size
mask = np.asarray(rd('plane_mask_inpaint.png').convert('L')) > 127
mask_app = mask.copy()

def fringe(mask, rgb, dq):
    """The silhouette's colour fringe (S62 §12): walking out from the hole's edge along its normal, the run of texels
    whose colour is nearer the occluder's own (2 texels inside the hole) than the background's (10-12 texels out),
    where the hole's edge is an occluder's silhouette (nearer inside than out) with a colour contrast across it. The
    troll's lace along the arms was SD continuing that fringe as an outline; the run is measured, not chosen."""
    from scipy.ndimage import binary_dilation, gaussian_filter, distance_transform_edt
    H, W = mask.shape; rgb = rgb.astype(np.float64)
    dist = distance_transform_edt(~mask); gy, gx = np.gradient(gaussian_filter(dist, 1.0)); n = np.hypot(gx, gy) + 1e-9; gx /= n; gy /= n
    out = np.zeros_like(mask); ys, xs = np.nonzero(binary_dilation(mask) & ~mask)
    for y, x in zip(ys, xs):
        P = []
        for k in range(-2, 13):
            yy, xx = int(round(y + k * gy[y, x])), int(round(x + k * gx[y, x]))
            if not (0 <= yy < H and 0 <= xx < W): break
            P.append((yy, xx))
        if len(P) < 15: continue
        yi, xi = P[0]
        if not mask[yi, xi] or not dq[yi, xi] > dq[y, x]: continue
        cO = np.mean([rgb[q] for q in P[0:2]], 0); cB = np.mean([rgb[q] for q in P[12:15]], 0)
        if np.linalg.norm(cO - cB) < 24: continue                     # 24/255 over RGB: no visible contrast to measure
        for q in P[2:12]:
            if np.linalg.norm(rgb[q] - cO) < np.linalg.norm(rgb[q] - cB): out[q] = True
            else: break
    return out

if A.grow == 'auto':
    src_rgb = np.asarray(rd('plane_source_color.png').convert('RGB')); src_d = np.asarray(rd('plane_source_depth16.png')).astype(np.float64); src_d /= 65535.0 if src_d.max() > 255 else 255.0
    fr = fringe(mask, src_rgb, src_d); mask = mask | fr; GROW = {'auto': int(fr.sum())}
elif int(A.grow) > 0:
    from scipy.ndimage import binary_dilation
    mask = binary_dilation(mask, iterations=int(A.grow)); GROW = int(A.grow)
else: GROW = 0
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
        'maskTexels': int(mask.sum()), 'appMaskTexels': int(mask_app.sum()), 'grow': GROW, 'sdSecs': round(time.time() - t0)}
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
# THE SECOND LAYER (S62 §12): where the bundle carries plate 2 (plane_plate2_mask: the surface behind a nearer fill, e.g.
# the plain behind the dune continued behind a figure's legs), a pose that slides plate 1 past shows it, so it is painted
# too: SD on the first pass's picture with plate 2's own wash in its region, its mask (widened like the first) and plate 2's
# depth as the condition. Written as return_band2_color.png; the app's import paints plate 2 with it.
if 'plane_plate2_mask.png' in names and 'plane_plate2_color.png' in names and 'plane_plate2_depth16.png' in names:
    m2 = np.asarray(rd('plane_plate2_mask.png').convert('L')) > 127
    if m2.any():
        t2 = time.time(); c2 = np.asarray(rd('plane_plate2_color.png').convert('RGB'))
        img2 = out.copy(); img2[m2] = c2[m2]
        d2 = np.asarray(rd('plane_plate2_depth16.png')).astype(np.float64); d2 = d2 / (65535.0 if d2.max() > 255 else 255.0)
        g2 = m2.copy()
        if A.grow == 'auto': g2 = m2 | fringe(m2, img2, d2)
        elif int(A.grow) > 0:
            from scipy.ndimage import binary_dilation
            g2 = binary_dilation(m2, iterations=int(A.grow))
        ctl2 = Image.fromarray(np.round(np.clip(d2, 0, 1) * 255).astype(np.uint8)).convert('RGB').resize((W, H), Image.BILINEAR)
        res2 = pipe(prompt=A.prompt, negative_prompt=A.negative, image=Image.fromarray(img2).resize((W, H), Image.LANCZOS), mask_image=Image.fromarray((g2 * 255).astype(np.uint8)).resize((W, H), Image.NEAREST),
                    control_image=ctl2, num_inference_steps=A.steps, generator=torch.Generator().manual_seed(A.seed + 1), strength=1.0, width=W, height=H).images[0]
        sd2 = np.asarray(res2.resize((pw, ph), Image.LANCZOS)).astype(np.uint8)
        out2 = img2.copy(); out2[g2] = sd2[g2]
        Image.fromarray(out2).save(os.path.join(A.out, 'return_band2_color.png'))
        info['layer2'] = {'maskTexels': int(m2.sum()), 'sdSecs': round(time.time() - t2)}
json.dump(info, open(os.path.join(A.out, 'sd_return.json'), 'w'), indent=1); print(json.dumps(info))
