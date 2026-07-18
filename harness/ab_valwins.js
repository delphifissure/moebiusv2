// A73 A/B: farther-value-wins (floored planes) vs shipped nearest-anchor-wins.
// argv: WT color depth tag camx1,camy1 camx2,camy2
// Builds quick twice (flag off/on), dumps plate stats + a shot per cam per state.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = process.argv[2];
const color = process.argv[3], depth = process.argv[4], tag = process.argv[5];
const cams = process.argv.slice(6).map(s => s.split(',').map(Number));
const H = path.join(WT, 'harness');
const OUTD = '/workspace/moebiusv2/harness/val';
fs.copyFileSync(color, path.join(H, 'defaultImgColor.png'));
fs.copyFileSync(depth, path.join(H, 'defaultImgDepth.png'));

const buildAndDump = async (page, state) => {
  await page.evaluate(() => {
    window._bgQuickBaked = false;
    const s = document.getElementById('bgModeSel');
    if (s) { s.value = 'quick'; s.dispatchEvent(new Event('change')); }
    document.getElementById('bgLayerBuildBtn').click();
  });
  await page.waitForFunction(() => window._bgQuickBaked === true, null, { timeout: 300000 });
  await new Promise(r => setTimeout(r, 400));
  const stats = await page.evaluate(() => {
    const d = window._fpData; if (!d) return null;
    const N = d.pw * d.ph;
    let nCl = 0, sP = 0, sAv = 0, nNearAv = 0, nNearP = 0, nZero = 0;
    for (let i = 0; i < N; i++) {
      if (!d.claimedF[i]) continue;
      nCl++; sP += d.P[i]; sAv += d.carAv[i];
      if (d.carAv[i] > 0.35) nNearAv++;
      if (d.P[i] > 0.35) nNearP++;
      if (d.P[i] < 0.005) nZero++;
    }
    return { claimed: nCl, meanP: +(sP / Math.max(1, nCl)).toFixed(3),
             meanAnchor: +(sAv / Math.max(1, nCl)).toFixed(3),
             nearAnchorPct: +(nNearAv / Math.max(1, nCl) * 100).toFixed(1),
             nearPlatePct: +(nNearP / Math.max(1, nCl) * 100).toFixed(1),
             zeroPlatePct: +(nZero / Math.max(1, nCl) * 100).toFixed(1) };
  });
  console.log('AB_' + tag + '_' + state + ' ' + JSON.stringify(stats));
  for (let ci = 0; ci < cams.length; ci++) {
    const [px, py] = cams[ci];
    const png = await page.evaluate(async ({ px, py }) => {
      isSweeping = true;
      await new Promise(r2 => { let n = 0; const tick = () => { camera.position.set(px, py, 0.2); n++; n < 8 ? requestAnimationFrame(tick) : r2(); }; requestAnimationFrame(tick); });
      camera.position.set(px, py, 0.2); render();
      return renderer.domElement.toDataURL('image/png');
    }, { px, py });
    fs.writeFileSync(path.join(OUTD, 'AB_' + tag + '_cam' + ci + '_' + state + '.png'), Buffer.from(png.split(',')[1], 'base64'));
    console.log('wrote AB_' + tag + '_cam' + ci + '_' + state + '.png');
  }
};

(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 933, height: 525 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 140)));
  page.on('console', m => { const t = m.text(); if (t.indexOf('QUICK-BAKE') >= 0 || t.indexOf('DIR-PLATE') >= 0) console.log('  [pg] ' + t.slice(0, 120)); });
  await page.goto('http://localhost:8099/fp_test.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
  await page.evaluate(() => { window._foldProbe = true; window._nearestAnchorWins = true; });
  await buildAndDump(page, 'nearest');                    // a63b law (hatch)
  await page.evaluate(() => { delete window._nearestAnchorWins; });
  await buildAndDump(page, 'valwins');                    // a73 default law
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
