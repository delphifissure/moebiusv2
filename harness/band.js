// A191: THE WARRIOR'S PERIOD-4 BANDING — DEPTH DATA, OR THE DITHERED CUT?
//
// a181 saw a combed band right of the warrior. a182 refuted the depth bins by
// prediction (doubling them moved the period by nothing). a183 refuted the
// quadtree decimation the same way (10.7x the quads, banding survived, the
// correlation went UP). That left "the depth data or the shader", and there it
// stopped.
//
// a189 CHANGES THE SUSPECT LIST. The a83 stretch cut discards on
//
//     svDith = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453)
//
// which is anchored to SCREEN PIXELS, and it fires hardest on the most stretched
// content. The warrior has by far the worst surviving stretch of the suite
// (19.9x against troll 6.8 and star 5.2), so it has the most content sitting in
// the dither band — and a dithered discard over a stretched region is a comb.
// That is the same mechanism a189 convicted for the simulated viewer, showing up
// on the plain path where it was calibrated to fire.
//
// TWO PREDICTIONS THAT CANNOT BOTH HOLD.
//
//   If the banding is the DITHERED CUT (screen-anchored):
//       - turning the cut off removes it, and
//       - DOUBLING THE CANVAS leaves the period near 4 px, because the dither
//         is keyed to gl_FragCoord and does not know about the source.
//
//   If the banding is in the DEPTH DATA (source-anchored):
//       - it survives with the cut off, and
//       - doubling the canvas roughly DOUBLES the period in pixels, because the
//         same source structure now covers twice as many pixels.
//
// The period is therefore measured in CANVAS pixels at each canvas size, and the
// frame is captured at the renderer's own backing-store size rather than a fixed
// 720x450 — resampling to a constant size would destroy exactly the quantity
// under test.
//
// A FOURTH ARM, ON A SUSPICION a189 RAISED AND DID NOT SETTLE. u_bandCutUvRate is
// computed from the renderer width while ARMING THE BAKE. If a window resize
// does not re-arm it, then every resize after a bake leaves the cut calibrated
// for the old canvas — the a189 defect, on the shipped path, triggered by
// dragging a window. Arm C re-bakes after the resize; arm D does not. C vs D
// isolates it.
//
//   node harness/band.js [warrior|star|troll] [deg]
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

  const measure = (opts) => page.evaluate(async (o) => {
    window._rayReproject = true;
    bgViewFadeStartDeg = 35; bgViewFadeEndDeg = 45;
    bgQuickBake = false; bgMPIFullPlanes = true; bgMPIMode = true;
    if (o.rebake) { bgBuildStamp = null; buildBackgroundLayer(); }
    isSweeping = true;

    // record what the cut is actually armed with, so a stale threshold is
    // visible in the table rather than inferred from behaviour
    let thr = null, nMat = 0;
    scene.traverse(m => { const u = m.material && m.material.uniforms;
      if (u && u.u_bandCutUvRate) { nMat++; if (thr === null) thr = u.u_bandCutUvRate.value; } });
    const saved = [];
    if (o.cutOff) scene.traverse(m => { const u = m.material && m.material.uniforms;
      if (u && u.u_bandCutUvRate) { saved.push([u, u.u_bandCutUvRate.value]); u.u_bandCutUvRate.value = 0; } });

    const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
    camera.position.set(dist * Math.tan(o.deg * Math.PI / 180), 0, dist);
    for (let n = 0; n < 3; n++) render();

    const W = renderer.domElement.width, Hh = renderer.domElement.height;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
    const g = cv.getContext('2d'); g.drawImage(renderer.domElement, 0, 0, W, Hh);
    const url = cv.toDataURL('image/png');
    const px = g.getImageData(0, 0, W, Hh).data;
    for (const [u, v] of saved) u.u_bandCutUvRate.value = v;

    const lum = new Float32Array(W * Hh);
    for (let i = 0; i < W * Hh; i++) lum[i] = 0.299*px[i*4] + 0.587*px[i*4+1] + 0.114*px[i*4+2];
    // comb energy = vertical second difference, what alternating rows maximise
    const comb = new Float32Array(W * Hh);
    for (let y = 1; y < Hh - 1; y++) for (let x = 0; x < W; x++) {
      const i = y*W + x; comb[i] = Math.abs(2*lum[i] - lum[i-W] - lum[i+W]);
    }
    const sorted = Float32Array.from(comb).sort();
    const thrC = sorted[Math.floor(sorted.length * 0.99)];
    let x0 = W, x1 = -1, y0 = Hh, y1 = -1;
    for (let y = 1; y < Hh - 1; y++) for (let x = 0; x < W; x++) {
      if (comb[y*W + x] < thrC) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) return { none: true, W, H: Hh, thr, nMat, url };
    const hgt = y1 - y0 + 1;
    const prof = new Float32Array(hgt);
    for (let y = 0; y < hgt; y++) { let s = 0;
      for (let x = x0; x <= x1; x++) s += comb[(y0 + y)*W + x];
      prof[y] = s / Math.max(1, x1 - x0 + 1); }
    // a182b: smooth before correlating and search from lag 4 — raw comb is
    // dominated by single-pixel alternation and peaks at the search floor.
    const sm = new Float32Array(hgt);
    for (let y = 0; y < hgt; y++) { let s = 0, c = 0;
      for (let k = -1; k <= 1; k++) { const j = y + k; if (j >= 0 && j < hgt) { s += prof[j]; c++; } }
      sm[y] = s / c; }
    let mean = 0; for (let y = 0; y < hgt; y++) mean += sm[y]; mean /= hgt;
    for (let y = 0; y < hgt; y++) sm[y] -= mean;
    let v0 = 0; for (let y = 0; y < hgt; y++) v0 += sm[y]*sm[y];
    let best = 0, bestLag = 0; const acf = [];
    for (let lag = 4; lag < Math.min(120, hgt >> 1); lag++) {
      let s = 0; for (let y = 0; y + lag < hgt; y++) s += sm[y]*sm[y+lag];
      s = s / (hgt - lag) / Math.max(1e-9, v0 / hgt);
      acf.push([lag, +s.toFixed(3)]);
      if (s > best) { best = s; bestLag = lag; }
    }
    acf.sort((a, b) => b[1] - a[1]);
    return { W, H: Hh, thr, nMat, url,
             box: x0 + '..' + x1 + ', ' + y0 + '..' + y1,
             combThr: +thrC.toFixed(2), period: bestLag, peak: +best.toFixed(3),
             topAcf: acf.slice(0, 4),
             v2max: (window._v2Stretch || {}).maxRatio };
  }, opts);

  const rows = [];
  console.log('\n' + ASSET + ' at ' + DEG + ' deg — is the banding SCREEN-anchored (the a83 dither) or SOURCE-anchored (depth)?');

  rows.push(['A  720x450, cut ON  (shipped)', await measure({ deg: DEG, rebake: true, cutOff: false })]);
  rows.push(['B  720x450, cut OFF',           await measure({ deg: DEG, rebake: false, cutOff: true })]);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => { window.dispatchEvent(new Event('resize')); });
  await new Promise(r => setTimeout(r, 1200));
  rows.push(['D  1440x900, NOT re-baked',     await measure({ deg: DEG, rebake: false, cutOff: false })]);
  rows.push(['C  1440x900, re-baked',         await measure({ deg: DEG, rebake: true,  cutOff: false })]);

  const pad = (s, n) => String(s).padStart(n);
  console.log('\n  arm                             canvas      u_bandCutUvRate   region                 period   corr');
  for (const [tag, m] of rows) {
    if (m.none) { console.log('  ' + tag.padEnd(32) + pad(m.W + 'x' + m.H, 11) + '   no comb region found'); continue; }
    console.log('  ' + tag.padEnd(32) + pad(m.W + 'x' + m.H, 11) +
      pad(m.thr === null ? 'none' : m.thr.toExponential(4), 18) +
      pad(m.box, 24) + pad(m.period, 9) + pad(m.peak, 7));
  }
  const A = rows[0][1], B = rows[1][1], D = rows[2][1], C = rows[3][1];
  if (!A.none && !B.none) {
    const d = B.peak - A.peak;
    console.log('\n  CUT OFF: corr ' + A.peak + ' -> ' + B.peak + '  (' + (d >= 0 ? '+' : '') + d.toFixed(3) + ')  ' +
      (d < -0.15 ? 'CONSISTENT with the dithered cut'
                 : (Math.abs(d) <= 0.15 ? 'REFUTED — the banding survives without the cut'
                                        : 'UNEXPECTED — stronger without the cut')));
  }
  if (!A.none && !C.none) {
    const ratio = C.period / Math.max(1e-9, A.period);
    console.log('  CANVAS x2 (re-baked): period ' + A.period + ' -> ' + C.period + '  (x' + ratio.toFixed(2) + ')  ' +
      (ratio > 1.5 ? 'SOURCE-anchored — the structure is in the data'
                   : (ratio < 1.3 ? 'SCREEN-anchored — the structure is in the shader'
                                  : 'AMBIGUOUS')));
  }
  if (!C.none && !D.none) {
    console.log('  RESIZE WITHOUT RE-BAKE: threshold ' + (D.thr === null ? '?' : D.thr.toExponential(4)) +
      ' vs re-baked ' + (C.thr === null ? '?' : C.thr.toExponential(4)) +
      (D.thr && C.thr && Math.abs(D.thr - C.thr) / C.thr > 0.05
        ? '  <-- STALE: a resize after a bake leaves the cut calibrated for the old canvas'
        : '  (tracks the resize)'));
  }
  for (const [tag, m] of rows) {
    if (!m.url) continue;
    const slug = tag.trim().split(/\s+/)[0];
    fs.writeFileSync(path.join(H, 'band_' + ASSET + '_' + slug + '.png'),
      Buffer.from(m.url.split(',')[1], 'base64'));
  }
  console.log('\n  wrote harness/band_' + ASSET + '_{A,B,C,D}.png');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
