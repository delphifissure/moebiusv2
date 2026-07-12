// What does the plate carry at the SW violation site?
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
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate(async () => {
    window._dbgFillCapture = true;
    bgMPIMode = true; bgMPIFullPlanes=false; bgPlugMode='directional'; bgValidMode='auto';
    buildBackgroundLayer();
    const D = window._dbgFill;
    const { pw, ph, plug, srcDepth, band, underMask } = D;
    // screen(362,359) -> plate approx (774,981); dump 9x5 grid around it
    const rows = [];
    for (let y=965; y<=1000; y+=5) { const r=[];
      for (let x=750; x<=810; x+=6) { const i=y*pw+x;
        r.push(x+','+y+':'+(band[i]?'B':underMask[i]?'U':'-')+plug[i].toFixed(3)+'/'+srcDepth[i].toFixed(3)); }
      rows.push(r.join(' ')); }
    return { rows, pw, ph };
  });
  console.log('plate', res.pw+'x'+res.ph);
  for (const r of res.rows) console.log(r);
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
