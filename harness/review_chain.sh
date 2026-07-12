#!/bin/bash
# Chained follow-up runs after the main sw driver (pid $1) exits.
set -x
export NODE_PATH=/opt/node22/lib/node_modules/playwright/node_modules:/opt/node22/lib/node_modules
cd /workspace/moebiusv2/harness

# wait for main sw driver
while kill -0 "$1" 2>/dev/null; do sleep 5; done
echo "=== sw driver done ==="

node review_attrib.js sw
echo "=== attrib done ==="

node review_debug_shots.js sw
echo "=== debug shots done ==="

# Frazetta (repo default asset)
cp ../defaultImgColor.png defaultImgColor.png
cp ../defaultImgDepth.png defaultImgDepth.png
node review_drive.js fr basic
node review_attrib.js fr
echo "=== frazetta done ==="

# Silverwarrior (3000x3000 — may be heavy)
cp ../silverwarrior_color.png defaultImgColor.png
cp ../silverwarrior_depth.png defaultImgDepth.png
node review_drive.js sv basic || echo "SILVERWARRIOR FAILED"
echo "=== silverwarrior done ==="

# restore starwatcher for reproducibility
cp ../starwatcher_color.png defaultImgColor.png
cp ../starwatcher_depth.png defaultImgDepth.png
echo "=== chain complete ==="
