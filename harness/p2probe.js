// PHASE-2 CANDIDATE PROBE: builds v1 with _srCapture on and dumps every
// phase-2 blob candidate (bbox, size, external-ink bbox, ring contrast,
// member depth range) so gates can be designed against ground truth.
// argv[2] = 'synT' to swap in the synthetic pair first (default: whatever
// defaultImg*.png currently holds, i.e. frazetta after a cp restore).
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
if (process.argv[2] === 'synT') {
  fs.copyFileSync('synth/synT_color.png', 'defaultImgColor.png');
  fs.copyFileSync('synth/synT_depth.png', 'defaultImgDepth.png');
}
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const logs = [];
  page.on('console', m => { const t = m.text(); if (/STROKE-REPAIR/.test(t)) logs.push(t); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate(() => {
    window._srCapture = true;
    bgMPIFullPlanes = false; bgMPIMode = true; bgPlugMode = 'directional'; bgValidMode = 'auto';
    buildBackgroundLayer();
    window._srCapture = false;
    return window._p2Dbg || { cand: [] };
  });
  console.log('grid', res.w + 'x' + res.h, '| candidates(n>8):', res.cand.length);
  for (const c of res.cand) {
    const [bx0, by0, bx1, by1] = c.bbox, [ix0, iy0, ix1, iy1] = c.ink;
    const spanNew = (iy0 < by0 && iy1 > by1) || (ix0 < bx0 && ix1 > bx1);
    const gap = c.adoptD2 - c.d[1] > 0.05 || c.adoptD2 - c.d[0] > 0.05;
    console.log(JSON.stringify(c), 'spanNew=' + spanNew, 'ring>=0.15:' + (c.ring >= 0.15), 'wouldLiftDepth:' + gap);
  }
  console.log(logs.join('\n') || '(no logs)');
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
