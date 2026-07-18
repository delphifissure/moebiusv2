const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const OUT = process.argv[2] || '.';
const DX = parseFloat(process.argv[3] || '0.13');
fs.copyFileSync('../starwatcher_color.png', 'defaultImgColor.png');
fs.copyFileSync('../starwatcher_depth.png', 'defaultImgDepth.png');
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 800 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = []; page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 2000)); }
  await new Promise(r => setTimeout(r, 1500));
  // pose
  await page.evaluate(async (dx) => {
    try { bgQuickBake = false; if (typeof useInpainting !== 'undefined') useInpainting = true; window._relaxGuard = parseFloat(process.env.RELAXGUARD||'0.05'); buildBackgroundLayer(); } catch(e) { console.log('build err ' + e.message); }
    await new Promise(r=>setTimeout(r,300));
    if (typeof isSweeping !== 'undefined') isSweeping = true;
    await new Promise(r2 => { let n=0; const tick=()=>{ camera.position.x=dx; camera.position.y=-0.02; camera.position.z=0.2; n++; n<12?requestAnimationFrame(tick):r2(); }; requestAnimationFrame(tick); });
    render();
  }, DX);
  // trigger sheet, intercept the anchor click to grab the dataURL
  const dataUrl = await page.evaluate(() => {
    return new Promise((res) => {
      const orig = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function() { HTMLAnchorElement.prototype.click = orig; res(this.href); };
      try { exportDebugContactSheet(); } catch(e) { res('ERR:' + e.message); }
      setTimeout(() => res('TIMEOUT'), 20000);
    });
  });
  if (dataUrl && dataUrl.startsWith('data:image')) {
    fs.writeFileSync(OUT + '/sheet.png', Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('SAVED sheet.png; errors=' + errs.slice(0,5).join(' | '));
  } else {
    console.log('NO-SHEET: ' + dataUrl + '; errors=' + errs.slice(0,5).join(' | '));
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
