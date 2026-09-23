"""S59 sheet A/B: blind sheets for the user. Per picture the three arms are shown as L / M / R in a random order drawn
here (os.urandom), written to shots/sheet_ab/key.json; its SHA-256 goes in the write-up before the frames are sent and
the key is opened only after the verdicts (S37 Phase C, second edition).

  python3 sheet_ab_compose.py <out dir for the sheets>
Per picture: <pic>_decide.png (rows: yaw +42, yaw -42, the atlas depth as relief) and <pic>_context.png (yaw 22.5,
pitch 30). Also prints the rule-7 guard: mean |difference| between the arms' decision frames.
"""
import sys, os, json, hashlib, random
import numpy as np
from PIL import Image, ImageDraw, ImageFont

H = os.path.dirname(os.path.abspath(__file__)); SH = os.path.join(H, 'shots', 'sheet_ab'); OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
PICS = ['troll', 'vermeer', 'sunflowers', 'starwatcher']
keyf = os.path.join(SH, 'key.json')
if os.path.exists(keyf):
    key = json.load(open(keyf))          # never redraw once drawn
else:
    rng = random.Random(int.from_bytes(os.urandom(16), 'big'))
    key = {}
    for p in PICS:
        arms = ['A', 'B', 'C']; rng.shuffle(arms); key[p] = dict(zip(['L', 'M', 'R'], arms))
    json.dump(key, open(keyf, 'w'), indent=1, sort_keys=True)
digest = hashlib.sha256(open(keyf, 'rb').read()).hexdigest()
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 28); small = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 20)
except Exception:
    font = small = ImageFont.load_default()

def relief(p, arm):
    d = os.path.join(SH, p); g = json.load(open(os.path.join(d, 'render.json')))['guard']; pw, ph = g['pw'], g['ph']
    z = np.fromfile(os.path.join(d, 'plate_%s.f32' % arm), np.float32).reshape(ph, pw).astype(np.float64)
    band = np.fromfile(os.path.join(H, 'shots', 'streakclass', 'ab_' + p, 'disocc.u8'), np.uint8).reshape(ph, pw) > 0
    step = json.load(open(os.path.join(H, 'shots', 'streakclass', 'ab_' + p, 'ab_fields', 'stats.json')))['step']
    gy, gx = np.gradient(z / step)                   # slope in visible steps per texel
    sh = np.clip(0.5 + 0.08 * (-gx - gy), 0, 1)       # oblique light; one display scale for every arm
    img = np.stack([sh] * 3, -1)
    img[~band] = img[~band] * 0.35 + 0.1              # the band at full contrast, the rest dimmed
    return Image.fromarray((img * 255).astype(np.uint8))

def fit(im, w):
    return im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)

guard = {}
for p in PICS:
    d = os.path.join(SH, p)
    if not os.path.exists(os.path.join(d, 'render.json')):
        print('missing', p); continue
    k = key[p]
    def frame(arm, pose): return Image.open(os.path.join(d, '%s_%s.png' % (arm, pose))).convert('RGB')
    W = frame('A', 'yawR42').width
    fr = {a: np.asarray(frame(a, 'yawR42'), np.float64) for a in 'ABC'}
    guard[p] = {'%s-%s' % (a, b): float(np.abs(fr[a] - fr[b]).mean()) for a, b in (('A', 'B'), ('A', 'C'), ('B', 'C'))}
    for name, rows in (('decide', ['yawR42', 'yawL42', 'relief']), ('context', ['yaw22', 'pitch30'])):
        tiles = []
        for r in rows:
            row = []
            for s in 'LMR':
                im = fit(relief(p, k[s]), W) if r == 'relief' else frame(k[s], r)
                row.append(im)
            tiles.append((r, row))
        hh = [max(t.height for t in row) for _, row in tiles]
        top = 50; lab = 34
        sheet = Image.new('RGB', (3 * W + 40, top + sum(h + lab for h in hh) + 10), (24, 24, 24)); dr = ImageDraw.Draw(sheet)
        dr.text((20, 10), '%s   (%s)' % (p, 'decide: which is cleanest?' if name == 'decide' else 'context'), fill=(230, 230, 230), font=font)
        y = top
        poselabel = {'yawR42': 'yaw +42°', 'yawL42': 'yaw -42°', 'relief': 'the atlas depth (relief; hole bright, rest dimmed)', 'yaw22': 'yaw 22.5°', 'pitch30': 'pitch +30°'}
        for (r, row), h in zip(tiles, hh):
            dr.text((20, y + 4), poselabel[r], fill=(200, 200, 200), font=small)
            for i, (s, im) in enumerate(zip('LMR', row)):
                x = 10 + i * (W + 10); sheet.paste(im, (x, y + lab)); dr.text((x + 8, y + lab + 6), s, fill=(255, 220, 0), font=font)
            y += h + lab
        sheet.save(os.path.join(OUT, '%s_%s.png' % (p, name)), optimize=True)
print('key sha256', digest)
print('rule-7 guard, mean |frame difference| at yaw +42 (0-255):', json.dumps(guard))
for d in (OUT, SH):                  # SH: where sheet_ab_decide.py and sheet_ab_review.py check the key against it
    json.dump({'sha256': digest, 'guard': guard}, open(os.path.join(d, 'compose.json'), 'w'), indent=1)
