#!/usr/bin/env python3
"""S27: starter files for hand-made or model-made object layers, from an SD Bundle zip.
For each exported object (largest band demand first, up to N) writes, at the plate grid:
  obj_<id>_color.png    RGBA: the source colour under the object's footprint, alpha 255 there, 0 elsewhere — the VISIBLE part;
                        paint / generate the hidden part (behind whatever occludes it) into the transparent area, keep the name
  obj_<id>_visible.png  the object's visible footprint (white) — leave as is; the import uses it to split visible from hidden
  obj_<id>_box.txt      the box [x0, y0, x1, y1) in plate pixels and in source-image pixels (for a layer model that takes boxes)
Then: app → Build → 'Import object layers (S27)' → select the obj_*.png files.
  python3 harness/objl_starters.py moebius_sd_bundle.zip out_dir [N=8]
"""
import sys, os, json, zipfile, io
import numpy as np
from PIL import Image
zp, out = sys.argv[1], sys.argv[2]; N = int(sys.argv[3]) if len(sys.argv) > 3 else 8
os.makedirs(out, exist_ok=True); z = zipfile.ZipFile(zp)
meta = json.loads(z.read('meta.json')); po = meta.get('plane_objects')
if not po: sys.exit('this bundle has no plane_objects: export it after a plane bake (S6 panel, far side = plane)')
ids = np.array(Image.open(io.BytesIO(z.read('plane_object_ids.png'))).convert('L'))
col = np.array(Image.open(io.BytesIO(z.read('plane_source_color.png'))).convert('RGB'))
ph, pw = ids.shape; sw, sh = (po.get('sourceImageSize') or [pw, ph])
print(f'plate {pw}x{ph}, source {sw}x{sh}, {po["count"]} objects ({po.get("withoutDemand", 0)} without demand not exported); rule: {po.get("rule")}')
for o in po['objects'][:N]:
    k = o['id']; m = ids == k
    rgba = np.zeros((ph, pw, 4), np.uint8); rgba[..., :3] = col; rgba[..., 3] = np.where(m, 255, 0)
    Image.fromarray(rgba, 'RGBA').save(f'{out}/obj_{k}_color.png'); Image.fromarray((m * 255).astype(np.uint8), 'L').save(f'{out}/obj_{k}_visible.png')
    x0, y0, x1, y1 = o['bbox']; sx, sy = sw / pw, sh / ph
    open(f'{out}/obj_{k}_box.txt', 'w').write(f'plate [x0 y0 x1 y1) = {x0} {y0} {x1} {y1}\nsource = {x0*sx:.0f} {y0*sy:.0f} {x1*sx:.0f} {y1*sy:.0f}\nfootprint {o["footprintPx"]} px, band demand {o["bandPx"]} px, front disparity {o["frontDepthMean"]:.3f}, background {o["backgroundDepthMean"]:.3f}\n')
    print(f'  obj_{k}: footprint {o["footprintPx"]} px, band {o["bandPx"]} px, box {o["bbox"]}')
print('wrote', out)
