// A182: IS THE WARRIOR'S COMBED BAND MADE OF v2's DEPTH BINS?
//
// The a181 sheets show a striped band immediately right of the warrior, growing
// with view angle, and warrior is the asset with the worst v2 stretch (19.9x vs
// troll 6.8, star 5.2). Stripes are a periodic artifact, and v2 slices depth into
// bgMPIV2Bins quantile planes, so the obvious suspect is the bin boundaries.
//
// "Obvious suspect" is not evidence. The hypothesis makes a PREDICTION: if the
// stripes are bin boundaries then DOUBLING the bin count must roughly HALVE the
// stripe period. If the period does not move, the bins are not the cause and the
// suspicion was pattern-matching.
//
// The band is located from the image rather than hardcoded: comb energy per pixel
// is |2*I(y) - I(y-1) - I(y+1)| (a vertical second difference, which is exactly
// what alternating rows maximise), and the measured region is the bounding box of
// the strongest 1%. Hardcoding a rectangle would let the region move with the
// hypothesis, which is the failure this file exists to avoid.
//
// Period comes from the autocorrelation of the column-averaged comb signal.
//
//   node harness/stripes.js [warrior|star|troll] [deg]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const ASSET = process.argv[2] || 'warrior';
const DEG = Number(process.argv[3] || 35);
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star: ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };
// A183: the arm is now the DECIMATION, not the bins. [maxBlock, bins] pairs —
// maxBlock 16 is shipped, 1 disables merging so every cell is emitted alone.
const ARMS = (process.env.ARM === 'bins')
  ? [[16, 10], [16, 20]]          // a182's refuted bin test, kept runnable
  : [[16, 10], [1, 10]];

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  const onDisk = (fs.readFileSync(path.join(WT, 'moebius.js'), 'utf8')
                    .match(/MOEBIUS_BUILD\s*=\s*'([^']+)'/) || [])[1] || null;
  const served = await page.evaluate(() => (typeof MOEBIUS_BUILD === 'string') ? MOEBIUS_BUILD : null);
  console.log('served build = ' + served + (served === onDisk ? ' (matches this tree)' : '  *** TREE SAYS ' + onDisk + ' ***'));

  const run = (maxBlock, bins, deg) => page.evaluate(async (o) => {
    window._rayReproject = true;
    bgViewFadeStartDeg = 35; bgViewFadeEndDeg = 45;
    bgQuickBake = false; bgMPIFullPlanes = true; bgMPIMode = true;
    bgMPIV2Bins = o.bins; bgMPIV2MaxBlock = o.maxBlock;
    bgBuildStamp = null; buildBackgroundLayer();
    isSweeping = true;
    const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
    camera.position.set(dist * Math.tan(o.deg * Math.PI / 180), 0, dist);
    for (let n = 0; n < 3; n++) render();
    const W = 720, Hh = 450;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
    const g = cv.getContext('2d'); g.drawImage(renderer.domElement, 0, 0, W, Hh);
    const px = g.getImageData(0, 0, W, Hh).data;
    const lum = new Float32Array(W * Hh);
    for (let i = 0; i < W * Hh; i++)
      lum[i] = 0.299 * px[i*4] + 0.587 * px[i*4+1] + 0.114 * px[i*4+2];

    // comb energy: vertical second difference — what alternating rows maximise
    const comb = new Float32Array(W * Hh);
    for (let y = 1; y < Hh - 1; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      comb[i] = Math.abs(2 * lum[i] - lum[i - W] - lum[i + W]);
    }
    // region = bounding box of the strongest 1%
    const sorted = Float32Array.from(comb).sort();
    const thr = sorted[Math.floor(sorted.length * 0.99)];
    let x0 = W, x1 = -1, y0 = Hh, y1 = -1, n = 0;
    for (let y = 1; y < Hh - 1; y++) for (let x = 0; x < W; x++) {
      if (comb[y * W + x] < thr) continue;
      n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) return { bins: o.bins, none: true };

    // column-averaged comb signal down the region, then autocorrelation
    const hgt = y1 - y0 + 1;
    const prof = new Float32Array(hgt);
    for (let y = 0; y < hgt; y++) { let s = 0;
      for (let x = x0; x <= x1; x++) s += comb[(y0 + y) * W + x];
      prof[y] = s / Math.max(1, x1 - x0 + 1); }
    // A182b TWO INSTRUMENT FIXES, BOTH OF WHICH MADE THE FIRST RUN UNINFORMATIVE.
    //  1. Smooth before correlating. Raw comb is dominated by single-pixel
    //     alternation, so the autocorrelation peaked at the search floor (lag 2)
    //     and reported "period 2" regardless of what the banding actually is.
    //  2. Search from lag 4. Lag 2-3 IS the pixel noise; a structure claim has to
    //     be about something wider than the sampling grid.
    const sm = new Float32Array(hgt);
    for (let y = 0; y < hgt; y++) {
      let s = 0, c = 0;
      for (let k = -1; k <= 1; k++) { const j = y + k; if (j >= 0 && j < hgt) { s += prof[j]; c++; } }
      sm[y] = s / c;
    }
    let mean = 0; for (let y = 0; y < hgt; y++) mean += sm[y]; mean /= hgt;
    for (let y = 0; y < hgt; y++) sm[y] -= mean;
    let v0 = 0; for (let y = 0; y < hgt; y++) v0 += sm[y] * sm[y];
    let best = 0, bestLag = 0; const acf = [];
    for (let lag = 4; lag < Math.min(80, hgt >> 1); lag++) {
      let s = 0; for (let y = 0; y + lag < hgt; y++) s += sm[y] * sm[y + lag];
      s = s / (hgt - lag) / Math.max(1e-9, v0 / hgt);   // normalised: 1.0 = perfect
      acf.push([lag, +s.toFixed(3)]);
      if (s > best) { best = s; bestLag = lag; }
    }
    acf.sort((p2, q2) => q2[1] - p2[1]);
    return { bins: o.bins, maxBlock: o.maxBlock, x0, x1, y0, y1, hgt,
             quads: (window._v2Stretch || {}).keep,
             // n is ALWAYS ~1% of the frame by construction — it is the
             // threshold's definition, not a finding. The informative numbers
             // are the threshold itself and the region's mean comb.
             combThr: +thr.toFixed(2), topAcf: acf.slice(0, 4),
             period: bestLag, peak: +best.toFixed(3),
             stripesInRegion: bestLag ? +(hgt / bestLag).toFixed(1) : 0,
             planes: (typeof mpiFullMeshes !== 'undefined' && mpiFullMeshes) ? mpiFullMeshes.length : -1,
             v2max: (window._v2Stretch || {}).maxRatio };
  }, { bins, maxBlock, deg });

  console.log('\n' + ASSET + ' at ' + DEG + ' deg — does the periodic banding follow the block grid?');
  console.log('\n  blk bins  quads  region (x0..x1, y0..y1)     combThr  period    corr  v2 worst');
  const out = [];
  for (const [mb, b] of ARMS) {
    const r = await run(mb, b, DEG);
    out.push(r);
    if (r.none) { console.log('  ' + String(b).padStart(4) + '   no comb region found'); continue; }
    console.log('  ' + String(mb).padStart(3) + String(b).padStart(5) + String(r.quads).padStart(7) +
      ('  ' + r.x0 + '..' + r.x1 + ', ' + r.y0 + '..' + r.y1).padEnd(28) +
      String(r.combThr).padStart(8) + String(r.period).padStart(8) +
      String(r.peak).padStart(8) + String(r.v2max).padStart(10));
    console.log('        top lags (lag,corr): ' + JSON.stringify(r.topAcf));
  }
  if (out.length === 2 && !out[0].none && !out[1].none) {
    const ratio = out[0].period / Math.max(1e-9, out[1].period);
    const dCorr = out[1].peak - out[0].peak;
    console.log('\n  quads ' + out[0].quads + ' -> ' + out[1].quads +
                '   period ' + out[0].period + ' -> ' + out[1].period +
                '   corr ' + out[0].peak + ' -> ' + out[1].peak + '  (' + (dCorr >= 0 ? '+' : '') + dCorr.toFixed(3) + ')');
    console.log('  PREDICTION if the BLOCK GRID causes the banding: turning merging off');
    console.log('  (blk 1, every cell emitted alone) must largely remove the periodic structure.');
    console.log('  VERDICT: ' + (dCorr < -0.15
      ? 'CONSISTENT — the periodicity collapses without merging'
      : (Math.abs(dCorr) <= 0.15
         ? 'REFUTED — the banding survives with merging off, the block grid is not the cause'
         : 'UNEXPECTED — merging off made the banding STRONGER')));
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
