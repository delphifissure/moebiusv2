#!/usr/bin/env python3
"""The magic button's segmentation, with a known answer (S71 §1): which no-click pipeline finds every object, whole,
with clean edges and its thin parts?

Cases (exact masks, nothing drawn by hand):
  kit      truth-kit scenes whose first hit is an object prim (label 2): rest_rgb.png, the exact per-pixel prim id
           (rest_layers.npz, layer 0). Flat-shaded, but with the thin and porous objects (P1-P6 discs, poles).
  pasted   exact-alpha objects pasted into real pictures: the starwatcher figure (S70 §6's fixture) and kit objects cut
           by their prim id (a porous crown, a trunk), each on the flattest far background of the picture (as painter_bench).
Arms (no clicks, no per-picture setting):
  owl_sam      S30's one-pass front end: OWLv2 class-free objectness boxes (NMS 0.5, boxes over 60 % dropped, top 20) ->
               SAM 2.1 small, one box prompt each, best-scored mask
  gdino_sam    Grounding DINO tiny with the generic query "object." -> SAM 2.1 boxes (box threshold 0.25, the model card's)
  birefnet     BiRefNet (dichotomous segmentation, one foreground matte), thresholded at 0.5, split into connected pieces
Scores per truth object: the prediction is the union of the arm's masks that lie mostly (> 1/2 of their area) on it;
IoU, boundary F-score (tolerance 2 texels), thin-part recall (truth minus its opening by a 2-texel disc: staffs, legs,
discs), found (IoU >= 0.5), and seconds per picture.
  python3 seg_bench.py --out DIR [--arms owl_sam,gdino_sam,birefnet] [--kit P1,P2,...] [--pics NAME=color ...] --figure fig.png
"""
import argparse, json, os, sys, time
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
ap = argparse.ArgumentParser()
ap.add_argument('--out', required=True); ap.add_argument('--arms', default='owl_sam,gdino_sam,birefnet')
ap.add_argument('--kit', default='P1,P2,P3,P5,S2,S9,S15,S26'); ap.add_argument('--kitdir', default='/home/user/moebiusv2/harness/truthkit/out')
ap.add_argument('--pics', nargs='*', default=[]); ap.add_argument('--figure', required=True)
A = ap.parse_args(); os.makedirs(A.out, exist_ok=True)
import torch
torch.set_num_threads(4)


def kit_case(sc):
    d = os.path.join(A.kitdir, sc); rgb = np.asarray(Image.open(os.path.join(d, 'rest_rgb.png')).convert('RGB'))
    z = np.load(os.path.join(d, 'rest_layers.npz')); pid = z['pid'][..., 0]; meta = json.load(open(os.path.join(d, 'meta.json')))
    # the kit's prims are parts (a trunk and its crown, a fence's slats): parts that touch are one object
    parts = [(p['name'], pid == p['pid']) for p in meta['prims'] if p['label'] == 2]
    allm = np.zeros(rgb.shape[:2], bool)
    for _, m in parts: allm |= m
    lb, n = ndi.label(ndi.binary_dilation(allm, iterations=2)); objs = {}
    for k in range(1, n + 1):
        m = allm & (lb == k)
        if m.sum() < 50: continue
        names = [nm for nm, pm in parts if (pm & m).any()]
        objs['+'.join(names[:3]) + ('+%d more' % (len(names) - 3) if len(names) > 3 else '')] = m
    return rgb, objs


def kit_cutouts():
    """exact-alpha objects from kit scenes: (name, rgba) cropped to the object"""
    out = []
    for sc in ('P2', 'P5'):
        rgb, objs = kit_case(sc)
        if not objs: continue
        m = np.zeros(rgb.shape[:2], bool)
        for v in objs.values(): m |= v
        ys, xs = np.nonzero(m); y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        out.append(('kit_' + sc, np.dstack([rgb[y0:y1, x0:x1], (m[y0:y1, x0:x1] * 255).astype(np.uint8)])))
    return out


