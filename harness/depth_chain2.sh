#!/bin/bash
set -x
export NODE_PATH=/opt/node22/lib/node_modules/playwright/node_modules:/opt/node22/lib/node_modules
cd /workspace/moebiusv2/harness
cp ../defaultImgColor.png defaultImgColor.png
cp ../defaultImgDepth.png defaultImgDepth.png
node depth_dump.js fr2d
echo "=== fr depth v2 done ==="
cp ../silverwarrior_color.png defaultImgColor.png
cp ../silverwarrior_depth.png defaultImgDepth.png
node depth_dump.js sv2d || echo "SV FAILED"
echo "=== sv depth v2 done ==="
cp ../starwatcher_color.png defaultImgColor.png
cp ../starwatcher_depth.png defaultImgDepth.png
echo "=== depth chain2 complete ==="
