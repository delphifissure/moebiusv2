#!/usr/bin/env python3
"""Photograph or artwork? (the user, 2026-09-26: use metric depth selectively "for photos vs art -- there's probably a way
we can discriminate"). First signal: Florence-2 (MIT, already used for SD prompts) captions the picture and names the
medium when it is not a photograph ("a painting of ...", "a cartoon of ..."). The picture is ART when the caption names an
art medium; otherwise PHOTO. No threshold. The second signal (the metric-depth models agreeing on the scene's scale) is
measured separately.
  python3 photo_or_art.py out.json name=image.png ...
"""
import json, re, sys
import torch
from PIL import Image
from transformers import AutoProcessor, Florence2ForConditionalGeneration

ART = r'\b(painting|painted|paint|illustration|illustrated|drawing|drawn|sketch|cartoon|comic|anime|manga|artwork|art|poster|watercolou?r|oil on|canvas|mural|engraving|woodcut|print|rendering|render|3d model|digital art)\b'
PHOTO = r'\b(photo|photograph|photography|picture taken|snapshot)\b'
torch.set_num_threads(2)
RID = 'florence-community/Florence-2-base'
proc = AutoProcessor.from_pretrained(RID); model = Florence2ForConditionalGeneration.from_pretrained(RID, torch_dtype=torch.float32).eval()
def cap(im, task):
    inp = proc(text=task, images=im, return_tensors='pt')
    with torch.no_grad(): ids = model.generate(**inp, max_new_tokens=60, num_beams=3)
    return proc.post_process_generation(proc.batch_decode(ids, skip_special_tokens=False)[0], task=task, image_size=im.size)[task]
R = {}
for spec in sys.argv[2:]:
    name, path = spec.split('=', 1); im = Image.open(path).convert('RGB')
    c = cap(im, '<CAPTION>'); d = cap(im, '<DETAILED_CAPTION>')
    art = re.findall(ART, (c + ' ' + d).lower()); ph = re.findall(PHOTO, (c + ' ' + d).lower())
    R[name] = {'caption': c, 'detailed': d, 'artWords': sorted(set(art)), 'photoWords': sorted(set(ph)), 'verdict': 'art' if art else 'photo'}
    print('%-14s %-5s %s | %s' % (name, R[name]['verdict'], c, sorted(set(art))), flush=True)
json.dump(R, open(sys.argv[1], 'w'), indent=1)
