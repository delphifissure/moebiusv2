import numpy as np, time, json, sys
from PIL import Image
import onnxruntime as ort
D='/home/user/moebiusv2/harness/shots/objlayers/view_troll_v2'
img = Image.open(f'{D}/source_plate.png').convert('RGB'); pw, ph = img.size
x = np.asarray(img.resize((1024,1024), Image.BILINEAR)).astype(np.float32)/255.
x = ((x - [0.485,0.456,0.406]) / [0.229,0.224,0.225]).transpose(2,0,1)[None].astype(np.float32)
so = ort.SessionOptions(); so.intra_op_num_threads = 4
enc = ort.InferenceSession('sam2onnx/vision_encoder.onnx', so, providers=['CPUExecutionProvider']); dec = ort.InferenceSession('sam2onnx/prompt_encoder_mask_decoder.onnx', so, providers=['CPUExecutionProvider'])
t=time.time(); e = enc.run(None, {'pixel_values': x}); print('encoder', [a.shape for a in e], f'{time.time()-t:.1f}s')
feats = {f'image_embeddings.{i}': e[i] for i in range(3)}
def run(points, labels, boxes_shape=(1,0,4)):
    pts = np.array(points, np.float32) * np.array([1024/pw, 1024/ph], np.float32)
    inp = dict(feats); inp['input_points'] = pts[None,None]; inp['input_labels'] = np.array(labels, np.int64)[None,None]; inp['input_boxes'] = np.zeros(boxes_shape, np.float32)
    t=time.time(); iou, masks, obj = dec.run(None, inp); dt=time.time()-t
    return iou, masks, obj, dt
def up(m):  # (256,256) logits -> (ph,pw) bool, bilinear
    return np.asarray(Image.fromarray(m.astype(np.float32), 'F').resize((pw,ph), Image.BILINEAR)) > 0
try:
    iou, masks, obj, dt = run([(300,350)], [1]); print('single click: iou', iou.ravel(), 'masks', masks.shape, 'obj', obj.ravel(), f'{dt*1000:.0f}ms')
except Exception as ex: print('empty boxes failed:', str(ex)[:300]); sys.exit(1)
onnx_single = [up(masks[0,0,k]) for k in range(masks.shape[2])]; print('  onnx candidate px', [int(m.sum()) for m in onnx_single])
iou2, masks2, obj2, dt2 = run([(300,190),(300,350),(250,650),(330,800)], [1,1,1,1]); onnx_multi = [up(masks2[0,0,k]) for k in range(masks2.shape[2])]
print('multi click: iou', iou2.ravel(), 'px', [int(m.sum()) for m in onnx_multi], f'{dt2*1000:.0f}ms')
# torch reference
import torch; torch.set_num_threads(4)
from sam2.build_sam import build_sam2; from sam2.sam2_image_predictor import SAM2ImagePredictor; from huggingface_hub import hf_hub_download
ck = hf_hub_download('facebook/sam2.1-hiera-small', 'sam2.1_hiera_small.pt'); pred = SAM2ImagePredictor(build_sam2('configs/sam2.1/sam2.1_hiera_s.yaml', ck, device='cpu')); pred.set_image(np.asarray(img))
def J(a,b): return (a&b).sum()/max(1,(a|b).sum())
m, sc, _ = pred.predict(point_coords=np.array([[300,350]],np.float32), point_labels=np.array([1]), multimask_output=True)
print('torch single: px', [int(mm.sum()) for mm in m], 'iou', sc, ' IoU onnx vs torch per candidate:', [round(J(onnx_single[k], m[k].astype(bool)),3) for k in range(3)])
m2, sc2, _ = pred.predict(point_coords=np.array([[300,190],[300,350],[250,650],[330,800]],np.float32), point_labels=np.array([1,1,1,1]), multimask_output=False)
print('torch multi: px', int(m2[0].sum()), 'iou', sc2, ' IoU of onnx candidates vs torch:', [round(J(onnx_multi[k], m2[0].astype(bool)),3) for k in range(len(onnx_multi))])
m3, sc3, _ = pred.predict(point_coords=np.array([[300,190],[300,350],[250,650],[330,800]],np.float32), point_labels=np.array([1,1,1,1]), multimask_output=True)
print('torch multi multimask=True: px', [int(mm.sum()) for mm in m3], 'iou', sc3, ' IoU vs onnx per candidate:', [round(J(onnx_multi[k], m3[k].astype(bool)),3) for k in range(3)])
