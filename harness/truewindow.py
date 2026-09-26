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
  Pixels MoGe marks invalid (sky) get d = 0 and are handled by the app's sky-at-infinity law (_skyInf); the mask is cleaned
  first (clean_valid: valid islands enclosed by sky are sky, invalid islands off the border take the depth around them).

  python3 truewindow.py color.png out_prefix [--slide f] [--model moge3|moge3base|moge2] [--refine N (MoGe-3 refiner steps, default 3)]  -> out_prefix_depth16.png, out_prefix_tw.json (the app parameters)

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


def main(color, prefix, slide=None, model='moge3', refine=3):
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
    valid, fixes = clean_valid(valid, P[..., 2])
    fx, fy = K[0, 0] * W, K[1, 1] * H
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
    p = {'model': {'moge3': 'MoGe-3 ViT-L, refine_steps=%d (CPU sparse ops)' % refine, 'moge3base': 'MoGe-3 ViT-L base (refine_steps=0)'}.get(model, 'MoGe-2 ViT-B'), 'slide': slide, 'beta': float(beta), 'skyAtInfinity': bool(beta == 0), 'pn': PN, 'outer': outer, 'inner': 1e-4, 'D_ref': float(D_ref), 'hfovDeg': float(np.degrees(hfov)), 'vfovDeg': float(np.degrees(vfov)),
         'Z_near_m': float(Z_near), 'Z_far_m': float(Z_near * (1 + outer / D_ref)), 'skyFraction': float(1 - valid.mean()), 'size': [W, H],
         'layerWH': [layerW, layerH], 'maskFixes': fixes, 'secs': round(time.time() - t0, 1)}
    json.dump(p, open(prefix + '_tw.json', 'w'), indent=1); print(json.dumps(p))


if __name__ == '__main__':
    a = sys.argv[1:]; sl = float(a[a.index('--slide') + 1]) if '--slide' in a else None
    md = a[a.index('--model') + 1] if '--model' in a else 'moge3'
    rf = int(a[a.index('--refine') + 1]) if '--refine' in a else 3
    main(a[0], a[1], sl, md, rf)
