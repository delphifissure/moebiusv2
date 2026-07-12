// MPI v2 test: build with full planes, shots at rest/standard/look-down/wide
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('console', m => { const t=m.text(); if (/MPI-V2|PERF|error/i.test(t)) console.log('  [pg]', t.slice(0,200)); });
  page.on('pageerror', e => console.log('PAGEERR', String(e).slice(0,300)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const t0 = Date.now();
  await page.evaluate(() => { bgMPIFullPlanes = true; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer(); });
  console.log('build wall time:', Date.now()-t0, 'ms');
  await page.waitForTimeout(500);
  const shot = async (name, X, Y) => {
    const d = await page.evaluate(async ({X,Y}) => {
      isSweeping = true; camera.position.x = X; camera.position.y = Y;
      await new Promise(res => { let n=0; const tick=()=>{ camera.position.x=X; camera.position.y=Y; n++; n<5?requestAnimationFrame(tick):res(); }; requestAnimationFrame(tick); });
      return document.getElementById('canvas').toDataURL('image/png');
    }, {X,Y});
    fs.writeFileSync(name, Buffer.from(d.split(',')[1], 'base64'));
  };
  await shot('v2_rest.png', 0, 0);
  await shot('v2_std.png', 0.123, -0.055);
  await shot('v2_down.png', 0.124, 0.067);
  await shot('v2_wide.png', 0.35, 0.05);
  await shot('v2_xwide.png', 0.6, 0.1);
  console.log('shots done');
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
