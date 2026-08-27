# 4DAnyone → animated splat sequence (GPU runbook)

Turns a 4DAnyone output rig into the animated 4D splat the moebius portal
plays. Runs on a GPU box (their generator wants 32 GB+ VRAM; per-frame
splat training fits on much less). Nothing here runs in the sandbox — the
first full run is the integration test, and every subprocess command is
echoed so version drift in nerfstudio flags is a one-line fix.

## One-time setup

1. 4DAnyone env per their README (`conda create -n 4danyone ...`).
2. nerfstudio env per their docs/nerfstudio.md (splatfacto), plus
   `pip install huggingface-hub safetensors` in the 4danyone env.

## Produce the rig (their step)

```bash
python inference.py --video_path <your_video.mp4> --views_per_layer 24
# -> data/fdanyone/<clip>/  (videos/dense/*.mp4 + cameras.json)
```

Front-arc rigs (`--views_per_layer 8 --start_yaw -90 --yaw_span 180`) train
fine for portal use — the portal only ever looks from the front cone.

## Train the sequence (our step)

```bash
python fourd/gpu/train_sequence.py \
    --fourd_repo ~/4DAnyone \
    --result_dir ~/4DAnyone/data/fdanyone/<clip> \
    --out_dir ~/seq_out --frames 0:121:2 \
    --first_iters 12000 --warm_iters 3000 \
    --fourd_python ~/miniconda3/envs/4danyone/bin/python \
    --ns_prefix "conda run -n nerfstudio"
```

- Frame 0 trains from 4DAnyone's visual-hull seed (`first_iters`); every
  later frame is warm-seeded from the previous frame's trained centers and
  trains `warm_iters` — the Dynamic3DGS-style speedup in its simplest
  reproducible form (geometry seed; appearance re-optimizes).
- Resumable: `progress.json` skips finished frames; re-run the same command
  after any crash.
- `--frames 0:121:2` = 61 frames at half rate; start there, go 1-step once
  timing is known.

## Convert for the portal

```bash
python fourd/gpu/ply_to_sequence.py --ply_dir ~/seq_out/ply --out_dir <repo>/fourd/assets_<clip> --fps 12
```

Then either:
- moebius: layer modal → color slot → select ALL `frame_*.splat` files at
  once (multi-select = one 4D sequence layer), or point a preset at the
  `manifest.json` URL;
- or `fourd/splat.html?asset=/fourd/assets_<clip>/manifest.json`.

## Known limits (recorded, not hidden)

- Per-frame sequences trade storage for simplicity (~tens of MB per frame
  uncompressed; `--max_splats` prunes explicitly and says so). The durable
  single-file 4D format (SpacetimeGaussians-style motion coefficients) is
  slice (c).
- Temporal shimmer at silhouettes is inherent to independent per-frame
  optimization; warm seeding reduces it, does not eliminate it.
- 4DAnyone's own note: their paper's 4DGS (FreeTimeGS) is not public; this
  per-frame route is the reproducible one they also point to (splatfacto).
