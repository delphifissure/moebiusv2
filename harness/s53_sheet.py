"""S53 / Sprint 29 — THE ARMS SIDE BY SIDE, SO A PERSON CAN DECIDE WHAT THE HARNESS CANNOT.

Two of Sprint 29's three items are decisions the numbers cannot make. The 2x depth map has the largest temporal
effect measured (-8.4%) but a HIGHER step variance and a degradation curve that is worse at 22.5 degrees and
better at 28.1 -- it changes the picture rather than simply improving it. The hybrid beats both of its own
endpoints but by 0.3 to 0.7% on one scene. Both want an eye, and an eye needs the frames beside each other at the
poses where the artefact lives, not a table.

So this builds one sheet per comparison: the same frames from each arm, stacked, with a difference strip. It makes
no claim and computes no score; harness/s53_metrics.py already did that. Its only job is to be looked at.

  python3 harness/s53_sheet.py <out.png> <arm1> <arm2> [<arm3> ...] [--frames 0,4,8] [--crop x,y,w,h]
"""
import sys, os, json
import numpy as np
from PIL import Image, ImageDraw

SWEEP = 'harness/shots/s53_sweep'
LABEL_H = 22
PAD = 6


def load_arm(tag, frames):
    d = os.path.join(SWEEP, tag)
    meta = json.load(open(os.path.join(d, 'sweep.json')))
    out = []
    for k in frames:
        fr = meta['frames'][k]
        im = Image.open(os.path.join(d, fr['file'])).convert('RGB')
        out.append((im, fr['fx'], fr['fy']))
    return meta, out


def main(argv):
    outp = argv[0]
    tags, frames, crop = [], None, None
    i = 1
    while i < len(argv):
        a = argv[i]
        if a == '--frames':
            frames = [int(x) for x in argv[i + 1].split(',')]; i += 2
        elif a == '--crop':
            crop = [int(x) for x in argv[i + 1].split(',')]; i += 2
        else:
            tags.append(a); i += 1

    metas, arms = {}, {}
    n = None
    for t in tags:
        m, ims = load_arm(t, frames if frames is not None else [])
        n = len(m['frames'])
        metas[t] = m
    if frames is None:
        frames = [0, n // 2, n - 1]          # rest, mid-sweep, the envelope edge
    for t in tags:
        metas[t], arms[t] = load_arm(t, frames)

    w, h = arms[tags[0]][0][0].size
    if crop:
        cw, ch = crop[2], crop[3]
    else:
        cw, ch = w, h

    cols = len(frames)
    rows = len(tags) + (1 if len(tags) == 2 else 0)      # a difference row only when comparing exactly two
    W = cols * cw + (cols + 1) * PAD
    H = rows * (ch + LABEL_H) + (rows + 1) * PAD
    sheet = Image.new('RGB', (W, H), (18, 18, 20))
    dr = ImageDraw.Draw(sheet)

    def place(r, c, im, label):
        x = PAD + c * (cw + PAD)
        y = PAD + r * (ch + LABEL_H + PAD)
        if crop:
            im = im.crop((crop[0], crop[1], crop[0] + crop[2], crop[1] + crop[3]))
        sheet.paste(im, (x, y + LABEL_H))
        dr.text((x + 2, y + 5), label, fill=(225, 225, 230))

    for r, t in enumerate(tags):
        for c, (im, fx, fy) in enumerate(arms[t][:cols]):
            deg = 45.0 * abs(fx)
            place(r, c, im, '%s   %.0f deg' % (t, deg))

    if len(tags) == 2:
        a, b = tags
        for c in range(cols):
            A = np.asarray(arms[a][c][0], np.int16)
            B = np.asarray(arms[b][c][0], np.int16)
            d = np.abs(A - B).sum(2)
            # amplified so a 0.7% pixel change is visible at all; the scale is printed, not hidden
            v = np.clip(d * 6, 0, 255).astype(np.uint8)
            place(len(tags), c, Image.fromarray(np.stack([v, v, v], -1)),
                  'difference x6   %.2f%% of pixels differ by >8' % (100 * (d > 8).mean()))

    os.makedirs(os.path.dirname(outp) or '.', exist_ok=True)
    sheet.save(outp)
    print('-> %s   %d arms x %d frames, %dx%d' % (outp, len(tags), cols, W, H))


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(1)
    main(sys.argv[1:])
