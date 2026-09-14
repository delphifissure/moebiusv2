#!/usr/bin/env python3
"""S27 sheet + numbers for one objlayers.js output directory: per pose a row of [truth view | none | cont | truth-depth]
and their |colour error| maps against the truth view (app frame resampled to the plate grid; the registration is checked at
the rest pose and printed: a registration error would show as a large rest error on every arm alike).
Numbers per arm and pose: uncovered pixels (alpha 0) inside the picture rectangle, mean |RGB error| vs truth over the
in-frame pixels, and the fraction of pixels whose error exceeds 64 (a 'wrong content' area).
  python3 harness/objl_sheet.py harness/shots/objlayers/S2
"""
import sys, os, json
import numpy as np
from PIL import Image, ImageDraw
d = sys.argv[1]; R = json.load(open(os.path.join(d, 'results.json'))); pw, ph = R['bake']['pw'], R['bake']['ph']
arms = [a for a in ('none', 'cont', 'truth') if a in R['results']]
def load(f): return np.array(Image.open(f).convert('RGBA'))
rows = []; table = []
first = load(os.path.join(d, R['results'][arms[0]]['shots'][str(R['poses'][0][0]) + ':' + str(R['poses'][0][1])]))
al0 = first[..., 3] > 0; cols = np.nonzero(al0.mean(0) > 0.5)[0]; rws = np.nonzero(al0.mean(1) > 0.5)[0]
X0, X1, Y0, Y1 = cols.min(), cols.max() + 1, rws.min(), rws.max() + 1
print(f'picture rect x {X0}-{X1} y {Y0}-{Y1} of {first.shape[1]}x{first.shape[0]}')
for fx, fy in R['poses']:
    key = f'{fx}:{fy}'; tv = os.path.join(d, 'tv_' + str(fx).replace('-', 'm') + '_' + str(fy).replace('-', 'm') + '.png')
    truth = np.array(Image.open(tv).convert('RGB')).astype(float) if os.path.exists(tv) else None
    tiles = [(truth.astype(np.uint8) if truth is not None else np.zeros((ph, pw, 3), np.uint8), f'truth view fx {fx} fy {fy}')]
    base = None
    for a in arms:
        im = load(os.path.join(d, R['results'][a]['shots'][key])); crop = im[Y0:Y1, X0:X1]
        hole = int((crop[..., 3] == 0).sum())
        app = np.array(Image.fromarray(crop).convert('RGB').resize((pw, ph), Image.BILINEAR)).astype(float)
        alpha = np.array(Image.fromarray(crop[..., 3]).resize((pw, ph), Image.NEAREST)) > 0
        if truth is not None:
            err = np.abs(app - truth).mean(-1); m = alpha
            me = float(err[m].mean()) if m.any() else float('nan'); bad = float((err[m] > 64).mean()) if m.any() else float('nan')
        else: err = np.zeros((ph, pw)); me = bad = float('nan')
        row = {'pose': key, 'arm': a, 'holes': hole, 'meanErr': me, 'badFrac': bad}
        # the layer's own effect: the pixels this arm changed against the 'none' arm, and the error there before / after
        if a == 'none': base = (app, err)
        elif base is not None:
            ch = np.abs(app - base[0]).max(-1) > 8; row['changedPx'] = int(ch.sum())
            if truth is not None and ch.any(): row['errNoneOnChanged'] = float(base[1][ch].mean()); row['errArmOnChanged'] = float(err[ch].mean())
        table.append(row)
        lab = f'{a}: holes {hole}, mean |err| {me:.1f}, >64: {100*bad:.1f}%'
        if 'changedPx' in row: lab += f" | changed {row['changedPx']} px: err {row.get('errNoneOnChanged', float('nan')):.0f} -> {row.get('errArmOnChanged', float('nan')):.0f}"
        tiles.append((app.astype(np.uint8), lab))
        e8 = np.clip(err * 2, 0, 255).astype(np.uint8); em = np.stack([e8, 255 - e8, np.zeros_like(e8)], -1); em[~alpha] = (40, 40, 200)
        tiles.append((em, f'|err| {a} (blue = uncovered)'))
    rows.append(tiles)
Wt, Ht = pw // 2, ph // 2; pad = 6; ncol = max(len(r) for r in rows)
sh = Image.new('RGB', (ncol * (Wt + pad) + pad, 30 + len(rows) * (Ht + 22 + pad)), (20, 20, 20)); dr = ImageDraw.Draw(sh)
dr.text((pad, 6), f"{R['scene']}  object layers (S27): truth view vs the app without layers / with the truth's completed object layers at the front-continued depth / with the truth's depth supplied", fill=(255, 255, 255))
for r, tiles in enumerate(rows):
    for c, (im, txt) in enumerate(tiles):
        x = pad + c * (Wt + pad); y = 30 + r * (Ht + 22 + pad); dr.text((x, y), txt[:96], fill=(255, 230, 120)); sh.paste(Image.fromarray(im).resize((Wt, Ht), Image.NEAREST), (x, y + 14))
sh.save(os.path.join(d, 'sheet.png')); json.dump(table, open(os.path.join(d, 'table.json'), 'w'), indent=1)
for t in table: print(t)
print('wrote', os.path.join(d, 'sheet.png'))
