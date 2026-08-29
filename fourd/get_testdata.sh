#!/usr/bin/env bash
# fourd/get_testdata.sh — fetch the 16-test real-scene corpus into
# fourd/testdata/ (gitignored; assets are pulled from their own public repos
# at test time, never redistributed by us).
#
# Needs: git, node. Optional: cmake + a C++ toolchain (builds the
# nianticlabs reference CLI to regenerate the two conformance ground-truth
# plys; without it those two files are skipped and tests T14/B1 will fail —
# everything else runs).
#
#   bash fourd/get_testdata.sh
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p testdata
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "== BabylonJS/Assets (splats: lizard, racoon, unicorn, plants, skull, sqwakers, fire pit, DC border, combined v3)"
git clone -q --depth 1 --filter=blob:none --sparse https://github.com/BabylonJS/Assets "$TMP/bab"
git -C "$TMP/bab" sparse-checkout set splats -q 2>/dev/null || git -C "$TMP/bab" sparse-checkout set splats
for f in hornedlizard.spz hornedlizard.splat racoonfamily.spz combined_SPZv3.spz combined_SPZv3.ply \
         Unicorn_Stuffy.ply DC_border.ply gs_Fire_Pit.splat gs_Plants.splat gs_Skull.splat gs_Sqwakers_trimed.splat; do
  cp "$TMP/bab/splats/$f" testdata/
done

echo "== playcanvas/engine (biker.spz, v4) + playcanvas/splat-transform (format fixtures)"
git clone -q --depth 1 --filter=blob:none --no-checkout https://github.com/playcanvas/engine "$TMP/pce"
git -C "$TMP/pce" checkout -q HEAD -- examples/assets/splats/biker.spz
cp "$TMP/pce/examples/assets/splats/biker.spz" testdata/
git clone -q --depth 1 --filter=blob:none --no-checkout https://github.com/playcanvas/splat-transform "$TMP/pst"
git -C "$TMP/pst" checkout -q HEAD -- test/fixtures/splat
cp "$TMP/pst/test/fixtures/splat/minimal-v4.spz" "$TMP/pst/test/fixtures/splat/minimal-v2.spz" \
   "$TMP/pst/test/fixtures/splat/minimal.ksplat" testdata/

echo "== antimatter15/splaTV (flame_steak — Neural 3D Video, dynamic .splatv)"
git clone -q --depth 1 --filter=blob:none --no-checkout https://github.com/antimatter15/splaTV "$TMP/stv"
git -C "$TMP/stv" checkout -q HEAD -- model.splatv
cp "$TMP/stv/model.splatv" testdata/flame_steak.splatv

echo "== nianticlabs/spz reference CLI (conformance ground truth for T14/B1)"
if command -v cmake >/dev/null 2>&1; then
  git clone -q --depth 1 https://github.com/nianticlabs/spz "$TMP/spz"
  if (cd "$TMP/spz" && cmake -B build -DCMAKE_BUILD_TYPE=Release >/dev/null 2>&1 \
      && cmake --build build -j4 >/dev/null 2>&1); then
    "$TMP/spz/build/spz_to_ply" testdata/biker.spz testdata/biker_ref.ply
    "$TMP/spz/build/spz_to_ply" testdata/combined_SPZv3.spz testdata/combined_ref.ply
    echo "   reference plys regenerated."
  else
    echo "   WARNING: reference CLI build failed — T14 and B1 will FAIL (no ground truth)."
  fi
else
  echo "   WARNING: cmake not found — T14 and B1 will FAIL (no ground truth)."
fi

echo "== done. $(ls testdata | wc -l) files in fourd/testdata/"
echo "   run:  node fourd/realscene_tests.js"
