// A105 measurement: does sampling the AXES at the rim find backstop protrusions
// the four hardcoded diagonals missed? The sweep repairs every texel where the
// backstop pokes through the FG at a sampled pose, and reports its counts, so
// the counts ARE the measurement: a protrusion the legacy set never saw is one
// that was shipping.
// Troll (851px) because this sweep is the GPU bottleneck and the point is the
// pose set, not the asset.
//   node harness/a105_ab.js [troll|star]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/arc73', H = path.join(WT, 'harness');
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star:  ['starwatcher_color.png', 'starwatcher_depth.png'] };
const ASSET = process.argv[2] || 'troll';
(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  for (const [tag, legacy] of [['derived 4 on the axes', false], ['legacy 4 diagonals', true]]) {
    const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
    const logs = [];
    page.on('console', m => { const t = m.text(); if (/A105|RUNG-PLUG|viewpoint scan|per-cell tear/.test(t)) logs.push(t); });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 140)));
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 40; t++) {
      const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
      if (ok) break; await new Promise(r => setTimeout(r, 1000));
    }
    const r = await page.evaluate((lg) => {
      window._srCapture = true; window._rayReproject = true; window._scanLegacyPoses = lg;
      bgQuickBake = true; buildBackgroundLayer();
      const mk = window._qbMask; if (!mk) return null;
      let nD = 0; const N = mk.pw * mk.ph;
      for (let i = 0; i < N; i++) if (mk.disocc[i]) nD++;
      return { sd: 100 * nD / N };
    }, legacy);
    console.log(ASSET + '  ' + tag.padEnd(24) + (r ? 'SD ' + r.sd.toFixed(2) + '%' : '(no capture)'));
    for (const l of logs) console.log('      ' + l.slice(0, 150));
    if (!logs.length) console.log('      (sweep reported nothing — no protrusions found at any sampled pose)');
    await page.close();
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
