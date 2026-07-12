// Numeric: final plug vs truth on OPEN GROUND (far from occluder) + underMask rows
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const NAME = process.argv[2];
const meta = JSON.parse(fs.readFileSync(`synth/${NAME}_meta.json`, 'utf8'));
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
  const res = await page.evaluate(async (meta) => {
    window._dbgFillCapture = true;
    bgMPIMode = true; bgPlugMode='directional'; bgValidMode='auto';
    buildBackgroundLayer();
    const D = window._dbgFill;
    const { pw, ph, plug, srcDepth, band, underMask } = D;
    const gd = (y) => { if (y < meta.horizon) return meta.dSky/255;
      const t = (y - meta.horizon) / Math.max(1, meta.H - meta.horizon);
      return (meta.dHor + (meta.dNear - meta.dHor)*t)/255; };
    // open-ground columns far from occluder: x=100 and x=1100 (synA), sample every 40 rows
    const cols = [100, Math.min(pw-50, meta.W-100)];
    const samples = [];
    for (const x of cols) for (let y = meta.horizon+20; y < meta.H-5; y += 40) {
      const i = y*pw+x;
      samples.push([x, y, +plug[i].toFixed(4), +srcDepth[i].toFixed(4), +gd(y).toFixed(4), underMask?underMask[i]:0, band[i]]);
    }
    // underMask per-row coverage
    const rowsU = [];
    for (let y = 0; y < ph; y += 50) { let c=0; for (let x=0;x<pw;x++) if (underMask && underMask[y*pw+x]) c++; rowsU.push([y,c]); }
    return { samples, rowsU, pw, ph };
  }, meta);
  console.log('open-ground [x, y, plugFinal, srcDepth, truth, under, band]:');
  for (const s of res.samples) console.log(' ', s.join('  '));
  console.log('underMask per-row count (y, n):', JSON.stringify(res.rowsU));
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
