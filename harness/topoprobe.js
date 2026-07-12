// TOPOLOGY TEST: for each band/under pixel, compare the plug depth against
// the LINEAR INTERPOLATION of the true surface depths at the two nearest
// non-completed pixels on its row (the surface's own continuation line).
// A plug that continues slope scores ~0; a flat rim-value plateau scores
// the full wedge error. Also reports plateau-ness (row-run variance).
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
  const res = await page.evaluate(() => {
    window._dbgFillCapture = true;
    bgMPIMode = true; bgMPIFullPlanes=false; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer();
    const D = window._dbgFill;
    const { pw, ph, band, underMask, plug, srcDepth } = D;
    const PN = pw*ph;
    const inSet = (i) => band[i] || (underMask && underMask[i]);
    // per completed pixel on each row: find nearest non-set pixel left & right,
    // compute expected = linear interp of srcDepth at those anchors.
    let n = 0, sumAbs = 0, sumPlateau = 0, big = 0;
    const errMap = new Uint8Array(PN);
    const errH = new Float32Array(64); // histogram of |err| in 1/255 steps of 4
    for (let y = 0; y < ph; y++) {
      const r0 = y*pw;
      let x = 0;
      while (x < pw) {
        if (!inSet(r0+x)) { x++; continue; }
        // run [x, e)
        let e = x; while (e < pw && inSet(r0+e)) e++;
        const li = x-1 >= 0 ? r0+x-1 : -1, ri = e < pw ? r0+e : -1;
        if (li >= 0 && ri >= 0 && (e - x) >= 4) {
          const dl = srcDepth[li], dr = srcDepth[ri];
          // only score reveals bounded by the SAME surface class on both
          // sides (a leg gap in a dune, a sky corridor): |dl-dr| small.
          if (Math.abs(dl - dr) < 0.10) {
            for (let xx = x; xx < e; xx++) {
              const tfrac = (xx - (x-1)) / (e - (x-1));
              const exp2 = dl + (dr - dl) * tfrac;
              const err = Math.abs(plug[r0+xx] - exp2);
              errMap[r0+xx] = Math.min(255, err*255|0);
              sumAbs += err; n++;
              const b = Math.min(63, (err*255/4)|0); errH[b]++;
              if (err > 0.06) big++;
            }
            // plateau-ness: variance of plug across the run vs variance of the interp line
            let m1 = 0; for (let xx = x; xx < e; xx++) m1 += plug[r0+xx]; m1 /= (e-x);
            let v1 = 0; for (let xx = x; xx < e; xx++) { const d2 = plug[r0+xx]-m1; v1 += d2*d2; }
            sumPlateau += Math.sqrt(v1/(e-x));
          }
        }
        x = e;
      }
    }
    // error map: red intensity = |err|, blue tint where pixel is BAND (vs under)
    const S = 2, c = document.createElement('canvas');
    c.width = (pw/S)|0; c.height = (ph/S)|0;
    const cx = c.getContext('2d'); const id = cx.createImageData(c.width, c.height);
    for (let y2 = 0; y2 < c.height; y2++) for (let x2 = 0; x2 < c.width; x2++) {
      const i = (y2*S)*pw + x2*S, o = (y2*c.width+x2)*4;
      const g = Math.min(200, srcDepth[i]*255*0.8|0);
      id.data[o]=g; id.data[o+1]=g; id.data[o+2]=g; id.data[o+3]=255;
      if (errMap[i] > 0) { id.data[o] = Math.min(255, 60+errMap[i]*3); id.data[o+1] = g>>2; id.data[o+2] = band[i]?200:0; }
    }
    cx.putImageData(id, 0, 0);
    return { n, meanAbs: sumAbs/Math.max(1,n), big, bigPct: 100*big/Math.max(1,n),
             hist: Array.from(errH.slice(0, 16)), png: c.toDataURL('image/png') };
  });
  console.log('scored px:', res.n, 'mean |plug - surface-line|:', res.meanAbs.toFixed(4),
              '(depth units); >0.06 err:', res.big, '(' + res.bigPct.toFixed(1) + '%)');
  console.log('err histogram (4/255 bins):', res.hist.map(v=>v|0).join(','));
  fs.writeFileSync('topo_errmap.png', Buffer.from(res.png.split(',')[1],'base64'));
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
