"""S59 sheet A/B: the blind review page. The same frames as the sheets, in a page the user can flip through on their own
screen (rule 8): per picture, the three arms as L / M / R only, at every pose and as the atlas relief, side by side or
flipped in place, with verdict buttons that build the line sheet_ab_decide.py takes.

Runs only after sheet_ab_compose.py has drawn the key and written its hash (compose.json); it reads the key to name the
files by side and never writes an arm letter anywhere in the output.

  python3 sheet_ab_review.py <out dir>        (SHEET_AB_SHOTS=<dir> points it at a test copy with its own key)
Writes <out>/index.html and <out>/<pic>/<L|M|R>_<pose>.png (pose: yawR42, yawL42, yaw22, pitch30, relief).
"""
import sys, os, json, hashlib, shutil
import numpy as np
from PIL import Image

H = os.path.dirname(os.path.abspath(__file__)); SH = os.environ.get('SHEET_AB_SHOTS') or os.path.join(H, 'shots', 'sheet_ab'); OUT = sys.argv[1]
PICS = ['troll', 'vermeer', 'sunflowers', 'starwatcher']
POSES = [('yawR42', 'yaw +42°'), ('yawL42', 'yaw −42°'), ('relief', 'hole depth'), ('yaw22', 'yaw 22.5°'), ('pitch30', 'pitch +30°')]
keyf = os.path.join(SH, 'key.json'); compf = os.path.join(SH, 'compose.json')
assert os.path.exists(compf), 'run sheet_ab_compose.py first: the key must be drawn and its hash recorded'
digest = hashlib.sha256(open(keyf, 'rb').read()).hexdigest()
assert digest == json.load(open(compf))['sha256'], 'key changed since compose -- the test is void'
key = json.load(open(keyf)); os.makedirs(OUT, exist_ok=True)

def relief(p, arm):                                   # as sheet_ab_compose.relief: one display scale for every arm
    d = os.path.join(SH, p); g = json.load(open(os.path.join(d, 'render.json')))['guard']; pw, ph = g['pw'], g['ph']
    z = np.fromfile(os.path.join(d, 'plate_%s.f32' % arm), np.float32).reshape(ph, pw).astype(np.float64)
    band = np.fromfile(os.path.join(H, 'shots', 'streakclass', 'ab_' + p, 'disocc.u8'), np.uint8).reshape(ph, pw) > 0
    step = json.load(open(os.path.join(H, 'shots', 'streakclass', 'ab_' + p, 'ab_fields', 'stats.json')))['step']
    gy, gx = np.gradient(z / step)
    sh = np.clip(0.5 + 0.08 * (-gx - gy), 0, 1)
    img = np.stack([sh] * 3, -1); img[~band] = img[~band] * 0.35 + 0.1
    return Image.fromarray((img * 255).astype(np.uint8))

pics = []
for p in PICS:
    d = os.path.join(SH, p)
    if not os.path.exists(os.path.join(d, 'render.json')): print('missing', p); continue
    os.makedirs(os.path.join(OUT, p), exist_ok=True); W = H0 = None
    for s in 'LMR':
        arm = key[p][s]
        for pose, _ in POSES:
            dst = os.path.join(OUT, p, '%s_%s.png' % (s, pose))
            if pose == 'relief':
                relief(p, arm).save(dst, optimize=True)
            else:
                shutil.copyfile(os.path.join(d, '%s_%s.png' % (arm, pose)), dst)
                if W is None: W, H0 = Image.open(dst).size
    pics.append({'id': p, 'w': W, 'h': H0})

page = open(os.path.join(H, 'sheet_ab_review.html')).read()
page = page.replace('/*DATA*/null', json.dumps({'pics': pics, 'poses': POSES, 'sha': digest}))
open(os.path.join(OUT, 'index.html'), 'w').write(page)
print('review page', os.path.join(OUT, 'index.html'), 'key sha256', digest, 'pictures', [q['id'] for q in pics])
