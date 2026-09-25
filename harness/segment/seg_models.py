"""The no-click segmentation pipelines, shared by seg_bench.py (the known-answer test) and seg_run.py (the app's Find
objects, through paint_server.py /segment). Each arm takes an RGB uint8 picture and returns a list of boolean masks."""
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
import torch
torch.set_num_threads(4)


_m = {}
def sam_boxes(img, boxes):
    if 'sam' not in _m:
        from transformers import Sam2Model, Sam2Processor
        _m['sam'] = (Sam2Processor.from_pretrained('facebook/sam2.1-hiera-small'), Sam2Model.from_pretrained('facebook/sam2.1-hiera-small').eval())
    proc, model = _m['sam']
    if not len(boxes): return []
    inp = proc(images=Image.fromarray(img), input_boxes=[[list(map(float, b)) for b in boxes]], return_tensors='pt')   # one image encode, every box
    with torch.no_grad(): o = model(**inp, multimask_output=True)
    masks = proc.post_process_masks(o.pred_masks.cpu(), inp['original_sizes'])[0]           # (boxes, 3, H, W)
    best = o.iou_scores[0].argmax(-1)                                                        # the best-scored of the three, per box
    return [masks[i, int(best[i])].numpy() > 0 for i in range(len(boxes))]


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




def arm_sam3(img, words=('person', 'animal', 'object')):
    """SAM 3 (gated: needs HF_TOKEN with access): every instance of each concept word, one mask per instance"""
    if 'sam3' not in _m:
        from transformers import Sam3Processor, Sam3Model
        _m['sam3'] = (Sam3Processor.from_pretrained('facebook/sam3'), Sam3Model.from_pretrained('facebook/sam3').eval())
    proc, model = _m['sam3']; out = []
    im = proc(images=Image.fromarray(img), return_tensors='pt')          # the image is encoded once; each word reuses it
    with torch.no_grad(): ve = model.get_vision_features(pixel_values=im.pixel_values)
    for w in words:
        ti = proc(text=w, return_tensors='pt')
        with torch.no_grad(): o = model(vision_embeds=ve, input_ids=ti.input_ids, attention_mask=ti.get('attention_mask'))
        r = proc.post_process_instance_segmentation(o, threshold=0.5, mask_threshold=0.5, target_sizes=im.get('original_sizes').tolist())[0]
        out += [m.numpy().astype(bool) for m in r['masks']]
    return out


ARMS = {'owl_sam': arm_owl_sam, 'gdino_sam': arm_gdino_sam, 'birefnet': arm_birefnet, 'sam3': arm_sam3}
