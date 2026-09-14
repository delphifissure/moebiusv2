# Depth proposes, SAM segments, depth glues: single-point prompts at points spread over the cliff set (the band), each point's
# best-scored SAM mask kept; masks merged (a) when one lies mostly inside another (SAM's hierarchy), (b) when two ADJACENT
# masks share an edge that is not a cliff (the band): parts of one surface are glued where the depth says there is no step.
import numpy as np, json, time
from PIL import Image
import onnxruntime as ort
from scipy import ndimage as ndi
P='/home/user/moebiusv2/harness/shots/a257probe/photo_da3_16n'; D='/home/user/moebiusv2/harness/shots/objlayers/view_troll_v2'
meta = json.load(open(f'{P}/meta.json')); pw, ph = meta['pw'], meta['ph']
dQ = np.fromfile(f'{P}/dQ.f32', np.float32).reshape(ph, pw); dis = np.fromfile(f'{P}/disocc.u8', np.uint8).reshape(ph, pw) > 0
pS = np.fromfile(f'{P}/plateF.f32', np.float32).reshape(ph, pw)[::-1]; q = 4 / 65535; band = dis & (pS < dQ - q)
img = Image.open(f'{D}/source_plate.png').convert('RGB'); ref = np.array(Image.open(f'{D}/plane_object_ids_sam.png')); troll = ref == 1; woman = ref == 2
x = np.asarray(img.resize((1024, 1024), Image.BILINEAR)).astype(np.float32) / 255.; x = ((x - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]).transpose(2, 0, 1)[None].astype(np.float32)
so = ort.SessionOptions(); so.intra_op_num_threads = 4
enc = ort.InferenceSession('sam2onnx/vision_encoder.onnx', so, providers=['CPUExecutionProvider']); dec = ort.InferenceSession('sam2onnx/prompt_encoder_mask_decoder.onnx', so, providers=['CPUExecutionProvider'])
e = enc.run(None, {'pixel_values': x}); feats = {f'image_embeddings.{i}': e[i] for i in range(3)}; sc = np.array([1024 / pw, 1024 / ph], np.float32)
def sam(points):
    inp = dict(feats); inp['input_points'] = (np.array(points, np.float32) * sc)[None, None]; inp['input_labels'] = np.ones((1, 1, len(points)), np.int64); inp['input_boxes'] = np.zeros((1, 0, 4), np.float32)
    iou, masks, _ = dec.run(None, inp); k = int(np.argmax(iou[0, 0])); return np.asarray(Image.fromarray(masks[0, 0, k].astype(np.float32), 'F').resize((pw, ph), Image.BILINEAR)) > 0, float(iou[0, 0, k])
def J(a, b): return (a & b).sum() / max(1, (a | b).sum())
# sample points over the cliff set: deepest-inside points, farthest-point spread, N = one per (band area / 2000 px) so the density follows the band, not a constant count
dt = ndi.distance_transform_edt(band); ys, xs = np.nonzero(band); w = dt[ys, xs]; N = max(8, int(band.sum() / 2000)); cand = np.stack([xs, ys], 1).astype(np.float32)
pts = [tuple(cand[int(np.argmax(w))])]; dmin = np.hypot(cand[:, 0] - pts[0][0], cand[:, 1] - pts[0][1])
for _ in range(N - 1):
    j = int(np.argmax(dmin * (w >= 1.5))); pts.append(tuple(cand[j])); dmin = np.minimum(dmin, np.hypot(cand[:, 0] - cand[j, 0], cand[:, 1] - cand[j, 1]))
print(f'{len(pts)} cliff-set prompts (band {int(band.sum())} px)'); t0 = time.time()
parts = [dict(zip(['mask', 'iou'], sam([p]))) | {'pt': p} for p in pts]; print(f'SAM {time.time() - t0:.0f}s')
# (a) hierarchy: drop a mask that lies mostly (> 1/2) inside a larger one... keep the larger (the whole); (b) glue adjacent masks across non-cliff edges
parts.sort(key=lambda r: -r['mask'].sum()); kept = []
for r in parts:
    if any((r['mask'] & k['mask']).sum() > 0.5 * r['mask'].sum() for k in kept): continue
    kept.append(r)
print(f'{len(kept)} masks after the hierarchy rule; sizes', [int(k['mask'].sum()) for k in kept][:12])
bandN = ndi.binary_dilation(band, np.ones((5, 5)))
lab = np.zeros((ph, pw), np.int32)
for i, k in enumerate(kept): lab[k['mask'] & (lab == 0)] = i + 1
parent = list(range(len(kept) + 1))
def find(a):
    while parent[a] != a: parent[a] = parent[parent[a]]; a = parent[a]
    return a
pairs = {}
for dy, dx in [(0, 1), (1, 0)]:
    a = lab[:ph - dy, :pw - dx]; b = lab[dy:, dx:]; m = (a > 0) & (b > 0) & (a != b); cl = bandN[:ph - dy, :pw - dx][m]
    for i, j, c in zip(a[m], b[m], cl): key = (min(i, j), max(i, j)); s = pairs.setdefault(key, [0, 0]); s[0] += 1; s[1] += int(c)
for (i, j), (n, c) in pairs.items():
    if n >= 20 and c < 0.5 * n: parent[find(i)] = find(j)   # shared edge mostly NOT a cliff -> one surface
groups = {}
for i in range(1, len(kept) + 1): groups.setdefault(find(i), []).append(i)
print(f'{len(groups)} objects after gluing across non-cliff edges')
rows = []
for g, ids in groups.items():
    m = np.isin(lab, ids); edge = m & ~ndi.binary_erosion(m); rows.append((int(m.sum()), round(J(m, troll), 2), round(J(m, woman), 2), int((m & band).sum()), round(float((edge & bandN).sum() / max(1, edge.sum())), 2), len(ids)))
rows.sort(key=lambda r: -r[3]); print('objects by band demand: px / IoU troll / IoU woman / band demand / outline-on-cliff / parts')
for r in rows[:14]: print('  ', r)
print('best IoU troll', max(r[1] for r in rows), 'best IoU woman', max(r[2] for r in rows))
# without gluing, for comparison
rows2 = sorted([(int(k['mask'].sum()), round(J(k['mask'], troll), 2), round(J(k['mask'], woman), 2)) for k in kept], key=lambda r: -r[0])
print('no glue: best IoU troll', max(r[1] for r in rows2), 'woman', max(r[2] for r in rows2), '; top masks', rows2[:8])
