"""Sprint 28 / S52 — ONE REAL INPAINT, on the bundle the app exports.

S47 measured that two thirds of what reads as messy is invented colour, and S50's class decomposition put ~16 % of the
actual picture at 45 degrees in the band. S51 then showed a 21 % improvement in the plate's geometry is invisible
underneath that wash. So the band's COLOUR is the thing, and this is the first time the project has put real content in
it rather than a rim-window mean.

THE ARMS ARE PACO's OWN TAXONOMY, ON OUR TASK. PACO (2406.07706, read first-hand for the R7 errata) tried three
strategies with the ground-truth amodal mask and reported all three failing:

  (a) inpaint the occluded region alone          -> "ambiguity, regarding which object the missing area belongs to";
                                                    the model completes the OCCLUDER
  (b) replace the occluder with uniform grey     -> "partly influenced by the replacement color"
  (c) extend the mask over the whole occluder    -> "may create unexpected new objects"

and then used (c) for every comparison in their supplementary, "as our empirical findings indicated its superiority
over the other two strategies in most scenarios". R7 reported the three as equally failed and omitted that.

THE TASK MISMATCH MATTERS AND RUNS OUR WAY. Every PACO failure is about completing the OCCLUDEE -- the album behind the
teddy bear. Our band is the BACKGROUND BEHIND the occluder, so (c) is literally our task and "creates unexpected new
objects" is their objection from wanting the album back. For a background band, plausible new background is the goal.

  A  band mask on the occluder-removed picture   -- what Sprint 25 built (harmonic continuation, not grey: better
                                                    than (b) and supported by PACO's own finding about the fill colour)
  B  band + occluder mask, occluder-removed      -- PACO (c), the strategy their evidence prefers
  C  band mask on the RAW plate colour           -- PACO (a), the control that should complete the occluder

Inpainter: LaMa (big-lama), feed-forward, CPU. It is one of the baselines PACO compares against (Suvorov et al. 2022),
which makes the comparison to their figure direct rather than analogical.

--- R8 item 5 (2026-09-22): THE OCCLUDER CHANNEL IS NOT POSSIBLE WITH THIS INPAINTER, AND THAT IS A MEASUREMENT ---

R8's action list asked for plane_object_ids to be fed to the inpainter AS ITS OWN CHANNEL, on four papers' evidence
that occluder information helps. It cannot be done with LaMa, and the reason is checked rather than assumed:

    >>> torch.load('big-lama.pt').named_parameters() -> first param
    model.generator.model.1.ffc.convl2l.weight   (64, 4, 7, 7)

Four input channels: RGB plus the mask. The checkpoint is a frozen TorchScript archive, so the first convolution
cannot even be widened in place, let alone trained. A fifth channel needs a different inpainter and a training run,
and this environment has no GPU. So the honest position is: THE CHANNEL IS NOT TESTED HERE, and nothing below should
be read as testing it.

What a fixed 4-channel model CAN be given is a better-shaped mask, and that is the other half of item 5. Arm B is
already occluder-informed in the only way the interface allows -- the occluder's footprint enters the mask, so the
model neither copies from it nor has to guess which side of the silhouette it is on. The new arms vary the one
remaining free parameter, HOW MUCH OF THE RIM IS WITHHELD AS CONTEXT:

  D  band dilated 4 px      -- the band's outer rim is where the wash is streakiest, and LaMa's context is the
  E  band dilated 12 px        pixels just outside the mask. Dilating stops the model conditioning on our own
  F  (band + occluder) +4      artefact. Against that: a bigger hole is a harder inpaint and more room to invent.

  python3 harness/s52_inpaint.py <bundle.zip> <outdir>
"""
import sys, os, io, json, zipfile, time
import numpy as np
from PIL import Image

BUNDLE = sys.argv[1] if len(sys.argv) > 1 else 'harness/shots/s45_rt/troll/bundle.zip'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'harness/shots/s52_inpaint/troll'
os.makedirs(OUT, exist_ok=True)

z = zipfile.ZipFile(BUNDLE)
have = set(z.namelist())
meta = json.loads(z.read('meta.json'))
pw, ph = meta['plane']['nativeRes']
print('bundle %s  plate %dx%d' % (BUNDLE, pw, ph))


def rd(name, mode='L'):
    if name not in have:
        return None
    return np.array(Image.open(io.BytesIO(z.read(name))).convert(mode))


