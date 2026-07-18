const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
fs.copyFileSync('../starwatcher_color.png', 'defaultImgColor.png');
fs.copyFileSync('../starwatcher_depth.png', 'defaultImgDepth.png');
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => console.log('  [PAGEERR] '+e.message.slice(0,140)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
  await page.evaluate(() => { window._rayReproject = true; bgQuickBake = true; buildBackgroundLayer(); });
  await new Promise(r => setTimeout(r, 400));
  console.log(await page.evaluate(() => 'portalZ=' + portalPlaneWorldZ + ' subjectZ=' + subjectFocalPlaneWorldZ +
    ' dolly=[' + dollyMinDistance + ',' + dollyMaxDistance + '] lockActive=' + (typeof subjectLockActive !== 'undefined' ? subjectLockActive : '?')));
  // dollyZoomTime values selecting dist = min, mid, max: sin(t) = -1, 0, +1
  const T = { near: -Math.PI/2, mid: 0, far: Math.PI/2 };
  for (const lock of [true, false]) {
    for (const [dtag, tval] of Object.entries(T)) {
      const png = await page.evaluate(async ({ tval, lock }) => {
        subjectLockActive = lock;
        dollyZoomActive = true;
        // PIN the time every frame: the app loop ticks dollyZoomTime
        // continuously (speed is const), so distances drifted between the
        // set and the capture (measured: mid landed at z=0.334). Pin in the
        // settle loop, then render+capture synchronously after a pinned set.
        const pin = () => { dollyZoomTime = tval - dollyZoomSpeed * 100; };
        // small lateral offset: the OFF-AXIS dolly-zoom case the user cares about
        isSweeping = true;
        await new Promise(r2 => { let n = 0; const tick = () => { pin(); camera.position.x = 0.12; camera.position.y = 0.02; n++; n < 10 ? requestAnimationFrame(tick) : r2(); }; requestAnimationFrame(tick); });
        pin(); camera.position.x = 0.12; camera.position.y = 0.02; render();
        return renderer.domElement.toDataURL('image/png');
      }, { tval, lock });
      const tag = 'dz_' + (lock ? 'lock' : 'free') + '_' + dtag;
      fs.writeFileSync(tag + '.png', Buffer.from(png.split(',')[1], 'base64'));
      const z = await page.evaluate(() => camera.position.z.toFixed(4));
      console.log('wrote ' + tag + '  camZ=' + z);
    }
    await page.evaluate(() => { dollyZoomActive = false; render(); });   // restore _dzBase
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
