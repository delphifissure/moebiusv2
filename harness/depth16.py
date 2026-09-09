#!/usr/bin/env python3
"""Write an estimator's depth as the 16-bit PNG the app ingests at full precision.

The app (moebius.js, bgDecodeDepth16) reads a 16-bit, single-channel, non-interlaced PNG directly and
takes sample/65535 as the normalised depth d in [0, 1]: bright = near, d = 1 at the volume's near end
(inner), d = 0 at its far end (outer), the portal plane at d = pn (0.5 by default). An 8-bit PNG goes
through the ordinary image path at 1/255 — on an 8.6 m scene that quantum is metres at the far end
(truth kit, S15: band depth median 3.4 m at 8 bits, 0.18 m at 16).

Input: a float array from the estimator —
  .npy / .npz (first array), .pfm, .exr (first channel; needs OpenEXR or imageio), 16-bit .tif/.tiff/.png,
  or an 8-bit image (re-exported unchanged: there is nothing to gain, and the script says so).
--kind disparity  (default; MiDaS / Depth Anything style relative inverse depth, larger = nearer)
--kind depth      (metric or relative depth, larger = farther: converted to 1/depth first)
Normalisation is linear min–max of the (inverse) depth, the same mapping an 8-bit export uses, so the
depth law sees the same picture at 256x the resolution. --lo/--hi override the range (percentiles
clip outliers: --lo-pct 0.1 --hi-pct 99.9).

  python3 harness/depth16.py in.npy out.png [--kind disparity|depth] [--lo-pct P] [--hi-pct P] [--invert]
"""
import argparse, os, sys, zlib, struct
import numpy as np


def load(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == '.npy': return np.load(path).astype(np.float64), 'float'
    if ext == '.npz':
        z = np.load(path); return z[z.files[0]].astype(np.float64), 'float'
    if ext == '.pfm':
        with open(path, 'rb') as f:
            hdr = f.readline().decode().strip(); w, h = map(int, f.readline().decode().split()); sc = float(f.readline().decode().strip())
            data = np.fromfile(f, '<f4' if sc < 0 else '>f4')
        ch = 3 if hdr == 'PF' else 1; a = data.reshape(h, w, ch)[::-1]; return (a[..., 0] if ch == 3 else a[..., 0]).astype(np.float64), 'float'
    if ext == '.exr':
        try:
            import imageio.v3 as iio; a = np.asarray(iio.imread(path)); a = a[..., 0] if a.ndim == 3 else a; return a.astype(np.float64), 'float'
        except Exception as e: sys.exit('EXR needs imageio with an EXR plugin: ' + str(e))
    from PIL import Image
    im = Image.open(path)
    if im.mode in ('I;16', 'I;16B', 'I;16L', 'I'): return np.asarray(im).astype(np.float64), '16'
    if im.mode == 'F': return np.asarray(im).astype(np.float64), 'float'
    return np.asarray(im.convert('L')).astype(np.float64), '8'


def write_png16(path, u16):
    h, w = u16.shape; raw = b''.join(b'\x00' + row.astype('>u2').tobytes() for row in u16)
    def chunk(t, d): c = struct.pack('>I', len(d)) + t + d; return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', w, h, 16, 0, 0, 0, 0)   # 16-bit greyscale, no interlace
    with open(path, 'wb') as f: f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('src'); ap.add_argument('dst')
    ap.add_argument('--kind', choices=['disparity', 'depth'], default='disparity')
    ap.add_argument('--lo', type=float); ap.add_argument('--hi', type=float)
    ap.add_argument('--lo-pct', type=float, default=0.0); ap.add_argument('--hi-pct', type=float, default=100.0)
    ap.add_argument('--invert', action='store_true', help='flip bright/dark after normalisation')
    a = ap.parse_args()
    arr, kind = load(a.src)
    if kind == '8':
        print('WARNING: the source is 8-bit; re-exported as 16-bit PNG with the same 256 levels — nothing gained. Export the estimator at float or 16 bits.')
        d = arr / 255.0
    else:
        v = arr.copy(); v[~np.isfinite(v)] = np.nan
        if a.kind == 'depth':
            v = np.where(v > 0, 1.0 / np.maximum(v, 1e-12), np.nan)
        lo = a.lo if a.lo is not None else np.nanpercentile(v, a.lo_pct); hi = a.hi if a.hi is not None else np.nanpercentile(v, a.hi_pct)
        if not hi > lo: sys.exit('degenerate range %g..%g' % (lo, hi))
        d = np.clip((np.nan_to_num(v, nan=lo) - lo) / (hi - lo), 0, 1)
        levels = len(np.unique(np.round(d * 65535)))
        print('source: %s, %dx%d, %s in [%g, %g] -> normalised (inverse) depth; %d distinct 16-bit levels (an 8-bit export would keep at most 256)' % (kind, arr.shape[1], arr.shape[0], a.kind, lo, hi, levels))
    if a.invert: d = 1 - d
    write_png16(a.dst, np.round(d * 65535).astype(np.uint16))
    print('wrote', a.dst, '(16-bit greyscale PNG, bright = near; the app logs "[QUICK-BAKE] a99: depth read at 16-bit precision" when it takes this path)')


if __name__ == '__main__': main()
