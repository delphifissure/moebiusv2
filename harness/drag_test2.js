const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('console', m => { const t=m.text(); if (/\[VIEW\]/.test(t)) console.log('  [pg]', t); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const box = await page.evaluate(() => { const r = document.getElementById('canvas').getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; });
  await page.keyboard.down('Shift');
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.mouse.move(box.x - 200, box.y + 60, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.waitForTimeout(300);
  const st = await page.evaluate(() => ({ dx: +manualCamDX.toFixed(4), dy: +manualCamDY.toFixed(4), camX: +camera.position.x.toFixed(4), camY: +camera.position.y.toFixed(4) }));
  console.log('after cmd-drag:', JSON.stringify(st));
  await page.mouse.dblclick(box.x, box.y);
  await page.waitForTimeout(200);
  const st2 = await page.evaluate(() => ({ dx: manualCamDX, dy: manualCamDY }));
  console.log('after dblclick reset:', JSON.stringify(st2));
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
