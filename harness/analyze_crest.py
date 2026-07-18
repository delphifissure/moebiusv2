import sys
import numpy as np
from PIL import Image

# usage: analyze_crest.py <prefix>   (e.g. dq3_  dq2_)
# Tracks the near-dune crest silhouette (strongest vertical luma edge per
# column in the lower half) and reports its median vertical shift mid->near
# and mid->far for lock and free. The dune is the SUBJECT in the q>P runs:
# a working pin holds the crest still.
PFX = sys.argv[1]
H = '/workspace/moebiusv2/harness/'
def load(t): return np.asarray(Image.open(H+t+'.png').convert('L')).astype(np.float32)

def crest(img):
    rh, rw = img.shape
    ys = {}
    lo, hi = int(0.50*rh), int(0.98*rh)
    for x in range(int(0.08*rw), int(0.55*rw), 6):
        col = img[lo:hi, x]
        g = np.abs(col[4:] - col[:-4])
        if g.max() < 12: continue
        ys[x] = lo + 2 + int(np.argmax(g))
    return ys

for mode in ['lock', 'free']:
    mid = crest(load(PFX + mode + '_mid'))
    for other in ['near', 'far']:
        oth = crest(load(PFX + mode + '_' + other))
        dz = [abs(oth[x] - mid[x]) for x in mid if x in oth]
        if dz:
            dz = np.array(dz, float)
            print('%s%s mid->%s: crest |dy| median %.1f px  mean %.1f  (n=%d)' %
                  (PFX, mode, other, float(np.median(dz)), float(dz.mean()), len(dz)))
        else:
            print('%s%s mid->%s: no crest columns' % (PFX, mode, other))
