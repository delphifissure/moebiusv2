// A130: the SIMULATED VIEWER, and its own acceptance test.
//
// The portal render is a PRE-DISTORTION. frameCorners() builds an off-axis
// frustum from the eye to the fixed portal rect, so the image is the intended
// one only when it is viewed FROM that eye. Every review shot in this arc was
// taken by scrubbing a virtual eye while sitting head-on to a monitor, which
// shows raw pre-distortion — catastrophically wrong-looking while entirely
// correct. This driver exercises the mode that adds the missing second half of
// the optical chain, and it runs the instrument's OWN acceptance test first,
// because an instrument that has never been shown to detect a fault has not
// been shown to work (brief 5, A2).
//
// Order matters and is not negotiable:
//   A1  pass 1 and pass 2 must agree about E and about the panel rect. If they
//       do not, every drift number afterwards is a confident false positive
//       about the frustum — the A113/A115 failure mode. The test refuses to
//       continue.
//   ..  anchor drift across +/-40 deg of yaw and of pitch.
//   A2  perturb the PASS-1 eye by a known lateral delta and require the anchor
//       to swim by the closed-form prediction.
//
//   node harness/simview.js [troll|star|warrior|photo]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const OUTD = '/workspace/moebiusv2/harness/val';
const ASSET = process.argv[2] || 'troll';
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star:  ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'],
              photo: ['roomImg1.png', 'roomDepth1.png'] };
// Poses to shoot: head-on, inside the fade, at the rim, and well past it. The
// mode is deliberately NOT gated on the cone — an instrument that inherits the
// product's fade cannot see past it, and past it is where the review shots were.
const POSES = [0, 20, 32, 45, 60];

