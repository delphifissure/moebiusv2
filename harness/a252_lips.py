#!/usr/bin/env python3
"""A252 lip tables: where does the band's depth come from, and is it deeper than the surfaces beside the gap?
Reads the a242_ghost raw exports (source rows) for one scene/arm and prints, per class and per region:
  n, excess = lipDeep - plate (in tear steps; > 0.5 = the plate is deeper than the DEEPER lip by more than half a cliff),
  split into observed-wrong (obsDepth itself below lipDeep), solve (prov 2/3, no observation), post-field (field ok, plate sunk).
Writes <arm>_a252_excess.png (blue = plate deeper than the deeper lip, scaled to 2 steps) and <arm>_a252_prov.png.
Usage: a252_lips.py <tag> <arm> [regions.json]   (regions: {"name": [x0, x1, y0, y1], ...} in source pixels)"""
import sys, os, json
import numpy as np
from PIL import Image
tag, arm = sys.argv[1], sys.argv[2]
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'shots', 'a242', tag)
A = os.path.join(D, arm + '_')
g = json.load(open(A + 'geostats.json')); pw, ph = g['pw'], g['ph']; N = pw * ph
STEP = 0.06   # fgTearStep (the app's cliff step; printed excesses are in these units)
def f32(n): p = A + n + '.bin'; return np.fromfile(p, dtype=np.float32).reshape(ph, pw) if os.path.exists(p) else None
def u8(n): p = A + n + '.bin'; return np.fromfile(p, dtype=np.uint8)[:N].reshape(ph, pw) if os.path.exists(p) else None
band = u8('band').astype(bool); dQ = f32('dQ'); plate = f32('plate'); field = f32('field'); obsD = f32('obsDepth')
obsC = np.fromfile(A + 'obsCount.bin', dtype=np.uint32).reshape(ph, pw)
lipDeep = f32('lipDeep'); lipNear = f32('lipNear'); spread = f32('lipSpread'); ramp = f32('rampDrop'); cross = f32('crossFrac'); prov = u8('prov'); cls = u8('cls'); post = f32('post')
if lipDeep is None: sys.exit('no A252 export for this arm (re-run a242_ghost.js on the current app)')
regions = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else {}
CLS = {1: 'continuous', 2: 'step', 7: 'extent-step', 3: 'single-lip', 4: 'fallback', 5: 'pinhole', 6: 'dilation'}
obs = obsC > 0
exc = np.where(obs, (lipDeep - plate) / STEP, np.nan)           # + = plate deeper than the deeper lip
excF = np.where(obs, (lipDeep - field) / STEP, np.nan)
obsBad = obs & (obsD < lipDeep - 0.5 * STEP)                     # the observation itself is below the deeper lip (ramp walk / walk past)
def table(mask, label):
    n = int((band & mask).sum());
    if n == 0: print(f'  {label:<26} n 0'); return
    rows = []
    for c in sorted(CLS):
        m = band & mask & (cls == c); nc = int(m.sum())
        if nc == 0: continue
        mo = m & obs
        e = exc[mo]; bad = int((e > 0.5).sum()) if mo.any() else 0
        ob = int((mo & obsBad).sum()); pf = int((mo & (excF <= 0.5) & (exc > 0.5)).sum()) if mo.any() else 0
        rd = float(np.median(ramp[mo]) / STEP) if mo.any() else 0; cr = float(np.mean(cross[mo])) if mo.any() else 0
        pd = float(np.median(post[m]) / STEP) if m.any() else 0
        rows.append(f'    {CLS[c]:<11} n {nc:>8}  obs {int(mo.sum()):>8}  plate>deeperLip {bad:>7} ({100*bad/max(1,mo.sum()):4.1f}%)  = obs-wrong {ob:>6} + post-field {pf:>6} + rest {bad-ob-pf:>6}   medExcess {np.nanmedian(e) if mo.any() else 0:+.2f} st  rampDrop {rd:.2f} st  crossed {cr:.2f}  postDrop {pd:+.2f} st')
    print(f'  {label:<26} n {n}'); print('\n'.join(rows))
print(f'{tag} [{arm}] plate {pw}x{ph}; band {int(band.sum())}; observed {int((band&obs).sum())}; classes ' + ', '.join(f'{CLS[c]} {int((band&(cls==c)).sum())}' for c in sorted(CLS)))
print('  provenance: ' + ', '.join(f'{k} {int((band&(prov==v)).sum())}' for v, k in [(1,'observed'),(2,'solve'),(3,'clamped'),(5,'post-field-deeper')]))
table(np.ones_like(band), 'ALL')
for name, (x0, x1, y0, y1) in regions.items():
    m = np.zeros_like(band); m[y0:y1, x0:x1] = True; table(m, name)
# PNGs
src = (dQ * 255).astype(np.uint8)
im = np.stack([src // 3] * 3, -1).astype(np.int32)
e = np.nan_to_num(exc, nan=0.0); pos = band & obs & (e > 0); neg = band & obs & (e < -0.25)
im[pos] = np.stack([np.zeros(pos.sum()), np.zeros(pos.sum()), np.clip(90 + 80 * e[pos], 0, 255)], -1)
im[neg] = [200, 120, 0]
im[band & ~obs] = [70, 70, 70]
Image.fromarray(np.clip(im, 0, 255).astype(np.uint8)).save(A + 'a252_excess.png')
PC = {0: (0, 0, 0), 1: (60, 200, 80), 2: (60, 120, 230), 7: (230, 120, 40), 3: (200, 200, 60), 4: (150, 150, 150), 5: (230, 60, 200), 6: (90, 90, 90)}
pc = np.zeros((ph, pw, 3), np.uint8)
for c, col in PC.items(): pc[cls == c] = col
pc[~band] = (src[~band] // 4)[:, None]
pv = np.zeros((ph, pw, 3), np.uint8); pv[~band] = (src[~band] // 4)[:, None]
for v, col in {1: (60, 200, 80), 2: (230, 160, 40), 3: (200, 60, 60), 5: (60, 120, 230)}.items(): pv[band & (prov == v)] = col
Image.fromarray(np.concatenate([pc, pv], 1)).save(A + 'a252_prov.png')
print('  -> ' + A + 'a252_excess.png (blue = plate deeper than the deeper lip, orange = nearer), ' + A + 'a252_prov.png (left: class green continuous / blue step / yellow single / grey fallback / magenta pinhole; right: provenance green observed / orange solve / red clamped / blue post-field-deeper)')
