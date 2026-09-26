#!/usr/bin/env python3
"""True-window geometry for a photograph (the Lamppost fault, 2026-09-26): each pixel at its real distance along its own
sight line, seen from the photograph's own centre of projection, expressed in the app's existing depth law so that every
part of the app (shader, bake, band, rim law, LUTs, worker) sees the same geometry with no code change.

  MoGe-3 ViT-L (default; --model moge2 for MoGe-2 ViT-B) (metric point map + intrinsics) -> Z (camera-axis distance, m) and the field of view.
  The picture is fitted in the portal as the app fits it (terrarium 0.16 x 0.09, the longer relative side filling it);
  D_ref = (picture half-height in portal units) / tan(vfov / 2): the distance at which the portal picture subtends the
  photograph's field of view, so the reference eye's rays ARE the camera's rays.
  The nearest content (99.9th percentile of 1/Z) sits on the glass: z_behind(Z) = D_ref (Z / Z_near - 1).
  The app's law behind the glass is z = -outer (1 - smoothstep(0, pn, d)); with pn -> 1 and outer = the farthest finite
  z_behind, d = pn * smoothstep^-1(1 - z_behind / outer) reproduces z_behind exactly (smoothstep is monotone on [0, 1]).
  Sky pixels get d = 0 and are handled by the app's sky-at-infinity law (_skyInf). The sky is DA3-Metric's sky head
  (da3_sky; --sky moge falls back to MoGe's invalid mask cleaned by clean_valid's island rules, which the probe showed wrong).

  python3 truewindow.py color.png out_prefix [--slide f] [--model moge3|moge3base|moge2] [--refine N (MoGe-3 refiner steps, default 3)] [--sky da3|moge] [--depth moge|da3metric|depthpro (the distances from another model; the mask from MoGe-3 + DA3, the lens from MoGe-3 or Depth Pro's own)]  -> out_prefix_depth16.png, out_prefix_tw.json (the app parameters)

DEPTH BUDGET (--slide f): one picture of a deep scene cannot support a 42 deg swing -- the far background slides by the
whole head offset t = D_ref tan 42 and the window fills with what the picture never saw. A budget compresses depth
PROJECTIVELY: q = Z_near / Z (1 at the glass, 0 at infinity) becomes q' = beta + (1 - beta) q. A map linear in inverse
depth along the rays from the eye is a projective transform fixing the eye: straight lines stay straight, planes stay
planes (the pole stays straight, the ground stays flat), the nearest content stays on the glass, and infinity lands on a
back wall at D_ref / beta. The farthest content (the sky too) then slides t (1 - beta) on the glass; beta is set so that
this is f of the picture width: beta = max(0, 1 - f W_pic / t). f is the product's choice (no budget: the true window).
"""
import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, torch
from PIL import Image

TW, TH = 0.16, 0.09          # terrariumWidth / terrariumHeight (moebius.js)
PN = 0.999                   # the portal at the nearest content: everything behind the glass


def inv_smoothstep(y):       # y in [0, 1] -> t with t^2 (3 - 2t) = y, t in [0, 1] (the monotone root)
    y = np.clip(y, 0.0, 1.0)
    return 0.5 - np.sin(np.arcsin(1.0 - 2.0 * y) / 3.0)


def clean_valid(valid, Z):
    """MoGe's mask marks the sky invalid, and sometimes pieces of it valid and pieces of objects invalid:
    - a VALID island whose whole outer boundary is invalid (a cloud inside the sky) floats in front of the sky and opens
      a hole at every pose -> it is sky;
    - an INVALID island that does not reach the picture's border is not sky (sky reaches the frame) -> it takes the
      median depth of the valid ring around it."""
    from scipy import ndimage as ndi
    H, W = valid.shape; st = np.ones((3, 3), bool); fixes = {'cloudIslandsToSky': 0, 'holesFilled': 0}
    lv, nv = ndi.label(valid, st)
    for k in range(1, nv + 1):
        m = lv == k; ring = ndi.binary_dilation(m, st) & ~m
        if ring.any() and not valid[ring].any() and not (m[0].any() or m[-1].any() or m[:, 0].any() or m[:, -1].any()):
            valid = valid & ~m; fixes['cloudIslandsToSky'] += int(m.sum())
    li, ni = ndi.label(~valid, st)
    Zf = Z.copy()
    for k in range(1, ni + 1):
        m = li == k
        if m[0].any() or m[-1].any() or m[:, 0].any() or m[:, -1].any(): continue
        ring = ndi.binary_dilation(m, st, iterations=2) & ~m & valid
        if ring.any(): Zf[m] = np.median(Z[ring]); valid = valid | m; fixes['holesFilled'] += int(m.sum())
    Z[:] = Zf
    return valid, fixes


