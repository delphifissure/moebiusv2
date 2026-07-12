// Depth-composite verification: renders the depth pass WITH the plug included
// (magenta = unplugged hole) at three poses, and computes source-space Law-2
// stats on the plug itself: weld error at the band ring, and protrusion count
// (plug nearer than the local background far-field + 0.08, per PLUG_PORT_SPEC).
// Usage: node depth_dump.js <prefix>
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const PREFIX = process.argv[2] || 'dd';

(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('console', m => { const t=m.text(); if (/RUNG-PLUG|error/i.test(t)) console.log('  [page]',t); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && fgMarkDilationMaterial && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  await page.evaluate(() => { bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer(); });
  await page.waitForTimeout(800);

  // Law-2 stats, app-convention: weld/protrusion measured against the
  // BG-side ring only (a FG-side neighbour SHOULD differ — that step is the
  // occlusion itself). "Protrusion" = plug nearer than the background surface
  // it welds to, beyond 0.08 slack.
  const stats = await page.evaluate(() => {
    const xE = bgDirectionalExport; if (!xE) return { err: 'no export' };
    const { pw, ph, band, plug } = xE; const N = pw * ph;
    const L = mediaLayers[0];
    const dImg = L.textures.depth.image;
    const c = document.createElement('canvas'); c.width = pw; c.height = ph;
    const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(dImg, 0, 0, pw, ph);
    const dpx = cx.getImageData(0, 0, pw, ph).data;
    const depth = new Float32Array(N); for (let i = 0; i < N; i++) depth[i] = dpx[i*4] / 255;
    let ringN = 0, weldSum = 0, weldMax = 0, weld02 = 0, protr = 0, protrMax = 0;
    for (let y = 1; y < ph-1; y++) for (let x = 1; x < pw-1; x++) { const i = y*pw+x;
      if (!band[i]) continue;
      const nbs = [i-1, i+1, i-pw, i+pw];
      for (const j of nbs) {
        if (band[j]) continue;
        // BG-side neighbour only: at or behind the plug (within slack)
        if (depth[j] <= plug[i] + 0.06) {
          ringN++;
          const w = Math.abs(plug[i] - depth[j]);
          weldSum += w; if (w > weldMax) weldMax = w; if (w > 0.02) weld02++;
          if (plug[i] > depth[j] + 0.08) { protr++; const e = plug[i]-depth[j]-0.08; if (e > protrMax) protrMax = e; }
        }
      }
    }
    return { pw, ph,
      ringBG: { n: ringN, meanWeldErr: +(weldSum/Math.max(1,ringN)).toFixed(4),
                maxWeldErr: +weldMax.toFixed(3), over0_02Frac: +(weld02/Math.max(1,ringN)).toFixed(4) },
      protrusion: { px: protr, frac: +(protr/Math.max(1,ringN)).toFixed(5), maxOver: +protrMax.toFixed(3) } };
  });
  console.log('LAW2-STATS', JSON.stringify(stats));

  await browser.close(); srv.kill();
  console.log('done');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
