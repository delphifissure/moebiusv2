"""A SUPPLIER-AGNOSTIC ACCEPTANCE TEST FOR A DEPTH RETURN, from a distribution match.

THE PROBLEM THIS SOLVES. S48 verified the return path against a deliberately corrupted return and it held; S52 then
ran a real model through it and produced a return that was worthless. The only thing that caught it was a
hand-written median comparison inside `s52_depth.py`:

    median |model - observed occluder|   0.0832
    median |model - plane background|    0.2607     <- three times further
    !! THE PREDICTION TRACKS THE OCCLUDER, NOT THE BACKGROUND

That guard was written for that script, by hand, after the fact. Every future supplier -- a different depth model,
a joint colour+depth model, a hybrid fill -- needs the same check, and nothing in the contract provides one.

THE PRINCIPLED FORM, from 2503.20211 (Yan et al.) Eq.12-15. They compute the depth histogram over a whole training
set with a differentiable histogram and constrain predictions to match it by KL divergence, because their failure
mode is a *distributional* one: "night predicts too many near planes, rain predicts too many far ones" (Fig.3 c,d).
Ours is the same shape. A prediction that tracks the occluder has an OCCLUDER-SHAPED HISTOGRAM, not a
background-shaped one, and that is visible without any ground truth for the hidden surface.

So: **the filled band's depth distribution should resemble the visible background's depth distribution.** Not
identical -- the band is a biased sample of the scene, it is by definition the parts behind things -- but the same
family. A return that is three times further from the background than from the occluder is not in the same family
and the statistic says so by a wide margin.

WHAT IS COMPARED, AND WHY EACH CHOICE. The reference is the VISIBLE BACKGROUND: texels that are neither in the band
nor part of a tagged occluder. Using the whole visible image would fold the occluder's own depths into the
reference and blunt exactly the discrimination we want. Three statistics, because one number hides its own
failure modes:

  W1      the 1-D Wasserstein distance, IN UNITS OF d. Interpretable: "the band's depths would have to move this
          far on average to match the background's". Robust to binning. THE ONE TO QUOTE.
  JS      Jensen-Shannon divergence, bounded in [0, 1], symmetric, no blow-up on empty bins. The stable stand-in
          for the paper's KL.
  KL      the paper's own statistic, band || reference, with the reference smoothed. Reported for fidelity to the
          source; it is the least robust of the three and should not be the one a decision rests on.

THE GUARD IS CALIBRATED AGAINST TRUTH, NOT ASSERTED, AND THE ABSOLUTE THRESHOLD DOES NOT WORK.

The first attempt compared a return's W1 against a fixed number. That is wrong, and the kit says so. On 30 kit
scenes where the hidden surface is known exactly, the TRUE band's distribution sits at W1 median 0.182, p90 0.421,
max 0.520 from the visible background -- because the band is a biased sample of the scene by construction, it is
the parts behind things. A perfect return does not score zero, and any absolute threshold tight enough to catch a
bad return also rejects the truth on some scene.

So the guard is RELATIVE AND SELF-CALIBRATING: score the return against the DO-NOTHING field on the same picture
(the observed depth carried across the band), which is always available and is definitionally the wrong answer.

    REJECT  if  W1(return) > 0.8 x W1(do nothing)

Validated on the same 30 kit scenes: ground truth passes on 29 of 30 (the exception is S16, where the occluder's
own depths happen to resemble the background's, so the reference-bad is weak -- ratio 1.74). Per-scene ratio for
truth: median 0.269, p90 0.598. On the troll the shipped plane construction scores 0.42 and S52's Amodal-DAV2
return scores 1.55 -- WORSE THAN DOING NOTHING, which is the verdict that was reached by hand and is now automatic.

WHAT THIS GUARD CANNOT DO, STATED SO IT IS NOT MISREAD. It detects a return drawn from the WRONG DISTRIBUTION. It
cannot detect a return that is too AVERAGE. Our plane far side is built by extrapolating the visible background, so
it inherits that background's distribution almost by construction and scores well here (0.0638, below the kit
truth floor) whatever its shape is. That is exactly SynergyAmodal S4.3's trap -- "regression-based methods tend to
produce results resembling an average outcome. While they often achieve decent IoU scores, the actual shapes do
not meet the requirements." This guard is a filter against foreign returns, and it must be read alongside
harness/truthkit/ordinal_pairs.py, which does catch over-averaging (the same far field scores 72.3% there).

Run with no arguments to print the calibration.

  python3 harness/return_guard.py                      # calibrate on the troll bundle
  python3 harness/return_guard.py <return.npy>         # score one return against the same references
"""
import sys, os, io, json, zipfile
import numpy as np
from PIL import Image

BUNDLE = os.environ.get('BUNDLE', 'harness/shots/s45_rt/troll/bundle.zip')
NBINS = 128
REJECT = 0.8          # W1(return) / W1(do nothing); calibrated on 30 kit scenes, see the docstring


def _hist(v, lo, hi, nb=NBINS):
    h, _ = np.histogram(v, bins=nb, range=(lo, hi))
    h = h.astype(np.float64)
    s = h.sum()
    return h / s if s > 0 else h


