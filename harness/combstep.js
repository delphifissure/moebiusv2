// A131: REOPENING a128 — the metric that chose the stale plate step was the one
// metric already proved blind to the artifact the fold-correct step prevents.
//
// a128 shipped `bgConeSlopePerPx` over the fold-correct `1/k` on this table:
//     arm             0deg  15deg  25deg  32deg  38deg
//     step = 1/k         0   0.48   0.97   1.44   1.98
//     step = stale       0   0.55   0.98   1.30   1.63
// That is black%. A117 established, in this codebase, with a measurement:
//     "black% is blind to it... 35.17 (torn) vs 37.45 (untorn)... The comb is
//      alternating light/dark, not black. A second-difference comb energy over
//      lit pixels sees it immediately."
// The fold-correct step is TIGHTER. A looser-than-fold-limit slope is by
// definition a slope steep enough to FOLD, and a folded plate produces comb,
// not black. So the stale step may be winning precisely by permitting the
// artifact the chosen metric cannot see. Two hypotheses, one blind metric.
//
// COMB METRIC, stated so it can be checked. Per row, over LIT pixels only
// (sum of RGB >= 24, so the letterbox and the true holes are excluded rather
// than counted as smooth):
//     comb = mean |L(x-1) - 2 L(x) + L(x+1)|,   L = 0.2126R + 0.7152G + 0.0722B
// A discrete second difference is zero on any linear ramp and maximal on a
// 1px alternation, which is exactly the cap-card/fold moire. Absolute values
// are only comparable WITHIN this run (a117's 7.91 / 5.61 came from a separate
// script); the arms here are all measured by this code at the same poses.
// Both axes are reported because a fold can comb along either.
//
//   node harness/combstep.js [troll|star|warrior]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const ASSET = process.argv[2] || 'troll';
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star: ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };
// Same absolute angles as holes.js so the two tables can be read together.
// REPLY01 also notes 38deg now sits INSIDE the 35/45 fade at ~70% opacity, so
// the visibility-weighted penalty is reported alongside the raw one.
const DEGS = [0, 15, 25, 32, 38];
// FIRST RUN OF THIS SCRIPT WAS A NULL, and the null was mine: I armed
// `_legacyPlateStep`, which does not exist. Both arms ran the shipped path and
// came out identical to 3 d.p. with the same logged step (0.00564). The real
// flag is `_envelopePlateStep`, and the polarity is the other way round —
// a128 INVERTED the fold-correct step to opt-in, so the SHIPPED default is the
// stale bgConeSlopePerPx. Recorded because a table of identical numbers is
// what a dead flag looks like, and it would have read as "no difference".
const ARMS = [['shipped: step = bgConeSlopePerPx (stale)', {}],
              ['fold-correct: step = 1/k', { _envelopePlateStep: true }],
              ['no slope limit at all (a87 tear)', { _legacyPlateTear: true }]];

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const all = {}, notes = {};
  for (const [tag, flags] of ARMS) {
    const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
    const logs = [];
    page.on('console', m => { const t = m.text(); if (/slope-limited|plate tear|a127b k =/.test(t)) logs.push(t); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 40; t++) {
      const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
      if (ok) break; await new Promise(r => setTimeout(r, 1000));
    }
    const rows = await page.evaluate(async (f) => {
      window._rayReproject = true;
      bgViewFadeStartDeg = 35; bgViewFadeEndDeg = 45;
      if (f._envelopePlateStep) window._envelopePlateStep = true;
      if (f._legacyPlateTear) window._legacyPlateTear = true;
      bgQuickBake = true; bgMPIFullPlanes = false; bgMPIMode = false;
      bgBuildStamp = null; buildBackgroundLayer();
      isSweeping = true;
      const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
      const W = 480, Hh = 300;
      const grab = () => { for (let n = 0; n < 3; n++) render();
        const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
        const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
        return cx.getImageData(0, 0, W, Hh).data; };
      const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      // footprint from the REST pose, letterbox excluded (same convention as
      // holes.js so the black% column is directly comparable)
      camera.position.set(0, 0, dist);
      const d0 = grab();
      let x0 = W, x1 = -1, y0 = Hh, y1 = -1;
      for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4;
        if (d0[i] + d0[i + 1] + d0[i + 2] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      const out = [];
      for (const deg of f.degs) {
        camera.position.set(dist * Math.tan(deg * Math.PI / 180), 0, dist);
        const d = grab();
        let blk = 0, tot = 0, cx_ = 0, nx = 0, cy_ = 0, ny = 0;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const i = (y * W + x) * 4; tot++;
          const lit = (d[i] + d[i + 1] + d[i + 2]) >= 24;
          if (!lit) { blk++; continue; }
          if (x > x0 && x < x1) {
            const a = (y * W + x - 1) * 4, b = (y * W + x + 1) * 4;
            if ((d[a] + d[a + 1] + d[a + 2]) >= 24 && (d[b] + d[b + 1] + d[b + 2]) >= 24) {
              cx_ += Math.abs(lum(d, a) - 2 * lum(d, i) + lum(d, b)); nx++;
            }
          }
          if (y > y0 && y < y1) {
            const a = ((y - 1) * W + x) * 4, b = ((y + 1) * W + x) * 4;
            if ((d[a] + d[a + 1] + d[a + 2]) >= 24 && (d[b] + d[b + 1] + d[b + 2]) >= 24) {
              cy_ += Math.abs(lum(d, a) - 2 * lum(d, i) + lum(d, b)); ny++;
            }
          }
        }
        out.push({ deg, black: +(100 * blk / Math.max(1, tot)).toFixed(2),
                   combX: +(cx_ / Math.max(1, nx)).toFixed(3),
                   combY: +(cy_ / Math.max(1, ny)).toFixed(3) });
      }
      camera.position.set(0, 0, dist); render();
      return out;
    }, Object.assign({ degs: DEGS }, flags));
    all[tag] = rows; notes[tag] = logs;
    await page.close();
  }

  const fade = (deg) => 1 - Math.min(1, Math.max(0, (deg - 35) / 10));   // visible fraction
  const pad = (s, n) => String(s).padStart(n);
  console.log('\n' + ASSET + '  PLATE SLOPE LIMIT — the a128 decision, re-run on the metric that can see folds');
  for (const [tag] of ARMS) {
    console.log('\n=== ' + tag + ' ===');
    for (const l of notes[tag]) console.log('   | ' + l.slice(0, 150));
    console.log('   deg      black%     comb X     comb Y   visible');
    for (const r of all[tag]) console.log('   ' + pad(r.deg, 3) + pad(r.black, 11) + pad(r.combX, 11) + pad(r.combY, 11) + pad(fade(r.deg).toFixed(2), 10));
  }
  const B = all[ARMS[0][0]], A = all[ARMS[1][0]];   // A = fold-correct, B = stale
  console.log('\n  fold-correct MINUS stale  (negative = fold-correct wins)');
  console.log('   deg     d black     d combX     d combY   d comb weighted by visibility');
  for (let i = 0; i < DEGS.length; i++) {
    const db = A[i].black - B[i].black, dx = A[i].combX - B[i].combX, dy = A[i].combY - B[i].combY;
    console.log('   ' + pad(DEGS[i], 3) + pad(db.toFixed(2), 12) + pad(dx.toFixed(3), 12) + pad(dy.toFixed(3), 12) +
                pad((0.5 * (dx + dy) * fade(DEGS[i])).toFixed(3), 14));
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
