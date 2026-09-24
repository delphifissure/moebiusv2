"""The atlas linter: is this SD bundle clean enough to hand to diffusion? (user, 2026-09-23: "clean holes for later
inpainting via diffusion -- plausible but clean depth, plausible wash for the colour ... we can't have a noisy atlas".)

Reads a plane bundle (the app's exportSDBundle zip) and reports the four ways an atlas is noisy, each in the atlas's own
units (visible steps 1/k for depth, texels for masks, the wash's own gradients for colour). ADVISORY (A126): the user's
screen decides; this makes the noise countable before anything goes to SD, and comparable between bundles.

  MASK       inpaint-mask components by size, specks of <= 4 / <= 16 texels, enclosed pinholes (and, where the bundle
             carries plane_mask_inpaint_raw.png, how many the S61 section 10 rule joined)
  SPIKES     pinhole texels (enclosed by the mask) whose plate stands more than two visible steps nearer than the plate
             around them: the occluder's own depth left standing inside a filled hole; and clones in the mask (plate
             not behind the source by two steps, S35 section 47)
  WALLS      adjacent mask texels whose plate depth differs by more than one visible step: count, summed length in steps,
             and per 1 000 mask texels (the combing is this)
  LAYERS     where plate 2 exists: walls split into layer seams and walls inside a layer; plate 2's own specks and
             walls; ORDER violations (plate 2 not behind plate 1 by two visible steps)
  STREAKS    inside the mask, the wash's mean |row-to-row| against |column-to-column| luminance change: a per-line wash
             streaks along lines, so the two are unequal; a 2-D wash has them near equal (ratio ~1)

  python3 atlas_lint.py <bundle.zip> [<bundle.zip> ...]
"""
import sys, io, json, zipfile
import numpy as np
from PIL import Image
from scipy.ndimage import label, binary_fill_holes

def load(z, name, mode=None):
    if name not in z.namelist(): return None
    im = Image.open(io.BytesIO(z.read(name)))
    a = np.asarray(im.convert(mode) if mode else im)
    return a

