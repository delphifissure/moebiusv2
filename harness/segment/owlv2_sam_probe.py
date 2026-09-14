# One-pass decomposition candidate: class-free OWLv2 objectness boxes -> SAM 2.1 box prompts -> depth (band demand) keeps occluders.
import numpy as np, time, torch, json
from PIL import Image
torch.set_num_threads(3)
D='/home/user/moebiusv2/harness/shots/objlayers/view_troll_v2'
img = Image.open(f'{D}/source_plate.png').convert('RGB'); pw, ph = img.size
ref = np.array(Image.open(f'{D}/plane_object_ids_sam.png')); troll = ref == 1; woman = ref == 2
from transformers import Owlv2Processor, Owlv2ForObjectDetection
t0 = time.time(); proc = Owlv2Processor.from_pretrained('google/owlv2-base-patch16-ensemble'); model = Owlv2ForObjectDetection.from_pretrained('google/owlv2-base-patch16-ensemble').eval(); print(f'owlv2 loaded {time.time()-t0:.0f}s')
# objectness needs a text query for the forward pass API; use a generic one and read the objectness logits (class-free)
inputs = proc(text=[['an object']], images=img, return_tensors='pt')
t0 = time.time()
with torch.no_grad(): out = model(**inputs)
print(f'owlv2 forward {time.time()-t0:.1f}s')
obj = out.objectness_logits[0].sigmoid().numpy()            # (num_patches,)
boxes = out.pred_boxes[0].numpy()                            # cxcywh normalised to the padded square
# OWLv2 pads the image to a square (bottom/right); boxes are relative to the padded square of side max(pw,ph)
S = max(pw, ph); bx = np.stack([(boxes[:,0]-boxes[:,2]/2)*S, (boxes[:,1]-boxes[:,3]/2)*S, (boxes[:,0]+boxes[:,2]/2)*S, (boxes[:,1]+boxes[:,3]/2)*S], 1)
order = np.argsort(-obj)
def iou_box(a, b):
    x0, y0, x1, y1 = max(a[0],b[0]), max(a[1],b[1]), min(a[2],b[2]), min(a[3],b[3]); inter = max(0,x1-x0)*max(0,y1-y0); ua = (a[2]-a[0])*(a[3]-a[1]) + (b[2]-b[0])*(b[3]-b[1]) - inter; return inter/max(1e-6, ua)
keep = []
for i in order:
    b = bx[i]; b = [max(0,b[0]), max(0,b[1]), min(pw,b[2]), min(ph,b[3])]
    if (b[2]-b[0]) < 8 or (b[3]-b[1]) < 8: continue
    if (b[2]-b[0])*(b[3]-b[1]) > 0.6*pw*ph: continue
    if any(iou_box(b, k['box']) > 0.5 for k in keep): continue
    keep.append({'box': [round(float(v)) for v in b], 'objectness': round(float(obj[i]), 3)})
    if len(keep) >= 20: break
print('top class-free proposals (box, objectness):'); 
for k in keep: print('  ', k)
# SAM box prompts on the proposals
import onnxruntime as ort
x = np.asarray(img.resize((1024,1024), Image.BILINEAR)).astype(np.float32)/255.; x = ((x - [0.485,0.456,0.406]) / [0.229,0.224,0.225]).transpose(2,0,1)[None].astype(np.float32)
so = ort.SessionOptions(); so.intra_op_num_threads = 3
enc = ort.InferenceSession('sam2onnx/vision_encoder.onnx', so, providers=['CPUExecutionProvider']); dec = ort.InferenceSession('sam2onnx/prompt_encoder_mask_decoder.onnx', so, providers=['CPUExecutionProvider'])
e = enc.run(None, {'pixel_values': x}); feats = {f'image_embeddings.{i}': e[i] for i in range(3)}
sc = np.array([1024/pw, 1024/ph, 1024/pw, 1024/ph], np.float32)
def J(a, b): return (a & b).sum() / max(1, (a | b).sum())
dobj = np.fromfile(f'{D}/objIds.u8', np.uint8).reshape(ph, pw) > 0
print('SAM masks from the proposals: box / objectness / mask px / SAM iou / IoU troll / IoU woman / frac in depth-object')
for k in keep:
    inp = dict(feats); inp['input_points'] = np.zeros((1,1,0,2), np.float32); inp['input_labels'] = np.zeros((1,1,0), np.int64); inp['input_boxes'] = (np.array(k['box'], np.float32) * sc)[None, None]
    iou, masks, _ = dec.run(None, inp); j = int(np.argmax(iou[0,0])); m = np.asarray(Image.fromarray(masks[0,0,j].astype(np.float32), 'F').resize((pw,ph), Image.BILINEAR)) > 0
    print('  ', k['box'], k['objectness'], int(m.sum()), round(float(iou[0,0,j]),2), round(J(m, troll),2), round(J(m, woman),2), round(float((m & dobj).sum()/max(1,m.sum())),2))
