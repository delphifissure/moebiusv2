"""S53 / R8 item 6 — THE REVEAL-THRESHOLDED HYBRID FILL. Two tools, split on a field we already compute.

SynergyAmodal Fig.6 splits performance by how much of the target is occluded: a REGRESSION (SDAmodal) has the best
mIoU in the 0-10% bucket, and GENERATIVE methods take over at 10-50%, 50-90% and 90-100%. Their S4.3 names why:

    "regression-based methods tend to produce results resembling an 'AVERAGE' outcome. While they often achieve
     DECENT IoU SCORES, the actual shapes do not meet the requirements of the deocclusion task."

That is our situation exactly. The plane far side IS a regression producing an average -- which is why it passes
the distribution guard almost by construction (return_guard.py scores it 0.42) and only manages 72.3% on ordinal
ordering. And our metrics were the IoU family, which is the half of the trap that R8 already caught.

THE SPLIT IS FREE, WHICH IS THE POINT. A hybrid normally needs a threshold nobody can justify. Ours is already
computed and already exported: plane_reveal_px.png is how far, in plate texels at the envelope rim, a texel's two
candidate depths move it -- S48's field, the same quantity Sprint 26's cliff tolerance is written in. Where the
reveal is small the disocclusion is a sliver and a smooth continuation is not merely adequate, it is right; where
it is large there is real hidden area and a generative fill has something to do. On the troll the field is
p50 0.37 texels, p90 1.73, p99 14.76 -- so MOST of the band is the regression's case and the heavy tail is the
model's, which is what the paper's figure predicts.

THE TWO TOOLS, both already built and neither newly trained:
  regression  plane_color_occluder_removed.png -- Sprint 25's harmonic continuation. S52 found it is already
              better than the wash before any model runs.
  generative  return_A_band_occrm.png -- LaMa on the band mask over that same seed (S52 arm A, which PACO
              prescribes by name for background regions).

So the hybrid costs one composite and no new inference. It is the cheapest test of the paper's claim available,
and if the claim is wrong here the cost of finding out is minutes.

  python3 harness/s53_hybrid.py [T ...]        # thresholds in plate texels at the rim; default a sweep
"""
import sys, os, io, json, zipfile
import numpy as np
from PIL import Image

BUNDLE = 'harness/shots/s45_rt/troll/bundle.zip'
ARMS = 'harness/shots/s52_inpaint/troll'
OUT = ARMS
# DECODING plane_reveal_px.png, which is easy to get wrong and was got wrong here first. meta.plane.reveal.pngScale
# is NOT a multiplier: it is the CAP IN TEXELS. The exporter writes min(reveal, CAP)/CAP, so the decode is
#     texels = value / 65535 * CAP
# exactly as meta.files['plane_reveal_px.png'] states. Reading pngScale as a multiplier gives a field ~375x too
# large, which puts every band texel above every threshold and makes the hybrid silently degenerate to "all
# generative" -- it did, and the percentiles disagreeing with meta by three orders of magnitude is what caught it.
# The field is CLIPPED at the cap: 0.96% of the plate saturates, and meta.plane.reveal.max (143.6 texels here) is
# the true uncapped maximum, so any threshold at or above the cap is meaningless.
PNG_CAP_DEFAULT = 16.0


