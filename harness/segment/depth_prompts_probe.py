# Depth proposes, SAM segments: the app's band (the cliff set: plate texels under an occluder's silhouette with a far side)
# split into connected pieces; each piece's interior points are one multi-point prompt to SAM 2.1; masks merged by overlap;
# each merged mask scored by (a) band demand under it, (b) the fraction of its outline that lies on the cliff set.
import numpy as np, json, time
from PIL import Image
import onnxruntime as ort
from scipy import ndimage as ndi
P='/home/user/moebiusv2/harness/shots/a257probe/photo_da3_16n'; D='/home/user/moebiusv2/harness/shots/objlayers/view_troll_v2'
meta = json.load(open(f'{P}/meta.json')); pw, ph = meta['pw'], meta['ph']
dQ = np.fromfile(f'{P}/dQ.f32', np.float32).reshape(ph, pw); dis = np.fromfile(f'{P}/disocc.u8', np.uint8).reshape(ph, pw) > 0
pS = np.fromfile(f'{P}/plateF.f32', np.float32).reshape(ph, pw)[::-1]
q = 1 / 65535 * 4   # a few quanta; the app uses its effective quantum
band = dis & (pS < dQ - q); print('band texels', int(band.sum()))
img = Image.open(f'{D}/source_plate.png').convert('RGB'); assert img.size == (pw, ph)
ref = np.array(Image.open(f'{D}/plane_object_ids_sam.png')); troll = ref == 1; woman = ref == 2
# pieces of the band
lab, n = ndi.label(band, structure=np.ones((3, 3))); sizes = ndi.sum(band, lab, range(1, n + 1)); print('band pieces', n, 'sizes top', sorted(sizes.astype(int), reverse=True)[:12])
# SAM
x = np.asarray(img.resize((1024, 1024), Image.BILINEAR)).astype(np.float32) / 255.; x = ((x - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]).transpose(2, 0, 1)[None].astype(np.float32)
so = ort.SessionOptions(); so.intra_op_num_threads = 4
enc = ort.InferenceSession('sam2onnx/vision_encoder.onnx', so, providers=['CPUExecutionProvider']); dec = ort.InferenceSession('sam2onnx/prompt_encoder_mask_decoder.onnx', so, providers=['CPUExecutionProvider'])
e = enc.run(None, {'pixel_values': x}); feats = {f'image_embeddings.{i}': e[i] for i in range(3)}
sc = np.array([1024 / pw, 1024 / ph], np.float32)
def sam(points):
    inp = dict(feats); pts = np.array(points, np.float32) * sc; inp['input_points'] = pts[None, None]; inp['input_labels'] = np.ones((1, 1, len(points)), np.int64); inp['input_boxes'] = np.zeros((1, 0, 4), np.float32)
    iou, masks, _ = dec.run(None, inp); k = int(np.argmax(iou[0, 0])); m = np.asarray(Image.fromarray(masks[0, 0, k].astype(np.float32), 'F').resize((pw, ph), Image.BILINEAR)) > 0; return m, float(iou[0, 0, k])
def J(a, b): return (a & b).sum() / max(1, (a | b).sum())
# interior points of a piece: farthest-point sampling on its distance transform (up to 6), points that are deepest inside the piece
def prompts(piece, k=6):
    dt = ndi.distance_transform_edt(piece); ys, xs = np.nonzero(piece); w = dt[ys, xs]; order = np.argsort(-w); pts = [(int(xs[order[0]]), int(ys[order[0]]))]
    cand = np.stack([xs, ys], 1).astype(np.float32)
    for _ in range(k - 1):
        dmin = np.min([np.hypot(cand[:, 0] - px, cand[:, 1] - py) for px, py in pts], 0) * (w > 0.5 * w.max())   # far from the chosen ones, still deep inside
        j = int(np.argmax(dmin)); 
        if dmin[j] <= 0: break
        pts.append((int(xs[j]), int(ys[j])))
    return pts
t0 = time.time(); masks = []
order = np.argsort(-sizes)
for pi in order:
    if sizes[pi] < 50: break   # tiny slivers give no prompt geometry (a 7 x 7 px piece) — reported, not tuned: everything above is run
    piece = lab == pi + 1; pts = prompts(piece); m, iou = sam(pts); masks.append({'piece': int(pi + 1), 'piecePx': int(sizes[pi]), 'pts': pts, 'mask': m, 'iou': iou})
print(f'{len(masks)} pieces prompted in {time.time() - t0:.0f}s')
# merge: masks that overlap by more than half of the smaller are one object (SAM's hierarchy)
objs = []
for r in sorted(masks, key=lambda r: -r['mask'].sum()):
    for o in objs:
        inter = (o['mask'] & r['mask']).sum()
        if inter > 0.5 * min(o['mask'].sum(), r['mask'].sum()): o['pieces'] += 1; o['piecePx'] += r['piecePx']; break
    else: objs.append({'mask': r['mask'], 'iou': r['iou'], 'pieces': 1, 'piecePx': r['piecePx'], 'pts': r['pts']})
# scores: band demand under the mask; outline-on-cliff fraction (outline pixels of the mask that are band texels or adjacent to one)
bandN = ndi.binary_dilation(band, np.ones((3, 3)))
rows = []
for o in objs:
    m = o['mask']; edge = m & ~ndi.binary_erosion(m); cliff = float((edge & bandN).sum() / max(1, edge.sum())); demand = int((m & band).sum())
    rows.append((int(m.sum()), round(o['iou'], 2), round(J(m, troll), 2), round(J(m, woman), 2), demand, round(cliff, 2), o['pieces'], o['pts'][:2]))
rows.sort(key=lambda r: -r[4])
print('merged objects, by band demand: mask px / SAM iou / IoU troll / IoU woman / band demand / outline-on-cliff / pieces / first prompts')
for r in rows[:16]: print('  ', r)
# the same scores for the OWLv2 masks' reference: the S28 click masks themselves
for nm, m in [('troll click mask', troll), ('woman click mask', woman)]:
    edge = m & ~ndi.binary_erosion(m); print(f'  reference {nm}: band demand {(m & band).sum()}, outline-on-cliff {float((edge & bandN).sum() / max(1, edge.sum())):.2f}')