plate = rd('plane_plate_color.png', 'RGB')
occrm = rd('plane_color_occluder_removed.png', 'RGB')
mband = rd('plane_mask_inpaint.png')
ctx = rd('plane_mask_context.png')
objids = rd('plane_object_ids.png')
for nm, a in (('plane_plate_color', plate), ('plane_color_occluder_removed', occrm),
              ('plane_mask_inpaint', mband), ('plane_mask_context', ctx), ('plane_object_ids', objids)):
    print('  %-34s %s' % (nm, 'missing' if a is None else str(a.shape)))
if plate is None or mband is None:
    print('FATAL: the bundle lacks the plane set'); sys.exit(1)

band = (mband > 127).astype(np.uint8)
occ = (objids > 0).astype(np.uint8) if objids is not None else np.zeros_like(band)
print('  band %d px (%.2f%%), occluder %d px (%.2f%%)' %
      (band.sum(), 100 * band.mean(), occ.sum(), 100 * occ.mean()))

from simple_lama_inpainting import SimpleLama
t0 = time.time(); lama = SimpleLama(device='cpu'); print('LaMa loaded %.1fs' % (time.time() - t0))

# The interface check behind the docstring's claim: run it, do not trust the note.
try:
    import torch as _t
    _sd = _t.jit.load('/root/.cache/torch/hub/checkpoints/big-lama.pt', map_location='cpu')
    _n, _p = next(iter(_sd.named_parameters()))
    print('LaMa first conv %s %s -> %d input channels (RGB+mask). An occluder channel needs a different model.'
          % (_n, tuple(_p.shape), tuple(_p.shape)[1]))
except Exception as _e:
    print('could not read the LaMa input width: %s' % _e)


def dilate(m, r):
    """Binary dilation by a square of radius r, via a separable running max. No scipy dependency."""
    a = m.astype(bool)
    for ax in (0, 1):
        b = a.copy()
        for k in range(1, r + 1):
            b |= np.roll(a, k, axis=ax) | np.roll(a, -k, axis=ax)
        a = b
    return a.astype(np.uint8)


bg = occrm if occrm is not None else plate
ARMS = [
    ('A_band_occrm', bg, band, 'Sprint 25: band mask, occluder replaced by a harmonic continuation'),
    ('B_bandocc_occrm', bg, np.maximum(band, occ), 'PACO (c): band + occluder mask, the strategy their own evidence prefers'),
    ('C_band_raw', plate, band, 'PACO (a) control: band mask on the raw plate colour, occluder left in'),
    ('D_band_dil4', bg, dilate(band, 4), 'R8 item 5: band dilated 4 px -- withhold the streaky rim from the context'),
    ('E_band_dil12', bg, dilate(band, 12), 'R8 item 5: band dilated 12 px -- the same, further out'),
    ('F_bandocc_dil4', bg, dilate(np.maximum(band, occ), 4), 'R8 item 5: PACO (c) plus the 4 px dilation'),
]
report = {'bundle': BUNDLE, 'plate': [pw, ph], 'arms': []}
for name, src, msk, desc in ARMS:
    t0 = time.time()
    out = lama(Image.fromarray(src), Image.fromarray((msk * 255).astype(np.uint8)))
    out = np.array(out.convert('RGB'))[:ph, :pw]
    dt = time.time() - t0
    # how far the inpaint moved the picture where it was ASKED to, and where it was not
    d = np.abs(out.astype(int) - src.astype(int)).sum(2)
    inside = float(d[msk > 0].mean()) if msk.sum() else 0.0
    outside = float(d[msk == 0].mean())
    changed_outside = int((d[msk == 0] > 8).sum())
    Image.fromarray(out).save(os.path.join(OUT, 'return_%s.png' % name))
    print('  %-16s %5.1fs   mean |d| inside %6.1f  outside %5.2f  (%d px changed outside the mask)' %
          (name, dt, inside, outside, changed_outside))
    report['arms'].append({'name': name, 'desc': desc, 'seconds': round(dt, 1),
                           'maskPx': int(msk.sum()), 'meanAbsInside': round(inside, 2),
                           'meanAbsOutside': round(outside, 3), 'changedOutside': changed_outside})

json.dump(report, open(os.path.join(OUT, 'inpaint.json'), 'w'), indent=1)
print('-> ' + OUT)
