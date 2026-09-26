#!/usr/bin/env python3
"""True-window geometry for a photograph (the Lamppost fault, 2026-09-26): each pixel at its real distance along its own
sight line, seen from the photograph's own centre of projection, expressed in the app's existing depth law so that every
part of the app (shader, bake, band, rim law, LUTs, worker) sees the same geometry with no code change.

  MoGe-2 (metric point map + intrinsics) -> Z (camera-axis distance, m) and the field of view.
  The picture is fitted in the portal as the app fits it (terrarium 0.16 x 0.09, the longer relative side filling it);
  D_ref = (picture half-height in portal units) / tan(vfov / 2): the distance at which the portal picture subtends the
  photograph's field of view, so the reference eye's rays ARE the camera's rays.
  The nearest content (99.9th percentile of 1/Z) sits on the glass: z_behind(Z) = D_ref (Z / Z_near - 1).
  The app's law behind the glass is z = -outer (1 - smoothstep(0, pn, d)); with pn -> 1 and outer = the farthest finite
  z_behind, d = pn * smoothstep^-1(1 - z_behind / outer) reproduces z_behind exactly (smoothstep is monotone on [0, 1]).
  Pixels MoGe marks invalid (sky) get d = 0 and are handled by the app's sky-at-infinity law (_skyInf).

  python3 truewindow.py color.png out_prefix [--slide f]  -> out_prefix_depth16.png, out_prefix_tw.json (the app parameters)

DEPTH BUDGET (--slide f): one picture of a deep scene cannot support a 42 deg swing -- the far background slides by the
whole head offset t = D_ref tan 42 and the window fills with what the picture never saw. A budget compresses depth
PROJECTIVELY: q = Z_near / Z (1 at the glass, 0 at infinity) becomes q' = beta + (1 - beta) q. A map linear in inverse
depth along the rays from the eye is a projective transform fixing the eye: straight lines stay straight, planes stay
planes (the pole stays straight, the ground stays flat), the nearest content stays on the glass, and infinity lands on a
back wall at D_ref / beta. The farthest content (the sky too) then slides t (1 - beta) on the glass; beta is set so that
this is f of the picture width: beta = max(0, 1 - f W_pic / t). f is the product's choice (no budget: the true window).
"""
import json, sys, time
import numpy as np, torch
from PIL import Image

TW, TH = 0.16, 0.09          # terrariumWidth / terrariumHeight (moebius.js)
PN = 0.999                   # the portal at the nearest content: everything behind the glass


def inv_smoothstep(y):       # y in [0, 1] -> t with t^2 (3 - 2t) = y, t in [0, 1] (the monotone root)
    y = np.clip(y, 0.0, 1.0)
    return 0.5 - np.sin(np.arcsin(1.0 - 2.0 * y) / 3.0)


def main(color, prefix, slide=None):
    from moge.model.v2 import MoGeModel
    img = np.asarray(Image.open(color).convert('RGB')); H, W = img.shape[:2]
    m = MoGeModel.from_pretrained('Ruicheng/moge-2-vitb-normal').eval(); t0 = time.time()
    with torch.no_grad(): o = m.infer(torch.tensor(img / 255., dtype=torch.float32).permute(2, 0, 1), use_fp16=False)
    K = o['intrinsics'].numpy(); P = o['points'].numpy(); valid = o['mask'].numpy() & np.isfinite(P[..., 2]) & (P[..., 2] > 0)
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
    p = {'slide': slide, 'beta': float(beta), 'skyAtInfinity': bool(beta == 0), 'pn': PN, 'outer': outer, 'inner': 1e-4, 'D_ref': float(D_ref), 'hfovDeg': float(np.degrees(hfov)), 'vfovDeg': float(np.degrees(vfov)),
         'Z_near_m': float(Z_near), 'Z_far_m': float(Z_near * (1 + outer / D_ref)), 'skyFraction': float(1 - valid.mean()), 'size': [W, H],
         'layerWH': [layerW, layerH], 'secs': round(time.time() - t0, 1)}
    json.dump(p, open(prefix + '_tw.json', 'w'), indent=1); print(json.dumps(p))


if __name__ == '__main__':
    a = sys.argv[1:]; sl = float(a[a.index('--slide') + 1]) if '--slide' in a else None
    main(a[0], a[1], sl)
