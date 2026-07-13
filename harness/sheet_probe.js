// A50 PROBE: debug-sheet buffer freshness in single-pass (baked) modes.
// Load troll, QUICK bake (single-pass), move the camera to a new pose,
// then export the sheet with the download click intercepted. Pre-fix the
// scene-colour buffer (pingPongRenderTargetB) still holds the LOAD-time
// frame; post-fix the export refreshes it for the current pose. We
// fingerprint the buffer before/after the export call and also save the
// sheet PNG for eyeballing. argv[2] = variant src ('' = live).
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const SRC = process.argv[2] || null;
const OUT = process.argv[3] || 'sheet_live.png';
(async () => {
  fs.copyFileSync('../defaultImgColor.png', 'defaultImgColor.png');
  fs.copyFileSync('../defaultImgDepth.png', 'defaultImgDepth.png');
  let pageFile = 'scratch_moebius.html';
  if (SRC) {
    fs.copyFileSync(SRC, 'm_active.js');
    fs.writeFileSync('scratch_ab.html',
      fs.readFileSync('scratch_moebius.html', 'utf8').replace('src="moebius.js"', 'src="m_active.js"'));
    pageFile = 'scratch_ab.html';
  }
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const logs = [];
  page.on('console', m => { const t = m.text(); if (/DBG-SHEET/.test(t)) logs.push(t); });
  await page.goto('http://localhost:8099/' + pageFile, { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate(async () => {
    // fingerprint helper: read a 64x64 block of pingPongRenderTargetB
    const fp = () => {
      const W = 64, H = 64;
      const buf = new Uint8Array(W * H * 4);
      renderer.readRenderTargetPixels(pingPongRenderTargetB,
        Math.floor(pingPongRenderTargetB.width / 3), Math.floor(pingPongRenderTargetB.height / 3), W, H, buf);
      let s = 0; for (let i = 0; i < buf.length; i += 7) s = (s * 31 + buf[i]) >>> 0;
      return s;
    };
    bgQuickBake = true; buildBackgroundLayer();      // single-pass from here on
    // move to a distinctly different pose and render single-pass frames
    isSweeping = true;
    await new Promise(r2 => { let n = 0; const tick = () => {
      camera.position.x = 0.12; camera.position.y = 0.06; camera.position.z = 0.25;
      n++; n < 8 ? requestAnimationFrame(tick) : r2(); }; requestAnimationFrame(tick); });
    render();
    const before = fp();
    // intercept the download click
    let captured = null;
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { captured = this.href; };
    exportDebugContactSheet();
    HTMLAnchorElement.prototype.click = orig;
    const after = fp();
    return { before, after, changed: before !== after, gotSheet: !!captured, png: captured };
  });
  console.log(JSON.stringify({ before: res.before, after: res.after, changed: res.changed, gotSheet: res.gotSheet }));
  console.log(logs.join('\n'));
  console.log(' buffer refreshed by export:', res.changed ? 'OK' : 'FAIL(stale)');
  if (res.png) fs.writeFileSync(OUT, Buffer.from(res.png.split(',')[1], 'base64'));
  await browser.close(); srv.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
