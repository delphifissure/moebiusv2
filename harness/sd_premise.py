"""Task #66: the premise test. Does a noisy atlas survive diffusion?

For one picture, each S59 arm's atlas goes through the same SD 1.5 inpaint with a depth ControlNet:
  image    the source with the hole replaced by the S59 wash (identical for every arm)
  mask     the hole (the dump band; identical for every arm)
  control  the plate depth as RENDERED for that arm (plate_<arm>.f32), normalised disparity, near = bright (the
           MiDaS/ControlNet-depth convention, which is the app's)
  seed, prompt, steps, strength: fixed and identical.
The only thing that differs between the three outputs is the depth the hole carries. Output: out_<arm>.png at the
working size, plus a streak measure inside the hole (advisory, A126): the mean |row-to-row difference| minus the mean
|column-to-column difference| of the output's luminance, ratioed to the same on the wash -- a combed depth condition
that SD reproduces as row structure raises it.

CPU only (no GPU in this container): 512-class resolution, 20 steps. SEALED until the user's S59 verdicts: these
frames reveal which depth is which.

  python3 sd_premise.py <picture> [steps=20]
"""
import sys, os, json, time
import numpy as np, torch
from PIL import Image
from diffusers import StableDiffusionControlNetInpaintPipeline, ControlNetModel, UniPCMultistepScheduler

P = sys.argv[1]; STEPS = int(sys.argv[2]) if len(sys.argv) > 2 else 20
H = os.path.dirname(os.path.abspath(__file__)); D = os.path.join(H, 'shots', 'streakclass', 'ab_' + P); R = os.path.join(H, 'shots', 'sheet_ab', P)
OUT = os.path.join(H, 'shots', 'sheet_ab', 'sd_' + P); os.makedirs(OUT, exist_ok=True)
torch.set_num_threads(4)
sz = json.load(open(os.path.join(D, 'size.json'))); pw, ph = sz['pw'], sz['ph']
band = (np.fromfile(os.path.join(D, 'disocc.u8'), np.uint8).reshape(ph, pw) > 0)
wash = Image.open(os.path.join(D, 'ab_fields', 'wash.png')).convert('RGB')
# working size: long side 640, multiples of 8 (CPU budget)
s = 640 / max(pw, ph); W, Hh = int(round(pw * s / 8) * 8), int(round(ph * s / 8) * 8)
img = wash.resize((W, Hh), Image.LANCZOS)
mask = Image.fromarray((band * 255).astype(np.uint8)).resize((W, Hh), Image.NEAREST)
cn = ControlNetModel.from_pretrained('lllyasviel/control_v11f1p_sd15_depth', variant='fp16', torch_dtype=torch.float32)
pipe = StableDiffusionControlNetInpaintPipeline.from_pretrained('stable-diffusion-v1-5/stable-diffusion-inpainting', controlnet=cn, variant='fp16',
                                                                torch_dtype=torch.float32, safety_checker=None, requires_safety_checker=False)
pipe.scheduler = UniPCMultistepScheduler.from_config(pipe.scheduler.config); pipe.set_progress_bar_config(disable=True)
m = np.asarray(mask) > 127
def streak(rgb):
    y = np.asarray(rgb, np.float64).mean(-1); dv = np.abs(np.diff(y, axis=0)); dh = np.abs(np.diff(y, axis=1))
    mv = m[1:, :] & m[:-1, :]; mh = m[:, 1:] & m[:, :-1]
    return float(dv[mv].mean() - dh[mh].mean())
res = {'picture': P, 'size': [W, Hh], 'steps': STEPS, 'washStreak': streak(img), 'arms': {}}
for arm in 'ABC':
    z = np.fromfile(os.path.join(R, 'plate_%s.f32' % arm), np.float32).reshape(ph, pw)
    ctl = Image.fromarray(np.round(np.clip(z, 0, 1) * 255).astype(np.uint8)).convert('RGB').resize((W, Hh), Image.BILINEAR)
    ctl.save(os.path.join(OUT, 'control_%s.png' % arm))
    t = time.time()
    g = torch.Generator().manual_seed(1234)
    o = pipe(prompt='the background behind, continuous surfaces, natural texture', negative_prompt='person, figure, object, text',
             image=img, mask_image=mask, control_image=ctl, num_inference_steps=STEPS, generator=g, strength=1.0,
             controlnet_conditioning_scale=1.0, width=W, height=Hh).images[0]
    o.save(os.path.join(OUT, 'out_%s.png' % arm))
    res['arms'][arm] = {'secs': round(time.time() - t), 'streak': streak(o)}
    print(arm, res['arms'][arm], flush=True)
json.dump(res, open(os.path.join(OUT, 'sd.json'), 'w'), indent=1)
