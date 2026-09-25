#!/usr/bin/env python3
"""Automatic labels for the SD prompt, tested with a known answer (the round-trip holes of grt_eval.py).

The hole is BACKGROUND revealed behind an object, so the label that helps is the background's, and the object's own label
belongs in the negative prompt (plain SD paints the occluder back: the starwatcher's extra legs). General rule, nothing
chosen per picture:
  background prompt  Florence-2 '<MORE_DETAILED_CAPTION>' of the picture with every occluder and hole replaced by the
                     far-side push-pull wash (grt_eval.far_seed: known pixels no nearer than the nearest hole by the join
                     ratio) -- the caption of the background plate, lead-in phrases stripped, first two sentences
  negative           the generic negatives + the occluder's subject phrase: Florence-2 '<CAPTION>' of the occluders alone
                     (their bounding box, everything else grey), cut at the first preposition or participle
Arms (SD 1.5 inpainting + depth ControlNet, the pipeline of sd_return.py / outpaint_eval.py, 20 steps, seed 1234; the
control depth is the far-side push-pull fill of the depth inside the hole -- the rule's depth, not the truth's -- the
same for both arms, so only the prompt differs):
  sd_gen   prompt 'the background behind, continuous surfaces, natural texture' (today's)
  sd_lab   the automatic background prompt and negative
  python3 label_prompt_eval.py --phase captions --pics NAME=color:depth16 ... --out DIR
  python3 label_prompt_eval.py --phase sd --pics ... --out DIR [--deg 20,45]
"""
import argparse, json, os, re, sys, time
import numpy as np
from PIL import Image
ap = argparse.ArgumentParser()
ap.add_argument('--phase', required=True, choices=['captions', 'masks', 'sd']); ap.add_argument('--pics', nargs='+', required=True)
ap.add_argument('--out', required=True); ap.add_argument('--deg', default='20,45'); ap.add_argument('--steps', type=int, default=20)
ap.add_argument('--seed', type=int, default=1234)
A = ap.parse_args(); os.makedirs(A.out, exist_ok=True)
sys.argv = [sys.argv[0]]
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'truthkit'))
import grt_eval as G
from reveal import shift_px
GEN_PROMPT = 'the background behind, continuous surfaces, natural texture'
GEN_NEG = 'text, frame, border, watermark'
CAPF = os.path.join(A.out, 'captions.json')


def holes_for(img, dn):
    H, W = dn.shape
    Wl = G.A.W if W / H > G.A.W / (G.A.W * 9 / 16) else (G.A.W * 9 / 16) * W / H
    sig = shift_px(dn, G.A.D, G.A.D, G.A.pn, G.A.outer, G.A.inner, W / Wl)
    out = {}
    for deg in [float(x) for x in A.deg.split(',')]:
        f = np.tan(np.radians(deg)); out['%g' % deg] = G.occluded(dn, sig, f) | G.occluded(dn, sig, -f)
    return out


def clean_bg(t):
    t = re.sub(r'^\s*(the|this) (image|picture|painting|photo(graph)?|illustration)\s+(is|shows|depicts)\s+(an?\s+)?((digital\s+)?(illustration|painting|photograph|picture|image|drawing)\s+of\s+)?', '', t, flags=re.I)
    s = [x.strip() for x in re.split(r'(?<=[.!?])\s+', t) if x.strip()]
    s = [x for x in s if not re.search(r'\b(center|centre|middle|left|right|corner|top|bottom) of the (image|picture|frame)\b', x, re.I)] or s
    out = ' '.join(s[:2]); return ' '.join(out.split()[:60])


def subject(t):
    t = re.sub(r'^\s*(an?|the)\s+', '', t.strip(), flags=re.I)
    return re.split(r'\b(on|in|at|with|over|under|near|by|of|from|and|standing|sitting|flying|holding|walking|looking|is|are)\b', t, flags=re.I)[0].strip(' .,')


