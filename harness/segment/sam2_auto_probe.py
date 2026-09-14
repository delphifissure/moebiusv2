import numpy as np, time, json
from PIL import Image
import torch; torch.set_num_threads(2)
from sam2.build_sam import build_sam2; from sam2.automatic_mask_generator import SAM2AutomaticMaskGenerator; from huggingface_hub import hf_hub_download
D='/home/user/moebiusv2/harness/shots/objlayers/view_troll_v2'
img = np.asarray(Image.open(f'{D}/source_plate.png').convert('RGB')); ph, pw = img.shape[:2]
ref = np.array(Image.open(f'{D}/plane_object_ids_sam.png')); troll = ref == 1; woman = ref == 2
dobj = np.fromfile(f'{D}/objIds.u8', np.uint8).reshape(ph, pw) > 0   # depth-only "in front of the far field" (A253 + continuity)
ck = hf_hub_download('facebook/sam2.1-hiera-small', 'sam2.1_hiera_small.pt'); model = build_sam2('configs/sam2.1/sam2.1_hiera_s.yaml', ck, device='cpu')
def J(a, b): return (a & b).sum() / max(1, (a | b).sum())
for pps in [16, 32]:
    gen = SAM2AutomaticMaskGenerator(model, points_per_side=pps, pred_iou_thresh=0.8, stability_score_thresh=0.9, min_mask_region_area=int(0.001 * pw * ph))
    t = time.time(); out = gen.generate(img); dt = time.time() - t
    rows = []
    for m in out:
        s = m['segmentation']; rows.append((int(s.sum()), round(float(m['predicted_iou']), 2), round(J(s, troll), 2), round(J(s, woman), 2), round(float((s & dobj).sum() / s.sum()), 2), round(float((s & troll).sum() / s.sum()), 2)))
    rows.sort(reverse=True)
    cov = np.zeros((ph, pw), bool)
    for m in out: cov |= m['segmentation']
    print(f'pps {pps}: {len(out)} masks in {dt:.0f}s; picture covered {cov.mean():.2f}; troll covered {(cov & troll).sum() / troll.sum():.2f}, woman covered {(cov & woman).sum() / woman.sum():.2f}')
    print('  best IoU with troll', max(r[2] for r in rows), ' with woman', max(r[3] for r in rows))
    print('  area / predIoU / IoU troll / IoU woman / frac in depth-object / frac in troll:')
    for r in rows[:14]: print('   ', r)
