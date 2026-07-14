// A55 diagnosis: what depth does the PARTY actually get, and from where?
// Compares, over the party window and a bare-ground control at the same
// screen rows: (a) raw loaded depth PNG, (b) the sharpened/shipped depth
// the bake ships. Prints mean/min/max/std + a coherence measure (fraction
// of 3x3 neighbourhoods whose range exceeds 0.06). Star asset.
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
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate(async () => {
    // raw depth PNG at source res
    const dImg = new Image();
    await new Promise(r => { dImg.onload = r; dImg.src = 'defaultImgDepth.png'; });
    const W = dImg.naturalWidth, H = dImg.naturalHeight;
    const rc = document.createElement('canvas'); rc.width = W; rc.height = H;
    const rcx = rc.getContext('2d'); rcx.drawImage(dImg, 0, 0);
    const rpx = rcx.getImageData(0, 0, W, H).data;
    const raw = new Float32Array(W*H);
    for (let i = 0; i < W*H; i++) raw[i] = rpx[i*4] / 255;

    // shipped depth after bake
    window._srCapture = true;
    bgQuickBake = true; buildBackgroundLayer();
    window._srCapture = false;
    const L = mediaLayers[0];
    const D = window._qbDbg;   // d = shipped, plate = envelope; same res as source
    const pw = D.pw, ph = D.ph;

    const stat = (arr, w, x0, x1, y0, y1) => {
      let n = 0, s = 0, mn = 2, mx = -1, incoh = 0, ncoh = 0;
      const vals = [];
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const v = arr[y*w+x]; n++; s += v; if (v<mn) mn=v; if (v>mx) mx=v; vals.push(v);
        if (x>x0 && x<x1-1 && y>y0 && y<y1-1) {
          let lmn=2, lmx=-1;
          for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++){ const u=arr[(y+dy)*w+(x+dx)]; if(u<lmn)lmn=u; if(u>lmx)lmx=u; }
          ncoh++; if (lmx-lmn > 0.06) incoh++;
        }
      }
      const mean = s/n; let sd=0; for (const v of vals) sd += (v-mean)*(v-mean); sd = Math.sqrt(sd/n);
      return { mean:+mean.toFixed(3), min:+mn.toFixed(3), max:+mx.toFixed(3), spread:+(mx-mn).toFixed(3),
               std:+sd.toFixed(3), incoherentFrac:+(incoh/Math.max(1,ncoh)).toFixed(3) };
    };
    // windows in SOURCE coords (1920x1323). party ~ bottom-right cluster.
    const party = [1180, 1520, 900, 1120];
    const groundNear = [820, 1080, 900, 1000];   // bare desert just left of party
    const groundFar  = [600, 900, 640, 720];      // bare desert further back
    const astro = [430, 720, 560, 1050];          // the big foreground figure
    return {
      W, H,
      partyRaw: stat(raw, W, ...party),
      partyShip: stat(D.d, pw, ...party),
      groundNearRaw: stat(raw, W, ...groundNear),
      groundFarRaw: stat(raw, W, ...groundFar),
      astroRaw: stat(raw, W, ...astro),
    };
  });
  console.log(JSON.stringify(res, null, 1));
  await browser.close(); srv.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
