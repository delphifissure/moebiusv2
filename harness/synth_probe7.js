// Raw + working depth cross-section along row 193 and column 159 of synD
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const NAME = process.argv[2];
(async () => {
  fs.copyFileSync(`synth/${NAME}_color.png`, 'defaultImgColor.png');
  fs.copyFileSync(`synth/${NAME}_depth.png`, 'defaultImgDepth.png');
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
    const { pw, ph, srcDepth, rawD } = D;
    const row = [], col = [];
    for (let x=150; x<=170; x++) row.push([x, +(rawD[193*pw+x]).toFixed(4), +(srcDepth[193*pw+x]).toFixed(4)]);
    for (let y=185; y<=200; y++) col.push([y, +(rawD[y*pw+159]).toFixed(4), +(srcDepth[y*pw+159]).toFixed(4)]);
    return { row, col };
  });
  console.log('row193 [x raw work]:'); for (const r of res.row) console.log(' ', r.join('  '));
  console.log('col159 [y raw work]:'); for (const r of res.col) console.log(' ', r.join('  '));
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
