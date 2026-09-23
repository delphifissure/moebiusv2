"""Before / after page for the source-anchored hole (S62): per picture, today's app (the per-line law, S59 arm A) next to
srcfill at the S59 poses, and the plate depth as a shaded relief next to DA3's own map. Not blind: the rule is withdrawn
(S62 section 1); this page is for looking.

  python3 srcfill_compare.py <srcfill out dir (per-picture plateD.f32)> <page out dir>
"""
import sys, os, json, shutil
import numpy as np
from PIL import Image

H = os.path.dirname(os.path.abspath(__file__)); FILL, OUT = sys.argv[1], sys.argv[2]; os.makedirs(OUT, exist_ok=True)
PICS = ['troll', 'vermeer', 'sunflowers', 'starwatcher']
POSES = [('yawR42', 'yaw +42°'), ('yawL42', 'yaw −42°'), ('yaw22', 'yaw 22.5°'), ('pitch30', 'pitch +30°')]

def relief(z, step):                                  # the S59 review page's shading, over the whole frame
    gy, gx = np.gradient(z / step); return Image.fromarray((np.clip(0.5 + 0.08 * (-gx - gy), 0, 1) * 255).astype(np.uint8))

pics = []
for p in PICS:
    Dd = os.path.join(H, 'shots', 'streakclass', 'ab_' + p); m = json.load(open(os.path.join(Dd, 'meta.json'))); pw, ph, st = m['pw'], m['ph'], m['quantum']
    new = os.path.join(H, 'shots', 'srcfill', p); old = os.path.join(H, 'shots', 'sheet_ab', p)
    if not os.path.exists(os.path.join(new, 'render.json')): print('missing', p); continue
    os.makedirs(os.path.join(OUT, p), exist_ok=True)
    for pose, _ in POSES:
        shutil.copyfile(os.path.join(old, 'A_%s.png' % pose), os.path.join(OUT, p, 'today_%s.png' % pose))
        shutil.copyfile(os.path.join(new, 'D_%s.png' % pose), os.path.join(OUT, p, 'new_%s.png' % pose))
    f32 = lambda q: np.fromfile(q, np.float32).reshape(ph, pw).astype(np.float64)
    relief(f32(os.path.join(Dd, 'dQ.f32')), st).save(os.path.join(OUT, p, 'da3_relief.png'), optimize=True)
    relief(f32(os.path.join(old, 'plate_A.f32')), st).save(os.path.join(OUT, p, 'today_relief.png'), optimize=True)
    relief(f32(os.path.join(FILL, p, 'plateD.f32')), st).save(os.path.join(OUT, p, 'new_relief.png'), optimize=True)
    shutil.copyfile(os.path.join(FILL, p, 'washD.png'), os.path.join(OUT, p, 'new_wash.png'))
    pics.append({'id': p, 'stats': json.load(open(os.path.join(FILL, p, 'stats.json')))})

page = open(os.path.join(H, 'srcfill_compare.html')).read().replace('/*DATA*/null', json.dumps({'pics': pics, 'poses': POSES}))
open(os.path.join(OUT, 'index.html'), 'w').write(page); print('page', os.path.join(OUT, 'index.html'), [q['id'] for q in pics])
