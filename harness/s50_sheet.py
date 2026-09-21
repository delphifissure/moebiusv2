"""Sprint 26 / S50: the contact sheet the DEFAULT is chosen on.

The measurement narrows the candidates; the screen decides between them. This tiles one pose across the arms, plain
render on the top row and the assertion's leak map underneath, so what each tolerance costs is visible rather than
tabulated.

  python3 harness/s50_sheet.py <dir> <pose e.g. 1_0> [out.png]
"""
import sys, os, json
from PIL import Image, ImageDraw

D = sys.argv[1]
POSE = sys.argv[2] if len(sys.argv) > 2 else '1_0'
OUT = sys.argv[3] if len(sys.argv) > 3 else os.path.join(D, 'sheet_' + POSE + '.png')

sw = json.load(open(os.path.join(D, 'sweep.json')))
arms = [a for a in sw['arms'] if os.path.exists(os.path.join(D, a + '_plain_' + POSE + '.png'))]
if not arms:
    print('no frames for pose ' + POSE + ' in ' + D); sys.exit(1)

rows = {(r['arm'], str(r['fx']).replace('-', 'm') + '_' + str(r['fy']).replace('-', 'm')): r for r in sw['rows']}
LAB = 34
first = Image.open(os.path.join(D, arms[0] + '_plain_' + POSE + '.png'))
W, H = first.size
# the leak map is cropped to the content rect, so it is narrower; scale it to the same width for the second row
lk0 = os.path.join(D, 'leak_' + arms[0] + '_plain_' + POSE + '.png')
lw, lh = Image.open(lk0).size if os.path.exists(lk0) else (W, H)
LH = int(round(lh * W / lw))

sheet = Image.new('RGB', (W * len(arms), LAB + H + LAB + LH), (16, 16, 18))
dr = ImageDraw.Draw(sheet)
for i, a in enumerate(arms):
    x = i * W
    r = rows.get((a, POSE))
    ph = ('%.2f%%' % r['placeholder']) if (r and r['placeholder'] == r['placeholder']) else '-'
    cap = '%s   placeholder %s   bounded hole %.3f%%   leak %s' % (a, ph, r['boundedPct'], '/'.join(str(v) for v in r['leak'])) if r else a
    dr.text((x + 6, 9), cap, fill=(235, 235, 240))
    sheet.paste(Image.open(os.path.join(D, a + '_plain_' + POSE + '.png')).convert('RGB'), (x, LAB))
    lk = os.path.join(D, 'leak_' + a + '_plain_' + POSE + '.png')
    if os.path.exists(lk):
        dr.text((x + 6, LAB + H + 9), 'red = leak (our mistake)   blue = genuine   grey = beyond frame', fill=(200, 200, 205))
        sheet.paste(Image.open(lk).convert('RGB').resize((W, LH)), (x, LAB + H + LAB))
    if i: dr.line([(x, 0), (x, sheet.height)], fill=(90, 90, 100), width=1)
sheet.save(OUT)
print(OUT + '  ' + str(sheet.size) + '  arms: ' + ', '.join(arms))