def da3_sky(img):
    """The sky, from DA3-Metric's own sky head (depth-anything/DA3METRIC-LARGE, Apache-2.0), at the picture's resolution.
    Replaces clean_valid's island rules (2026-09-26), which were wrong both ways on the probe (harness/sky_islands_probe.py):
    sky seen through a fence's gaps and through foliage is enclosed by the foreground and was given the foreground's depth;
    a twig or bird alone in the sky was turned into sky and lost its parallax; on Caillebotte the enclosed "holes" were sky
    and MoGe's solid patches in them were sky too. DA3's head calls the fence and foliage gaps sky (0.85-0.99 of their
    pixels), the Lamppost twig not sky (0.33), all of Caillebotte's patches sky, and agrees with MoGe's mask on the
    photographs (IoU 0.97-0.99)."""
    B = os.environ.get('DA3_SRC', '/tmp/claude-0/-home-user-moebius/989b3965-28fd-58c7-96b5-b4b22c709919/scratchpad/bakeoff/Depth-Anything-3/src')
    sys.path.insert(0, B); from depth_anything_3.api import DepthAnything3
    m = DepthAnything3.from_pretrained('depth-anything/DA3METRIC-LARGE').to(device='cpu').eval()
    with torch.no_grad(): p = m.inference([img], process_res=1008, process_res_method='upper_bound_resize')
    s = Image.fromarray((p.sky[0] > 0.5).astype(np.uint8) * 255).resize(img.size, Image.NEAREST)
    da3_sky.depth = np.asarray(Image.fromarray(p.depth[0].astype(np.float32)).resize(img.size, Image.BILINEAR))   # canonical depth (metric x 300 / focal): up to one scale
    return np.asarray(s) > 127


def sky_from_da3(valid, Z, sky):
    """MoGe's validity with DA3's sky: DA3 sky (in regions MoGe also sees sky in) is sky, even where MoGe gave a depth; a pixel MoGe dropped that DA3 does not
    call sky is an object MoGe missed -- each such component takes the median depth of the valid ring around it."""
    from scipy import ndimage as ndi
    st = np.ones((3, 3), bool)
    # a DA3 sky region counts only where MoGe also sees sky somewhere inside it: on paintings DA3's head is patchy (271 specks
    # across Hunters' sky, 588 across Starwatcher's, where MoGe sees none) and each speck would tear to infinity; on the
    # photographs every region with real sky contains MoGe sky, and Caillebotte's whole sky is one region seeded by MoGe's
    lab, nreg = ndi.label(sky, st); seeds = np.unique(lab[sky & ~valid]); seeds = seeds[seeds > 0]
    sky = np.isin(lab, seeds)
    fixes = {'skyRule': 'DA3METRIC-LARGE sky head, regions seeded by MoGe sky', 'da3Regions': int(nreg), 'da3RegionsKept': int(len(seeds)), 'mogeSolidToSky': int((valid & sky).sum()), 'mogeDroppedFilled': 0, 'mogeDroppedUnfilled': 0}
    v = valid & ~sky; miss = ~valid & ~sky; li, ni = ndi.label(miss, st)
    for k in range(1, ni + 1):
        mk = li == k; ring = ndi.binary_dilation(mk, st, iterations=2) & ~mk & v
        if ring.any(): Z[mk] = np.median(Z[ring]); v |= mk; fixes['mogeDroppedFilled'] += int(mk.sum())
        else: fixes['mogeDroppedUnfilled'] += int(mk.sum())
    return v, fixes


