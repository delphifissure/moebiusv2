const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const step = (s) => console.log('STEP:', s);
(async () => {
  step('server');
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  step('launch');
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('console', m => { const t=m.text(); if (/\[VIEW\]/.test(t)) console.log('  [pg]', t); });
  step('goto');
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  step('poll');
  for (let t = 0; t < 30; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  step('inject-drag');  // simulate the gesture with dispatched events instead of playwright input
  const st = await page.evaluate(() => {
    const cnv = document.getElementById('canvas');
    const r = cnv.getBoundingClientRect();
    const cx0 = r.left + r.width/2, cy0 = r.top + r.height/2;
    const mk = (type, x, y) => new PointerEvent(type, { clientX: x, clientY: y, button: 0, buttons: 1, shiftKey: true, bubbles: true, cancelable: true, pointerId: 7 });
    cnv.dispatchEvent(mk('pointerdown', cx0, cy0));
    for (let i = 1; i <= 10; i++) window.dispatchEvent(mk('pointermove', cx0 - i*20, cy0 + i*6));
    window.dispatchEvent(mk('pointerup', cx0 - 200, cy0 + 60));
    return { dx: +manualCamDX.toFixed(4), dy: +manualCamDY.toFixed(4) };
  });
  console.log('after synthetic shift-drag:', JSON.stringify(st));
  step('reset');
  const st2 = await page.evaluate(() => {
    document.getElementById('canvas').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return { dx: manualCamDX, dy: manualCamDY };
  });
  console.log('after dblclick reset:', JSON.stringify(st2));
  await browser.close(); srv.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
