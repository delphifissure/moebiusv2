// A192: DOES A WINDOW RESIZE LEAVE THE STRETCH CUT CALIBRATED FOR THE OLD CANVAS?
//
// a189 fixed one instance of a general shape: the a72/a83 band cut measures with
// dFdx/fwidth — per RENDERED pixel — against u_bandCutUvRate, which is
// bgBandCutStretchFrac / rendererWidth. Those agree only while the renderer's
// width is what it was when the threshold was computed.
//
// AND IT IS COMPUTED WHILE ARMING THE BAKE, not per frame:
//     armNet:  mu.u_bandCutUvRate.value = bgBandCutStretchFrac / Math.max(1, w)
// onWindowResize updates u_resolution and every render target, but nothing in it
// re-arms the cut. If that reading is right, then every window resize AFTER a
// bake leaves the cut calibrated for the old canvas — the a189 defect, on the
// shipped path, triggered by dragging a window edge.
//
// a191 tried to test this and the arm was VOID: it ran in v2, where
// u_bandCutUvRate is 0 because only the quick bake arms it. A threshold of zero
// cannot go stale. This runs on QUICK, where the cut is actually armed.
//
// THE ARMS.
//   A  bake at the small canvas, then RESIZE and do not re-bake  -> stale?
//   B  same page, re-bake at the large canvas                    -> correct
// Growing the canvas makes each pixel cover LESS uv, so the correct threshold
// SHRINKS. A stale one is therefore too LARGE, and `uvRate < u_bandCutUvRate` —
// the undithered branch — starts deleting content. Predicted signature: the same
// as a189 before the fix.
//
// The threshold is read out of the live material in both arms, so "stale" is
// observed rather than inferred, and the ratio is compared against the measured
// backing-store ratio rather than an assumed 2.
//
//   node harness/resize.js [star|troll|warrior]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const ASSET = process.argv[2] || 'star';
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star: ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };
const DEG = 27;
// A192c REF MODE. The in-page re-bake after a resize crashes swiftshader at the
// larger canvas, and without it "resize causes the dark" cannot be separated
// from "a larger canvas causes the dark". REF=1 loads a FRESH page already at
// the large size and bakes there, which is the same comparison without the
// crash — and it is the more honest reference anyway, since it shares no state
// with the small-canvas bake.
const REF = process.env.REF === '1';
const NOIMG = process.env.NOIMG === '1';   // A192d: skip toDataURL, which is what crashes swiftshader at the larger canvas
const BIG_W = 960, BIG_H = 600;            // A192d: 1080x675 crashed the renderer; the question needs a ratio, not a size
const VW = REF ? BIG_W : 720, VH = REF ? BIG_H : 450;

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: VW, height: VH } });
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

  const bake = () => page.evaluate(async () => {
    window._rayReproject = true;
    bgViewFadeStartDeg = 35; bgViewFadeEndDeg = 45;
    bgQuickBake = true; bgMPIFullPlanes = false; bgMPIMode = false;
    bgBuildStamp = null; buildBackgroundLayer();
    isSweeping = true;
    return renderer.domElement.width + 'x' + renderer.domElement.height;
  });
  const probe = (deg) => page.evaluate(async (o) => {
    const deg = o.deg, noimg = o.noimg;
    let thr = null, n = 0;
    scene.traverse(m => { const u = m.material && m.material.uniforms;
      if (u && u.u_bandCutUvRate) { n++; if (thr === null) thr = u.u_bandCutUvRate.value; } });
    const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
    camera.position.set(0, dist * Math.tan(deg * Math.PI / 180), dist);
    for (let k = 0; k < 3; k++) render();
    const W = renderer.domElement.width, Hh = renderer.domElement.height;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
    const g = cv.getContext('2d'); g.drawImage(renderer.domElement, 0, 0, W, Hh);
    const px = g.getImageData(0, 0, W, Hh).data;
    let dark = 0, on = 0, s = 0, ne = 0;
    const lum = new Float32Array(W*Hh);
    for (let i = 0; i < W*Hh; i++) lum[i] = 0.299*px[i*4] + 0.587*px[i*4+1] + 0.114*px[i*4+2];
    for (let i = 0; i < W*Hh; i++) { if (px[i*4+3] < 8) continue; on++; if (lum[i] < 8) dark++; }
    for (let y = 1; y < Hh-1; y++) for (let x = 1; x < W-1; x++) { const i = y*W+x;
      if (px[i*4+3] < 8) continue;
      const gx = lum[i+1]-lum[i-1], gy = lum[i+W]-lum[i-W];
      s += Math.sqrt(gx*gx+gy*gy); ne++; }
    return { W, H: Hh, thr, nMats: n, url: noimg ? null : cv.toDataURL('image/png'),
             darkPct: +(100*dark/Math.max(1,on)).toFixed(3),
             coverPct: +(100*on/(W*Hh)).toFixed(2),
             edge: +(s/Math.max(1,ne)).toFixed(3) };
  }, { deg, noimg: NOIMG });

  // A192b PRINT EACH ARM AS IT IS MEASURED. The first run of this file lost
  // everything: the page crashed inside the SECOND bake (swiftshader, larger
  // canvas) and the script threw before printing a single row, discarding two
  // arms that had already succeeded. The staleness question is answered by the
  // FIRST two arms alone — the re-bake is only the reference — so a crash in the
  // reference must not take the finding with it.
  const pad = (s, n) => String(s).padStart(n);
  const row = (lbl, m) => console.log('  ' + lbl.padEnd(34) + pad(m.W+'x'+m.H, 10) +
    pad(m.thr === null ? 'none' : m.thr.toExponential(4), 18) +
    pad(m.thr ? (1/m.thr).toFixed(0) : '-', 8) + pad(m.darkPct, 9) + pad(m.coverPct, 9) + pad(m.edge, 8));

  const smallSize = await bake();
  const A0 = await probe(DEG);                       // baked and rendered small
  console.log('\n' + ASSET + ' quick, look-up ' + DEG + 'deg — does a resize leave the cut stale?');
  console.log('  baked at ' + smallSize + '\n');
  console.log('  arm                                backing     u_bandCutUvRate   1/thr    dark%    cover%   edge');
  row('baked small, rendered small', A0);

  if (REF) {
    console.log('\n  REF mode: baked fresh at this size, no resize. This row is the reference the');
    console.log('  crashed arm B was meant to be — compare its dark% against arm A of the normal run.');
    for (const [m, tag] of [[A0, 'ref']].filter(([m]) => m && m.url))
      fs.writeFileSync(path.join(H, 'resize_' + ASSET + '_' + tag + '.png'),
        Buffer.from(m.url.split(',')[1], 'base64'));
    await browser.close(); srv.kill(); process.exit(0);
  }
  await page.setViewportSize({ width: 1080, height: 675 });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await new Promise(r => setTimeout(r, 1500));
  const A = await probe(DEG);                        // resized, NOT re-baked
  row('A  resized, NOT re-baked', A);

  let B = null;
  try { const bigSize = await bake(); B = await probe(DEG); row('B  re-baked at ' + bigSize, B); }
  catch (e) { console.log('  B  re-bake at the new size CRASHED (' +
    String(e.message).slice(0, 60) + ') — reference arm lost, A0 vs A still stand'); }

  // the staleness verdict needs only A0 vs A: did the threshold move when the
  // canvas did? B prices the consequence, and is optional.
  if (A.thr && A0.thr) {
    const backRatio = A.W / A0.W, thrRatio = A.thr / A0.thr;
    console.log('\n  backing width ratio ' + backRatio.toFixed(3) +
      ',  threshold ratio after resize ' + thrRatio.toFixed(3));
    const stale = Math.abs(thrRatio - 1) < 0.05 && Math.abs(backRatio - 1) > 0.05;
    console.log('  ' + (stale
      ? 'STALE — the resize did NOT re-arm the cut. 1/thr stayed at ' + (1/A.thr).toFixed(0) +
        ' while the frame is now ' + A.W + ' px wide. The threshold did not move (ratio ' +
        thrRatio.toFixed(2) + '), so it is now ' + backRatio.toFixed(2) +
        'x LARGER than correct and the undithered branch over-cuts.'
      : 'NOT STALE — the threshold moved with the resize, so this path re-arms somewhere.'));
    if (stale && B) {
      console.log('  visible cost at this pose: dark ' + A.darkPct + '% (stale) vs ' + B.darkPct +
        '% (correct), cover ' + A.coverPct + '% vs ' + B.coverPct + '%, edge ' + A.edge + ' vs ' + B.edge);
      console.log('  NOTE the direction: 1/thr is the canvas the cut THINKS it is drawing into.');
      console.log('  Growing the window makes the correct threshold SMALLER, so a stale one is too');
      console.log('  large — the same over-cut a189 fixed for the simulated viewer.');
    }
  }
  for (const [m, tag] of [[A0,'small'],[A,'stale'],[B,'rebaked']].filter(([m]) => m && m.url))
    fs.writeFileSync(path.join(H, 'resize_' + ASSET + '_' + tag + '.png'),
      Buffer.from(m.url.split(',')[1], 'base64'));
  console.log('\n  wrote harness/resize_' + ASSET + '_{small,stale,rebaked}.png');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
