"""S53 / R8 item 1 — SCORE THE SWEEPS PERCEPTUALLY, and be exact about what each number is.

R8's third finding, from three papers read first-hand, is that this project's instruments cannot see its own defect.
Every score we have used -- RMSE, MAE, delta-1, PSNR, "pixels differing", "mean abs difference" -- is in the family
that rewards blur, because the blur-minimising prediction is the conditional mean and that is exactly what an L2
score asks for. MLGS states the consequence directly: LPIPS is the metric that separates methods PSNR calls equal.
And InpaintFusion S4.1 adds the second half: "spatio-temporal consistency cannot be judged from individual images".

WHAT THIS COMPUTES, AND WHAT EACH ONE IS WORTH.

  1. DEGRADATION CURVE -- LPIPS(frame_k, frame_0) against the sweep angle.
     Frame 0 is rest and is the same picture for every arm that differs only in the band's colour, so this reads as
     "how far from the picture the artist approved has this arm travelled by 45 degrees". It is a real perceptual
     distance, but it is NOT a quality score: an arm that changes more is not thereby worse. Read it for SHAPE --
     where on the path the picture falls apart -- and for the ordering at the far end, not as a verdict.

  2. TEMPORAL STEP -- LPIPS(frame_k, frame_{k-1}), the frame-to-frame perceptual change.
     THIS IS THE ONE THE MOTION ARGUMENT IS ABOUT. The camera path is identical across arms and, for the S52
     returns, so is the geometry -- only the band's colour differs. So the parallax component of the step is common
     to all of them and any DIFFERENCE between arms is attributable to the content. Correct content translates
     smoothly and gives a low, flat curve; content that smears or pops gives a higher and spikier one. Its absolute
     value is meaningless (it is dominated by ordinary parallax); only the comparison between arms is meaningful,
     and only where geometry is held fixed. For the S51 arm the geometry DOES change, so that comparison is
     confounded and is reported with the confound named rather than quietly.

  3. ROUGHNESS -- the standard deviation of the temporal step over the sweep, and its maximum.
     A smooth glide and a series of jumps can share a mean. Jumps are what "streaky as hell" describes.

  4. SWEEP FRECHET DISTANCE (sFD) -- and it is NOT VFID, which is why it is not called that.
     VFID is the Frechet distance between I3D features of real and generated VIDEO. I3D weights are not obtainable
     in this environment (three sources tried: 404, unreachable, 403), and there is no real video to compare
     against in any case -- there is no ground truth for the hidden surface. What is computed instead is the
     Frechet distance between the per-frame deep-feature distributions of two arms' sweeps, using the AlexNet
     feature stack LPIPS already loads. It is a distribution-level "how differently do these two sweeps look over
     the whole path" and it is a distance between two arms, not a quality score against truth. Named for what it
     is. DO NOT quote it as VFID. It is also weak: the AlexNet stack gives 1152 dimensions and a sweep gives ~11
     frames, so the covariance is estimated from far fewer samples than dimensions and is shrunk toward its
     diagonal to be invertible at all. What survives is closer to a mean-and-variance distance than a true
     Frechet. Read it as a coarse ordering, never as a calibrated number.

  LPIPS backbone: alex. The vgg variant's torchvision weights fail their hash through this environment's proxy.
  alex is LPIPS's own recommended "best forward" configuration, so this is the standard choice, not a fallback.

  python3 harness/s53_metrics.py <sweepdir> [<sweepdir> ...]
"""
import sys, os, json
import numpy as np
from PIL import Image

import torch
import lpips

torch.set_grad_enabled(False)
NET = lpips.LPIPS(net='alex')


def load(d):
    meta = json.load(open(os.path.join(d, 'sweep.json')))
    ims = []
    for fr in meta['frames']:
        a = np.asarray(Image.open(os.path.join(d, fr['file'])).convert('RGB'), dtype=np.float32) / 127.5 - 1.0
        ims.append(torch.from_numpy(a).permute(2, 0, 1).unsqueeze(0))
    return meta, ims


