#!/usr/bin/env python3
"""Sky masks side by side (from da3metric_probe.py): the picture; MoGe-3 sky (invalid) vs DA3 sky -- white both, red MoGe
only, cyan DA3 only.   python3 sky_compare_sheet.py DA3M_DIR out.png name=color.png ..."""
import os, sys
import numpy as np
from PIL import Image, ImageDraw
d, outp = sys.argv[1], sys.argv[2]; tiles = []
for spec in sys.argv[3:]:
    n, p = spec.split('=', 1)
    if not os.path.exists(os.path.join(d, n + '_da3sky.npy')): continue
    img = Image.open(p).convert('RGB'); ds = np.load(os.path.join(d, n + '_da3sky.npy')); ms = ~np.load(os.path.join(d, n + '_mogevalid.npy'))
    a = np.asarray(img).astype(float) * 0.35
    a[ms & ds] = (255, 255, 255); a[ms & ~ds] = (255, 60, 60); a[ds & ~ms] = (40, 220, 255)
    for im in (img, Image.fromarray(a.astype(np.uint8))):
        t = im.copy(); t.thumbnail((300, 300)); tiles.append((n, t))
W = 300; rows = (len(tiles) + 3) // 4; sh = Image.new('RGB', (W * 4, W * rows), (25, 25, 25))
for i, (n, t) in enumerate(tiles): sh.paste(t, ((i % 4) * W, (i // 4) * W)); ImageDraw.Draw(sh).text(((i % 4) * W + 4, (i // 4) * W + 4), n, fill=(255, 255, 0))
sh.save(outp); print(sh.size)
