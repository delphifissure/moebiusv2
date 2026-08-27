#!/usr/bin/env python3
"""Per-frame 3DGS .ply directory -> .splat sequence + manifest.json.

Converts trained 3DGS plys (train_sequence.py output, or any per-frame set)
into the antimatter .splat frames + manifest the moebius splat layer and
fourd/splat.html play. Stdlib only — no numpy/plyfile needed.

Decode/encode identities (same constants as fourd/splat_renderer.js):
  color  = 0.5 + SH_C0 * f_dc          (DC band only)
  alpha  = sigmoid(opacity_logit)
  scale  = exp(scale_log)
  quat   stored as byte = c*128+128, order (w, x, y, z), normalized

Subject metadata: center/height from the 2nd..98th percentile bbox of frame
0's splats with alpha > 0.3 — trained splats grow far-flung low-opacity
floaters, and a min/max bbox would hand the portal framing to them.

  python ply_to_sequence.py --ply_dir seq_out/ply --out_dir assets_seq [--fps 12] [--max_splats 0]
"""
from __future__ import annotations
import argparse, array, json, math, struct
from pathlib import Path

SH_C0 = 0.28209479177387814


def read_3dgs_ply(path: Path):
    raw = path.read_bytes()
    head_end = raw.index(b'end_header') + len(b'end_header') + 1
    header = raw[:head_end].decode('ascii', 'replace')
    if 'binary_little_endian' not in header:
        raise SystemExit(f'{path}: only binary_little_endian supported')
    n = 0; props = []
    for line in header.splitlines():
        t = line.split()
        if len(t) >= 3 and t[0] == 'element' and t[1] == 'vertex': n = int(t[2])
        elif len(t) >= 3 and t[0] == 'property':
            if t[1] != 'float': raise SystemExit(f'{path}: non-float property {t[2]}')
            props.append(t[2])
    f = array.array('f'); f.frombytes(raw[head_end:head_end + n * len(props) * 4])
    idx = {p: i for i, p in enumerate(props)}
    need = ['x','y','z','f_dc_0','f_dc_1','f_dc_2','opacity','scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3']
    for k in need:
        if k not in idx: raise SystemExit(f'{path}: missing property {k}')
    return f, len(props), n, idx


def convert(path: Path, max_splats: int):
    f, stride, n, idx = read_3dgs_ply(path)
    order = range(n)
    if max_splats and n > max_splats:
        # importance = opacity * mean scale; keep the top max_splats, SAY SO
        def imp(i):
            o = i * stride
            a = 1 / (1 + math.exp(-f[o + idx['opacity']]))
            s = (f[o + idx['scale_0']] + f[o + idx['scale_1']] + f[o + idx['scale_2']]) / 3
            return a * math.exp(s)
        order = sorted(range(n), key=imp, reverse=True)[:max_splats]
        print(f'  {path.name}: pruned {n} -> {max_splats} by opacity*scale (explicit --max_splats)')
    out = bytearray()
    recs = []
    for i in order:
        o = i * stride
        x, y, z = f[o + idx['x']], f[o + idx['y']], f[o + idx['z']]
        sx, sy, sz = (math.exp(f[o + idx['scale_' + str(k)]]) for k in range(3))
        a = 1 / (1 + math.exp(-f[o + idx['opacity']]))
        rgb = [max(0, min(255, int((0.5 + SH_C0 * f[o + idx['f_dc_' + str(k)]]) * 255))) for k in range(3)]
        q = [f[o + idx['rot_' + str(k)]] for k in range(4)]  # (w, x, y, z), unnormalized
        ql = math.sqrt(sum(c * c for c in q)) or 1.0
        q = [c / ql for c in q]
        out += struct.pack('<3f3f', x, y, z, sx, sy, sz)
        out += bytes(rgb) + bytes([max(0, min(255, int(a * 255)))])
        out += bytes(max(0, min(255, int(c * 128 + 128))) for c in q)
        recs.append((x, y, z, a))
    return bytes(out), recs


def subject_from(recs):
    solid = [(x, y, z) for x, y, z, a in recs if a > 0.3] or [(x, y, z) for x, y, z, _ in recs]
    def pct(vals, p):
        s = sorted(vals); return s[min(len(s) - 1, int(p * len(s)))]
    lo = [pct([v[k] for v in solid], 0.02) for k in range(3)]
    hi = [pct([v[k] for v in solid], 0.98) for k in range(3)]
    return { 'center': [(lo[k] + hi[k]) / 2 for k in range(3)],
             'height': max(1e-6, hi[1] - lo[1]) }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--ply_dir', required=True, type=Path)
    ap.add_argument('--out_dir', required=True, type=Path)
    ap.add_argument('--fps', type=float, default=12)
    ap.add_argument('--max_splats', type=int, default=0, help='0 = keep all (default)')
    a = ap.parse_args()
    plys = sorted(a.ply_dir.glob('*.ply'))
    if not plys: raise SystemExit(f'no .ply in {a.ply_dir}')
    a.out_dir.mkdir(parents=True, exist_ok=True)
    frames, subject = [], None
    for k, p in enumerate(plys):
        data, recs = convert(p, a.max_splats)
        name = f'frame_{k:03d}.splat'
        (a.out_dir / name).write_bytes(data)
        frames.append(name)
        if subject is None: subject = subject_from(recs)
        print(f'  {p.name} -> {name} ({len(recs)} splats)')
    (a.out_dir / 'manifest.json').write_text(json.dumps({
        'kind': 'splat-sequence', 'fps': a.fps, 'frames': frames, 'subject': subject,
        'note': 'converted by fourd/gpu/ply_to_sequence.py',
    }, indent=2))
    print(f'{len(frames)} frames + manifest.json -> {a.out_dir}')


if __name__ == '__main__':
    main()
