// A52 one-off: image the SHIPPED depth vs RAW depth in the comb region
// (party/dune-crest band) after a quick bake. Binarized columns => the
// ramp collapse is the comb source; smooth => estimator dither.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const OUT = process.argv[2] || '.';
fs.copyFileSync('../starwatcher_color.png', 'defaultImgColor.png');
fs.copyFileSync('../starwatcher_depth.png', 'defaultImgDepth.png');
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
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
    const L = mediaLayers[0];
    const D = window._qbDbg;
    if (!D) return { err: 'no qbDbg' };
    const pw = D.pw, ph = D.ph;
    // comb region in canvas coords (520-800, 330-470) of 960x540 -> source x2, x2.45
    const x0 = 1040, x1 = 1600, y0 = 810, y1 = 1150;
    const W = x1 - x0, H = y1 - y0;
    const paint = (arr) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const cx = c.getContext('2d');
      const id = cx.createImageData(W, H);
      // stretch contrast around the local range
      let mn = 1, mx = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const v = arr[y*pw+x]; if (v < mn) mn = v; if (v > mx) mx = v; }
      const s = mx > mn ? 255/(mx-mn) : 1;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const v = Math.round((arr[y*pw+x]-mn)*s);
        const o = ((y-y0)*W + (x-x0))*4;
        id.data[o]=v; id.data[o+1]=v; id.data[o+2]=v; id.data[o+3]=255;
      }
      cx.putImageData(id, 0, 0);
      return c.toDataURL('image/png');
    };
    const out = { shipped: paint(D.d), range: null };
    if (L._rawDepth && L._rawDepthW === pw) out.raw = paint(L._rawDepth);
    return out;
  });
  if (res.err) { console.log('ERR', res.err); process.exit(1); }
  fs.writeFileSync(OUT + '/dc_shipped.png', Buffer.from(res.shipped.split(',')[1], 'base64'));
  if (res.raw) fs.writeFileSync(OUT + '/dc_raw.png', Buffer.from(res.raw.split(',')[1], 'base64'));
  console.log('wrote shipped' + (res.raw ? '+raw' : ' (no raw export)'));
  await browser.close(); srv.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