(async () => {
  try { fs.mkdirSync(OUTD, { recursive: true }); } catch (e) {}
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
  page.on('console', m => { const t = m.text(); if (/\[SV\]|a127b k =|slope-limited/.test(t)) console.log('   | ' + t.slice(0, 200)); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }

  const res = await page.evaluate(async (poses) => {
    window._rayReproject = true;
    bgQuickBake = true; bgMPIFullPlanes = false; bgMPIMode = false;
    bgBuildStamp = null; buildBackgroundLayer();
    const out = { test: null, shots: [], hud: [] };
    window.simViewer.on();
    out.test = window.svAcceptanceTest({ sweep: 40, step: 5 });
    const shot = async (tag) => {
      for (let n = 0; n < 3; n++) render();
      return { tag, png: renderer.domElement.toDataURL('image/png') };
    };
    // Black% INSIDE THE PROJECTED PANEL POLYGON, raw vs simulated. This is the
    // guard against the one failure the spec names explicitly: an overlay tuned
    // to hide the artifact. The simulated viewer is a geometric remapping of
    // the SAME pixels, so it must NOT be able to make a hole go away. If these
    // two numbers track each other, the mode is changing what the shape reads
    // as and nothing else; if sim is systematically lower, the instrument is
    // flattering the render and must be reported, not tuned.
    const holeFrac = (poly) => {
      const cv = document.createElement('canvas');
      const W = renderer.domElement.width, Hh = renderer.domElement.height;
      cv.width = W; cv.height = Hh;
      const cx = cv.getContext('2d');
      cx.drawImage(renderer.domElement, 0, 0);
      const d = cx.getImageData(0, 0, W, Hh).data;
      // even-odd point-in-polygon over the convex quad
      const inside = (px, py) => {
        let c = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
          if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) c = !c;
        }
        return c;
      };
      let tot = 0, blk = 0;
      for (let y = 0; y < Hh; y += 2) for (let x = 0; x < W; x += 2) {
        if (!inside(x + 0.5, y + 0.5)) continue;
        const i = (y * W + x) * 4; tot++;
        if (d[i] + d[i + 1] + d[i + 2] < 24) blk++;
      }
      return tot ? 100 * blk / tot : NaN;
    };
    // The polygon to measure inside is the CONTENT rect, not the panel rect:
    // the layer is fit inside a 16:9 terrarium, so a panel-wide denominator is
    // ~50% letterbox on a portrait asset and would swamp the signal.
    const contentRect = () => {
      const m = mediaLayers[0] && mediaLayers[0].mesh;
      const R = svPanelRect();
      if (!m) return { w: R.W, h: R.H };
      m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox;
      return { w: (bb.max.x - bb.min.x) * m.scale.x, h: (bb.max.y - bb.min.y) * m.scale.y };
    };
    const contentPoly = (useSim) => {
      const R = svPanelRect(), C = contentRect();
      const cw = renderer.domElement.width, ch = renderer.domElement.height;
      const asp = R.W / R.H;
      let mw = cw, mh = Math.round(cw / asp);
      if (mh > ch) { mh = ch; mw = Math.round(ch * asp); }
      const mx = Math.round((cw - mw) / 2), my = Math.round((ch - mh) / 2);
      const cor = [[-C.w / 2, -C.h / 2], [C.w / 2, -C.h / 2], [C.w / 2, C.h / 2], [-C.w / 2, C.h / 2]];
      if (!useSim) {
        // the raw view is an orthographic shot of the panel: panel rect -> the
        // viewport rect linearly, so the content rect maps proportionally
        return cor.map(([x, y]) => [mx + (x / R.W + 0.5) * mw, my + (0.5 - y / R.H) * mh]);
      }
      const cam = svState.cam2;
      return cor.map(([x, y]) => {
        const q = new THREE.Vector3(x, y, R.P).project(cam);
        return [mx + (q.x * 0.5 + 0.5) * mw, my + (1 - (q.y * 0.5 + 0.5)) * mh];
      });
    };

    for (const a of poses) {
      window.simViewer.pose(a, 0);
      // MEASUREMENT shots: PiP OFF in BOTH arms. With the inset on, the sim arm
      // reads 3.4 points less black at 0 deg purely because bright inset pixels
      // sit inside the measured polygon — an instrument flattering itself.
      window.simViewer.pip(false);
      // RAW pre-distortion (what every review shot in this arc showed)
      svState.pipShowsRaw = false;
      out.shots.push(await shot('raw_' + a));
      const blackRaw = holeFrac(contentPoly(false));
      // SIMULATED physical viewer (what an actual off-axis viewer sees)
      svState.pipShowsRaw = true;
      out.shots.push(await shot('sim_' + a));
      const blackSim = holeFrac(contentPoly(true));
      // presentation shot with the A/B inset, for the eye not the number
      window.simViewer.pip(true);
      out.shots.push(await shot('ab_' + a));
      const E = svEye();
      const K = svKAt(E);
      const om = svOmegaFrac(E), sub = svSubtenseDeg(E);
      const R = svPanelRect();
      const D = Math.abs(E.z - R.P), off = Math.hypot(E.x, E.y);
      out.hud.push({ yaw: a,
        theta: +(Math.atan2(off, D) * 180 / Math.PI).toFixed(2),
        kHere: K ? +K.kHere.toFixed(0) : null,
        kBudget: K ? +K.kBudget.toFixed(0) : null,
        complPct: K ? +(100 * K.kHere / 63).toFixed(0) : null,
        omegaPct: +(100 * om.frac).toFixed(1),
        subtense: sub.h.toFixed(1) + ' x ' + sub.v.toFixed(1),
        fade: +svState.lastFade.toFixed(2),
        driftPx: +svAnchorDrift(E).maxPx.toFixed(4),
        blackRaw: +blackRaw.toFixed(2), blackSim: +blackSim.toFixed(2) });
    }
    window.simViewer.off();
    return out;
  }, POSES);

  for (const s of res.shots) {
    try { fs.writeFileSync(path.join(OUTD, 'SV_' + ASSET + '_' + s.tag + '.png'),
          Buffer.from(s.png.split(',')[1], 'base64')); } catch (e) {}
  }

  const T = res.test || {};
  console.log('\n=== A1 (load-bearing): do pass 1 and pass 2 share a frame? ===');
  if (T.a1) {
    console.log('  |E_pass1 - E_pass2| = ' + T.a1.eyeAgreement.toExponential(3) + ' world units');
    console.log('  panel rect -> NDC corner error = ' + T.a1.rectErrNdc.toExponential(3));
    console.log('  => ' + (T.a1.ok ? 'AGREE (the drift numbers below mean something)'
                                   : 'MISMATCH (test refused to continue — as designed)'));
  }
  if (T.sweep && T.sweep.length) {
    console.log('\n=== anchor drift, +/-40 deg on the sphere ===');
    const yaws = T.sweep.filter(s => s.yaw !== undefined), pits = T.sweep.filter(s => s.pitch !== undefined);
    console.log('  yaw   ' + yaws.map(s => s.yaw + ':' + s.driftPx.toFixed(3)).join('  '));
    console.log('  pitch ' + pits.map(s => s.pitch + ':' + s.driftPx.toFixed(3)).join('  '));
    console.log('  max = ' + T.maxDriftPx.toFixed(4) + ' px');
  }
  if (T.a2) {
    console.log('\n=== A2: can the instrument SEE a break? ===');
    console.log('  pass-1 eye displaced ' + T.a2.deltaWorld.toFixed(5) + ' world units laterally');
    console.log('  predicted swim ' + T.a2.predictedPx.toFixed(2) + ' px (closed form, independent of the matrices)');
    console.log('  measured  swim ' + T.a2.measuredPx.toFixed(2) + ' px (matrix path)');
    console.log('  ratio ' + T.a2.ratio.toFixed(4) + '  => ' + (Math.abs(T.a2.ratio - 1) < 0.05 ? 'the instrument detects the fault it was given' : 'MISMATCH'));
  }
  console.log('\n=== HUD at each pose (' + ASSET + ') ===');
  console.log('  yaw  theta   k here  k budget  compl%  Omega%   subtense       fade  drift px   black% raw   black% sim');
  for (const h of res.hud) {
    console.log('  ' + String(h.yaw).padStart(3) + String(h.theta).padStart(7) +
      String(h.kHere).padStart(9) + String(h.kBudget).padStart(10) +
      String(h.complPct).padStart(8) + String(h.omegaPct).padStart(8) + '   ' +
      h.subtense.padEnd(14) + String(h.fade).padStart(5) + String(h.driftPx).padStart(10) +
      String(h.blackRaw).padStart(13) + String(h.blackSim).padStart(13));
  }
  console.log('\n  black% is measured inside the PROJECTED CONTENT POLYGON in each view (not the');
  console.log('  panel rect: on a portrait asset that is ~50% letterbox), PiP off in both. The two');
  console.log('  columns must track: the simulated viewer is a geometric remapping of the same');
  console.log('  pixels and MUST NOT be able to make a hole disappear.');
  console.log('\nOVERALL: ' + (T.pass ? 'PASS' : 'FAIL') + '   shots -> ' + OUTD + '/SV_' + ASSET + '_*.png');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
