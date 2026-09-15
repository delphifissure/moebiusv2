#!/usr/bin/env python3
"""S32: compare two live_repro dumps (per-line law vs 2-D plate) of the same picture.
  python3 harness/plate_compare.py harness/shots/liverepro/troll_line harness/shots/liverepro/troll_plate_edge
Reports, over the band texels with a far side (disocc & plateF < dQ - q): the fraction whose far field changed and by how
much; the row structure of the far field — the median absolute difference between vertically adjacent band texels
(row-to-row, what the eye reads as streaks) against horizontally adjacent ones (along the row), and their ratio; and the
same for the plate depth actually rendered. Depth is the app's normalised disparity (1 near, 0 far)."""
import sys, json, numpy as np
A, B = sys.argv[1], sys.argv[2]
def load(d):
    sz = json.load(open(f'{d}/size.json')); pw, ph = sz['pw'], sz['ph']
    ff = np.fromfile(f'{d}/farField.f32', np.float32).reshape(ph, pw); dis = np.fromfile(f'{d}/disocc.u8', np.uint8).reshape(ph, pw) > 0
    pf = np.fromfile(f'{d}/plateF.f32', np.float32).reshape(ph, pw)[::-1]; dq = np.fromfile(f'{d}/dQ.f32', np.float32).reshape(ph, pw)
    return pw, ph, ff, dis, pf, dq
pwA, phA, ffA, disA, pfA, dqA = load(A); pwB, phB, ffB, disB, pfB, dqB = load(B); assert (pwA, phA) == (pwB, phB)
q = 4 / 65535
band = disA & (pfA < dqA - q)   # the reference arm's band with a far side
def rowcol(f, m):
    v = m[1:, :] & m[:-1, :]; h = m[:, 1:] & m[:, :-1]
    dv = np.abs(f[1:, :] - f[:-1, :])[v]; dh = np.abs(f[:, 1:] - f[:, :-1])[h]
    return float(np.median(dv)), float(np.median(dh)), float(np.mean(dv)), float(np.mean(dh))
print(f'band texels with a far side: {int(band.sum())}')
ch = band & (np.abs(ffA - ffB) > 1e-7)
print(f'far field changed on {int(ch.sum())} band texels ({100 * ch.sum() / max(1, band.sum()):.1f} %); median |change| {np.median(np.abs(ffA - ffB)[ch]) if ch.any() else 0:.5f}, p90 {np.percentile(np.abs(ffA - ffB)[ch], 90) if ch.any() else 0:.5f} (depth units; effective quantum ~0.00176 on the troll)')
for name, fa, fb in (('far field', ffA, ffB), ('plate depth (rendered)', pfA, pfB)):
    a = rowcol(fa, band); b = rowcol(fb, band)
    print(f'{name}: row-to-row median |d| {a[0]:.5f} -> {b[0]:.5f}; along-row median |d| {a[1]:.5f} -> {b[1]:.5f}; anisotropy row/along {a[0] / max(1e-9, a[1]):.2f} -> {b[0] / max(1e-9, b[1]):.2f}; means row {a[2]:.5f} -> {b[2]:.5f}, along {a[3]:.5f} -> {b[3]:.5f}')
# jumps larger than the visible step between vertically adjacent band texels (a seam the eye can see)
step = 0.00176
for name, f in (('A', ffA), ('B', ffB)):
    v = band[1:, :] & band[:-1, :]; dv = np.abs(f[1:, :] - f[:-1, :])[v]
    print(f'{name}: vertical band edges with |d| > visible step: {int((dv > step).sum())} of {int(v.sum())} ({100 * (dv > step).mean():.1f} %)')
