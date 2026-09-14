import numpy as np, time
from PIL import Image
import onnxruntime as ort
D='/home/user/moebiusv2/harness/shots/objlayers/view_troll_v2'
img = Image.open(f'{D}/source_plate.png').convert('RGB'); pw, ph = img.size
ref = np.array(Image.open(f'{D}/plane_object_ids_sam.png'))
x = np.asarray(img.resize((1024,1024), Image.BILINEAR)).astype(np.float32)/255.
x = ((x - [0.485,0.456,0.406]) / [0.229,0.224,0.225]).transpose(2,0,1)[None].astype(np.float32)
so = ort.SessionOptions(); so.intra_op_num_threads = 4
enc = ort.InferenceSession('sam2onnx/vision_encoder.onnx', so, providers=['CPUExecutionProvider']); dec = ort.InferenceSession('sam2onnx/prompt_encoder_mask_decoder.onnx', so, providers=['CPUExecutionProvider'])
e = enc.run(None, {'pixel_values': x}); feats = {f'image_embeddings.{i}': e[i] for i in range(3)}
sc = np.array([1024/pw, 1024/ph], np.float32)
def up(m): return np.asarray(Image.fromarray(m.astype(np.float32), 'F').resize((pw,ph), Image.BILINEAR)) > 0
def J(a,b): return (a&b).sum()/max(1,(a|b).sum())
def run(points, labels, boxes):
    inp = dict(feats)
    pts = (np.array(points, np.float32).reshape(-1,2) * sc) if len(points) else np.zeros((0,2), np.float32)
    inp['input_points'] = pts[None,None]; inp['input_labels'] = np.array(labels, np.int64).reshape(1,1,-1)
    bx = np.array(boxes, np.float32).reshape(-1,4); bx = bx * np.concatenate([sc, sc]) if len(bx) else np.zeros((0,4), np.float32)
    inp['input_boxes'] = bx[None]
    try: iou, masks, obj = dec.run(None, inp)
    except Exception as ex: return 'ERR ' + str(ex)[:200]
    ms = [up(masks[0,i,k]) for i in range(masks.shape[1]) for k in range(masks.shape[2])]
    return iou.ravel().round(3).tolist(), [int(m.sum()) for m in ms], [round(J(m, ref==1),3) for m in ms], masks.shape
troll_box = [151,148,604,847]
print('box only            :', run([], [], [troll_box]))
print('box + 0 pts shape   :', run([], [], [troll_box])[-1] if not isinstance(run([], [], [troll_box]), str) else '')
print('box + 1 click       :', run([(300,350)], [1], [troll_box]))
print('box + 4 clicks      :', run([(300,190),(300,350),(250,650),(330,800)], [1,1,1,1], [troll_box]))
print('box + exclude woman :', run([(470,700)], [0], [troll_box]))
print('woman box           :', run([], [], [[428,428,568,936]]), ' (ref id 2)')
print('loose troll box     :', run([], [], [[100,100,650,900]]))
