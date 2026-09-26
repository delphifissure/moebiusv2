#!/usr/bin/env python3
"""DA3-Metric (depth-anything/DA3METRIC-LARGE, Apache-2.0) beside MoGe-3 on the same pictures:
  - SKY: DA3-Metric's own sky head vs MoGe-3's invalid mask (two independent sky opinions);
  - SCALE: DA3-Metric's metres (its README: metric = focal_px * net_output / 300, focal from MoGe-3's field of view at the
    processed resolution) vs MoGe-3's metres on the pixels both call scene: the median ratio and its spread. Two metric
    estimators trained on photographs should agree on a photograph; on art there is no true scale to agree on.
  python3 da3metric_probe.py OUTDIR name=color.png ...   (run from bakeoff/MoGe so moge imports)
"""
import json, os, sys, time
import numpy as np, torch
from PIL import Image
H0 = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, H0)
B = '/tmp/claude-0/-home-user-moebius/989b3965-28fd-58c7-96b5-b4b22c709919/scratchpad/bakeoff'; sys.path.insert(0, B + '/Depth-Anything-3/src')
from truewindow import load_moge3
from depth_anything_3.api import DepthAnything3
torch.set_num_threads(4)
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
jp = os.path.join(out, 'da3metric.json'); R = json.load(open(jp)) if os.path.exists(jp) else {}
mo = load_moge3(refine=False)
da = DepthAnything3.from_pretrained('depth-anything/DA3METRIC-LARGE').to(device='cpu').eval()
for spec in sys.argv[2:]:
    name, path = spec.split('=', 1)
    if name in R: continue
    img = Image.open(path).convert('RGB'); a = np.asarray(img); H, W = a.shape[:2]
    t0 = time.time()
    with torch.no_grad(): o = mo.infer(torch.tensor(a / 255., dtype=torch.float32).permute(2, 0, 1), fov_x=None, resolution_level=9, refine_steps=0, use_fp16=False)
    K = o['intrinsics'].numpy(); Zm = o['points'].numpy()[..., 2]; vm = o['mask'].numpy() & np.isfinite(Zm) & (Zm > 0)
    fx_px = K[0, 0] * W; hfov = float(np.degrees(2 * np.arctan(W / 2 / fx_px)))
    with torch.no_grad(): p = da.inference([img], process_res=1008, process_res_method='upper_bound_resize')
    net = p.depth[0]; h, w = net.shape; f_proc = fx_px * w / W
    Zd = f_proc * net / 300.0
    sky = p.sky[0] if getattr(p, 'sky', None) is not None else None
    Zd_full = np.asarray(Image.fromarray(Zd.astype(np.float32)).resize((W, H), Image.BILINEAR))
    skyd = (np.asarray(Image.fromarray((sky > 0.5).astype(np.uint8) * 255).resize((W, H), Image.NEAREST)) > 127) if sky is not None else np.zeros((H, W), bool)
    both = vm & ~skyd
    r = Zd_full[both] / Zm[both]; lr = np.log(r[np.isfinite(r) & (r > 0)])
    mo_sky = ~vm
    R[name] = {'hfovMoGe': round(hfov, 1), 'scaleRatioMedian': round(float(np.exp(np.median(lr))), 3),
               'logRatioIQR': round(float(np.percentile(lr, 75) - np.percentile(lr, 25)), 3),
               'Zmedian_MoGe': round(float(np.median(Zm[both])), 2), 'Zmedian_DA3M': round(float(np.median(Zd_full[both])), 2),
               'sky_MoGe': round(float(mo_sky.mean()), 4), 'sky_DA3': round(float(skyd.mean()), 4),
               'sky_agree_IoU': round(float((mo_sky & skyd).sum() / max(1, (mo_sky | skyd).sum())), 3) if (mo_sky | skyd).any() else None,
               'sky_MoGeOnly': round(float((mo_sky & ~skyd).mean()), 4), 'sky_DA3Only': round(float((skyd & ~mo_sky).mean()), 4), 'secs': round(time.time() - t0, 1)}
    np.save(os.path.join(out, name + '_da3sky.npy'), skyd); np.save(os.path.join(out, name + '_mogevalid.npy'), vm)
    np.save(os.path.join(out, name + '_Zda3m.npy'), Zd_full.astype(np.float32)); np.save(os.path.join(out, name + '_Zmoge.npy'), Zm.astype(np.float32))
    print(name, json.dumps(R[name]), flush=True); json.dump(R, open(jp, 'w'), indent=1)