if A.phase == 'captions':
    import torch
    from transformers import AutoProcessor, Florence2ForConditionalGeneration
    torch.set_num_threads(2)
    RID = 'florence-community/Florence-2-base'   # MIT; the transformers-native conversion of microsoft/Florence-2-base
    proc = AutoProcessor.from_pretrained(RID); model = Florence2ForConditionalGeneration.from_pretrained(RID, torch_dtype=torch.float32).eval()
    def cap(im, task):
        inp = proc(text=task, images=im, return_tensors='pt')
        with torch.no_grad(): ids = model.generate(**inp, max_new_tokens=80, num_beams=3)
        return proc.post_process_generation(proc.batch_decode(ids, skip_special_tokens=False)[0], task=task, image_size=im.size)[task]
    caps = json.load(open(CAPF)) if os.path.exists(CAPF) else {}
    for spec in A.pics:
        name, rest = spec.split('='); pc, pd = rest.split(':')
        img, dn = G.load(pc, pd); hs = holes_for(img, dn)
        hole = np.zeros(dn.shape, bool)
        for h in hs.values(): hole |= h
        if hole.sum() < 50: caps[name] = None; print(name, 'no hole'); continue
        seed = G.far_seed(dn, hole); occ = ~hole & ~seed
        plate = G.pushpull(img, seed)
        Image.fromarray((np.clip(plate, 0, 1) * 255).astype(np.uint8)).save(os.path.join(A.out, name + '_bgplate.png'))
        t0 = time.time(); bg_raw = cap(Image.fromarray((np.clip(plate, 0, 1) * 255).astype(np.uint8)), '<MORE_DETAILED_CAPTION>')
        occ_raw = ''
        if occ.sum() > 50:
            ys, xs = np.nonzero(occ); crop = np.full_like(img, 0.5); crop[occ] = img[occ]
            crop = crop[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
            Image.fromarray((crop * 255).astype(np.uint8)).save(os.path.join(A.out, name + '_occluders.png'))
            occ_raw = cap(Image.fromarray((crop * 255).astype(np.uint8)), '<CAPTION>')
        caps[name] = {'bg_raw': bg_raw, 'occ_raw': occ_raw, 'prompt': clean_bg(bg_raw), 'negative_subject': subject(occ_raw) if occ_raw else '',
                      'occluderPct': float(100 * occ.mean()), 'secs': round(time.time() - t0, 1)}
        print(name, json.dumps(caps[name]), flush=True)
        json.dump(caps, open(CAPF, 'w'), indent=1)

elif A.phase == 'masks':
    # the rule that replaced 'captions' (whose background caption still named the foreground and whose occluder crops
    # captioned as nonsense): Florence-2 captions the picture in detail, grounds each phrase, segments it
    # ('<REFERRING_EXPRESSION_SEGMENTATION>'), and a phrase whose mask lies mostly (> 1/2, a majority, no tuning) on the
    # near side of the holes (the occluders: not far_seed, not hole) goes to the negative prompt; the rest form the prompt.
    import torch
    from PIL import ImageDraw
    from transformers import AutoProcessor, Florence2ForConditionalGeneration
    torch.set_num_threads(2)
    RID = 'florence-community/Florence-2-base'
    proc = AutoProcessor.from_pretrained(RID); model = Florence2ForConditionalGeneration.from_pretrained(RID, torch_dtype=torch.float32).eval()
    def run(im, task, text=''):
        inp = proc(text=task + text, images=im, return_tensors='pt')
        with torch.no_grad(): ids = model.generate(**inp, max_new_tokens=512, num_beams=3)
        return proc.post_process_generation(proc.batch_decode(ids, skip_special_tokens=False)[0], task=task, image_size=im.size)[task]
    caps = json.load(open(CAPF)) if os.path.exists(CAPF) else {}
    for spec in A.pics:
        name, rest = spec.split('='); pc, pd = rest.split(':')
        img, dn = G.load(pc, pd); hs = holes_for(img, dn)
        hole = np.zeros(dn.shape, bool)
        for h in hs.values(): hole |= h
        if hole.sum() < 50: caps[name] = None; print(name, 'no hole', flush=True); continue
        occ = ~hole & ~G.far_seed(dn, hole)
        im = Image.fromarray((img * 255).astype(np.uint8)); t0 = time.time()
        capt = run(im, '<MORE_DETAILED_CAPTION>'); g = run(im, '<CAPTION_TO_PHRASE_GROUNDING>', capt)
        phrases = list(dict.fromkeys(l.strip() for l in g['labels'] if l.strip()))
        pos, neg, per = [], [], {}
        for ph in phrases:
            r = run(im, '<REFERRING_EXPRESSION_SEGMENTATION>', ph)
            mk = Image.new('L', im.size, 0); dr = ImageDraw.Draw(mk)
            for polys in r['polygons']:
                for pl in polys:
                    if len(pl) >= 6: dr.polygon(pl, fill=255)
            mk = np.asarray(mk) > 0
            if mk.sum() < 20: per[ph] = None; continue
            near = float(occ[mk].mean()); per[ph] = {'maskPct': float(100 * mk.mean()), 'near': near}
            (neg if near > 0.5 else pos).append(re.sub(r'^(the|a|an)\s+', '', ph, flags=re.I))
        caps[name] = {'caption': capt, 'phrases': per, 'prompt': ', '.join(pos) if pos else GEN_PROMPT,
                      'negative_subject': ', '.join(neg), 'occluderPct': float(100 * occ.mean()), 'secs': round(time.time() - t0, 1)}
        print(name, 'prompt:', caps[name]['prompt'], '| negative:', caps[name]['negative_subject'], '| %.0fs' % caps[name]['secs'], flush=True)
        json.dump(caps, open(CAPF, 'w'), indent=1)

else:
    import torch
    from diffusers import StableDiffusionControlNetInpaintPipeline, ControlNetModel, UniPCMultistepScheduler
    torch.set_num_threads(4)
    cn = ControlNetModel.from_pretrained('lllyasviel/control_v11f1p_sd15_depth', variant='fp16', torch_dtype=torch.float32)
    pipe = StableDiffusionControlNetInpaintPipeline.from_pretrained('stable-diffusion-v1-5/stable-diffusion-inpainting', controlnet=cn, variant='fp16',
                                                                    torch_dtype=torch.float32, safety_checker=None, requires_safety_checker=False)
    pipe.scheduler = UniPCMultistepScheduler.from_config(pipe.scheduler.config); pipe.set_progress_bar_config(disable=True)
    def sd(img, dctl, hole, prompt, neg):
        H, W = hole.shape; Ws, Hs = int(round(W / 8) * 8), int(round(H / 8) * 8)
        ctl = Image.fromarray(np.round(np.clip(dctl, 0, 1) * 255).astype(np.uint8)).convert('RGB').resize((Ws, Hs), Image.BILINEAR)
        r = pipe(prompt=prompt, negative_prompt=neg, image=Image.fromarray((img * 255).astype(np.uint8)).resize((Ws, Hs), Image.LANCZOS),
                 mask_image=Image.fromarray((hole * 255).astype(np.uint8)).resize((Ws, Hs), Image.NEAREST), control_image=ctl,
                 num_inference_steps=A.steps, generator=torch.Generator().manual_seed(A.seed), strength=1.0, width=Ws, height=Hs).images[0]
        return np.asarray(r.resize((W, H), Image.LANCZOS), np.float32) / 255
    caps = json.load(open(CAPF)); resf = os.path.join(A.out, 'label_prompt.json')
    res = json.load(open(resf)) if os.path.exists(resf) else {}
    for spec in A.pics:
        name, rest = spec.split('='); pc, pd = rest.split(':')
        if not caps.get(name): continue
        img, dn = G.load(pc, pd); c = caps[name]
        lab_neg = GEN_NEG + (', ' + c['negative_subject'] if c['negative_subject'] else '')
        for key, hole in holes_for(img, dn).items():
            if hole.sum() < 50: continue
            dctl = dn.copy(); dpp = G.pushpull(np.repeat(dn[..., None], 3, -1), G.far_seed(dn, hole))[..., 0]; dctl[hole] = dpp[hole]
            seen = img.copy(); seen[hole] = 0
            r = res.setdefault(name, {}).setdefault(key, {'holePct': float(100 * hole.mean())})
            for arm, (pr, ng) in {'sd_gen': (GEN_PROMPT, GEN_NEG), 'sd_lab': (c['prompt'], lab_neg)}.items():
                t0 = time.time(); fill = sd(seen, dctl, hole, pr, ng)
                comp = img.copy(); comp[hole] = fill[hole]
                Image.fromarray((np.clip(comp, 0, 1) * 255).astype(np.uint8)).save(os.path.join(A.out, '%s_%s_%s.png' % (name, key, arm)))
                r[arm] = G.scores(fill, img, hole); r[arm]['secs'] = round(time.time() - t0, 1)
                print(name, key, arm, {k: round(v, 4) for k, v in r[arm].items()}, flush=True)
                json.dump(res, open(resf, 'w'), indent=1)
