#!/usr/bin/env python3
"""Queue item 5: what a minute of layered colour + depth video costs, measured with a real codec on the synthetic video
shots (exact per-frame truth, 480x270), against the derived size of a Gaussian-splat scene.

Streams per shot, all x265 (bundled ffmpeg): colour (yuv420p, crf 20 and 28), depth (normalised disparity of the first hit,
gray12le, the largest crf whose decoded disparity stays within 2^-10 of the range at the 99th percentile -- the float16
storage precision the coverage tests already use), and the foreground alpha (gray, crf 20). Reported as bits per pixel
per frame and as MB per minute at 24 fps scaled to 1920x1080 by pixel count (bits per pixel are roughly resolution-
invariant at fixed quality; a flagged approximation).
Splats (derived, not measured): a 3D Gaussian carries 59 float32 parameters (position 3, scale 3, rotation 4, opacity 1,
spherical-harmonic colour to degree 3: 48) = 236 bytes.
  python3 size_budget.py --out DIR [--shots walker_tripod,truck_trunks,crowd_pan]
"""
import argparse, glob, json, os, subprocess, tempfile
import numpy as np, imageio_ffmpeg
ap = argparse.ArgumentParser(); ap.add_argument('--out', required=True); ap.add_argument('--root', default='/home/user/moebiusv2/harness/truthkit/out/video')
ap.add_argument('--shots', default='walker_tripod,truck_trunks,crowd_pan'); A = ap.parse_args(); os.makedirs(A.out, exist_ok=True)
FF = imageio_ffmpeg.get_ffmpeg_exe(); F16 = 2.0 ** -10

def enc(frames, pix_in, pix_out, crf, W, H, extra=()):
    with tempfile.TemporaryDirectory() as td:
        raw, mp4 = os.path.join(td, 'in.raw'), os.path.join(td, 'o.mp4'); np.concatenate([f.ravel() for f in frames]).tofile(raw)
        subprocess.run([FF, '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', pix_in, '-s', '%dx%d' % (W, H), '-r', '24', '-i', raw, '-c:v', 'libx265', '-crf', str(crf),
                        '-pix_fmt', pix_out, '-x265-params', 'log-level=error', *extra, mp4], check=True)
        size = os.path.getsize(mp4)
        dec = subprocess.run([FF, '-v', 'error', '-i', mp4, '-f', 'rawvideo', '-pix_fmt', pix_in, '-'], check=True, capture_output=True).stdout
        return size, dec

res = {}
for shot in A.shots.split(','):
    T = [np.load(f) for f in sorted(glob.glob(os.path.join(A.root, shot, 'truth_*.npz')))]
    H, W = T[0]['depth'].shape[:2]; n = len(T); px = W * H * n
    rgb = [np.ascontiguousarray(t['rgb'][..., 0, :]) for t in T]
    dep = np.stack([t['depth'][..., 0].astype(np.float32) for t in T]); inv = 1 / np.where(np.isfinite(dep), dep, np.inf)
    dn = (inv - inv.min()) / max(inv.max() - inv.min(), 1e-12); d16 = [np.round(x * 4095).astype('<u2') for x in dn]   # gray12le in 16-bit words
    al = [np.ascontiguousarray(t['alpha_thing']) for t in T]
    r = res[shot] = {'frames': n, 'W': W, 'H': H}
    for crf in (20, 28):
        s, _ = enc(rgb, 'rgb24', 'yuv420p', crf, W, H); r['colour_crf%d' % crf] = s * 8 / px
    best = None
    for crf in (0, 4, 8, 12, 16, 20, 24):
        s, dec = enc(d16, 'gray12le', 'gray12le', crf, W, H)
        e = np.abs(np.frombuffer(dec, '<u2').reshape(n, H, W).astype(np.float32) / 4095 - np.stack(d16).astype(np.float32) / 4095)
        p99 = float(np.percentile(e, 99)); r.setdefault('depth_scan', []).append({'crf': crf, 'bpp': s * 8 / px, 'p99': p99, 'max': float(e.max())})
        if p99 <= F16: best = {'crf': crf, 'bpp': s * 8 / px, 'p99': p99}
    r['depth_lossy_within'] = best
    # lossy depth rings at every silhouette (the p99 error above), so the arm that meets the precision rule is lossless
    s1, dec = enc(d16, 'gray12le', 'gray12le', 0, W, H, extra=('-x265-params', 'lossless=1:log-level=error'))
    ok = np.array_equal(np.frombuffer(dec, '<u2').reshape(n, H, W), np.stack(d16))
    with tempfile.TemporaryDirectory() as td:
        raw, mkv = os.path.join(td, 'in.raw'), os.path.join(td, 'o.mkv'); np.concatenate([f.ravel() for f in d16]).tofile(raw)
        subprocess.run([FF, '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'gray12le', '-s', '%dx%d' % (W, H), '-r', '24', '-i', raw, '-c:v', 'ffv1', '-level', '3', mkv], check=True)
        s2 = os.path.getsize(mkv)
    best = {'crf': 'lossless x265', 'bpp': s1 * 8 / px, 'exact': bool(ok), 'ffv1_bpp': s2 * 8 / px}
    r['depth'] = best
    s, _ = enc(al, 'gray', 'gray', 20, W, H); r['alpha_crf20'] = s * 8 / px
    per_min = lambda bpp: bpp * 1920 * 1080 * 24 * 60 / 8 / 1e6
    tot = r['colour_crf20'] + (best['bpp'] if best else float('nan')) + r['alpha_crf20']
    r['MB_per_min_1080p'] = {'colour': per_min(r['colour_crf20']), 'depth': per_min(best['bpp']) if best else None, 'alpha': per_min(r['alpha_crf20']), 'total': per_min(tot)}
    print('%-14s %d frames: colour %.3f bpp (crf20) %.3f (crf28) | depth %s | alpha %.3f bpp | 1080p24: %s MB/min' % (shot, n, r['colour_crf20'], r['colour_crf28'],
          ('lossless x265 %.3f bpp (exact %s), ffv1 %.3f bpp' % (best['bpp'], best['exact'], best['ffv1_bpp'])), r['alpha_crf20'],
          {k: round(v, 1) for k, v in r['MB_per_min_1080p'].items() if v is not None}), flush=True)
res['splat_bytes_per_gaussian'] = 236
json.dump(res, open(os.path.join(A.out, 'size_budget.json'), 'w'), indent=1)
