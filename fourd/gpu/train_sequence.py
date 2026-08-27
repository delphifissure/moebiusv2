#!/usr/bin/env python3
"""4DAnyone rig -> per-frame 3DGS sequence (warm-started), for the moebius 4D portal.

Wraps 4DAnyone's OWN exporter (scripts/export_nerfstudio.py, one synchronized
timestamp -> splatfacto-ready dataset with visual-hull init + masks) in a loop
over time steps, trains each with nerfstudio splatfacto, warm-starting frame
t>start from frame t-1's trained splat (previous centers become the next
frame's seed point cloud), and exports one 3DGS .ply per frame. Feed the
result to ply_to_sequence.py to get the .splat frames + manifest.json the
moebius splat layer plays.

Honest scope:
  - The warm start seeds GEOMETRY (splatfacto initializes gaussian means from
    the dataset's sparse_pcd.ply); appearance re-optimizes per frame. That is
    the Dynamic3DGS-style speedup in its simplest reproducible form, not full
    parameter carry-over.
  - nerfstudio CLI flags drift between versions; every subprocess command is
    echoed before running so a flag mismatch is a one-line fix, not a mystery.
  - This runs on the GPU box (4DAnyone env + a nerfstudio env), NOT in the
    sandbox this file was written in — treat the first full run as the test.

Usage (both conda envs installed per the two projects' docs):
  python train_sequence.py \
      --fourd_repo ~/4DAnyone --result_dir ~/4DAnyone/data/fdanyone/<clip> \
      --out_dir ~/seq_out --frames 0:121:2 \
      --first_iters 12000 --warm_iters 3000 \
      --fourd_python ~/miniconda3/envs/4danyone/bin/python \
      --ns_prefix "conda run -n nerfstudio"
"""
from __future__ import annotations
import argparse, json, shutil, struct, subprocess, sys, time
from pathlib import Path


def sh(cmd: list[str] | str, cwd=None):
    printable = cmd if isinstance(cmd, str) else ' '.join(str(c) for c in cmd)
    print(f'[train_sequence] $ {printable}', flush=True)
    subprocess.run(cmd, cwd=cwd, shell=isinstance(cmd, str), check=True)