def lint(path):
    z = zipfile.ZipFile(path); meta = json.loads(z.read('meta.json')) if 'meta.json' in z.namelist() else {}
    mp = meta.get('plane', {}) if isinstance(meta, dict) else {}
    m = load(z, 'plane_mask_inpaint.png', 'L'); mraw = load(z, 'plane_mask_inpaint_raw.png', 'L')
    src = load(z, 'plane_source_depth16.png'); plate = load(z, 'plane_plate_depth16.png'); col = load(z, 'plane_plate_color.png', 'RGB')
    if m is None or src is None or plate is None: return {'bundle': path, 'error': 'not a plane bundle (needs plane_mask_inpaint, plane_source_depth16, plane_plate_depth16)'}
    mask = m > 127; ph, pw = mask.shape
    sc = lambda a: a.astype(np.float64) / (65535.0 if a.max() > 255 else 255.0)
    dQ, pl = sc(src), sc(plate)
    # the visible step 1/k from the bundle's own meta (k = the fade-end LUT's larger end), else its effective quantum
    dm = mp.get('depth', {}) if isinstance(mp, dict) else {}
    step = dm.get('visibleStep') or dm.get('effectiveQuantum'); stepSrc = 'meta.plane.depth.visibleStep' if dm.get('visibleStep') else 'meta.plane.depth.effectiveQuantum'
    if not step: step, stepSrc = 1 / 65535, 'none in meta: the 16-bit grid (walls will over-count)'
    step = float(step)
    out = {'bundle': path, 'size': [pw, ph], 'maskTexels': int(mask.sum()), 'step': step, 'stepSource': stepSrc}
    # MASK
    lab, n = label(mask); sz = np.bincount(lab.ravel())[1:] if n else np.array([])
    holes = binary_fill_holes(mask) & ~mask; hl, hn = label(holes)
    out['mask'] = {'components': int(n), 'specks<=4': int((sz <= 4).sum()), 'specks<=16': int((sz <= 16).sum()), 'pinholes': int(hn), 'pinholeTexels': int(holes.sum())}
    if mraw is not None:
        raw = mraw > 127; rh = binary_fill_holes(raw) & ~raw; _, rn = label(rh)
        out['mask']['pinholesBeforeRule'] = int(rn); out['mask']['texelsAddedByRule'] = int((mask & ~raw).sum())
    # SPIKES: a pinhole texel (enclosed by the mask) whose plate stands more than two visible steps nearer than the plate
    # around it -- the occluder's own depth left standing inside a filled hole; and CLONES: mask texels whose plate is
    # not behind the source by two steps (S35 section 47)
    from scipy.ndimage import binary_dilation
    nSp, nSpH = 0, 0
    for i in range(1, hn + 1):
        hmask = hl == i; ring = binary_dilation(hmask) & mask
        if not ring.any(): continue
        sp = hmask & (pl > np.median(pl[ring]) + 2 * step); c = int(sp.sum())
        if c: nSp += c; nSpH += 1
    clone = mask & (pl >= dQ - 2 * step)
    out['spikes'] = {'texels': nSp, 'pinholesWithSpikes': nSpH, 'clonesInMask': int(clone.sum())}
    # WALLS
    nW, lW = 0, 0.0
    for a, b, mm in ((pl[1:, :], pl[:-1, :], mask[1:, :] & mask[:-1, :]), (pl[:, 1:], pl[:, :-1], mask[:, 1:] & mask[:, :-1])):
        d = np.abs(a - b)[mm] / step; w = d > 1; nW += int(w.sum()); lW += float(d[w].sum())
    out['walls'] = {'pairs': nW, 'lengthSteps': round(lW), 'per1000MaskTexels': round(1000 * nW / max(1, mask.sum()), 1)}
    # LAYERS (S62 §12): where the bundle carries plate 2, a texel of plate 1 that has a plate 2 behind it holds a middle
    # surface (or a nearer part) -- the seam between such texels and the rest of plate 1 is a layer boundary by design, not
    # combing. So the walls are split: SEAMS (the two sides differ in having a plate 2) and INSIDE (both sides the same).
    # Plate 2 is linted on its own mask, and ORDER counts plate-2 texels not behind plate 1 by two visible steps (the rule
    # that made them; any such texel crosses plate 1 on screen).
    m2 = load(z, 'plane_plate2_mask.png', 'L'); p2 = load(z, 'plane_plate2_depth16.png')
    if m2 is not None and p2 is not None:
        l2 = m2 > 127; pl2 = sc(p2); nS = nI = 0
        for a, b, mm, la, lb in ((pl[1:, :], pl[:-1, :], mask[1:, :] & mask[:-1, :], l2[1:, :], l2[:-1, :]), (pl[:, 1:], pl[:, :-1], mask[:, 1:] & mask[:, :-1], l2[:, 1:], l2[:, :-1])):
            w = (np.abs(a - b) / step > 1) & mm; nS += int((w & (la != lb)).sum()); nI += int((w & (la == lb)).sum())
        n2 = 0
        for a, b, mm in ((pl2[1:, :], pl2[:-1, :], l2[1:, :] & l2[:-1, :]), (pl2[:, 1:], pl2[:, :-1], l2[:, 1:] & l2[:, :-1])): n2 += int(((np.abs(a - b) / step > 1) & mm).sum())
        lab2, k2 = label(l2); sz2 = np.bincount(lab2.ravel())[1:] if k2 else np.array([])
        out['layers'] = {'plate2Texels': int(l2.sum()), 'plate2Components': int(k2), 'plate2Specks<=4': int((sz2 <= 4).sum()),
                         'wallsSeamsPer1000': round(1000 * nS / max(1, mask.sum()), 1), 'wallsInsidePer1000': round(1000 * nI / max(1, mask.sum()), 1),
                         'plate2WallsPer1000': round(1000 * n2 / max(1, l2.sum()), 1), 'orderViolations': int((l2 & ~(pl2 < pl - 2 * step)).sum())}
    # STREAKS
    if col is not None:
        y = col.astype(np.float64).mean(-1)
        mv = mask[1:, :] & mask[:-1, :]; mh = mask[:, 1:] & mask[:, :-1]
        dv = np.abs(np.diff(y, axis=0))[mv].mean() if mv.any() else 0.0; dh = np.abs(np.diff(y, axis=1))[mh].mean() if mh.any() else 0.0
        out['streaks'] = {'rowToRow': round(float(dv), 3), 'colToCol': round(float(dh), 3), 'anisotropy': round(float(max(dv, dh) / max(1e-9, min(dv, dh))), 2)}
    return out

if __name__ == '__main__':
    for p in sys.argv[1:]:
        r = lint(p); print(json.dumps(r, indent=1))
