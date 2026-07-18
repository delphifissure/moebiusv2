import numpy as np
from PIL import Image

H = '/workspace/moebiusv2/harness/'
def load(t): return np.asarray(Image.open(H+t+'.png').convert('L')).astype(np.float32)

ref = load('dz_lock_mid')
rh, rw = ref.shape
depth = np.asarray(Image.open('/workspace/moebiusv2/starwatcher_depth.png').convert('L').resize((rw, rh))).astype(np.float32)/255.0

# patch centers by depth bin, chosen where local contrast is decent
PS, SR = 12, 30   # patch half-size, search radius
grad = np.abs(np.gradient(ref)[0]) + np.abs(np.gradient(ref)[1])
bins = {'near(d>0.7)': (0.70, 1.01), 'split(0.4-0.6)': (0.40, 0.60), 'far(0.05-0.3)': (0.05, 0.30)}
centers = {k: [] for k in bins}
step = 40
for y in range(SR+PS+10, rh-SR-PS-10, step):
    for x in range(SR+PS+10, rw-SR-PS-10, step):
        d = depth[y, x]
        c = grad[y-PS:y+PS, x-PS:x+PS].mean()
        if c < 4: continue
        # patch must be depth-coherent (not straddling a silhouette)
        dp = depth[y-PS:y+PS, x-PS:x+PS]
        if dp.max() - dp.min() > 0.15: continue
        for k, (lo, hi) in bins.items():
            if lo <= d < hi and len(centers[k]) < 14: centers[k].append((y, x))

def drift(img, y, x, patch):
    best, by, bx = -2, 0, 0
    p = (patch - patch.mean()); pn = np.sqrt((p*p).sum()) + 1e-6
    for dy in range(-SR, SR+1, 2):
        for dx in range(-SR, SR+1, 2):
            w = img[y+dy-PS:y+dy+PS, x+dx-PS:x+dx+PS]
            q = w - w.mean(); qn = np.sqrt((q*q).sum()) + 1e-6
            ncc = (p*q).sum()/(pn*qn)
            if ncc > best: best, by, bx = ncc, dy, dx
    return (by, bx, best)

for mode in ['lock', 'free']:
    mid = load('dz_%s_mid' % mode)
    for other in ['near', 'far']:
        img = load('dz_%s_%s' % (mode, other))
        print('== %s: mid -> %s ==' % (mode, other))
        for k in bins:
            ds = []
            for (y, x) in centers[k]:
                patch = mid[y-PS:y+PS, x-PS:x+PS]
                dy, dx, ncc = drift(img, y, x, patch)
                if ncc > 0.5: ds.append(np.hypot(dy, dx))
            if ds: print('  %-16s mean drift %5.1f px  (n=%d)' % (k, float(np.mean(ds)), len(ds)))
            else: print('  %-16s no confident matches' % k)
