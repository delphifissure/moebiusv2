#!/usr/bin/env python3
"""S28: visible object masks from SAM 2.1 (facebook/sam2.1-hiera-small, Apache-2.0), prompted with the boxes the app's
depth-only object export produces — the SAMEO front end (any detector's boxes → a mask decoder), with SAM 2.1's own decoder,
which returns the VISIBLE mask (modal), not the amodal one.

Inputs (from harness/objl_view.js or an SD Bundle): the source picture at the plate grid, objects.json {pw, ph, depth,
objects:[{id, bbox [x0,y0,x1,y1), footprintPx, bandPx, frontDepthMean, …}]}, optionally objIds.u8 (the depth-only map, for the
comparison figure). Prompts: the top N objects by band demand (default 12); each box is passed once; SAM 2.1 returns three
masks per prompt and its own IoU estimate — the highest-scoring mask is kept. Overlaps between objects are resolved by the
app's front depth (nearer object wins; frontDepthMean is normalised disparity, larger = nearer). Optionally (--auto) SAM 2.1's
automatic mask generator adds objects our boxes did not name, ranked by area, appended after the prompted ones.

Outputs to <out>: plane_object_ids_sam.png (id map, 0 = none, ids as in objects_sam.json), objects_sam.json, overlay.png
(source dimmed, coloured masks, the prompt boxes), and a comparison against the depth-only map when present.
  python3 harness/segment/sam2_objects.py <dir with source_plate.png + objects.json> [--n 12] [--auto] [--model small|large]
"""
import sys, os, json, time, argparse
import numpy as np
from PIL import Image, ImageDraw
ap = argparse.ArgumentParser(); ap.add_argument('dir'); ap.add_argument('--n', type=int, default=12); ap.add_argument('--auto', action='store_true'); ap.add_argument('--model', default='small'); ap.add_argument('--min-band', type=int, default=200)
ap.add_argument('--points', default='', help='click prompts "x,y;x,y" in plate pixels (the user\'s click on an object): SAM returns three nested candidates, the largest one under --max-frac is kept as the whole object; numbered first')
ap.add_argument('--pps', type=int, default=32, help='automatic generator: points per side'); ap.add_argument('--max-frac', type=float, default=0.6, help='a prompt box or a mask covering more than this fraction of the picture is background, not an object')
a = ap.parse_args(); D = a.dir
import torch; torch.set_num_threads(4)
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor
from huggingface_hub import hf_hub_download
cfgs = {'small': ('facebook/sam2.1-hiera-small', 'sam2.1_hiera_small.pt', 'configs/sam2.1/sam2.1_hiera_s.yaml'), 'large': ('facebook/sam2.1-hiera-large', 'sam2.1_hiera_large.pt', 'configs/sam2.1/sam2.1_hiera_l.yaml')}
repo, fn, cfg = cfgs[a.model]; ckpt = hf_hub_download(repo, fn)
model = build_sam2(cfg, ckpt, device='cpu'); pred = SAM2ImagePredictor(model)
img = np.array(Image.open(f'{D}/source_plate.png').convert('RGB')); ph, pw = img.shape[:2]
info = json.load(open(f'{D}/objects.json'))
def frac(b): return (b[2] - b[0]) * (b[3] - b[1]) / float(pw * ph)
objs = [o for o in info['objects'] if o['bandPx'] >= a.min_band and frac(o['bbox']) <= a.max_frac][:a.n]   # a whole-picture box is the depth-only rule's failure on a photograph, not an object
t0 = time.time(); pred.set_image(img); t_enc = time.time() - t0
print(f'SAM 2.1 {a.model}: image {pw}x{ph} encoded in {t_enc:.1f}s; {len(objs)} box prompts (band demand >= {a.min_band})')
masks = []
pts = [[tuple(float(v) for v in q.split(',')) for q in pt.split('+') if q.strip()] for pt in a.points.split(';') if pt.strip()]   # "x,y+x,y" = several clicks on ONE object
for k, group in enumerate(pts, start=1):
    px, py = group[0]
    m, sc, _ = pred.predict(point_coords=np.array(group, dtype=np.float32), point_labels=np.ones(len(group), dtype=np.int32), multimask_output=len(group) == 1)
    cands = sorted([(int(mm.sum()), float(sc[i]), i) for i, mm in enumerate(m)], reverse=True)
    # the whole object: the largest candidate under max-frac that SAM itself rates at least 0.5; else the best-rated one
    pick = next(((n, sco, i) for n, sco, i in cands if n <= a.max_frac * pw * ph and sco >= 0.5), max(cands, key=lambda c: c[1]))
    mk = m[pick[2]].astype(bool); masks.append({'id': k, 'mask': mk, 'score': pick[1], 'front': None, 'bandPx': 0, 'box': [int(v) for v in [np.nonzero(mk)[1].min(), np.nonzero(mk)[0].min(), np.nonzero(mk)[1].max() + 1, np.nonzero(mk)[0].max() + 1]], 'source': 'click ' + '+'.join(f'({x:.0f},{y:.0f})' for x, y in group)})
    print(f'  click {k} at {group}: candidates ' + ', '.join(f'{n} px / iou {sco:.2f}' for n, sco, i in cands) + f' -> kept {pick[0]} px')
