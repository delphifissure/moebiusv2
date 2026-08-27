#!/usr/bin/env python3
"""4DAnyone output rig -> SpacetimeGaussians (Neural3D-style) training input.

SpacetimeGaussians' Neural3D path expects a scene folder of per-camera videos
cam00.mp4..camNN.mp4 plus poses_bounds.npy (LLFF layout), which its
pre_n3d.py then expands into per-timestamp COLMAP models. A 4DAnyone result
already IS per-camera synchronized video + exact poses, so this converter is
mostly renaming plus the LLFF pose convention.

Conventions (documented, validate on first real run):
  - cameras.json camera_to_world is OpenCV (columns right/down/forward).
  - LLFF poses_bounds stores c2w rows as a 3x5 [R | t | hwf] with rotation
    columns [down, right, backwards] and hwf = (image_h, image_w, focal).
    From OpenCV columns (c0, c1, c2): down = c1, right = c0, back = -c2.
  - near/far bounds: distance from each camera to the rig centroid, with a
    +/-60% margin — a HEURISTIC (4DAnyone subjects fill a ~2m capsule at rig
    center); tighten if their preprocessing complains.

Stdlib only (writes the .npy header by hand).

  python fourd_to_stg.py --result_dir data/fdanyone/<clip> --out_dir ~/stg/<clip> [--link]
"""
from __future__ import annotations
import argparse, json, os, shutil, struct
from pathlib import Path


def write_npy_f8(path: Path, rows: list[list[float]]):
    n, m = len(rows), len(rows[0])
    header = "{'descr': '<f8', 'fortran_order': False, 'shape': (%d, %d), }" % (n, m)
    pad = 64 - ((10 + len(header) + 1) % 64)
    header = header + ' ' * pad + '\n'
    with open(path, 'wb') as f:
        f.write(b'\x93NUMPY\x01\x00')
        f.write(struct.pack('<H', len(header)))
        f.write(header.encode('ascii'))
        for r in rows:
            for v in r: f.write(struct.pack('<d', float(v)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--result_dir', required=True, type=Path)
    ap.add_argument('--out_dir', required=True, type=Path)
    ap.add_argument('--link', action='store_true', help='hardlink videos instead of copying')
    a = ap.parse_args()
    rig = json.loads((a.result_dir / 'cameras.json').read_text())
    cams = rig['cameras']
    a.out_dir.mkdir(parents=True, exist_ok=True)
    # rig centroid for bounds
    centers = []
    for c in cams:
        m = c['camera_to_world']
        centers.append((m[0][3], m[1][3], m[2][3]))
    cx = sum(p[0] for p in centers) / len(centers)
    cy = sum(p[1] for p in centers) / len(centers)
    cz = sum(p[2] for p in centers) / len(centers)
    rows = []
    for c in cams:
        cid = int(c['camera_id'])
        src = a.result_dir / c['video']
        dst = a.out_dir / f'cam{cid:02d}.mp4'
        if not dst.exists():
            os.link(src, dst) if a.link else shutil.copy2(src, dst)
        m = c['camera_to_world']  # 3x4 or 4x4, OpenCV c2w
        c0 = (m[0][0], m[1][0], m[2][0])   # right
        c1 = (m[0][1], m[1][1], m[2][1])   # down
        c2 = (m[0][2], m[1][2], m[2][2])   # forward
        t = (m[0][3], m[1][3], m[2][3])
        K = c['K']
        focal = (K[0][0] + K[1][1]) / 2
        h, w = c['image_height'], c['image_width']
        # rows of the 3x5: [down | right | back | t | hwf], row-major flatten
        llff = []
        for r in range(3):
            llff += [c1[r], c0[r], -c2[r], t[r], (h, w, focal)[r]]
        d = ((t[0] - cx) ** 2 + (t[1] - cy) ** 2 + (t[2] - cz) ** 2) ** 0.5
        rows.append(llff + [max(0.05, d * 0.4), d * 1.6])
    write_npy_f8(a.out_dir / 'poses_bounds.npy', rows)
    print(f'{len(cams)} cameras -> {a.out_dir} (cam*.mp4 + poses_bounds.npy)')
    print('next (SpacetimeGaussians repo): python script/pre_n3d.py --videopath', a.out_dir)


if __name__ == '__main__':
    main()
