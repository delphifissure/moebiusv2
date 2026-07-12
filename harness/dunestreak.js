// Depth structure in the streaky dune region + tear membership
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
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
    bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer();
    const D = window._dbgFill;
    const { pw, ph, srcDepth, rawD, band, underMask } = D;
    // column transect through the streaky dune: x=450, y 1000..1300
    const col = [];
    for (let y = 1050; y <= 1290; y += 4) { const i = y*pw + 450;
      col.push([y, +rawD[i].toFixed(3), +srcDepth[i].toFixed(3), band[i]?1:0, underMask&&underMask[i]?1:0]);
    }
    // stats: count adjacent-row steps > fgTearStep in worked vs raw depth over the dune region
    let stepsW = 0, stepsR = 0, n = 0;
    for (let y = 950; y < 1300; y++) for (let x = 100; x < 900; x++) { const i = y*pw+x;
      if (Math.abs(srcDepth[i] - srcDepth[i+pw]) > fgTearStep) stepsW++;
      if (Math.abs(rawD[i] - rawD[i+pw]) > fgTearStep) stepsR++;
      n++;
    }
    return { col, stepsW, stepsR, n };
  });
  console.log('vertical steps > fgTearStep in dune region: worked', res.stepsW, 'raw', res.stepsR, 'of', res.n);
  console.log('col x=450 [y raw worked band under]:');
  for (const r of res.col) console.log(' ', r.join('  '));
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
