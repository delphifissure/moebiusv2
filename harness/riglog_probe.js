// A54 one-off: capture [QUICK-BAKE] logs + rigidify coverage at the party.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
fs.copyFileSync('../starwatcher_color.png', 'defaultImgColor.png');
fs.copyFileSync('../starwatcher_depth.png', 'defaultImgDepth.png');
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const logs = [];
  page.on('console', m => { const t = m.text(); if (/QUICK-BAKE/.test(t)) logs.push(t); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate(() => {
    window._srCapture = true;
    bgQuickBake = true;
    buildBackgroundLayer();
    window._srCapture = false;
    const D = window._qbDbg;
    if (!D) return { err: 'no dbg' };
    const pw = D.pw;
    // party window in source coords
    let n = 0, nStand = 0, uniq = new Set();
    for (let y = 850; y < 1150; y++) for (let x = 1050; x < 1550; x++) {
      const i = y*pw+x; n++;
      const lift = D.d[i] - D.plate[i];
      if (lift > 0.02) { nStand++; uniq.add(Math.round(D.d[i]*200)); }
    }
    return { partyPx: n, standing: nStand, distinctDepths: uniq.size };
  });
  console.log(JSON.stringify(res));
  console.log(logs.filter(t => /despeckle|rigidify|cliff tear/.test(t)).join('\n'));
  await browser.close(); srv.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
