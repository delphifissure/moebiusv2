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
ap.add_argument('--grow', default='auto', help="'auto' (default): the mask SD paints is widened evenly by the picture's silhouette colour fringe (its 90th percentile run, measured); N: widen by N texels; 0: the bundle mask as is. The app reads the bundle mask only")
ap.add_argument('--painter', default='sd', choices=['sd', 'lama', 'lama+sd'], help="sd: SD 1.5 inpainting from the wash; lama: LaMa (continues the surroundings, invents nothing); lama+sd: LaMa's fill refined by SD at --refine strength")
ap.add_argument('--refine', type=float, default=0.5, help='lama+sd: the strength of the SD refinement over the LaMa fill (0 = LaMa as is, 1 = SD from scratch)')
ap.add_argument('--image', default='occluder_removed', choices=['occluder_removed', 'plate'], help='occluder_removed: PACO arm A (S52); plate: the source with only the hole washed (plane_plate_color.png)'); A = ap.parse_args()
os.makedirs(A.out, exist_ok=True); z = zipfile.ZipFile(A.bundle); names = z.namelist()
rd = lambda n: Image.open(io.BytesIO(z.read(n)))
img_name = 'plane_color_occluder_removed.png' if (A.image == 'occluder_removed' and 'plane_color_occluder_removed.png' in names) else 'plane_plate_color.png'
img = rd(img_name).convert('RGB'); pw, ph = img.size
mask = np.asarray(rd('plane_mask_inpaint.png').convert('L')) > 127
mask_app = mask.copy()

def fringe(mask, rgb, dq, runs=False):
    """The silhouette's colour fringe (S62 §12): walking out from the hole's edge along its normal, the run of texels
    whose colour is nearer the occluder's own (2 texels inside the hole) than the background's (10-12 texels out),
    where the hole's edge is an occluder's silhouette (nearer inside than out) with a colour contrast across it. The
    troll's lace along the arms was SD continuing that fringe as an outline; the run is measured, not chosen."""
    from scipy.ndimage import binary_dilation, gaussian_filter, distance_transform_edt
    H, W = mask.shape; rgb = rgb.astype(np.float64)
    dist = distance_transform_edt(~mask); gy, gx = np.gradient(gaussian_filter(dist, 1.0)); n = np.hypot(gx, gy) + 1e-9; gx /= n; gy /= n
    out = np.zeros_like(mask); R = []; ys, xs = np.nonzero(binary_dilation(mask) & ~mask)
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
        k = 0
        for q in P[2:12]:
            if np.linalg.norm(rgb[q] - cO) < np.linalg.norm(rgb[q] - cB): out[q] = True; k += 1
            else: break
        R.append(k)
    return (out, np.array(R)) if runs else out

if A.grow == 'auto':
    src_rgb = np.asarray(rd('plane_source_color.png').convert('RGB')); src_d = np.asarray(rd('plane_source_depth16.png')).astype(np.float64); src_d /= 65535.0 if src_d.max() > 255 else 255.0
    # widened EVENLY by the picture's own fringe (the 90th percentile of the per-texel runs): widening only where a fringe
    # was measured kept the silhouette's jagged outline and the troll's lace came back heavier (3 759 texels added); an
    # even widening rounds the outline off, and SD stops reading the removed figure in the mask's shape
    fr, runs = fringe(mask, src_rgb, src_d, runs=True); gN = int(np.ceil(np.percentile(runs, 90))) if len(runs) else 0
    if gN > 0:
        from scipy.ndimage import binary_dilation
        mask = binary_dilation(mask, iterations=gN)
    GROW = {'auto': gN, 'fringeP50': float(np.percentile(runs, 50)) if len(runs) else 0, 'samples': len(runs)}
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
def grown(m):
    g = GROW['auto'] if A.grow == 'auto' else int(A.grow)
    if g > 0:
        from scipy.ndimage import binary_dilation
        return binary_dilation(m, iterations=g)
    return m
_lama = None
def lama_fill(image, m):
    global _lama
    if _lama is None:
        from simple_lama_inpainting import SimpleLama
        _lama = SimpleLama()
    out = np.asarray(_lama(Image.fromarray(image), Image.fromarray((m * 255).astype(np.uint8))))
    return out[:image.shape[0], :image.shape[1]].astype(np.uint8)
# PAINTER (S62 §12): SD 1.5 invents -- an object where a figure-shaped blank sits in a plain (the starwatcher's far pass painted
# a boat where he stood), lace along a silhouette. LaMa continues what surrounds the mask and invents nothing: clean on the
# troll's forest and the starwatcher's plain, a dark ghost of the Vermeer's woman where the hole is the whole figure and the
# table. lama+sd: LaMa's fill, then SD over it at --refine strength -- SD adds texture to a coherent fill instead of
# inventing into a blank.
def paint(image, m, depth, seed):
    if A.painter == 'lama': return lama_fill(image, m)
    if A.painter == 'lama+sd':
        base = image.copy(); lf = lama_fill(image, m); base[m] = lf[m]
        return paint_sd(base, m, depth, seed, A.refine)
    return paint_sd(image, m, depth, seed, 1.0)
