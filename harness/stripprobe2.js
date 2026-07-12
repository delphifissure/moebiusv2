// Cluster strip texels with depth 0.3-0.45 near the violation region
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
    bgMPIMode = true; bgMPIFullPlanes=false; bgPlugMode='directional'; bgValidMode='auto';
    buildBackgroundLayer();
    const D = window._dbgFill;
    const { pw, ph, stripO, stripD, srcDepth } = D;
    if (!stripO) return { err: 'no strips captured' };
    // region around plate (572,541): +-120 px, list strip texels 0.28-0.48
    const found = [];
    const cnt = {};
    for (let y = 400; y < 690; y++) for (let x = 430; x < 720; x++) { const i = y*pw+x;
      for (let s = 0; s < 2; s++) {
        if (stripO[s][i] && stripD[s][i] > 0.28 && stripD[s][i] < 0.48) {
          const k = stripO[s][i] + '@s' + s;
          cnt[k] = (cnt[k]||0)+1;
          if (found.length < 12) found.push([x, y, s, stripO[s][i], +stripD[s][i].toFixed(3), +srcDepth[i].toFixed(3)]);
        }
      }
    }
    return { cnt, found };
  });
  if (res.err) { console.log(res.err); } else {
  console.log('mid-depth strip texels by owner layer@slot:', JSON.stringify(res.cnt));
  console.log('first 12 [x y slot layer stripD src]:');
  for (const f of res.found) console.log(' ', f.join('  ')); }
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
