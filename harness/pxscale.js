// A192e: VERIFY THE CORRECTION ITSELF, AT ONE CANVAS SIZE.
//
// a192 established the defect end-to-end: bake at 380 px, resize to 740 without
// re-baking, and the stretch cut — still calibrated for 380 — deletes content
// (black 0.000% -> 2.988%, against 0.002% for a page baked fresh at 740).
//
// Verifying the FIX that way is not available here: the post-resize probe
// crashes swiftshader. That crash is NOT the fix — the pre-a192 build was run
// through the identical harness as a control and crashed in exactly the same
// place — but a crash is a crash, and a fix must not be reported as working on
// the strength of a run that did not finish.
//
// So test the correction instead of the scenario. Staleness is one number being
// wrong relative to another, and both are reachable from the page:
//
//   u_bandCutUvRate  the threshold, armed at bake time from the renderer width
//   bgBandCutArmedW  the width it was armed against (a192 records it)
//   u_pxScale        = (width being rasterised into) / bgBandCutArmedW
//
// A resize to R times the width is therefore INDISTINGUISHABLE, from the
// shader's point of view, from arming at 1/R of the current width. So drive it
// that way, at a fixed canvas, with no resize and nothing to crash:
//
//   BASELINE   shipped: threshold armed at this width, pxScale 1
//   STALE      threshold scaled by R (as if armed at width/R) while
//              bgBandCutArmedW still claims the current width -> pxScale stays
//              1 -> the correction does NOT fire -> this is the a192 defect
//   CORRECTED  same threshold, bgBandCutArmedW set to width/R -> pxScale = R ->
//              the correction fires
//
// PREDICTION: STALE deletes content (dark% rises well above baseline) and
// CORRECTED returns to baseline. If CORRECTED does not come back, u_pxScale does
// not actually undo the error and the fix is wrong regardless of what the
// end-to-end run would have said.
//
// This is a stronger test than the resize scenario in one respect: it changes
// ONLY the two numbers in question, so nothing else about a resize (render
// targets rebuilt, letterbox recomputed, textures reallocated) can carry the
// result.
//
//   node harness/pxscale.js [star|troll|warrior] [ratio]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const ASSET = process.argv[2] || 'star';
const RATIO = Number(process.argv[3] || 1.947);   // the measured 380 -> 740 ratio
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star: ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };
const DEG = 27;

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
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
  const hasFix = await page.evaluate(() => typeof bgSyncPxScale === 'function' && typeof bgBandCutArmedW !== 'undefined');
  console.log('a192 correction present in this build: ' + hasFix);
  if (!hasFix) { console.log('*** nothing to verify'); await browser.close(); srv.kill(); process.exit(1); }

  const r = await page.evaluate(async (o) => {
    window._rayReproject = true;
    bgViewFadeStartDeg = 35; bgViewFadeEndDeg = 45;
    bgQuickBake = true; bgMPIFullPlanes = false; bgMPIMode = false;
    bgBuildStamp = null; buildBackgroundLayer();
    isSweeping = true;
    const W = renderer.domElement.width, Hh = renderer.domElement.height;
    const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
    camera.position.set(0, dist * Math.tan(o.deg * Math.PI / 180), dist);

    const cuts = [];
    scene.traverse(m => { const u = m.material && m.material.uniforms;
      if (u && u.u_bandCutUvRate) cuts.push([u, u.u_bandCutUvRate.value]); });
    const armed0 = bgBandCutArmedW;

    const measure = () => {
      for (let k = 0; k < 3; k++) render();
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const g = cv.getContext('2d'); g.drawImage(renderer.domElement, 0, 0, W, Hh);
      const px = g.getImageData(0, 0, W, Hh).data;
      const lum = new Float32Array(W*Hh);
      for (let i = 0; i < W*Hh; i++) lum[i] = 0.299*px[i*4] + 0.587*px[i*4+1] + 0.114*px[i*4+2];
      let dark = 0, on = 0, s = 0, ne = 0;
      for (let i = 0; i < W*Hh; i++) { if (px[i*4+3] < 8) continue; on++; if (lum[i] < 8) dark++; }
      for (let y = 1; y < Hh-1; y++) for (let x = 1; x < W-1; x++) { const i = y*W+x;
        if (px[i*4+3] < 8) continue;
        const gx = lum[i+1]-lum[i-1], gy = lum[i+W]-lum[i-W];
        s += Math.sqrt(gx*gx+gy*gy); ne++; }
      let px1 = null;
      scene.traverse(m => { const u = m.material && m.material.uniforms;
        if (u && u.u_pxScale && px1 === null) px1 = u.u_pxScale.value; });
      return { dark: +(100*dark/Math.max(1,on)).toFixed(3),
               edge: +(s/Math.max(1,ne)).toFixed(3), pxScale: px1,
               thr: cuts.length ? cuts[0][0].u_bandCutUvRate.value : null };
    };

    const out = {};
    out.baseline = measure();
    // STALE: threshold as if armed at W/R, but the recorded width still says W
    for (const [u, v0] of cuts) u.u_bandCutUvRate.value = v0 * o.ratio;
    bgBandCutArmedW = armed0;
    out.stale = measure();
    // CORRECTED: same threshold, the recorded width now tells the truth
    bgBandCutArmedW = armed0 / o.ratio;
    out.corrected = measure();
    // restore
    for (const [u, v0] of cuts) u.u_bandCutUvRate.value = v0;
    bgBandCutArmedW = armed0; bgSyncPxScale();
    return { out, W, H: Hh, armed0, nCuts: cuts.length };
  }, { deg: DEG, ratio: RATIO });

  const pad = (s, n) => String(s).padStart(n);
  console.log('\n' + ASSET + ' quick, look-up ' + DEG + 'deg, canvas ' + r.W + 'x' + r.H +
    ', armed width ' + r.armed0 + ', ' + r.nCuts + ' material(s), ratio ' + RATIO);
  console.log('\n  arm                       u_bandCutUvRate   u_pxScale    dark%     edge');
  for (const [k, lbl] of [['baseline','BASELINE (shipped)'],['stale','STALE (correction off)'],['corrected','CORRECTED (a192)']]) {
    const m = r.out[k];
    console.log('  ' + lbl.padEnd(26) + pad(m.thr.toExponential(4), 16) +
      pad(m.pxScale === null ? '-' : m.pxScale.toFixed(3), 12) + pad(m.dark, 9) + pad(m.edge, 9));
  }
  const b = r.out.baseline, s = r.out.stale, c = r.out.corrected;
  const broke = s.dark - b.dark, healed = s.dark - c.dark;
  console.log('\n  staleness cost   dark ' + b.dark + ' -> ' + s.dark + '  (+' + broke.toFixed(3) + ')');
  console.log('  correction       dark ' + s.dark + ' -> ' + c.dark + '  (-' + healed.toFixed(3) + ')');
  console.log('  VERDICT: ' + (broke <= 0.05
    ? 'INCONCLUSIVE — the stale arm did not break anything, so there is nothing to have fixed'
    : (Math.abs(c.dark - b.dark) < 0.05
       ? 'CONFIRMED — the correction returns the frame to baseline exactly'
       : (healed > 0.5 * broke ? 'PARTIAL — the correction recovers most but not all of the loss'
                               : 'FAILED — u_pxScale does not undo the error'))));
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
