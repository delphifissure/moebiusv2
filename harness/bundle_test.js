// Test the per-layer file builder headless (bypasses the zip/debug-sheet path)
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
    bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer();
    const files = [];
    const meta = { files: {} };
    const toPng = (cv) => { // return dataURL length as byte proxy + keep first layer's PNGs
      return cv.toDataURL('image/png');
    };
    const n = bgBuildMPILayerFiles(files, meta, toPng);
    // pull the first emitted layer's three files for visual check
    const out = { n, names: files.map(f => f.name), meta: meta.mpiLayers };
    for (const f of files.slice(0, 3)) out[f.name] = f.bytes; // dataURLs
    return out;
  });
  console.log('layers emitted:', res.n);
  console.log('files:', JSON.stringify(res.names));
  console.log('meta:', JSON.stringify(res.meta));
  for (const name of res.names.slice(0,3)) {
    if (res[name]) fs.writeFileSync('bundle_' + name, Buffer.from(res[name].split(',')[1], 'base64'));
  }
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
