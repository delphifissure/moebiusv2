"""DO THE COLOUR RETURN AND THE DEPTH RETURN AGREE ABOUT WHERE THE EDGES ARE?

THE GAP THIS CLOSES. Our return contract asks for colour and depth as separate files, potentially from separate
models, and checks each one alone: the seam is verified exact, the band is verified painted, and return_guard.py
now checks the depth's distribution. Nothing checks the two AGAINST EACH OTHER. A supplier can return a perfectly
plausible colour fill and a perfectly plausible depth fill that disagree about where the boundary between two
surfaces is, both pass every existing check, and the render shows colour sliding off geometry as the viewer moves.

TWO PAPERS, POINTING THE SAME WAY FROM OPPOSITE SIDES, AND THEY ONLY LOOK CONTRADICTORY.

  Gen3R Tab.11 -- do NOT ask one backbone for both modalities. An RGB head on VGGT's geometry tokens scores
  RealEstate10K PSNR 23.39 against 37.58 for the RGB VAE: "VGGT is designed primarily for geometry modeling and
  lacks sufficient capacity for RGB feature extraction ... This observation also motivates our choice to DECODE
  APPEARANCE AND GEOMETRY SEPARATELY." So separate files is the right shape and our contract already has it.
  But their KL ALIGNMENT between the two latents is load-bearing: without it 1-view PSNR falls 20.51 -> 16.31 and
  camera AUC@30 0.7443 -> 0.4100. Separate decoders, aligned representations.

  DeepDR -- a JOINT colour-and-depth solve beats inpaint-then-redepth by roughly 2x on depth RMSE (InteriorNet
  0.278 against 0.563-0.572; DynaFill 4.51 against 7.78-8.12).

Together: generate them together, decode them apart. What neither gives us is a way to TELL, after the fact,
whether a given pair is aligned -- and since our suppliers are whatever the artist points at, that is the check
the contract actually needs.

A BIAS TO KNOW ABOUT BEFORE READING THE NUMBERS. A SMOOTH depth map has broad edges that still overlap themselves
when displaced, so its shifted control stays high and its margin shrinks -- the test is harder on a blurry depth
return than on a sharp one, regardless of whether the pair is truly aligned. Read the margin against the
calibration line this script prints (the same measurement on the visible plate, where colour and depth are both
observed and therefore aligned by construction), and read the ratio alongside it, never the raw NCC alone.

THE RIM CONFOUND, FOUND 2026-09-22 AND FIXED HERE, WITH THE MEASUREMENT THAT FOUND IT.
Bornemann & Maerz (J. Math. Imaging Vis. 28, 2007) S5 "Boundary Effects": any filter run near a fill front
without normalising by the validity mask treats the unfilled side as content and turns the region's own boundary
into a SPURIOUS EDGE -- "in general, this makes the boundary a spurious edge, aligning the coherence flow
tangentially to it". sobel() below is a central difference, so at a band texel one pixel inside the rim its
support reaches onto the plate and carries the rim step. return_grad.py measured that step at median |g| 0.0828
in d. The colour has an edge at the same place (the occluder silhouette). So both fields shared a large,
correlated, spurious edge on a one-texel ring, and the NCC was reading it as alignment.

Measured on the troll bundle (band 39.9%), scoring on the band eroded by k texels:

  k=0 (as shipped) 0.4006      k=1 0.1454      k=2 0.1324      k=3 0.1322      k=5 0.1294

The score falls 64% at k=1 and is flat thereafter -- exactly the signature of a one-texel ring, which is 9.5% of
the band and carries depth edges 5.9x stronger than the band's interior (mean 0.1433 against 0.0243). Worse, the
VERDICT was resting on it: score-vs-shifted margin +0.2178 as shipped, +0.0020 once the ring is excluded. The
test reported a strong alignment; almost all of it was the rim, and on the band proper the pair is not
distinguishable from a displaced copy of itself.

So the band is eroded by one texel before scoring, and BOTH numbers are printed -- the honest one and the
shipped one -- so the size of the old defect stays visible instead of being quietly corrected away. No published
conclusion rested on this instrument (it is cited descriptively in S53 only), so nothing is retracted.

WHAT IS MEASURED. On the band, the normalised cross-correlation between the colour's edge magnitude and the
depth's edge magnitude. A real surface boundary shows in both: the depth steps and the colour changes. The number
alone means little -- natural images have texture edges with no depth step at all, so even a perfect pair scores
well below 1 -- so it is always reported against two controls computed on the same pair:

  shifted   the depth edges displaced by a few texels. An aligned pair must beat this, or "alignment" is just
            both maps being busy in the same region.
  shuffled  the depth edge magnitudes randomly permuted within the band. This is the floor: any score at or below
            it means there is no relationship at all.

  python3 harness/return_align.py <colour.png> [<depth.npy|depth16.png>]
"""
import sys, os, io, json, zipfile
import numpy as np
from PIL import Image

BUNDLE = os.environ.get('BUNDLE', 'harness/shots/s45_rt/troll/bundle.zip')
RNG = np.random.default_rng(7)


def sobel(a):
    gx = np.zeros_like(a); gy = np.zeros_like(a)
    gx[:, 1:-1] = a[:, 2:] - a[:, :-2]
    gy[1:-1, :] = a[2:, :] - a[:-2, :]
    return np.hypot(gx, gy)


def ncc(x, y, m):
    """Normalised cross-correlation of two fields over a mask."""
    a, b = x[m].astype(np.float64), y[m].astype(np.float64)
    a = a - a.mean(); b = b - b.mean()
    d = np.sqrt((a * a).sum() * (b * b).sum())
    return float((a * b).sum() / d) if d > 0 else 0.0