def paste(img, rgba, frac=0.45):
    """rgba pasted at frac of the picture height on the flattest far background (luminance flatness: no depth needed)"""
    H, W = img.shape[:2]; F = Image.fromarray(rgba, 'RGBA'); fh = int(round(frac * H)); fw = max(1, int(round(F.size[0] * fh / F.size[1])))
    if fw > W - 2: fw = W - 2; fh = int(round(F.size[1] * fw / F.size[0]))
    F = np.asarray(F.resize((fw, fh), Image.LANCZOS)); fa = F[..., 3] > 127
    L = img.mean(-1); best = None
    for y in range(0, H - fh + 1, max(1, fh // 6)):
        for x in range(0, W - fw + 1, max(1, fw // 4)):
            v = float(np.std(L[y:y + fh, x:x + fw][fa]))
            if best is None or v < best[0]: best = (v, y, x)
    _, y, x = best; comp = img.copy(); a = F[..., 3:4] / 255.0
    comp[y:y + fh, x:x + fw] = (F[..., :3] * a + comp[y:y + fh, x:x + fw] * (1 - a)).astype(np.uint8)
    m = np.zeros((H, W), bool); m[y:y + fh, x:x + fw] = fa
    return comp, m


_m = {}
def sam_boxes(img, boxes):
    if 'sam' not in _m:
        from transformers import Sam2Model, Sam2Processor
        _m['sam'] = (Sam2Processor.from_pretrained('facebook/sam2.1-hiera-small'), Sam2Model.from_pretrained('facebook/sam2.1-hiera-small').eval())
    proc, model = _m['sam']; out = []
    im = Image.fromarray(img)
    for b in boxes:
        inp = proc(images=im, input_boxes=[[list(map(float, b))]], return_tensors='pt')
        with torch.no_grad(): o = model(**inp, multimask_output=True)
        masks = proc.post_process_masks(o.pred_masks.cpu(), inp['original_sizes'])[0][0]      # (3, H, W)
        k = int(o.iou_scores[0, 0].argmax()); out.append(masks[k].numpy() > 0)
    return out


def nms(boxes, scores, W, H, top=20):
    def iou(a, b):
        x0, y0, x1, y1 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3]); i = max(0, x1 - x0) * max(0, y1 - y0)
        return i / max(1e-6, (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i)
    keep = []
    for i in np.argsort(-np.asarray(scores)):
        b = [max(0, boxes[i][0]), max(0, boxes[i][1]), min(W, boxes[i][2]), min(H, boxes[i][3])]
        if b[2] - b[0] < 8 or b[3] - b[1] < 8 or (b[2] - b[0]) * (b[3] - b[1]) > 0.6 * W * H: continue
        if any(iou(b, k) > 0.5 for k in keep): continue
        keep.append(b)
        if len(keep) >= top: break
    return keep


def arm_owl_sam(img):
    if 'owl' not in _m:
        from transformers import Owlv2Processor, Owlv2ForObjectDetection
        _m['owl'] = (Owlv2Processor.from_pretrained('google/owlv2-base-patch16-ensemble'), Owlv2ForObjectDetection.from_pretrained('google/owlv2-base-patch16-ensemble').eval())
    proc, model = _m['owl']; H, W = img.shape[:2]
    inp = proc(text=[['an object']], images=Image.fromarray(img), return_tensors='pt')
    with torch.no_grad(): o = model(**inp)
    obj = o.objectness_logits[0].sigmoid().numpy(); bx = o.pred_boxes[0].numpy(); S = max(W, H)
    boxes = np.stack([(bx[:, 0] - bx[:, 2] / 2) * S, (bx[:, 1] - bx[:, 3] / 2) * S, (bx[:, 0] + bx[:, 2] / 2) * S, (bx[:, 1] + bx[:, 3] / 2) * S], 1)
    return sam_boxes(img, nms(boxes, obj, W, H))


def arm_gdino_sam(img):
    if 'gd' not in _m:
        from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection
        _m['gd'] = (AutoProcessor.from_pretrained('IDEA-Research/grounding-dino-tiny'), AutoModelForZeroShotObjectDetection.from_pretrained('IDEA-Research/grounding-dino-tiny').eval())
    proc, model = _m['gd']; H, W = img.shape[:2]
    inp = proc(images=Image.fromarray(img), text='object.', return_tensors='pt')
    with torch.no_grad(): o = model(**inp)
    r = proc.post_process_grounded_object_detection(o, inp.input_ids, threshold=0.25, text_threshold=0.25, target_sizes=[(H, W)])[0]
    return sam_boxes(img, nms(r['boxes'].numpy().tolist(), r['scores'].numpy().tolist(), W, H))


def arm_birefnet(img):
    if 'bi' not in _m:
        from transformers import AutoModelForImageSegmentation
        _m['bi'] = AutoModelForImageSegmentation.from_pretrained('ZhengPeng7/BiRefNet', trust_remote_code=True).eval()
    model = _m['bi']; H, W = img.shape[:2]
    x = torch.from_numpy(np.asarray(Image.fromarray(img).resize((1024, 1024), Image.BILINEAR), np.float32) / 255.0).permute(2, 0, 1)[None]
    x = (x - torch.tensor([0.485, 0.456, 0.406])[:, None, None]) / torch.tensor([0.229, 0.224, 0.225])[:, None, None]
    with torch.no_grad(): p = model(x)[-1].sigmoid()[0, 0].numpy()
    m = np.asarray(Image.fromarray((p * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR)) > 127
    lb, n = ndi.label(m); return [lb == k for k in range(1, n + 1) if (lb == k).sum() >= 50]


def score(masks, truth):
    pred = np.zeros_like(truth)
    for m in masks:
        if m.sum() and (m & truth).sum() > 0.5 * m.sum(): pred |= m
    I = (pred & truth).sum(); U = (pred | truth).sum(); iou = I / max(1, U)
    def edge(m): return m & ~ndi.binary_erosion(m)
    et, ep = edge(truth), edge(pred); dt = ndi.distance_transform_edt(~et); dp = ndi.distance_transform_edt(~ep)
    prec = float((dt[ep] <= 2).mean()) if ep.any() else 0.0; rec = float((dp[et] <= 2).mean()) if et.any() else 0.0
    bf = 2 * prec * rec / max(1e-9, prec + rec)
    thin = truth & ~ndi.binary_opening(truth, structure=np.ones((5, 5), bool))
    return {'iou': float(iou), 'boundaryF': bf, 'thinRecall': float((pred & thin).sum() / max(1, thin.sum())), 'thinPx': int(thin.sum()), 'found': bool(iou >= 0.5)}


ARMS = {'owl_sam': arm_owl_sam, 'gdino_sam': arm_gdino_sam, 'birefnet': arm_birefnet}
cases = []
for sc in [s for s in A.kit.split(',') if s]:
    try:
        rgb, objs = kit_case(sc)
        if objs: cases.append(('kit_' + sc, rgb, objs))
    except Exception as e: print('skip', sc, e, flush=True)
fig = np.asarray(Image.open(A.figure).convert('RGBA')); cut = [('starwatcher', fig)] + kit_cutouts()
for spec in A.pics:
    name, pc = spec.split('=')[0], spec.split('=')[1].split(':')[0]
    img = np.asarray(Image.open(pc).convert('RGB'))
    if max(img.shape[:2]) > 1024: s = 1024 / max(img.shape[:2]); img = np.asarray(Image.fromarray(img).resize((int(img.shape[1] * s), int(img.shape[0] * s)), Image.LANCZOS))
    for cn, rgba in cut:
        comp, m = paste(img, rgba); cases.append(('%s+%s' % (name, cn), comp, {cn: m}))
res = {}; resf = os.path.join(A.out, 'seg_bench.json')
for cname, img, objs in cases:
    Image.fromarray(img).save(os.path.join(A.out, cname + '.png'))
    for arm in A.arms.split(','):
        t0 = time.time()
        try: masks = ARMS[arm](img)
        except Exception as e: print(cname, arm, 'FAILED', repr(e)[:200], flush=True); continue
        secs = time.time() - t0
        r = res.setdefault(cname, {}).setdefault(arm, {'secs': round(secs, 1), 'masks': len(masks), 'objects': {}})
        for on, tm in objs.items(): r['objects'][on] = score(masks, tm)
        print(cname, arm, round(secs, 1), 's', {k: {kk: (round(vv, 3) if isinstance(vv, float) else vv) for kk, vv in v.items()} for k, v in r['objects'].items()}, flush=True)
        json.dump(res, open(resf, 'w'), indent=1)
print('DONE', flush=True)
