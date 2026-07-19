// A78 repro: user's device poses on a76+a77 content.
// Star at (0.182,-0.056): false-disocc regions + taffy + horizon-on-astronaut.
// Troll at (0.147,0.008): false-disocc wall patches.
// Dumps: SD-mask overlay (disocc red over color), anchor map, render shot.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/arc73';
const H = path.join(WT, 'harness');
const OUTD = '/workspace/moebiusv2/harness/val';
const ASSET = process.argv[2] || 'star';
const conf = ASSET === 'star'
  ? { color: path.join(WT, 'starwatcher_color.png'), depth: path.join(WT, 'starwatcher_depth.png'), cam: [0.182, -0.056], vw: 933, vh: 525 }
  : { color: path.join(WT, 'defaultImgColor.png'),   depth: path.join(WT, 'defaultImgDepth.png'),   cam: [0.147, 0.008], vw: 933, vh: 525 };
fs.copyFileSync(conf.color, path.join(H, 'defaultImgColor.png'));
fs.copyFileSync(conf.depth, path.join(H, 'defaultImgDepth.png'));
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: conf.vw, height: conf.vh } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 140)));
  page.on('console', m => { const t = m.text(); if (/QUICK-BAKE|DIR-PLATE/.test(t)) console.log('  [pg] ' + t.slice(0, 110)); });
  await page.goto('http://localhost:8099/fp_test.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
  await page.evaluate(() => {
    window._foldProbe = true; window._srCapture = true; window._bgQuickBaked = false;
    const s = document.getElementById('bgModeSel');
    if (s) { s.value = 'quick'; s.dispatchEvent(new Event('change')); }
    document.getElementById('bgLayerBuildBtn').click();
  });
  await page.waitForFunction(() => window._bgQuickBaked === true, null, { timeout: 480000, polling: 2000 });
  await new Promise(r => setTimeout(r, 600));
  const dump = async (name, mode) => {
    const png = await page.evaluate((mode) => {
      const d = window._fpData;
      const cv = document.createElement('canvas'); cv.width = d.pw; cv.height = d.ph;
      const cx = cv.getContext('2d');
      // draw source color under
      const src = document.createElement('canvas'); src.width = d.pw; src.height = d.ph;
      const sx = src.getContext('2d');
      const im = sx.createImageData(d.pw, d.ph);
      for (let i = 0; i < d.pw * d.ph; i++) {
        let r = 0, g = 0, b = 0;
        if (mode === 'sdover') {
          const v = Math.round(d.dQ[i] * 150) + 40;
          r = g = b = v;
          if (d.claimedF[i]) { r = 255; g = Math.round(v * 0.4); b = Math.round(v * 0.4); }
        } else if (mode === 'anchor') {
          if (d.claimedF[i]) { const v = Math.round(d.carAv[i] * 255); r = v; g = v; b = 255; }
          else { const v = Math.round(d.dQ[i] * 90); r = g = b = v; }
        }
        im.data[i*4] = r; im.data[i*4+1] = g; im.data[i*4+2] = b; im.data[i*4+3] = 255;
      }
      sx.putImageData(im, 0, 0);
      cx.drawImage(src, 0, 0);
      return cv.toDataURL('image/png');
    }, mode);
    fs.writeFileSync(path.join(OUTD, name), Buffer.from(png.split(',')[1], 'base64'));
    console.log('wrote ' + name);
  };
  const tag = ASSET;
  await dump('A78_' + tag + '_sdover.png', 'sdover');
  await dump('A78_' + tag + '_anchor.png', 'anchor');
  const [px, py] = conf.cam;
  const png = await page.evaluate(async ({ px, py }) => {
    isSweeping = true;
    await new Promise(r2 => { let n = 0; const tick = () => { camera.position.set(px, py, 0.2); n++; n < 8 ? requestAnimationFrame(tick) : r2(); }; requestAnimationFrame(tick); });
    camera.position.set(px, py, 0.2); render();
    return renderer.domElement.toDataURL('image/png');
  }, { px, py });
  fs.writeFileSync(path.join(OUTD, 'A78_' + tag + '_shot.png'), Buffer.from(png.split(',')[1], 'base64'));
  console.log('wrote A78_' + tag + '_shot.png');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
