// A191b: THE FIRST VERSION OF THIS TEST PRINTED TWO VERDICTS AND EARNED NEITHER.
//
// band.js reported "REFUTED — the banding survives without the cut" and
// "SCREEN-anchored — the structure is in the shader". Both are void:
//
//  1. THE CUT ARM NEVER DIVERGED. u_bandCutUvRate read 0.0000e+0 in EVERY arm,
//     including the shipped ones. The a72/a83 stretch cut is armed by the QUICK
//     bake's armNet(); v2 — the mode the banding lives in, and the shipped
//     default — never arms it. So "cut off" turned off something already off,
//     and the correlation was identical to three decimal places because the two
//     arms were the same render.
//     THE UNDERLYING FACT IS STRONGER THAN THE A/B WOULD HAVE BEEN: the
//     dithered cut CANNOT be causing v2's banding, because it is disabled in
//     v2. The a189-derived hypothesis is eliminated by mechanism, not by
//     measurement. Same for the resize-staleness arm — a threshold of 0 cannot
//     go stale, so that question is still open and is NOT answered here.
//
//  2. THE PERIOD COMPARISON COMPARED DIFFERENT THINGS. The comb region is
//     auto-located per arm and it MOVED — 170..293, 58..212 at the small canvas
//     against 404..749, 20..538 at the large one. Two different features. And
//     the canvases are not related by 2: a 720x450 page gives a 380x214 backing
//     store, a 1440x900 page gives 960x540, a ratio of 2.53. The printed "x0.10
//     -> SCREEN-anchored" came from a branch that was only ever written for
//     ratios near 1 or near 2.
//     a182/a183's "period 4" is not comparable either: those captured into a
//     fixed 720x450 canvas, upsampled from the 380x214 backing store, so their
//     periods are in units 1.9x smaller than a backing-store pixel.
//
// WHAT THIS VERSION FIXES.
//  - The region is located ONCE, at the larger canvas where the band is best
//    resolved, and stored NORMALISED. Both arms measure the same part of the
//    same picture.
//  - Period is reported in backing-store pixels AND normalised by backing
//    height, so the two arms can be compared at all.
//  - The lag search starts at 3 and the top five lags are printed with their
//    correlations, so a peak sitting on the search floor is visible instead of
//    being reported as a period.
//  - The backing ratio is measured and printed rather than assumed.
//
// THE PREDICTIONS, in the corrected units:
//   SOURCE-anchored (the depth data): period_norm is CONSTANT, so period_px
//     scales with the backing height.
//   SCREEN-anchored (something in the shader keyed to gl_FragCoord): period_px
//     is CONSTANT, so period_norm shrinks by the backing ratio.
//
//   node harness/band2.js [warrior|star|troll] [deg]
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

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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

  const run = (o) => page.evaluate(async (o) => {
    window._rayReproject = true;
    bgViewFadeStartDeg = 35; bgViewFadeEndDeg = 45;
    bgQuickBake = false; bgMPIFullPlanes = true; bgMPIMode = true;
    bgBuildStamp = null; buildBackgroundLayer();
    isSweeping = true;
    let thr = null;
    scene.traverse(m => { const u = m.material && m.material.uniforms;
      if (u && u.u_bandCutUvRate && thr === null) thr = u.u_bandCutUvRate.value; });
    const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
    camera.position.set(dist * Math.tan(o.deg * Math.PI / 180), 0, dist);
    for (let n = 0; n < 3; n++) render();
    const W = renderer.domElement.width, Hh = renderer.domElement.height;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
    const g = cv.getContext('2d'); g.drawImage(renderer.domElement, 0, 0, W, Hh);
    const url = cv.toDataURL('image/png');
    const px = g.getImageData(0, 0, W, Hh).data;
    const lum = new Float32Array(W*Hh);
    for (let i = 0; i < W*Hh; i++) lum[i] = 0.299*px[i*4] + 0.587*px[i*4+1] + 0.114*px[i*4+2];
    const comb = new Float32Array(W*Hh);
    for (let y = 1; y < Hh-1; y++) for (let x = 0; x < W; x++) {
      const i = y*W+x; comb[i] = Math.abs(2*lum[i] - lum[i-W] - lum[i+W]); }

    let rect = o.rect;   // normalised [x0,x1,y0,y1], or null to locate here
    if (!rect) {
      const sorted = Float32Array.from(comb).sort();
      const t = sorted[Math.floor(sorted.length * 0.99)];
      let x0 = W, x1 = -1, y0 = Hh, y1 = -1;
      for (let y = 1; y < Hh-1; y++) for (let x = 0; x < W; x++) {
        if (comb[y*W+x] < t) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0) return { none: true, W, H: Hh, thr, url };
      rect = [x0/W, x1/W, y0/Hh, y1/Hh];
    }
    const X0 = Math.max(1, Math.round(rect[0]*W)), X1 = Math.min(W-2, Math.round(rect[1]*W));
    const Y0 = Math.max(1, Math.round(rect[2]*Hh)), Y1 = Math.min(Hh-2, Math.round(rect[3]*Hh));
    const hgt = Y1 - Y0 + 1;
    if (hgt < 16) return { none: true, W, H: Hh, thr, url, rect };
    const prof = new Float32Array(hgt);
    for (let y = 0; y < hgt; y++) { let s = 0;
      for (let x = X0; x <= X1; x++) s += comb[(Y0+y)*W + x];
      prof[y] = s / Math.max(1, X1 - X0 + 1); }
    const sm = new Float32Array(hgt);
    for (let y = 0; y < hgt; y++) { let s = 0, c = 0;
      for (let k = -1; k <= 1; k++) { const j = y+k; if (j >= 0 && j < hgt) { s += prof[j]; c++; } }
      sm[y] = s/c; }
    let mean = 0; for (let y = 0; y < hgt; y++) mean += sm[y]; mean /= hgt;
    for (let y = 0; y < hgt; y++) sm[y] -= mean;
    let v0 = 0; for (let y = 0; y < hgt; y++) v0 += sm[y]*sm[y];
    const acf = [];
    for (let lag = 3; lag < Math.min(200, hgt >> 1); lag++) {
      let s = 0; for (let y = 0; y + lag < hgt; y++) s += sm[y]*sm[y+lag];
      acf.push([lag, +(s/(hgt-lag)/Math.max(1e-9, v0/hgt)).toFixed(3)]);
    }
    const top = acf.slice().sort((a,b) => b[1]-a[1]).slice(0, 5);
    return { W, H: Hh, thr, url, rect,
             box: X0+'..'+X1+', '+Y0+'..'+Y1,
             period: top[0][0], peak: top[0][1], top,
             periodNorm: +(top[0][0]/Hh).toFixed(5),
             onFloor: top[0][0] === 3 };
  }, o);

  // locate the region ONCE at the large canvas, then reuse it everywhere
  const big = await run({ deg: DEG, rect: null });
  if (big.none) { console.log('no comb region found at the large canvas'); await browser.close(); srv.kill(); process.exit(2); }
  await page.setViewportSize({ width: 720, height: 450 });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await new Promise(r => setTimeout(r, 1200));
  const small = await run({ deg: DEG, rect: big.rect });

  const pad = (s, n) => String(s).padStart(n);
  console.log('\n' + ASSET + ' at ' + DEG + ' deg — SAME normalised region at two backing-store sizes');
  console.log('  region (normalised): [' + big.rect.map(v => v.toFixed(3)).join(', ') + ']\n');
  console.log('  backing store   u_bandCutUvRate   region px              period px   period/height   corr   on floor');
  for (const m of [small, big]) {
    if (m.none) { console.log('  ' + pad(m.W + 'x' + m.H, 13) + '   region too small at this size'); continue; }
    console.log('  ' + pad(m.W + 'x' + m.H, 13) + pad(m.thr === null ? 'none' : m.thr.toExponential(4), 18) +
      pad(m.box, 22) + pad(m.period, 12) + pad(m.periodNorm, 16) + pad(m.peak, 7) + pad(m.onFloor ? 'YES' : 'no', 11));
    console.log('        top lags: ' + JSON.stringify(m.top));
  }
  if (!small.none && !big.none) {
    const ratio = big.H / small.H;
    const pxRatio = big.period / Math.max(1e-9, small.period);
    console.log('\n  backing height ratio ' + ratio.toFixed(3) + ',  period ratio ' + pxRatio.toFixed(3));
    console.log('  VERDICT: ' + (
      Math.abs(pxRatio - ratio) < Math.abs(pxRatio - 1)
        ? 'SOURCE-anchored — the period scales with resolution, so the structure is in the data'
        : (Math.abs(pxRatio - 1) < 0.35
           ? 'SCREEN-anchored — the period is fixed in pixels, so the structure is in the shader'
           : 'NEITHER — the period ratio matches no prediction; the instrument is still measuring two different things and this run decides nothing')));
    console.log('\n  u_bandCutUvRate is 0 in v2, so the a83 dithered cut is NOT ARMED on this path');
    console.log('  and cannot be the cause. That is a mechanism, not an A/B — the a191 cut arm');
    console.log('  was a no-op and is not evidence.');
  }
  for (const [m, tag] of [[small, 'small'], [big, 'big']])
    if (m.url) fs.writeFileSync(path.join(H, 'band2_' + ASSET + '_' + tag + '.png'),
      Buffer.from(m.url.split(',')[1], 'base64'));
  console.log('\n  wrote harness/band2_' + ASSET + '_{small,big}.png');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
