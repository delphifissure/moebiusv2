// A135: THE ORDERING CLAMP — brief §4.4, promoted by REPLY02 §7 ("cheap,
// unconditional, do it").
//
//     d_hidden(x) >= d_occluder_silhouette(x) + eps
//
// One O(N) pass over the final plate depth. The plate is the BACKSTOP: it is
// only ever seen through a disocclusion, so a plate texel nearer than the
// surface it backs is a protrusion by definition. A21, A41, A43, A112, the
// backstop protrusion sweep, the cap cards and the hardcoded -0.004 push-back
// all exist to FIND or PAPER OVER violations of this one inequality. Searching
// rendered poses for violations of an invariant is strictly worse than
// enforcing the invariant.
//
// eps is DERIVED: one source quantum (a89 measures it; 1/255 = 0.00392 on all
// four suite assets, a133). Below that the source cannot distinguish; above it
// is arbitrary. It lands on the 0.004 a43 reached empirically.
//
// PASS CRITERIA, from the brief, stated before the run:
//   - black% unchanged at rest AND off-axis (this must not buy coverage; it is
//     a correctness pass)
//   - comb energy not worse (a117's metric, since the clamp moves a surface)
//   - the clamp reports a non-zero violation count, or it is doing nothing and
//     the whole protrusion apparatus was guarding an invariant already held
//
//   node harness/orderclamp.js [troll|star|warrior]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const { armWitness, assertArmsDiffer } = require('./abguard');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const ASSET = process.argv[2] || 'troll';
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star: ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };
const DEGS = [0, 15, 25, 32, 38];
const ARMS = [['a135 ordering clamp ON (new default)', {}],
              ['clamp OFF (pre-a135)', { _noOrderClamp: true }]];

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const all = {}, notes = {}, times = {};
  for (const [tag, flags] of ARMS) {
    const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    const logs = [];
    page.on('console', m => { const t = m.text(); if (/a135|slope-limited|a133 |plate plugs/.test(t)) logs.push(t); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 40; t++) {
      const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
      if (ok) break; await new Promise(r => setTimeout(r, 1000));
    }
    const res = await page.evaluate(async (f) => {
      window._rayReproject = true;
      bgViewFadeStartDeg = 35; bgViewFadeEndDeg = 45;
      if (f._noOrderClamp) window._noOrderClamp = true;
      bgQuickBake = true; bgMPIFullPlanes = false; bgMPIMode = false;
      const tB = performance.now();
      bgBuildStamp = null; buildBackgroundLayer();
      const bakeMs = Math.round(performance.now() - tB);
      isSweeping = true;
      const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
      const W = 480, Hh = 300;
      const grab = () => { for (let n = 0; n < 3; n++) render();
        const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
        const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
        return cx.getImageData(0, 0, W, Hh).data; };
      const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      camera.position.set(0, 0, dist);
      const d0 = grab();
      let x0 = W, x1 = -1, y0 = Hh, y1 = -1;
      for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4;
        if (d0[i] + d0[i + 1] + d0[i + 2] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      const out = [];
      for (const deg of f.degs) {
        camera.position.set(dist * Math.tan(deg * Math.PI / 180), 0, dist);
        const d = grab();
        let blk = 0, tot = 0, cx_ = 0, nx = 0, cy_ = 0, ny = 0;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const i = (y * W + x) * 4; tot++;
          if ((d[i] + d[i + 1] + d[i + 2]) < 24) { blk++; continue; }
          if (x > x0 && x < x1) { const a = (y * W + x - 1) * 4, b = (y * W + x + 1) * 4;
            if ((d[a] + d[a + 1] + d[a + 2]) >= 24 && (d[b] + d[b + 1] + d[b + 2]) >= 24) { cx_ += Math.abs(lum(d, a) - 2 * lum(d, i) + lum(d, b)); nx++; } }
          if (y > y0 && y < y1) { const a = ((y - 1) * W + x) * 4, b = ((y + 1) * W + x) * 4;
            if ((d[a] + d[a + 1] + d[a + 2]) >= 24 && (d[b] + d[b + 1] + d[b + 2]) >= 24) { cy_ += Math.abs(lum(d, a) - 2 * lum(d, i) + lum(d, b)); ny++; } }
        }
        out.push({ deg, black: +(100 * blk / Math.max(1, tot)).toFixed(2),
                   combX: +(cx_ / Math.max(1, nx)).toFixed(3), combY: +(cy_ / Math.max(1, ny)).toFixed(3) });
      }
      camera.position.set(0, 0, dist); render();
      return { rows: out, bakeMs };
    }, Object.assign({ degs: DEGS }, flags));
    all[tag] = res.rows; notes[tag] = logs; times[tag] = res.bakeMs;
    await page.close();
  }

  // A134: the arms must diverge downstream of the flag before any number is read.
  assertArmsDiffer(ARMS.map(([tag]) => [tag, armWitness(notes[tag])]));

  const pad = (s, n) => String(s).padStart(n);
  console.log('\n' + ASSET + '  ORDERING CLAMP  d_hidden(x) >= d_occluder(x) + one source quantum');
  for (const [tag] of ARMS) {
    console.log('\n=== ' + tag + '   (bake ' + times[tag] + 'ms) ===');
    for (const l of notes[tag]) console.log('   | ' + l.slice(0, 175));
    console.log('   deg      black%     comb X     comb Y');
    for (const r of all[tag]) console.log('   ' + pad(r.deg, 3) + pad(r.black, 11) + pad(r.combX, 11) + pad(r.combY, 11));
  }
  const A = all[ARMS[0][0]], B = all[ARMS[1][0]];
  console.log('\n  clamp ON minus clamp OFF   (black% must be ~unchanged: this is a correctness');
  console.log('  pass, not a coverage buy. Comb must not get worse.)');
  console.log('   deg     d black     d combX     d combY');
  for (let i = 0; i < DEGS.length; i++) {
    console.log('   ' + pad(DEGS[i], 3) + pad((A[i].black - B[i].black).toFixed(2), 12) +
      pad((A[i].combX - B[i].combX).toFixed(3), 12) + pad((A[i].combY - B[i].combY).toFixed(3), 12));
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { if (!e.abGuard) console.error('ERR', e.stack || e.message); process.exit(1); });
