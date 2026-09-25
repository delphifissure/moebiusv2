#!/usr/bin/env python3
"""Field-of-view estimation against a known answer (queue item 1, S67 §6: each shot's eye distance D = (W/2)/tan(hfov/2)
comes from the shot's field of view, which for film and comics is rarely known).

Pictures with exact intrinsics: the truth kit's dolly family (S30, the same scene through the same window from D(f),
f = 18..144 mm full-frame equivalent; hfov = 2 atan(W/2 / D) from each render's meta.json) and the first frame of each of
the nine synthetic video shots (hfov = 2 atan(nx/2 / fpx) from shot.json). Models: MoGe-2 (ViT-S and ViT-B normal
checkpoints; fov_x unknown), which predicts intrinsics. Reported: estimated vs true hfov, and the consequence for the eye
distance, D_est / D_true = tan(hfov_true/2) / tan(hfov_est/2) (the per-shot scale error it would cause).
  python3 fov_bench.py [--models vits,vitb] [--out DIR]
"""
import argparse, glob, json, os, time
import numpy as np, torch
from PIL import Image
ap = argparse.ArgumentParser(); ap.add_argument('--models', default='vits,vitb'); ap.add_argument('--out', required=True)
ap.add_argument('--dolly', default='/home/user/moebiusv2/harness/truthkit/out/dolly/S30'); ap.add_argument('--video', default='/home/user/moebiusv2/harness/truthkit/out/video')
A = ap.parse_args(); os.makedirs(A.out, exist_ok=True); torch.set_num_threads(3)
pics = []
for d in sorted(glob.glob(os.path.join(A.dolly, 'f*'))):
    m = json.load(open(os.path.join(d, 'meta.json'))); pics.append(('dolly_' + os.path.basename(d), os.path.join(d, 'rest_rgb.png'), float(np.degrees(2 * np.arctan(m['W'] / 2 / m['D'])))))
for d in sorted(glob.glob(os.path.join(A.video, '*'))):
    f = os.path.join(d, 'shot.json')
    if not os.path.exists(f): continue
    m = json.load(open(f)); fr = sorted(glob.glob(os.path.join(d, 'frame_000.png')) + glob.glob(os.path.join(d, 'rgb_000.png')) + glob.glob(os.path.join(d, '*000*.png')))
    fr = [x for x in fr if 'depth' not in x and 'label' not in x]
    if fr: pics.append(('video_' + os.path.basename(d), fr[0], float(np.degrees(2 * np.arctan(m['nx'] / 2 / m['fpx'])))))
from moge.model.v2 import MoGeModel
res = {}
for mn in A.models.split(','):
    model = MoGeModel.from_pretrained('Ruicheng/moge-2-%s-normal' % mn).eval()
    for name, path, hf in pics:
        im = np.asarray(Image.open(path).convert('RGB')); x = torch.tensor(im / 255, dtype=torch.float32).permute(2, 0, 1)
        t0 = time.time()
        with torch.no_grad(): out = model.infer(x, fov_x=None, resolution_level=9, use_fp16=False)
        K = out['intrinsics'].cpu().numpy(); he = float(np.degrees(2 * np.arctan(0.5 / K[0, 0])))
        dr = float(np.tan(np.radians(hf) / 2) / np.tan(np.radians(he) / 2))
        res.setdefault(name, {'true': hf, 'img': path})[mn] = {'hfov': he, 'err_deg': he - hf, 'D_ratio': dr, 'secs': round(time.time() - t0, 1)}
        print('%-22s true %5.1f  %s %5.1f  (%+5.1f deg)  eye distance x%.2f' % (name, hf, mn, he, he - hf, dr), flush=True)
    del model
json.dump(res, open(os.path.join(A.out, 'fov_bench.json'), 'w'), indent=1)
