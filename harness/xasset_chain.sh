#!/bin/bash
set -x
export NODE_PATH=/opt/node22/lib/node_modules/playwright/node_modules:/opt/node22/lib/node_modules
cd /workspace/moebiusv2/harness
cp ../defaultImgColor.png defaultImgColor.png
cp ../defaultImgDepth.png defaultImgDepth.png
node fix_drive.js fr2 basic
echo "=== frazetta v4.2 done ==="
cp ../silverwarrior_color.png defaultImgColor.png
cp ../silverwarrior_depth.png defaultImgDepth.png
node fix_drive.js sv2 basic || echo "SILVERWARRIOR FAILED"
echo "=== silverwarrior v4.2 done ==="
cp ../starwatcher_color.png defaultImgColor.png
cp ../starwatcher_depth.png defaultImgDepth.png
echo "=== xasset chain complete ==="