def paint_sd(image, m, depth, seed, strength):
    ctl = Image.fromarray(np.round(np.clip(depth, 0, 1) * 255).astype(np.uint8)).convert('RGB').resize((W, H), Image.BILINEAR)
    r = pipe(prompt=A.prompt, negative_prompt=A.negative, image=Image.fromarray(image).resize((W, H), Image.LANCZOS), mask_image=Image.fromarray((m * 255).astype(np.uint8)).resize((W, H), Image.NEAREST),
             control_image=ctl, num_inference_steps=A.steps, generator=torch.Generator().manual_seed(seed), strength=strength, width=W, height=H).images[0]
    return np.asarray(r.resize((pw, ph), Image.LANCZOS)).astype(np.uint8)
# SD paints SURFACES, not plates (S62 §12). Where the bundle carries plate 2, plate 1 is not one surface: in the dune's
# band it holds the far plain, behind the legs the dune continued. Handed over as one picture, that is a leg-shaped island
# of near dune in a band of far plain, and SD painted an object there (starwatcher, every pose). So two passes, each a
# picture of one surface:
#   FAR:  the far surface wherever the hole shows it (plate 1 outside plate 2's texels, plate 2 inside), with its depth;
#         it gives plate 1 outside plate 2's texels and plate 2 itself;
#   NEAR: the middle surface: the source picture with only plate 2's texels (where plate 1 is the nearer layer) repainted,
#         plate 1's depth there and the source depth around; it gives plate 1 on those texels.
# Without plate 2 the far pass is the only one (as before).
t0 = time.time(); src_rgb2 = np.asarray(rd('plane_source_color.png').convert('RGB')); src_d2 = np.asarray(rd('plane_source_depth16.png')).astype(np.float64); src_d2 /= 65535.0 if src_d2.max() > 255 else 255.0
p1c = np.asarray(img).copy(); has2 = np.zeros((ph, pw), bool); out2 = None
if 'plane_plate2_mask.png' in names and 'plane_plate2_color.png' in names and 'plane_plate2_depth16.png' in names:
    has2 = (np.asarray(rd('plane_plate2_mask.png').convert('L')) > 127) & mask_app
if has2.any():
    p2c = np.asarray(rd('plane_plate2_color.png').convert('RGB')); p2d = np.asarray(rd('plane_plate2_depth16.png')).astype(np.float64); p2d /= 65535.0 if p2d.max() > 255 else 255.0
    farImg = p1c.copy(); farImg[has2] = p2c[has2]; farD = ctl16.copy(); farD[has2] = p2d[has2]
    far = paint(farImg, mask, farD, A.seed); farOut = farImg.copy(); farOut[mask] = far[mask]
    # the figure in front of the middle surface is taken out of the near picture (plane_mask_occluder): left in, SD continued
    # the legs it saw above the region down into it (new boots at the starwatcher's feet). Its texels take plate 1's wash,
    # the dune continued below the ridge and the plain above, and plate 1's depth
    occ = (np.asarray(rd('plane_mask_occluder.png').convert('L')) > 127) & mask_app if 'plane_mask_occluder.png' in names else np.zeros_like(has2)
    nearImg = src_rgb2.copy(); nearD = src_d2.copy(); fig = occ | has2
    nearImg[fig] = p1c[fig]; nearD[fig] = ctl16[fig]; nm = grown(has2)
    near = paint(nearImg, nm, nearD, A.seed + 1)
    out = farOut.copy(); out[has2] = near[has2]; out2 = farOut
else:
    sd_full = paint(p1c, mask, ctl16, A.seed); out = p1c.copy(); out[mask] = sd_full[mask]   # colour on the mask only (the app enforces it too)
Image.fromarray(out).save(os.path.join(A.out, 'return_band_color.png'))
if out2 is not None: Image.fromarray(out2).save(os.path.join(A.out, 'return_band2_color.png'))
info = {'bundle': A.bundle, 'image': img_name, 'painter': A.painter, 'refine': A.refine if A.painter == 'lama+sd' else None, 'grid': [pw, ph], 'work': [W, H], 'steps': A.steps, 'seed': A.seed, 'prompt': A.prompt,
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
if has2.any(): info['layers'] = {'plate2Texels': int(has2.sum()), 'occluderTexels': int(occ.sum()), 'passes': ['far (plate 1 outside plate 2, and plate 2)', 'near (plate 1 on plate 2\'s texels, on the source picture)']}
json.dump(info, open(os.path.join(A.out, 'sd_return.json'), 'w'), indent=1); print(json.dumps(info))