def compare(band_d, ref_d, nb=NBINS):
    """W1, Jensen-Shannon and KL between two 1-D depth samples, on a shared support."""
    lo = float(min(band_d.min(), ref_d.min()))
    hi = float(max(band_d.max(), ref_d.max()))
    if hi - lo < 1e-9:
        return {'W1': 0.0, 'JS': 0.0, 'KL': 0.0}
    p = _hist(band_d, lo, hi, nb)
    q = _hist(ref_d, lo, hi, nb)
    width = (hi - lo) / nb
    # W1 as the integral of |CDF difference| -- exact for histograms, and in units of d
    w1 = float(np.abs(np.cumsum(p) - np.cumsum(q)).sum() * width)
    m = 0.5 * (p + q)
    kl = lambda a, b: float(np.sum(np.where(a > 0, a * np.log(np.maximum(a, 1e-12) / np.maximum(b, 1e-12)), 0.0)))
    js = 0.5 * kl(p, m) + 0.5 * kl(q, m)
    eps = 1e-6                                     # the paper's KL needs a smoothed reference or it is infinite
    qs = (q + eps) / (1 + eps * nb)
    return {'W1': w1, 'JS': float(js / np.log(2)), 'KL': kl(p, qs)}


def load(bundle=BUNDLE):
    z = zipfile.ZipFile(bundle)
    # masks through convert('L') -- plane_object_ids is paletted or multi-channel and reading it raw gives a 3-D array
    m = lambda n: np.array(Image.open(io.BytesIO(z.read(n))).convert('L'))
    d16 = lambda n: np.array(Image.open(io.BytesIO(z.read(n)))).astype(np.float64) / 65535.0
    band = m('plane_mask_inpaint.png') > 127
    occ = m('plane_object_ids.png') > 0
    obs = d16('plane_source_depth16.png')
    plate = d16('plane_plate_depth16.png')
    assert band.shape == obs.shape == plate.shape == occ.shape, (band.shape, occ.shape, obs.shape, plate.shape)
    return band, occ, obs, plate


def reference(band, occ, obs):
    """The visible background: neither band nor tagged occluder. Falls back to 'visible and farther than the
    occluder's median' when the object map is absent or covers almost everything, and says which it used."""
    ref = (~band) & (~occ)
    how = 'visible, not a tagged occluder'
    if ref.sum() < 0.02 * band.size:
        cut = np.median(obs[occ]) if occ.any() else np.median(obs)
        ref = (~band) & (obs < cut)
        how = 'visible and farther than the occluder median (object map too large to subtract)'
    return ref, how


def main():
    band, occ, obs, plate = load()
    ref, how = reference(band, occ, obs)
    print('bundle %s' % BUNDLE)
    print('band %d px (%.1f%%)   tagged occluder %d px (%.1f%%)   reference %d px (%.1f%%)'
          % (band.sum(), 100 * band.mean(), occ.sum(), 100 * occ.mean(), ref.sum(), 100 * ref.mean()))
    print('reference = %s' % how)
    ref_d = obs[ref]
    print('reference d  p10/50/90 %s' % np.percentile(ref_d, [10, 50, 90]).round(3))

    cands = {
        'the shipped plane construction': plate,
        'do nothing (the occluder\'s own depth)': obs,
    }
    amo = 'harness/shots/s52_inpaint/troll/amodal_d.npy'
    if os.path.exists(amo):
        cands['S52 Amodal-DAV2 (known worthless)'] = np.load(amo).astype(np.float64)
    for p in sys.argv[1:]:
        cands[os.path.basename(p)] = np.load(p).astype(np.float64)

    print('\n  %-38s %9s %9s %9s %11s' % ('return, read on the band', 'W1 (in d)', 'JS', 'KL', 'band d p50'))
    out = {}
    for name, f in cands.items():
        s = compare(f[band], ref_d)
        out[name] = s
        print('  %-38s %9.4f %9.4f %9.4f %11.3f' % (name, s['W1'], s['JS'], s['KL'], np.median(f[band])))

    # THE VERDICT. Against the do-nothing field on this same picture, never against an absolute number: the kit
    # shows the true band's own distance from the background spans 0.02 to 0.52 across scenes, so no fixed
    # threshold both catches a bad return and spares the truth.
    nothing = out["do nothing (the occluder's own depth)"]['W1']
    print('\n  VERDICT -- W1(return) against W1(do nothing) = %.4f on this picture; reject above %.2f' % (nothing, REJECT))
    for name, s in out.items():
        r = s['W1'] / max(nothing, 1e-9)
        print('    %-38s ratio %5.2f   %s' % (name, r, 'REJECT' if r > REJECT else 'pass'))
    print('\n  The rule is validated on 30 kit scenes with exact hidden truth: the true band passes on 29 of 30')
    print('  (median ratio 0.269, p90 0.598; S16 is the exception, where the occluder\'s depths happen to')
    print('  resemble the background\'s and the reference-bad is weak). It catches a return from the wrong')
    print('  distribution. It does NOT catch a return that is merely too average -- see the module docstring.')
    if os.environ.get('DUMP'):
        json.dump(out, open(os.environ['DUMP'], 'w'), indent=1)


if __name__ == '__main__':
    main()
