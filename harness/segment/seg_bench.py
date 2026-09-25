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


from seg_models import ARMS, _m


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