def main(thresholds):
    z = zipfile.ZipFile(BUNDLE)
    meta = json.loads(z.read('meta.json'))
    rv = meta['plane']['reveal']
    m = lambda n: np.array(Image.open(io.BytesIO(z.read(n))).convert('L'))
    rgb = lambda n: np.array(Image.open(io.BytesIO(z.read(n))).convert('RGB'))
    band = m('plane_mask_inpaint.png') > 127
    seed = rgb('plane_color_occluder_removed.png')
    cap = float(rv.get('pngScale', PNG_CAP_DEFAULT))          # the CAP in texels, not a multiplier
    reveal = np.array(Image.open(io.BytesIO(z.read('plane_reveal_px.png')))).astype(np.float64) / 65535.0 * cap
    sat = reveal >= cap - 1e-6
    lama = np.array(Image.open(os.path.join(ARMS, 'return_A_band_occrm.png')).convert('RGB'))
    ph, pw = band.shape
    assert reveal.shape == band.shape and lama.shape[:2] == band.shape

    r = reveal[band]
    print('reveal on the band, in plate texels at the rim (%s):' % rv['unit'])
    print('  p50 %.3f  p90 %.3f  p99 %.3f  max %.2f   [meta says p50 %.2f p90 %.2f p99 %.2f]'
          % (np.percentile(r, 50), np.percentile(r, 90), np.percentile(r, 99), r.max(),
             rv['p50'], rv['p90'], rv['p99']))
    print('  clipped at the %.0f-texel cap: %d band texels (%.2f%%); meta max is %.1f, so the tail is censored'
          % (cap, (sat & band).sum(), 100 * (sat & band).mean(), rv['max']))
    print('  screen px per plate texel %.4f, so those are %.3f / %.3f / %.3f screen px'
          % (rv['screenPxPerTexel'], np.percentile(r, 50) * rv['screenPxPerTexel'],
             np.percentile(r, 90) * rv['screenPxPerTexel'], np.percentile(r, 99) * rv['screenPxPerTexel']))

    # how different are the two tools where it matters? If they agree, the split cannot buy anything and that is
    # the first thing to know, before any threshold is chosen.
    diff = np.abs(lama.astype(int) - seed.astype(int)).sum(2)
    print('\nthe two tools differ on the band: mean |d| %.1f, %.1f%% of band texels differ by more than 24'
          % (diff[band].mean(), 100 * (diff[band] > 24).mean()))
    q50, q90, q99 = (float(np.percentile(r, p)) for p in (50, 90, 99))
    for lo, hi, name in ((0, q50, 'reveal < p50'), (q50, q90, 'p50..p90'), (q90, q99, 'p90..p99'), (q99, 1e9, '> p99')):
        s = band & (reveal >= lo) & (reveal < hi)
        if s.sum():
            print('  %-14s %8d px (%5.1f%% of band)   mean |d| between the tools %6.1f'
                  % (name, s.sum(), 100 * s.sum() / band.sum(), diff[s].mean()))

    print('\n%-10s %12s %12s %14s' % ('threshold', 'generative px', '% of band', 'mean |d| vs seed'))
    report = {'reveal': {'p50': float(np.percentile(r, 50)), 'p90': float(np.percentile(r, 90)),
                         'p99': float(np.percentile(r, 99)), 'max': float(r.max())}, 'arms': []}
    for T in thresholds:
        gen = band & (reveal >= T)
        out = seed.copy()
        out[gen] = lama[gen]
        name = 'H_rev%g' % T
        Image.fromarray(out).save(os.path.join(OUT, 'return_%s.png' % name))
        d2 = np.abs(out.astype(int) - seed.astype(int)).sum(2)
        print('  %-8s %12d %11.1f%% %14.1f' % ('T=%g' % T, gen.sum(), 100 * gen.sum() / band.sum(), d2[band].mean()))
        report['arms'].append({'name': name, 'T': T, 'generativePx': int(gen.sum()),
                               'fracBand': float(gen.sum() / band.sum()), 'meanAbsVsSeed': float(d2[band].mean())})
    # the two limits, written out as arms so the sweep can render them beside the hybrids
    Image.fromarray(seed).save(os.path.join(OUT, 'return_H_seedonly.png'))
    print('\nthe limits are already on disk as arms: T=0 is return_A_band_occrm.png (all generative),')
    print('T=inf is return_H_seedonly.png (all regression, no model at all).')
    json.dump(report, open(os.path.join(OUT, 'hybrid.json'), 'w'), indent=1)
    print('-> ' + OUT)


if __name__ == '__main__':
    ts = [float(x) for x in sys.argv[1:]] or [0.25, 0.5, 1.0, 2.0, 4.0, 8.0]
    main(ts)
