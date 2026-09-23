"""Before / after page for the source-anchored hole (S62): per picture, today's app (the per-line law, S59 arm A) next to
srcfill at the S59 poses, and the plate depth as a shaded relief next to DA3's own map. Not blind: the rule is withdrawn
(S62 section 1); this page is for looking.

  python3 srcfill_compare.py <srcfill out dir (per-picture plateD.f32)> <page out dir>
  LIVE=1 python3 srcfill_compare.py - <page out dir>     (the app's own run: shots/srchole_live/<picture>/, srchole_live.js)
"""
import sys, os, json, shutil
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ramp_collapse import visible_step

H = os.path.dirname(os.path.abspath(__file__)); FILL, OUT = sys.argv[1], sys.argv[2]; os.makedirs(OUT, exist_ok=True)
PICS = ['troll', 'vermeer', 'sunflowers', 'starwatcher']
POSES = [('yawR42', 'yaw +42°'), ('yawL42', 'yaw −42°'), ('yaw22', 'yaw 22.5°'), ('pitch30', 'pitch +30°')]

def relief(z, step, gain):                            # oblique light, one gain per picture (all its panels alike)
    gy, gx = np.gradient(z / step); return Image.fromarray((np.clip(0.5 + gain * (-gx - gy), 0, 1) * 255).astype(np.uint8))

pics = []
for p in PICS:
    Dd = os.path.join(H, 'shots', 'streakclass', 'ab_' + p); m = json.load(open(os.path.join(Dd, 'meta.json'))); pw, ph = m['pw'], m['ph']; st = visible_step(pw, ph, m['outer'], m['inner'], m['D'])
    LIVE = os.environ.get('LIVE') == '1'
    new = os.path.join(H, 'shots', 'srchole_live' if LIVE else 'srcfill', p); old = os.path.join(H, 'shots', 'sheet_ab', p)
    if not os.path.exists(os.path.join(new, 'live.json' if LIVE else 'render.json')): print('missing', p); continue
    os.makedirs(os.path.join(OUT, p), exist_ok=True)
    for pose, _ in POSES:
        shutil.copyfile(os.path.join(old, 'A_%s.png' % pose), os.path.join(OUT, p, 'today_%s.png' % pose))
        shutil.copyfile(os.path.join(new, ('S_%s.png' if LIVE else 'D_%s.png') % pose), os.path.join(OUT, p, 'new_%s.png' % pose))
    f32 = lambda q: np.fromfile(q, np.float32).reshape(ph, pw).astype(np.float64)
    src = f32(os.path.join(Dd, 'dQ.f32')); gy, gx = np.gradient(src / st)
    # the S59 page's gain (0.08 per step) saturates on steep receding ground (sunflowers, starwatcher); here the gain puts
    # DA3's own 95th-percentile slope at a quarter of the grey range, so every picture's ground reads
    gain = 0.25 / max(1e-9, float(np.percentile(np.abs(gx + gy), 95)))
    relief(src, st, gain).save(os.path.join(OUT, p, 'da3_relief.png'), optimize=True)
    relief(f32(os.path.join(old, 'plate_A.f32')), st, gain).save(os.path.join(OUT, p, 'today_relief.png'), optimize=True)
    relief(f32(os.path.join(new, 'plate.f32') if LIVE else os.path.join(FILL, p, 'plateD.f32')), st, gain).save(os.path.join(OUT, p, 'new_relief.png'), optimize=True)
    shutil.copyfile(os.path.join(new, 'wash.png') if LIVE else os.path.join(FILL, p, 'washD.png'), os.path.join(OUT, p, 'new_wash.png'))
    stt = json.load(open(os.path.join(new, 'live.json')))['stats'] if LIVE else json.load(open(os.path.join(FILL, p, 'stats.json')))
    if LIVE: stt = dict(stt, reachMaxPx=None, kinksInHole=None)
    pics.append({'id': p, 'stats': stt})

page = open(os.path.join(H, 'srcfill_compare.html')).read().replace('/*DATA*/null', json.dumps({'pics': pics, 'poses': POSES}))
open(os.path.join(OUT, 'index.html'), 'w').write(page); print('page', os.path.join(OUT, 'index.html'), [q['id'] for q in pics])