def load_moge3(refine=True):
    """MoGe-3 ViT-L (MIT). Its sparse 3D refiner (refine_steps, default 3) is written against FlexGEMM (CUDA/Triton). With
    refine=True the four FlexGEMM pieces come from harness/cpu_flex_gemm.py (FlexGEMM's own PyTorch reference arithmetic,
    checked against dense conv3d / avg_pool3d) and the full model runs on CPU; refine=False builds the base model only
    (S26's refine_steps=0)."""
    import types
    from huggingface_hub import hf_hub_download
    if refine:
        import cpu_flex_gemm; cpu_flex_gemm.install()
        from moge.model.v3 import MoGeModel
        ck = torch.load(hf_hub_download('Ruicheng/moge-3-vitl', 'model.pt'), map_location='cpu', weights_only=True)
        m = MoGeModel(**ck['model_config']); r = m.load_state_dict(ck['model'], strict=True); return m.eval()
    fg = types.ModuleType('flex_gemm'); fgnn = types.ModuleType('flex_gemm.nn'); fgops = types.ModuleType('flex_gemm.ops')
    class _Stub(torch.nn.Module):
        def __init__(self, *a, **k): super().__init__()
    for n in ('SubmanifoldConv3d', 'SparsePool3d', 'SparseUpsample3d'): setattr(fgnn, n, _Stub)
    fgops.NeighborCache = _Stub; fg.nn = fgnn; fg.ops = fgops
    sys.modules.update({'flex_gemm': fg, 'flex_gemm.nn': fgnn, 'flex_gemm.ops': fgops})
    from moge.model.v3 import MoGeModel
    ck = torch.load(hf_hub_download('Ruicheng/moge-3-vitl', 'model.pt'), map_location='cpu', weights_only=True)
    cfg = dict(ck['model_config']); cfg.pop('refiner', None); cfg.pop('refiner_depth_resolution', None)
    m = MoGeModel(**cfg); m.load_state_dict(ck['model'], strict=False); return m.eval()


def depth_pro(img):
    """Apple Depth Pro (ml-depth-pro; weights ckpt/depth_pro.pt): metric depth and its own focal length."""
    B = os.environ.get('DEPTHPRO_DIR', '/tmp/claude-0/-home-user-moebius/989b3965-28fd-58c7-96b5-b4b22c709919/scratchpad/bakeoff')
    import depth_pro as dp
    from depth_pro.depth_pro import DEFAULT_MONODEPTH_CONFIG_DICT as C
    C.checkpoint_uri = B + '/ckpt/depth_pro.pt'
    model, transform = dp.create_model_and_transforms(config=C, device=torch.device('cpu'), precision=torch.float32); model.eval()
    with torch.no_grad(): pr = model.infer(transform(img), f_px=None)
    return pr['depth'].cpu().numpy().astype(np.float32), float(pr['focallength_px'])