def feats(ims):
    """The AlexNet stack LPIPS uses, global-average-pooled per layer and concatenated: one vector per frame."""
    out = []
    for im in ims:
        fs = NET.net.forward(NET.scaling_layer(im))
        out.append(torch.cat([lpips.normalize_tensor(f).mean(dim=(2, 3)).flatten() for f in fs]).numpy())
    return np.stack(out)


def frechet(a, b):
    """Frechet distance between two Gaussians fitted to the per-frame feature vectors. Small sample (n frames vs
    thousands of dimensions), so the covariance is shrunk toward its diagonal -- stated, because an unregularised
    estimate here would be rank-deficient and the number meaningless."""
    from scipy import linalg
    def gauss(x):
        mu = x.mean(0)
        c = np.cov(x, rowvar=False)
        c = 0.9 * c + 0.1 * np.diag(np.diag(c)) + 1e-8 * np.eye(c.shape[0])
        return mu, c
    m1, c1 = gauss(a); m2, c2 = gauss(b)
    diff = m1 - m2
    cov, _ = linalg.sqrtm(c1.dot(c2), disp=False)
    if np.iscomplexobj(cov):
        cov = cov.real
    return float(diff.dot(diff) + np.trace(c1) + np.trace(c2) - 2 * np.trace(cov))


def main(dirs):
    runs = {}
    for d in dirs:
        meta, ims = load(d)
        tag = meta['tag']
        n = len(ims)
        deg = [0.0] + [float(NET(ims[0], ims[k]).item()) for k in range(1, n)]
        tmp = [float(NET(ims[k - 1], ims[k]).item()) for k in range(1, n)]
        runs[tag] = {'meta': meta, 'deg': deg, 'tmp': tmp, 'f': feats(ims)}
        print('loaded %-10s %d frames  %s' % (tag, n, 'RET ' + os.path.basename(meta['ret']) if meta['ret'] else ('flags ' + json.dumps(meta['flags']) if meta['flags'] else 'the plate as baked')))

    n = len(next(iter(runs.values()))['deg'])
    ang = [45.0 * k / (n - 1) for k in range(n)]

    print('\n== 1. DEGRADATION: LPIPS(frame, rest) -- how far the picture has travelled from the approved one ==')
    hdr = '  %-10s' % 'arm' + ''.join('%8.1f' % ang[k] for k in range(0, n, max(1, n // 7)))
    print(hdr + '   (degrees)')
    for tag, r in runs.items():
        print('  %-10s' % tag + ''.join('%8.4f' % r['deg'][k] for k in range(0, n, max(1, n // 7))))

    print('\n== 2. TEMPORAL STEP: LPIPS(frame, previous) -- the frame-to-frame perceptual change ==')
    print('  identical camera path for every arm; for the S52 returns the geometry is identical too, so the')
    print('  difference between those arms is the content. Absolute values are dominated by ordinary parallax.')
    print('  %-10s %9s %9s %9s %9s' % ('arm', 'mean', 'sd', 'max', 'at deg'))
    for tag, r in runs.items():
        t = np.array(r['tmp'])
        print('  %-10s %9.5f %9.5f %9.5f %9.1f' % (tag, t.mean(), t.std(), t.max(), ang[int(t.argmax()) + 1]))

    print('\n== 3. SWEEP FRECHET DISTANCE (sFD) between arms -- NOT VFID; see the module docstring ==')
    tags = list(runs)
    print('  %-10s' % '' + ''.join('%10s' % t[:9] for t in tags))
    for a in tags:
        print('  %-10s' % a + ''.join('%10.4f' % (0.0 if a == b else frechet(runs[a]['f'], runs[b]['f'])) for b in tags))

    out = {'angles': ang,
           'lpips': {t: r['deg'] for t, r in runs.items()},
           'temporal': {t: r['tmp'] for t, r in runs.items()},
           'sFD': {a: {b: (0.0 if a == b else frechet(runs[a]['f'], runs[b]['f'])) for b in tags} for a in tags},
           'backbone': 'lpips-alex', 'vfid': 'not computed: I3D weights unobtainable and no ground-truth video exists'}
    p = os.path.join(os.path.dirname(dirs[0]), 'metrics.json')
    json.dump(out, open(p, 'w'), indent=1)
    print('\n-> ' + p)


if __name__ == '__main__':
    main(sys.argv[1:])
