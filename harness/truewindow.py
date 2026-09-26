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

  python3 truewindow.py color.png out_prefix  -> out_prefix_depth16.png, out_prefix_tw.json (the app parameters)
"""
import json, sys, time
import numpy as np, torch
from PIL import Image

TW, TH = 0.16, 0.09          # terrariumWidth / terrariumHeight (moebius.js)
PN = 0.999                   # the portal at the nearest content: everything behind the glass


def inv_smoothstep(y):       # y in [0, 1] -> t with t^2 (3 - 2t) = y, t in [0, 1] (the monotone root)
    y = np.clip(y, 0.0, 1.0)
    return 0.5 - np.sin(np.arcsin(1.0 - 2.0 * y) / 3.0)


def main(color, prefix):
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
    zb = np.where(valid, np.maximum(0.0, D_ref * (Z / Z_near - 1.0)), np.inf)
    outer = float(np.percentile(zb[valid], 99.9))
    d = np.where(valid, PN * inv_smoothstep(1.0 - np.minimum(zb, outer) / outer), 0.0)
    Image.fromarray(np.round(d * 65535).astype(np.uint16)).save(prefix + '_depth16.png')
    p = {'pn': PN, 'outer': outer, 'inner': 1e-4, 'D_ref': float(D_ref), 'hfovDeg': float(np.degrees(hfov)), 'vfovDeg': float(np.degrees(vfov)),
         'Z_near_m': float(Z_near), 'Z_far_m': float(Z_near * (1 + outer / D_ref)), 'skyFraction': float(1 - valid.mean()), 'size': [W, H],
         'layerWH': [layerW, layerH], 'secs': round(time.time() - t0, 1)}
    json.dump(p, open(prefix + '_tw.json', 'w'), indent=1); print(json.dumps(p))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
