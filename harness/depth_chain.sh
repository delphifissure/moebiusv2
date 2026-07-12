#!/bin/bash
set -x
export NODE_PATH=/opt/node22/lib/node_modules/playwright/node_modules:/opt/node22/lib/node_modules
cd /workspace/moebiusv2/harness
cp ../starwatcher_color.png defaultImgColor.png
cp ../starwatcher_depth.png defaultImgDepth.png
node depth_dump.js swd
echo "=== sw depth done ==="
cp ../defaultImgColor.png defaultImgColor.png
cp ../defaultImgDepth.png defaultImgDepth.png
node depth_dump.js frd
echo "=== fr depth done ==="
cp ../silverwarrior_color.png defaultImgColor.png
cp ../silverwarrior_depth.png defaultImgDepth.png
node depth_dump.js svd || echo "SV DEPTH FAILED"
echo "=== sv depth done ==="
cp ../starwatcher_color.png defaultImgColor.png
cp ../starwatcher_depth.png defaultImgDepth.png
echo "=== depth chain complete ==="
