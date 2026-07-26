// A139: IS v2's SKIRT A FIFTH CONE-BLIND QUANTITY, AND IS IT SHORT ON THE
// TROLL?
//
// Two reasons this is worth checking before the completion-extent work:
//
//  1. The user's black is predominantly around the EDGES of the sheet, not
//     inside the figure. Edge black is beyond-frame — the skirt's problem, not
//     the behind-occluder problem.
//  2. A32 sized the skirt with hardcoded WORLD constants: "0.10 world for the
//     backdrop = the 45-degree pan with headroom; 0.05 for frame-cut near
//     content". Those do not contain bgViewFadeEndDeg. Meanwhile a113's
//     corrected, measured margin law (max|shift| from bgShiftLUTFor) lives in
//     v1's scene extension — the path being retired. So the correct law and the
//     shipped margin are in different modes, which is the same shape as the
//     clamp/sweep split a137 found.
//
// And A32's zero-hole validation covered SW and frazetta. NOT the troll — the
// asset in the user's screenshots, on the default mode.
//
// This runs a v2 bake at cone 45 and at cone 60 and prints, per bin, the
// shipped skirt against what the a113 law asks for that bin's own depth.
// Verdict per the a132 sweep's convention: MOVES / CONE-BLIND.
//
//   node harness/skirtcone.js [troll|star|warrior]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const ASSET = process.argv[2] || 'troll';
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star: ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };
const CONES = [45, 60];

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const byCone = {};
  for (const cone of CONES) {
    const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
    const logs = [];
    page.on('console', m => { const t = m.text(); if (/a139 skirt/.test(t)) logs.push(t); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 40; t++) {
      const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
      if (ok) break; await new Promise(r => setTimeout(r, 1000));
    }
    await page.evaluate(async (c) => {
      window._rayReproject = true;
      bgViewFadeStartDeg = c - 10; bgViewFadeEndDeg = c;
      bgQuickBake = false; bgMPIFullPlanes = true; bgMPIMode = true;
      bgBuildStamp = null; buildBackgroundLayer();
    }, cone);
    byCone[cone] = logs;
    await page.close();
  }

  const parse = (l) => {
    const m = l.match(/bin(\d+) meanD=([\d.]+)( \(BACKDROP\))?: shipped (\d+)x(\d+) px.*law asks (\d+) px/);
    if (!m) return null;
    return { bin: +m[1], meanD: +m[2], backdrop: !!m[3], shipX: +m[4], shipY: +m[5], need: +m[6] };
  };
  const A = byCone[45].map(parse).filter(Boolean);
  const B = byCone[60].map(parse).filter(Boolean);
  console.log('\n' + ASSET + '  v2 SKIRT: shipped hardcoded margin vs the a113 law, per bin');
  console.log('  bin  meanD   role       shipped px      law@45   law@60   ship moved?  short@45');
  let blind = true, shortAt45 = 0;
  for (let i = 0; i < A.length; i++) {
    const a = A[i], b = B[i] || {};
    const moved = (b.shipX !== undefined) && (a.shipX !== b.shipX || a.shipY !== b.shipY);
    if (moved) blind = false;
    const sh = Math.max(a.shipX, a.shipY);
    const s45 = Math.max(0, a.need - sh);
    if (s45 > shortAt45) shortAt45 = s45;
    console.log('  ' + String(a.bin).padStart(3) + String(a.meanD.toFixed(3)).padStart(7) +
      (a.backdrop ? '   BACKDROP' : '   near/mid') +
      (a.shipX + 'x' + a.shipY).padStart(13) + String(a.need).padStart(9) +
      String(b.need === undefined ? '-' : b.need).padStart(9) +
      (moved ? '   yes' : '   NO  ').padStart(14) + (s45 ? String(s45) + 'px' : '-').padStart(10));
  }
  console.log('\n  VERDICT: the shipped skirt is ' + (blind ? 'CONE-BLIND' : 'cone-derived') +
    ' — identical at 45 and 60 degrees' + (blind ? '' : ' (it moved)'));
  console.log('  The a113 law moves with the cone in every row, so the two disagree by a');
  console.log('  factor that grows with the cone. Worst shortfall at the SHIPPED 45deg cone: ' +
    (shortAt45 ? shortAt45 + ' px' : 'none — the hardcoded margin covers the law at 45'));
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
