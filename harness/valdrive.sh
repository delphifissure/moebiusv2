#!/bin/bash
# Commit-by-commit validation of the a61..a72b arc against the two device
# scenes. Re-entrant: skips commits already present in the results log.
set -u
REPO=/workspace/moebiusv2
H=$REPO/harness
OUT=$H/val
LOG=$OUT/results.jsonl
mkdir -p "$OUT"
NODEP=/opt/node22/lib/node_modules/playwright/node_modules:/opt/node22/lib/node_modules
COMMITS="236226f d0ba77e f94ea0e b0c7c11 e4c2446 975d358 7cb9712 a8b5fd8 d895e47 496dfd4 3d647e5 426370b 9754c23 a943063 1ff281e"
for C in $COMMITS; do
  if grep -q "\"commit\":\"$C\"" "$LOG" 2>/dev/null; then echo "skip $C (done)"; continue; fi
  WT=/workspace/val_$C
  git -C "$REPO" worktree remove --force "$WT" 2>/dev/null
  git -C "$REPO" worktree add "$WT" "$C" >/dev/null 2>&1 || { echo "{\"commit\":\"$C\",\"err\":\"worktree\"}" >> "$LOG"; continue; }
  mkdir -p "$WT/harness"
  cp "$H/scratch_server.js" "$H/scratch_moebius.html" "$H/val_probe.js" "$WT/harness/"
  [ -d "$H/vendor" ] && cp -r "$H/vendor" "$WT/harness/"
  ln -sf ../moebius.js "$WT/harness/moebius.js"
  pkill -f "scratch_serve[r]" 2>/dev/null; pkill -f "headless_shel[l]" 2>/dev/null; sleep 1
  cd "$WT/harness"
  SLINE=$(NODE_PATH=$NODEP timeout 420 node val_probe.js "$REPO/starwatcher_color.png" "$REPO/starwatcher_depth.png" "$OUT/${C}_star.png" 0.318 -0.051 2>&1 | grep RESULT | head -1)
  pkill -f "scratch_serve[r]" 2>/dev/null; pkill -f "headless_shel[l]" 2>/dev/null; sleep 1
  TLINE=$(NODE_PATH=$NODEP timeout 420 node val_probe.js "$REPO/defaultImgColor.png" "$REPO/defaultImgDepth.png" "$OUT/${C}_troll.png" 0.217 0.026 2>&1 | grep RESULT | head -1)
  echo "{\"commit\":\"$C\",\"star\":${SLINE#RESULT },\"troll\":${TLINE#RESULT }}" | tr -d '\n' >> "$LOG"
  echo "" >> "$LOG"
  echo "done $C  star=${SLINE#RESULT }  troll=${TLINE#RESULT }"
  cd /
  git -C "$REPO" worktree remove --force "$WT" 2>/dev/null
done
pkill -f "scratch_serve[r]" 2>/dev/null; pkill -f "headless_shel[l]" 2>/dev/null
echo CAMPAIGN_DONE
