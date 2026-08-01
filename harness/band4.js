// A191d: THE WARRIOR'S BAND IS SURVIVING FOLDED QUADS, AND HERE IS THE TEST.
//
// THREE INSTRUMENTS FAILED THE SAME WAY BEFORE THIS ONE. a182 and a183 reported
// "period 4" — the first lag their autocorrelation search was allowed to
// consider. a191b reported "period 3" after lowering that floor by one. a191c
// replaced the ACF with a DFT and reported a period equal to the WHOLE REGION
// HEIGHT in both arms — bin k=1, the frequency floor, which is the residual
// trend the window leaves behind. Every one of those numbers is the edge of the
// search space, printed as a measurement.
//
// AND THE PICTURE SAYS THERE IS NO PERIOD. The analysed crop (band3 output) is
// ragged horizontal smear filling the trailing disocclusion to the right of the
// figure — irregular filaments, not a repeating band. a181's "combed /
// venetian-blind" was MY visual description, and the comb metric it inspired (a
// vertical second difference) fires on horizontal streaks whether or not they
// repeat. The periodicity was assumed at a181 and never held.
//
// WHAT THAT LEAVES. The warrior has the worst surviving fold ratio in the suite
// by a wide margin: 19.9x against troll 6.8, photo 9.0, star 5.2. A surviving
// folded quad IS a filament of stretched texture — the a165 gate exists to
// count exactly this, and regress currently passes the warrior because its
// tolerance is 1..30. So the hypothesis is not a new mechanism at all: the band
// is the 19.9x that the gate already reports, drawn.
//
// THE PREDICTION. Tear more aggressively and the band must weaken in proportion.
// _v2Tears(mn, mx, extentTexels) tears when the reprojected shift span exceeds
// the cell extent; dividing the extent it is given by F makes it tear at 1/F of
// the fold it tolerates now. If the band is surviving folded quads, comb energy
// in the region must fall as F rises. If the band is something else, tearing
// harder will change the quad count and leave the streaks where they are.
//
// The quad count and the worst ratio are printed for every arm, because an arm
// that does not change the mesh has not diverged and its comb number means
// nothing (a134, and a183 where exactly that happened).
//
//   node harness/band4.js [warrior|star|troll] [deg]
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
const FACTORS = [1, 2, 4, 8];

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

  const hooked = await page.evaluate(() => {
    if (typeof _v2Tears !== 'function') return false;
    window.__origTears = _v2Tears;
    window.__tearF = 1;
    _v2Tears = function (mn, mx, extentTexels) {
      return window.__origTears(mn, mx, extentTexels / Math.max(1e-9, window.__tearF));
    };
    return true;
  });
  if (!hooked) { console.log('*** _v2Tears is not reassignable in this build — cannot run'); await browser.close(); srv.kill(); process.exit(1); }

  const run = (o) => page.evaluate(async (o) => {
    window.__tearF = o.F;
    window._rayReproject = true;
    bgViewFadeStartDeg = 35; bgViewFadeEndDeg = 45;
    bgQuickBake = false; bgMPIFullPlanes = true; bgMPIMode = true;
    bgBuildStamp = null; buildBackgroundLayer();
    isSweeping = true;
    const st = window._v2Stretch || {};
    const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
    camera.position.set(dist * Math.tan(o.deg * Math.PI / 180), 0, dist);
    for (let n = 0; n < 3; n++) render();
    const W = renderer.domElement.width, Hh = renderer.domElement.height;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
    const g = cv.getContext('2d'); g.drawImage(renderer.domElement, 0, 0, W, Hh);
    const px = g.getImageData(0, 0, W, Hh).data;
    const X0 = Math.round(o.rect[0]*W), X1 = Math.round(o.rect[1]*W);
    const Y0 = Math.round(o.rect[2]*Hh), Y1 = Math.round(o.rect[3]*Hh);
    const cc = document.createElement('canvas'); cc.width = X1-X0+1; cc.height = Y1-Y0+1;
    cc.getContext('2d').drawImage(cv, X0, Y0, X1-X0+1, Y1-Y0+1, 0, 0, X1-X0+1, Y1-Y0+1);
    const lum = new Float32Array(W*Hh);
    for (let i = 0; i < W*Hh; i++) lum[i] = 0.299*px[i*4] + 0.587*px[i*4+1] + 0.114*px[i*4+2];
    // comb energy inside the FIXED region — the quantity a181..a191c all tracked
    let s = 0, n = 0, blackN = 0;
    for (let y = Math.max(1,Y0); y <= Math.min(Hh-2,Y1); y++)
      for (let x = Math.max(0,X0); x <= Math.min(W-1,X1); x++) {
        const i = y*W+x;
        s += Math.abs(2*lum[i] - lum[i-W] - lum[i+W]); n++;
        if (px[i*4+3] < 8 || lum[i] < 8) blackN++;
      }
    return { F: o.F, comb: +(s/Math.max(1,n)).toFixed(3),
             blackPct: +(100*blackN/Math.max(1,n)).toFixed(3),
             quads: st.keep, torn: st.torn, worst: st.max, url: cc.toDataURL('image/png') };
  }, o);

  // fixed region: the trailing band right of the figure, from a191c
  const RECT = [0.421, 0.780, 0.037, 0.996];
  const rows = [];
  for (const F of FACTORS) rows.push(await run({ deg: DEG, F, rect: RECT }));

  const pad = (s, n) => String(s).padStart(n);
  console.log('\n' + ASSET + ' at ' + DEG + ' deg — tear harder and watch the band. Region fixed at [' +
    RECT.join(', ') + ']\n');
  console.log('   tear x   surviving quads   torn   worst fold ratio   comb energy   black%');
  for (const r of rows)
    console.log('  ' + pad(r.F, 6) + pad(r.quads, 18) + pad(r.torn, 7) +
      pad(r.worst === undefined ? '?' : (+r.worst).toFixed(2), 19) +
      pad(r.comb, 14) + pad(r.blackPct, 9));
  const a = rows[0], z = rows[rows.length-1];
  const diverged = a.quads !== z.quads;
  console.log('\n  arm divergence: quads ' + a.quads + ' -> ' + z.quads +
    (diverged ? '  (the mesh really changed)' : '  *** IDENTICAL — the arms did not diverge, numbers void'));
  if (diverged) {
    const drop = 100 * (1 - z.comb / Math.max(1e-9, a.comb));
    console.log('  comb energy ' + a.comb + ' -> ' + z.comb + '  (' + drop.toFixed(1) + '% lower), ' +
      'worst fold ' + (+a.worst).toFixed(2) + ' -> ' + (+z.worst).toFixed(2));
    console.log('  VERDICT: ' + (drop > 25
      ? 'CONSISTENT — the band is surviving folded quads; tearing them removes it'
      : (drop > 5 ? 'PARTIAL — tearing helps but does not account for most of the band'
                  : 'REFUTED — the band survives aggressive tearing, so it is not surviving folds')));
    console.log('  black% is the cost: every quad torn out is a hole the plug must fill.');
  }
  for (const r of rows)
    fs.writeFileSync(path.join(H, 'band4_' + ASSET + '_tear' + r.F + '.png'),
      Buffer.from(r.url.split(',')[1], 'base64'));
  console.log('\n  wrote harness/band4_' + ASSET + '_tear{1,2,4,8}.png — the region, per arm');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