def edges_of_colour(rgb):
    lum = (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]).astype(np.float64) / 255.0
    return sobel(lum)


def erode1(mask):
    """Drop the one-texel ring whose sobel support reaches across the rim. See THE RIM CONFOUND above:
    without this the score is 2.8x higher and the verdict rests almost entirely on the rim step."""
    out = mask.copy()
    out[1:, :] &= mask[:-1, :]; out[:-1, :] &= mask[1:, :]
    out[:, 1:] &= mask[:, :-1]; out[:, :-1] &= mask[:, 1:]
    return out


def main(colour_path, depth_path):
    z = zipfile.ZipFile(BUNDLE)
    m = lambda n: np.array(Image.open(io.BytesIO(z.read(n))).convert('L'))
    band = m('plane_mask_inpaint.png') > 127
    plate = np.array(Image.open(io.BytesIO(z.read('plane_plate_depth16.png')))).astype(np.float64) / 65535.0

    col = np.array(Image.open(colour_path).convert('RGB'))
    if depth_path is None:
        dep, dname = plate, 'the shipped plate depth'
    elif depth_path.endswith('.npy'):
        dep, dname = np.load(depth_path).astype(np.float64), os.path.basename(depth_path)
    else:
        dep, dname = np.array(Image.open(depth_path)).astype(np.float64) / 65535.0, os.path.basename(depth_path)
    assert col.shape[:2] == band.shape and dep.shape == band.shape

    ec, ed = edges_of_colour(col), sobel(dep)
    inner = erode1(band)          # the honest mask: no sobel support crosses the rim
    print('colour %s   depth %s   band %d px, scored on %d (%.1f%% dropped as the rim ring)'
          % (os.path.basename(colour_path), dname, band.sum(), inner.sum(),
             100.0 * (band.sum() - inner.sum()) / max(band.sum(), 1)))

    def three(mask):
        s = ncc(ec, ed, mask)
        # control 1: the depth edges shifted. An aligned pair must beat a displaced copy of itself.
        sh = []
        for k in (2, 4, 8):
            for ax in (0, 1):
                sh.append(ncc(ec, np.roll(ed, k, axis=ax), mask))
                sh.append(ncc(ec, np.roll(ed, -k, axis=ax), mask))
        # control 2: the depth edge magnitudes permuted inside the mask. The floor.
        perm = ed.copy(); v = perm[mask].copy(); RNG.shuffle(v); perm[mask] = v
        return s, float(np.mean(sh)), ncc(ec, perm, mask)

    score, shifted, shuffled = three(inner)
    rimscore, rimshift, _ = three(band)

    print('  NCC(colour edges, depth edges) on the band   %.4f' % score)
    print('  the same with the depth edges shifted 2-8 px %.4f   (an aligned pair must beat this)' % shifted)
    print('  the same with the depth edges shuffled       %.4f   (the floor: no relationship)' % shuffled)
    print('  [rim ring INCLUDED, the pre-2026-09-22 number: %.4f, margin %+.4f -- see THE RIM CONFOUND]'
          % (rimscore, rimscore - rimshift))
    margin = score - shifted
    ratio = score / shifted if shifted > 1e-9 else float('inf')
    print('  margin over the shifted control              %+.4f   (ratio %.2fx)' % (margin, ratio))
    # WHAT THIS VERDICT IS AND IS NOT. Margin and ratio can disagree, and on the troll they do: LaMa's fill scores
    # margin +0.015 / ratio 2.54x while the harmonic seed scores +0.046 / 1.57x. Neither ordering is wrong -- LaMa
    # puts few sharp edges where the depth steps, the seed puts broad low-frequency structure everywhere -- so this
    # instrument CANNOT RANK two plausible pairs. It detects GROSS MISALIGNMENT: a pair at or below the shuffled
    # floor has no relationship at all, and that is the failure the contract has no other way to catch.
    gross = margin <= 0 or abs(score - shuffled) < 2 * abs(shuffled - 0) + 1e-3
    print('  VERDICT: %s' % ('NOT ALIGNED -- at or below the shuffled floor; the colour and depth returns have no '
                             'common boundary structure' if gross else
                             'no gross misalignment (margin and ratio both positive). This does NOT rank it against '
                             'another arm -- see the module.'))
    # the same number OUTSIDE the band, where colour and depth are both observed and must agree by construction.
    # This calibrates the score: it is what "aligned" looks like on this picture.
    vis = ~band
    print('\n  for scale, the SAME measurement on the visible plate, where both are observed and therefore aligned')
    print('  by construction: %.4f (shifted %.4f)'
          % (ncc(edges_of_colour(np.array(Image.open(io.BytesIO(z.read('plane_source_color.png'))).convert('RGB'))),
                 sobel(np.array(Image.open(io.BytesIO(z.read('plane_source_depth16.png')))).astype(np.float64) / 65535.0), vis),
             ncc(edges_of_colour(np.array(Image.open(io.BytesIO(z.read('plane_source_color.png'))).convert('RGB'))),
                 np.roll(sobel(np.array(Image.open(io.BytesIO(z.read('plane_source_depth16.png')))).astype(np.float64) / 65535.0), 4, axis=1), vis)))
    return {'colour': os.path.basename(colour_path), 'depth': dname, 'ncc': score,
            'shifted': shifted, 'shuffled': shuffled, 'margin': margin}


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    out = main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
    if os.environ.get('DUMP'):
        json.dump(out, open(os.environ['DUMP'], 'w'), indent=1)