def main(color, prefix, slide=None, model='moge3', refine=3, sky_rule='da3', depth_src='moge'):
    img = np.asarray(Image.open(color).convert('RGB')); H, W = img.shape[:2]
    x = torch.tensor(img / 255., dtype=torch.float32).permute(2, 0, 1)
    if model in ('moge3', 'moge3base'):
        rs = refine if model == 'moge3' else 0
        m = load_moge3(refine=rs > 0); t0 = time.time()
        with torch.no_grad(): o = m.infer(x, fov_x=None, resolution_level=9, refine_steps=rs, use_fp16=False)
    else:
        from moge.model.v2 import MoGeModel
        m = MoGeModel.from_pretrained('Ruicheng/moge-2-vitb-normal').eval(); t0 = time.time()
        with torch.no_grad(): o = m.infer(x, use_fp16=False)
    K = o['intrinsics'].numpy(); P = o['points'].numpy(); valid = o['mask'].numpy() & np.isfinite(P[..., 2]) & (P[..., 2] > 0)
    if sky_rule == 'da3': valid, fixes = sky_from_da3(valid, P[..., 2], da3_sky(Image.fromarray(img)))
    else: valid, fixes = clean_valid(valid, P[..., 2])
    fx, fy = K[0, 0] * W, K[1, 1] * H
    # --depth: the distances from another model, the sky mask and (for DA3-Metric) the lens still MoGe-3's; scale is irrelevant
    # (the true window uses Z / Z_near only). DA3-Metric has no lens of its own; Depth Pro brings its own focal length.
    if depth_src == 'da3metric':
        if not hasattr(da3_sky, 'depth'): da3_sky(Image.fromarray(img))
        P = P.copy(); P[..., 2] = np.where(valid, da3_sky.depth, P[..., 2])
    elif depth_src == 'depthpro':
        Zp, fpx = depth_pro(img); P = P.copy(); P[..., 2] = np.where(valid, Zp, P[..., 2]); fx = fy = fpx
    valid = valid & np.isfinite(P[..., 2]) & (P[..., 2] > 0)
    hfov, vfov = 2 * np.arctan(W / 2 / fx), 2 * np.arctan(H / 2 / fy)
    # the portal picture: the app fits the layer so the longer relative side fills the terrarium
    layerW = TW if W / H > TW / TH else TH * W / H; layerH = layerW * H / W
    D_ref = (layerH / 2) / np.tan(vfov / 2)
    Z = P[..., 2]; inv = np.where(valid, 1.0 / np.maximum(Z, 1e-6), 0.0)
    Z_near = 1.0 / np.percentile(inv[valid], 99.9)
    t = D_ref * np.tan(np.radians(42.0)); beta = 0.0 if slide is None else max(0.0, 1.0 - slide * layerW / t)
    q = np.where(valid, np.minimum(1.0, Z_near / np.maximum(Z, 1e-6)), 0.0)
    qp = beta + (1.0 - beta) * q                                     # the budget (beta = 0: the true window)
    zb = np.where(valid | (beta > 0), D_ref * (1.0 / np.maximum(qp, 1e-9) - 1.0), np.inf)
    outer = float(D_ref * (1.0 / beta - 1.0)) if beta > 0 else float(np.percentile(zb[valid], 99.9))
    d = np.where(valid | (beta > 0), PN * inv_smoothstep(1.0 - np.minimum(zb, outer) / outer), 0.0)
    Image.fromarray(np.round(d * 65535).astype(np.uint16)).save(prefix + '_depth16.png')
    p = {'depthSource': depth_src, 'model': {'moge3': 'MoGe-3 ViT-L, refine_steps=%d (CPU sparse ops)' % refine, 'moge3base': 'MoGe-3 ViT-L base (refine_steps=0)'}.get(model, 'MoGe-2 ViT-B'), 'slide': slide, 'beta': float(beta), 'skyAtInfinity': bool(beta == 0), 'pn': PN, 'outer': outer, 'inner': 1e-4, 'D_ref': float(D_ref), 'hfovDeg': float(np.degrees(hfov)), 'vfovDeg': float(np.degrees(vfov)),
         'Z_near_m': float(Z_near), 'Z_far_m': float(Z_near * (1 + outer / D_ref)), 'skyFraction': float(1 - valid.mean()), 'size': [W, H],
         'layerWH': [layerW, layerH], 'maskFixes': fixes, 'secs': round(time.time() - t0, 1)}
    json.dump(p, open(prefix + '_tw.json', 'w'), indent=1); print(json.dumps(p))


if __name__ == '__main__':
    a = sys.argv[1:]; sl = float(a[a.index('--slide') + 1]) if '--slide' in a else None
    md = a[a.index('--model') + 1] if '--model' in a else 'moge3'
    rf = int(a[a.index('--refine') + 1]) if '--refine' in a else 3
    sk = a[a.index('--sky') + 1] if '--sky' in a else 'da3'
    ds = a[a.index('--depth') + 1] if '--depth' in a else 'moge'
    main(a[0], a[1], sl, md, rf, sk, ds)
