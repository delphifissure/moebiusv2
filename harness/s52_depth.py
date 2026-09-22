"""Sprint 28 / S52 — THE DEPTH HALF OF THE RETURN, from Amodal Depth Anything.

Sprint 25 built a return contract that asks for depth as well as colour and reconciles it by a screened Poisson solve
with the observed plate depth as the Dirichlet boundary. S48's round trip verified the plumbing against a deliberately
corrupted return and found the PURE GRADIENT form best on a photograph (0.0118 against a raw 0.0304, 2.57x), with the
per-component shift on an absolute return actively harmful. This runs the contract on a real model's output for the
first time.

Model: Amodal-DAV2 (Zhyever/Amodal-Depth-Anything-DAV2), cached locally, CPU. Interface as `infer.py` uses it and as
`research/s35/bleed/amodal_probe.py` already drives it: rgb at 518x518, a binary GUIDE MASK (the amodal extent of the
target), and an OBSERVATION depth; the prediction is kept inside the mask. The prediction is relative, so it is brought
back to the app's normalised d by the observation's own min/max — the scale-and-shift alignment the literature assumes.

WHAT CANNOT BE SCORED HERE, STATED UP FRONT. S48 could score its return because the target was the bake's own field
with known corruption. Here there is no ground truth for the hidden surface: the model predicts scene geometry that may
be better OR worse than the plane extrapolation, and nothing in the picture says which. So this emits the return and the
render decides — "whatever it looks like is the finding". The one thing that IS checkable is the contract's own
promise: the seam must stay exact, which the reimport measures.

R7's caveat on this model, which stands: its ground truth is itself a DAV2 prediction, so it is capped by DAV2.

  python3 harness/s52_depth.py <bundle.zip> <outdir>
"""
import sys, os, io, json, zipfile, time
import numpy as np
from PIL import Image

ADA = '/tmp/claude-0/-home-user-moebius/989b3965-28fd-58c7-96b5-b4b22c709919/scratchpad/ada'
BUNDLE = sys.argv[1] if len(sys.argv) > 1 else 'harness/shots/s45_rt/troll/bundle.zip'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'harness/shots/s52_inpaint/troll'
os.makedirs(OUT, exist_ok=True)

z = zipfile.ZipFile(BUNDLE)
meta = json.loads(z.read('meta.json'))
pw, ph = meta['plane']['nativeRes']
rd = lambda n, m='L': np.array(Image.open(io.BytesIO(z.read(n))).convert(m))

rgb = rd('plane_source_color.png', 'RGB')
dq16 = np.array(Image.open(io.BytesIO(z.read('plane_source_depth16.png'))))
band = rd('plane_mask_inpaint.png') > 127
d_obs = dq16.astype(np.float64) / 65535.0
dmin, dmax = float(d_obs.min()), float(d_obs.max()); rng = max(dmax - dmin, 1e-9)
obs_n = (d_obs - dmin) / rng
print('plate %dx%d  band %d px (%.2f%%)  observation d %.3f..%.3f' % (pw, ph, band.sum(), 100 * band.mean(), dmin, dmax))

sys.path.insert(0, ADA)
import torch, torch.nn.functional as F
from torchvision.transforms import InterpolationMode, Resize
from src.models.amodalsynthdrive.dav2 import AmodalDAv2
torch.set_grad_enabled(False)
t0 = time.time()
model = AmodalDAv2(encoder='vitl', pretrained=False).from_pretrained('Zhyever/Amodal-Depth-Anything-DAV2', strict=True).eval()
print('model loaded %.1fs' % (time.time() - t0))
rs = Resize(size=(518, 518), interpolation=InterpolationMode.NEAREST)
rgb_ts = rs(torch.tensor(rgb).permute(2, 0, 1).unsqueeze(0).float() / 255)
obs_ts = rs(torch.tensor(obs_n).unsqueeze(0).unsqueeze(0).float())
m_ts = rs(torch.tensor(band.astype(np.float32)).unsqueeze(0).unsqueeze(0)); m_ts = (m_ts > 0).float()
t0 = time.time()
pred = model(rgb_ts, guide_rgb=None, guide_mask=m_ts * 2 - 1, observation=obs_ts * 2 - 1)
print('inference %.1fs' % (time.time() - t0))
p = F.interpolate(pred.squeeze().unsqueeze(0).unsqueeze(0), (ph, pw), mode='bilinear', align_corners=False).squeeze().numpy()
d_pred = np.clip(p, 0, 1) * rng + dmin

plate16 = np.array(Image.open(io.BytesIO(z.read('plane_plate_depth16.png')))).astype(np.float64) / 65535.0
print('in the band: model d p10/50/90 %s   the bake plate there %s   the observed (occluder) %s' % (
    np.percentile(d_pred[band], [10, 50, 90]).round(3),
    np.percentile(plate16[band], [10, 50, 90]).round(3),
    np.percentile(d_obs[band], [10, 50, 90]).round(3)))
# how far the model's answer is from the construction's, in d — not an error, the two disagree and neither is truth
dd = np.abs(d_pred[band] - plate16[band])
print('model vs the plane construction in the band: median |d| %.4f  p90 %.4f' % (np.median(dd), np.percentile(dd, 90)))

# ---- the return files, in the contract's encoding (meta.plane.returnContract) ----
u16 = lambda a: np.clip(np.round(a * 65535.0), 0, 65535).astype(np.uint16)
Image.fromarray(u16(d_pred), mode='I;16').save(os.path.join(OUT, 'return_band_depth16.png'))
# gradients: gx[i] ~ d[i+1]-d[i], gy[i] ~ d[i+pw]-d[i], carried as (g + 0.5) because a gradient is signed
gx = np.zeros_like(d_pred); gy = np.zeros_like(d_pred)
gx[:, :-1] = d_pred[:, 1:] - d_pred[:, :-1]
gy[:-1, :] = d_pred[1:, :] - d_pred[:-1, :]
Image.fromarray(u16(gx + 0.5), mode='I;16').save(os.path.join(OUT, 'return_band_gradx16.png'))
Image.fromarray(u16(gy + 0.5), mode='I;16').save(os.path.join(OUT, 'return_band_grady16.png'))
np.save(os.path.join(OUT, 'amodal_d.npy'), d_pred.astype(np.float32))
json.dump({'bundle': BUNDLE, 'bandPx': int(band.sum()),
           'modelD': [round(float(v), 4) for v in np.percentile(d_pred[band], [10, 50, 90])],
           'plateD': [round(float(v), 4) for v in np.percentile(plate16[band], [10, 50, 90])],
           'vsPlateMedianAbsD': round(float(np.median(dd)), 4),
           'gradRange': [round(float(gx.min()), 4), round(float(gx.max()), 4)]},
          open(os.path.join(OUT, 'depth.json'), 'w'), indent=1)
print('-> ' + OUT + '  (return_band_depth16.png, return_band_gradx16.png, return_band_grady16.png)')