def read_3dgs_ply_positions_colors(path: Path, max_points: int):
    """Minimal binary 3DGS .ply reader -> (positions, rgb bytes) for seeding."""
    raw = path.read_bytes()
    head_end = raw.index(b'end_header') + len(b'end_header') + 1
    header = raw[:head_end].decode('ascii', 'replace')
    n = 0; props = []
    for line in header.splitlines():
        t = line.split()
        if len(t) >= 3 and t[0] == 'element' and t[1] == 'vertex': n = int(t[2])
        elif len(t) >= 3 and t[0] == 'property': props.append(t[2])
    if 'binary_little_endian' not in header:
        raise SystemExit(f'{path}: only binary_little_endian 3DGS ply supported')
    stride = len(props)
    idx = {p: i for i, p in enumerate(props)}
    import array
    f = array.array('f'); f.frombytes(raw[head_end:head_end + n * stride * 4])
    step = max(1, n // max_points)
    SH_C0 = 0.28209479177387814
    pts, cols = [], []
    for i in range(0, n, step):
        o = i * stride
        pts.append((f[o + idx['x']], f[o + idx['y']], f[o + idx['z']]))
        def col(k):
            v = 0.5 + SH_C0 * f[o + idx[k]]
            return max(0, min(255, int(v * 255)))
        cols.append((col('f_dc_0'), col('f_dc_1'), col('f_dc_2')))
    return pts, cols


def write_seed_ply(path: Path, pts, cols):
    """ASCII ply point cloud, the format nerfstudio reads for seed points."""
    with open(path, 'w') as fh:
        fh.write('ply\nformat ascii 1.0\n')
        fh.write(f'element vertex {len(pts)}\n')
        fh.write('property float x\nproperty float y\nproperty float z\n')
        fh.write('property uchar red\nproperty uchar green\nproperty uchar blue\n')
        fh.write('end_header\n')
        for p, c in zip(pts, cols):
            fh.write(f'{p[0]:.6f} {p[1]:.6f} {p[2]:.6f} {c[0]} {c[1]} {c[2]}\n')


def find_latest_config(ns_out: Path, exp: str) -> Path:
    cands = sorted(ns_out.glob(f'{exp}/*/*/config.yml'), key=lambda p: p.stat().st_mtime)
    if not cands:
        raise SystemExit(f'no config.yml under {ns_out}/{exp} — did ns-train finish?')
    return cands[-1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fourd_repo', required=True, type=Path)
    ap.add_argument('--result_dir', required=True, type=Path, help='data/fdanyone/<clip>')
    ap.add_argument('--out_dir', required=True, type=Path)
    ap.add_argument('--frames', default='0:121:1', help='start:stop:step over the 121 time steps')
    ap.add_argument('--first_iters', type=int, default=12000)
    ap.add_argument('--warm_iters', type=int, default=3000)
    ap.add_argument('--method', default='splatfacto')
    ap.add_argument('--fourd_python', default=sys.executable, help='python of the 4danyone env')
    ap.add_argument('--ns_prefix', default='', help='e.g. "conda run -n nerfstudio"')
    ap.add_argument('--seed_max_points', type=int, default=100000)
    ap.add_argument('--ns_extra', default='', help='extra ns-train args appended verbatim')
    a = ap.parse_args()

    start, stop, step = (int(x) for x in a.frames.split(':'))
    frames = list(range(start, stop, step))
    a.out_dir.mkdir(parents=True, exist_ok=True)
    ply_dir = a.out_dir / 'ply'; ply_dir.mkdir(exist_ok=True)
    state_path = a.out_dir / 'progress.json'
    state = json.loads(state_path.read_text()) if state_path.exists() else {'done': []}
    clip = a.result_dir.name
    ns_out = a.out_dir / 'ns'
    prev_ply = None
    for k, t in enumerate(frames):
        tag = f'frame_{t:03d}'
        out_ply = ply_dir / f'{tag}.ply'
        if t in state['done'] and out_ply.exists():
            prev_ply = out_ply
            print(f'[train_sequence] {tag} already done, skipping'); continue
        t0 = time.time()
        # 1. per-timestamp dataset via 4DAnyone's own exporter
        ds = a.fourd_repo / 'data' / 'nerfstudio' / clip / tag
        if not (ds / 'transforms.json').exists():
            sh([str(a.fourd_python), 'scripts/export_nerfstudio.py',
                '--result_dir', str(a.result_dir), '--frame_index', str(t)], cwd=a.fourd_repo)
        # 2. warm start: previous frame's centers replace the visual hull
        iters = a.first_iters if prev_ply is None else a.warm_iters
        if prev_ply is not None:
            pts, cols = read_3dgs_ply_positions_colors(prev_ply, a.seed_max_points)
            seed = ds / 'sparse_pcd.ply'
            shutil.copy2(seed, ds / 'sparse_pcd.visualhull.ply') if not (ds / 'sparse_pcd.visualhull.ply').exists() else None
            write_seed_ply(seed, pts, cols)
            print(f'[train_sequence] {tag}: warm-seeded {len(pts)} pts from {prev_ply.name}')
        # 3. train
        cmd = (f'{a.ns_prefix} ns-train {a.method} --data {ds} --output-dir {ns_out} '
               f'--experiment-name {tag} --max-num-iterations {iters} '
               f'--pipeline.model.background-color random '
               f'--viewer.quit-on-train-completion True {a.ns_extra}').strip()
        sh(cmd)
        # 4. export the frame's splat
        cfg = find_latest_config(ns_out, tag)
        exp_dir = a.out_dir / 'export' / tag
        sh(f'{a.ns_prefix} ns-export gaussian-splat --load-config {cfg} --output-dir {exp_dir}'.strip())
        produced = sorted(exp_dir.glob('*.ply'), key=lambda p: p.stat().st_size)
        if not produced: raise SystemExit(f'{tag}: ns-export produced no .ply')
        shutil.copy2(produced[-1], out_ply)
        prev_ply = out_ply
        state['done'].append(t); state_path.write_text(json.dumps(state))
        print(f'[train_sequence] {tag} done in {time.time()-t0:.0f}s ({k+1}/{len(frames)})')
    print(f'[train_sequence] all {len(frames)} frames -> {ply_dir}')
    print('next: python ply_to_sequence.py --ply_dir', ply_dir, '--out_dir <assets>')


if __name__ == '__main__':
    main()
