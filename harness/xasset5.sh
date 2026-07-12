#!/bin/bash
set -x
export NODE_PATH=/opt/node22/lib/node_modules/playwright/node_modules:/opt/node22/lib/node_modules
cd /workspace/moebiusv2/harness
cp ../defaultImgColor.png defaultImgColor.png
cp ../defaultImgDepth.png defaultImgDepth.png
node mini_drive.js fr7 0.123 -0.055 || echo "FR FAILED"
cp ../silverwarrior_color.png defaultImgColor.png
cp ../silverwarrior_depth.png defaultImgDepth.png
node mini_drive.js sv7 0.123 -0.055 || echo "SV FAILED"
cp ../starwatcher_color.png defaultImgColor.png
cp ../starwatcher_depth.png defaultImgDepth.png
echo "=== xasset5 complete ==="
