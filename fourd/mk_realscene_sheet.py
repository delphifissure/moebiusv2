#!/usr/bin/env python3
"""Compose the 16-test real-scene contact sheet from tiles + results.json."""
import json, os
from PIL import Image, ImageDraw

D = os.path.join(os.path.dirname(__file__), 'shots', 'realscenes')
res = {r['id']: r for r in json.load(open(os.path.join(D, 'results.json')))}
ids = [f'T{i:02d}' for i in range(1, 17)]
TW, TH, LB = 320, 240, 34
cols, rows = 4, 4
sheet = Image.new('RGB', (cols * TW + (cols + 1) * 6, rows * (TH + LB) + (rows + 1) * 6), (14, 16, 20))
d = ImageDraw.Draw(sheet)
for k, tid in enumerate(ids):
    x = 6 + (k % cols) * (TW + 6)
    y = 6 + (k // cols) * (TH + LB + 6)
    r = res.get(tid, {})
    p = os.path.join(D, tid + '.png')
    if os.path.exists(p):
        im = Image.open(p).convert('RGB')
        im.thumbnail((TW, TH))
        sheet.paste(im, (x + (TW - im.size[0]) // 2, y + (TH - im.size[1]) // 2))
    else:
        d.rectangle([x, y, x + TW, y + TH], outline=(60, 60, 70))
        d.text((x + 8, y + TH // 2), '(comparison test — no tile)', fill=(120, 130, 150))
    ok = r.get('pass', False)
    d.rectangle([x, y + TH, x + TW, y + TH + LB], fill=(20, 46, 26) if ok else (52, 20, 20))
    line1 = f"{tid} {'PASS' if ok else 'FAIL'} - {r.get('label', '?')}"
    parts = []
    if 'n' in r: parts.append(f"{r['n']:,} splats")
    if 'coverPct' in r: parts.append(f"cover {r['coverPct']}%")
    if 'parallaxPx' in r: parts.append(f"parallax {r['parallaxPx']}px")
    if not parts and 'note' in r: parts.append(r['note'][:52])
    d.text((x + 5, y + TH + 3), line1[:56], fill=(220, 240, 225) if ok else (255, 190, 190))
    d.text((x + 5, y + TH + 17), ' · '.join(parts)[:58], fill=(150, 170, 160))
sheet.save(os.path.join(D, 'contact_sheet.png'))
print('sheet ->', os.path.join(D, 'contact_sheet.png'))
