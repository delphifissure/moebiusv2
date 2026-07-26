// A140: IS THE USER'S BLACK AT THE EDGES OR IN THE INTERIOR?
//
// REPLY03 §4 reasons: the black is predominantly around the edges of the
// sheet, edge black is beyond-frame, beyond-frame is the skirt's problem, so
// fix the skirt first. The first link in that chain is an observation from
// screenshots. a139 already falsified the third link — the skirt is cone-blind
// but it is 1.3x to 190x LARGER than the a113 law asks at the shipped 45 deg
// cone, so it cannot be short. That leaves the first link worth measuring
// directly rather than inferred from a thumbnail.
//
// Splits black% inside the content polygon into an EDGE BAND (the outer 8% of
// the content bbox on each side) and the INTERIOR, on the SHIPPED DEFAULT mode
// (v2), on the troll — the asset in the user's screenshots and the one A32's
// zero-hole scan never covered.
//
// Reported as both a raw percentage and as a SHARE of all black, because the
// edge band is only ~29% of the area and a raw comparison would flatter it.
//
//   node harness/edgeblack.js [troll|star|warrior] [quick|v2]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const ASSET = process.argv[2] || 'troll';
const MODE = process.argv[3] || 'v2';
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star: ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };
const DEGS = [0, 15, 25, 32, 38, 45];
const BAND = 0.08;   // fraction of the content bbox counted as "edge"

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  const rows = await page.evaluate(async (o) => {
    window._rayReproject = true;
    bgViewFadeStartDeg = 35; bgViewFadeEndDeg = 45;
    if (o.noSkirt) window._noQuickSkirt = true;
    bgQuickBake = (o.mode === 'quick');
    bgMPIFullPlanes = (o.mode === 'v2'); bgMPIMode = (o.mode === 'v2');
    bgBuildStamp = null; buildBackgroundLayer();
    isSweeping = true;
    const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
    const W = 600, Hh = 375;
    const grab = () => { for (let n = 0; n < 3; n++) render();
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
      return cx.getImageData(0, 0, W, Hh).data; };
    camera.position.set(0, 0, dist);
    const d0 = grab();
    let x0 = W, x1 = -1, y0 = Hh, y1 = -1;
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4;
      if (d0[i] + d0[i + 1] + d0[i + 2] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    const mx = Math.max(1, Math.round(bw * o.band)), my = Math.max(1, Math.round(bh * o.band));
    const out = [];
    for (const deg of o.degs) {
      camera.position.set(dist * Math.tan(deg * Math.PI / 180), 0, dist);
      const d = grab();
      let eT = 0, eB = 0, iT = 0, iB = 0, eA = 0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = (y * W + x) * 4;
        const edge = (x - x0 < mx) || (x1 - x < mx) || (y - y0 < my) || (y1 - y < my);
        // A149: separate ABSENCE from dark paint. The clear is alpha 0, so a
        // texel the geometry never covered has alpha 0; painted content has
        // alpha 255 however dark it is. Counting them together cannot tell a
        // hole from a black border.
        const absent = d[i + 3] < 8;
        const black = absent || ((d[i] + d[i + 1] + d[i + 2]) < 24);
        if (edge) { eT++; if (black) eB++; if (absent) eA++; } else { iT++; if (black) iB++; }
      }
      out.push({ deg,
        edgePct: +(100 * eB / Math.max(1, eT)).toFixed(2),
        edgeAbsentPct: +(100 * eA / Math.max(1, eT)).toFixed(2),
        intPct: +(100 * iB / Math.max(1, iT)).toFixed(2),
        edgeShare: +(100 * eB / Math.max(1, eB + iB)).toFixed(1),
        edgeAreaShare: +(100 * eT / Math.max(1, eT + iT)).toFixed(1),
        totalPct: +(100 * (eB + iB) / Math.max(1, eT + iT)).toFixed(2) });
    }
    camera.position.set(0, 0, dist); render();
    return out;
  }, { degs: DEGS, band: BAND, mode: MODE, noSkirt: process.env.NOSKIRT === '1' });

  const pad = (s, n) => String(s).padStart(n);
  console.log('\n' + ASSET + '  mode=' + MODE + '  WHERE IS THE BLACK? (outer ' + (BAND * 100) +
              '% of the content bbox = "edge")' + (process.env.NOSKIRT === '1' ? '   [SKIRT OFF]' : '   [skirt on]'));
  console.log('  deg   black% edge   ABSENT% edge   black% interior   total black%   edge share');
  for (const r of rows)
    console.log('  ' + pad(r.deg, 3) + pad(r.edgePct, 13) + pad(r.edgeAbsentPct, 15) +
                pad(r.intPct, 18) + pad(r.totalPct, 15) + pad(r.edgeShare + '%', 14));
  console.log('\n  the edge band is ' + rows[0].edgeAreaShare + '% of the measured area, so an edge share');
  console.log('  above that is a genuine edge concentration and below it is not.');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
