# Testing splats in moebius — instructions

## Manual (the usual workflow)

1. Pull, serve the repo (`node fourd/server.js` → http://localhost:8098, or
   your usual server), open `moebius.html`.
2. Layer modal → **+ Add Layer** → the **Color** slot accepts splat files
   alongside images/video: `.splat`, 3DGS `.ply`, `.spz` (v1–v4),
   SpacetimeGaussians `.ply`, `.splatv`.
   - **One file** → static splat layer (or auto-playing 4D if the file is a
     SpacetimeGaussians ply / .splatv).
   - **Multi-select several `.splat`/`.ply` frames** → one 4D sequence layer
     (natural filename order, plays at 12 fps by default).
   - If a scene imports **upside down**, tick **"splat is y-up (skip
     flip)"** on that layer: most 3DGS content is y-down (COLMAP heritage)
     and flips by default; some producers (PlayCanvas spz) author y-up.
3. Apply. The splat is real geometry in the same portal: head tracking,
   off-axis projection, and mixing with 2.5D layers all just work. The
   debug sheet stamp shows `splat=<layers>L/<total splats>[dyn]`.

Everything lives in `moebius.js` — no extra script tags, single file as
always.

## Automated suites

The test scenes are third-party assets we don't redistribute, so
`fourd/testdata/` is gitignored — fetch it once per clone:

```bash
bash fourd/get_testdata.sh        # pulls scenes from their public repos
                                  # (optionally builds the Niantic reference
                                  # CLI for the two conformance tests)
node fourd/realscene_tests.js     # 16 real-scene tests IN moebius
node fourd/moebius_splat_test.js  # T1-T6 integration regression
```

- **realscene_tests.js** — loads 12 real captures as layers inside
  `scratch_moebius.html` (troll scene present), sweeps the eye, checks
  coverage/view-dependence, cross-format render agreement, numeric decoder
  conformance against the Niantic reference implementation, a real dynamic
  scene (flame_steak), and that the baked 2.5D gap set stays bit-exact
  (99907/3769) with a splat loaded. Tiles + `results.json` land in
  `fourd/shots/realscenes/`; `python3 fourd/mk_realscene_sheet.py` builds
  the contact sheet (needs `pip install pillow`).
- **moebius_splat_test.js** — the fast regression: isolation, composite,
  spz round-trip, 4D sequence, spacetime motion + temporal window.

Both exit 0 on all-pass. They drive headless Chromium via playwright-core
and serve on ports 8098/8099 — run them one at a time.

## Where to get free splats to test with

On your own machine (no proxy restrictions), best first stops:

1. **Hugging Face `cakewalk/splat-data`** — the classic antimatter15 demo
   set as ready-to-use `.splat`: `train`, `truck` (Tanks & Temples),
   `garden`, `bicycle`, `stump` (Mip-NeRF 360), `plush`. These are THE
   research benchmark scenes, converted from the official INRIA pre-trained
   models. Research-use licensing.
   `https://huggingface.co/datasets/cakewalk/splat-data`
2. **Official INRIA pre-trained models** — every Mip-NeRF 360 / T&T / Deep
   Blending scene as full-quality 3DGS `point_cloud.ply` (14 GB zip linked
   from the graphdeco-inria/gaussian-splatting README). Heaviest fidelity;
   multi-million splats.
3. **superspl.at gallery (PlayCanvas)** — thousands of user captures, many
   CC0/CC-BY (license shown per scene). Open a scene in the SuperSplat
   editor and export as `.ply` or compressed — export **standard ply or
   .splat**, not "compressed.ply"/SOGS (not supported yet).
4. **Scaniverse spz samples** (`scaniverse.com/spz`) and any Scaniverse
   capture you export — compact `.spz`, the most bandwidth-efficient format
   we support.
5. **Polycam explore gallery** — free account, per-capture licenses,
   exports gaussian splat `.ply`.

Performance guidance for the current renderer (CPU counting-sort + gather
per eye move): **up to ~1M splats is comfortable** (the 932k racoon sample
runs fine); the 5.8M-splat INRIA `bicycle` will sort slowly — prune on
export (SuperSplat can), or wait for the GPU-sort slice. `.spz`/`.splat`
load fastest; view-dependent color (SH bands) is not rendered yet, so
scenes relying on shiny materials will look flatter than in other viewers.

Not supported (clearly refused with a message): `.ksplat`, SOGS/webp
"compressed.ply". Convert those to `.ply`/`.splat` first.