for o in objs:
    o = dict(o); o['id'] = o['id'] + len(pts)   # ids after the clicks
    x0, y0, x1, y1 = o['bbox']; box = np.array([x0, y0, x1 - 1, y1 - 1], dtype=np.float32)
    t1 = time.time(); m, sc, _ = pred.predict(box=box[None], multimask_output=True)
    k = int(np.argmax(sc)); mk = m[k].astype(bool)
    masks.append({'id': o['id'], 'mask': mk, 'score': float(sc[k]), 'front': o['frontDepthMean'], 'bandPx': o['bandPx'], 'box': o['bbox'], 'source': 'box prompt'})
    print(f"  obj {o['id']}: box {o['bbox']} band {o['bandPx']} -> mask {int(mk.sum())} px, iou est {sc[k]:.2f} ({time.time()-t1:.1f}s)")
if a.auto:
    from sam2.automatic_mask_generator import SAM2AutomaticMaskGenerator
    gen = SAM2AutomaticMaskGenerator(model, points_per_side=a.pps, pred_iou_thresh=0.8, stability_score_thresh=0.9, min_mask_region_area=int(0.001 * pw * ph))
    t1 = time.time(); auto = gen.generate(img); print(f'  automatic ({a.pps} points per side): {len(auto)} masks in {time.time()-t1:.0f}s')
    taken = np.zeros((ph, pw), bool)
    for mm in masks: taken |= mm['mask']
    nid = max([m['id'] for m in masks], default=0); nBg = nPart = 0
    for am in sorted(auto, key=lambda r: -r['area']):
        mk = am['segmentation']
        if mk.sum() > a.max_frac * pw * ph: nBg += 1; continue     # background (floor, wall, sky), not an object
        if (mk & taken).sum() > 0.5 * mk.sum(): nPart += 1; continue   # a part of an object already kept (SAM's masks are hierarchical): the whole object wins
        if nid >= 254: break
        nid += 1; masks.append({'id': nid, 'mask': mk & ~taken, 'score': float(am['predicted_iou']), 'front': None, 'bandPx': 0, 'box': [int(v) for v in am['bbox']], 'source': 'automatic'}); taken |= mk
    print(f'  kept {sum(1 for m in masks if m["source"] == "automatic")} automatic objects; dropped {nBg} background-sized, {nPart} parts of kept objects')
# overlaps: nearer object wins (front = normalised disparity, larger = nearer); automatic masks (no depth) lose to prompted ones
ids = np.zeros((ph, pw), np.uint8); front = np.full((ph, pw), -1.0)
for mm in masks:
    f = mm['front'] if mm['front'] is not None else -0.5
    w = mm['mask'] & (f > front); ids[w] = mm['id']; front[w] = f
out_objs = []
for mm in masks:
    m = ids == mm['id']
    if not m.any(): continue
    ys, xs = np.nonzero(m); out_objs.append({'id': mm['id'], 'maskPx': int(m.sum()), 'bbox': [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1], 'promptBox': mm['box'], 'iouEstimate': mm['score'], 'frontDepthMean': mm['front'], 'bandPx': mm['bandPx'], 'source': mm['source']})
Image.fromarray(ids, 'L').save(f'{D}/plane_object_ids_sam.png')
json.dump({'model': repo, 'pw': pw, 'ph': ph, 'prompts': (('clicks ' + a.points + '; ') if pts else '') + 'boxes of the depth-only objects, largest band demand first' + ('; automatic' if a.auto else ''), 'objects': out_objs}, open(f'{D}/objects_sam.json', 'w'), indent=1)
# overlay: dimmed source, one colour per object, prompt boxes; and the depth-only map beside it when present
rng = np.random.RandomState(3); pal = rng.randint(60, 255, (256, 3)); pal[0] = 0
def overlay(idmap, title, boxes=None):
    base = (img * 0.4).astype(np.float64); col = pal[idmap]; m = idmap > 0
    base[m] = base[m] * 0.35 + col[m] * 0.65
    im = Image.fromarray(base.astype(np.uint8)); dr = ImageDraw.Draw(im)
    if boxes:
        for b in boxes: dr.rectangle([b[0], b[1], b[2] - 1, b[3] - 1], outline=(255, 255, 255), width=1)
    dr.text((6, 6), title, fill=(255, 255, 0)); return im
tiles = [overlay(ids, f'SAM 2.1 {a.model}: {len(out_objs)} objects from {len(objs)} box prompts' + (' + automatic' if a.auto else ''), [o['bbox'] for o in objs])]
if os.path.exists(f'{D}/objIds.u8'):
    d0 = np.fromfile(f'{D}/objIds.u8', np.uint8).reshape(ph, pw); tiles.insert(0, overlay(d0, f'depth-only objects (A253 + continuity): {int((d0 > 0).sum())} px'))
    # agreement per prompted object: IoU of the SAM mask with the depth footprint it was prompted from
    for o, mm in zip(objs, masks[len(pts):len(pts) + len(objs)]):
        fp = d0 == o['id']; inter = (fp & mm['mask']).sum(); uni = (fp | mm['mask']).sum()
        print(f"  obj {o['id']}: depth footprint {int(fp.sum())} px, SAM mask {int(mm['mask'].sum())} px, IoU {inter / max(1, uni):.2f}, SAM adds {int((mm['mask'] & ~fp).sum())} px, drops {int((fp & ~mm['mask']).sum())} px")
W = sum(t.size[0] for t in tiles) + 6 * (len(tiles) + 1); sh = Image.new('RGB', (W, tiles[0].size[1] + 12), (20, 20, 20)); x = 6
for t in tiles: sh.paste(t, (x, 6)); x += t.size[0] + 6
sh.save(f'{D}/overlay_sam.png'); print('wrote', f'{D}/plane_object_ids_sam.png', f'{D}/objects_sam.json', f'{D}/overlay_sam.png')
