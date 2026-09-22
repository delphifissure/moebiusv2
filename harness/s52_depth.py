"""Sprint 28 / S52 — THE DEPTH HALF OF THE RETURN, from Amodal Depth Anything.

*** RETIRED AS AN APPROACH (R8, 2026-09-22). KEPT AS THE RECORD, AND FOR ITS EXPORT HALF. ***
The model is wrong for the task and this script's own guard says so on every run (the three-way print at the bottom).
R8 settled it three ways from the corpus read first-hand: Amodal-DAV2 answers "how deep is the OCCLUDEE's hidden
part", we are asking "what is behind the occluder"; the amodal survey (2207.02062 S2.2) puts our task outside amodal
completion altogether, since we compute the mask from geometry and want the background; and DeepDR (2023) quantifies
inpaint-then-redepth at roughly twice the depth RMSE of a joint solve on every dataset it reports. DO NOT REOPEN THIS
MODEL FOR BAND DEPTH. A further reason this particular run was unsound: Amodal-DAV2's own Table 2 shows scale-and-
shift alignment HURTS it (3.682 -> 3.878), and the rescaling at line ~69 below is exactly that alignment.
What survives is the export half, and that now lives in the shared, corrected harness/return_grad.py.

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
# THE GUIDE MASK IS THE OCCLUDER, NOT THE BAND. Amodal-DAV2's semantics are COUNTERFACTUAL: the mask names the object to
# be removed and the prediction is what lies BEHIND it (which is why research/s35/bleed/amodal_probe.py's arms are occ /
# collar / frame). The first run of this script passed the band and the model returned the OCCLUDER's own depth --
# median 0.292 in the band against an observed occluder median of 0.289 and a background plate of 0.069. The check that
# caught it is the three-way percentile print below, which exists because a depth return cannot be eyeballed.
occ = rd('plane_object_ids.png') > 0
print('guide mask = the occluder footprint, %d px (%.2f%%); the prediction is read in the band' % (occ.sum(), 100 * occ.mean()))
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
m_ts = rs(torch.tensor(occ.astype(np.float32)).unsqueeze(0).unsqueeze(0)); m_ts = (m_ts > 0).float()
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
# THE GUARD: if the prediction tracks the OCCLUDER rather than the background, the guide mask is wrong and the return is
# worthless. Compared against both references, so the failure names itself instead of producing a plausible file.
mo = float(np.median(np.abs(d_pred[band] - d_obs[band]))); mp = float(np.median(np.abs(d_pred[band] - plate16[band])))
print('median |model - observed occluder| %.4f   |model - plane background| %.4f' % (mo, mp))
if mo < mp * 0.6:
    print('  !! THE PREDICTION TRACKS THE OCCLUDER, NOT THE BACKGROUND -- the guide mask is wrong; do not use this return')

# ---- the return files, in the contract's encoding (meta.plane.returnContract) ----
u16 = lambda a: np.clip(np.round(a * 65535.0), 0, 65535).astype(np.uint16)
Image.fromarray(u16(d_pred), mode='I;16').save(os.path.join(OUT, 'return_band_depth16.png'))
# gradients: gx[i] ~ d[i+1]-d[i], gy[i] ~ d[i+pw]-d[i], carried as (g + 0.5) because a gradient is signed.
# The field handed to the exporter is a COMPOSITE -- observed plate depth outside the band, model prediction inside --
# so the edges that straddle the rim are the cross-source differences InpaintFusion S3.7 says not to take. The source
# map says which side each texel came from and harness/return_grad.py takes the mean bi-directional sample there.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from return_grad import bidirectional_gradients, encode_u16
src = band.astype(np.uint8)          # 0 the observed plate, 1 the predicted band
gx, gy, grep = bidirectional_gradients(d_pred, src)
print('gradients: %d/%d rim-crossing edges took the bi-directional mean (%d both sides, %d one, %d flat)'
      % (grep['crossX'] + grep['crossY'], 2 * pw * ph, grep['meanBoth'], grep['oneSideOnly'], grep['noEstimate']))
Image.fromarray(encode_u16(gx), mode='I;16').save(os.path.join(OUT, 'return_band_gradx16.png'))
Image.fromarray(encode_u16(gy), mode='I;16').save(os.path.join(OUT, 'return_band_grady16.png'))
np.save(os.path.join(OUT, 'amodal_d.npy'), d_pred.astype(np.float32))
json.dump({'bundle': BUNDLE, 'bandPx': int(band.sum()),
           'modelD': [round(float(v), 4) for v in np.percentile(d_pred[band], [10, 50, 90])],
           'plateD': [round(float(v), 4) for v in np.percentile(plate16[band], [10, 50, 90])],
           'vsPlateMedianAbsD': round(float(np.median(dd)), 4),
           'gradRange': [round(float(gx.min()), 4), round(float(gx.max()), 4)]},
          open(os.path.join(OUT, 'depth.json'), 'w'), indent=1)
print('-> ' + OUT + '  (return_band_depth16.png, return_band_gradx16.png, return_band_grady16.png)')
