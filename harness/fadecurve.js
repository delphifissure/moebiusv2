// A143: THE ANGLE FADE DARKENS FAR EARLIER THAN THE 45-DEGREE CONE.
//
// User: "the angle fade on load appears to be more conservative than it should
// be, like even 10 degrees off and it's darkening."
//
// updateViewFade() takes the MAX of two terms in different units:
//   VIRTUAL   f = (theta - bgViewFadeStartDeg) / (bgViewFadeEndDeg - start)
//             i.e. nothing before 35 deg, black at 45. This is the cone the
//             product documents and that every bake is sized for.
//   FACE-FRAME  the head's angular position INSIDE THE DEVICE CAMERA's frame,
//             fading over the last 10 degrees before the head exits:
//             fH = (aH - (hfov/2 - 10)) / 10,  aH = atan(|faceX-0.5| * 2 * tan(hfov/2))
//             Added by A29 for a real reason — a narrow laptop camera can lose
//             the face long before the head reaches 35 deg of virtual angle,
//             and a lost face is a wrong pose, not a dark one.
//
// The two are NOT in the same units and nothing ties them together. This
// measures the composite fade as a function of the VIRTUAL angle the user
// perceives, which is the only frame in which "10 degrees off" is meaningful.
//
// The chain, using the shipped constants:
//   camera.x = -(faceX - 0.5) * camOff * scalar * lensGain,  camOff = 0.2
//   theta    = atan(|camera.x| / dist)
// so faceX and theta are locked together, and both fade terms can be evaluated
// against the same abscissa.
//
//   node harness/fadecurve.js
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = path.join('/workspace/mm', 'harness');

(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  const res = await page.evaluate(() => {
    const p = bgCameraIntrinsics();
    const D2R = Math.PI / 180;
    const dist = Math.max(1e-3, Math.abs(camera.position.z - portalPlaneWorldZ));
    const ftsSlider = document.getElementById('facetrackingScalarSlider');
    const scalar = ftsSlider ? parseFloat(ftsSlider.value) : 1.0;
    const lensGain = Math.tan((contentLensFovDeg * D2R) / 2);
    const camOff = 0.2;
    const rows = [];
    // sweep the nose across the camera frame; each position implies a virtual angle
    for (let off = 0; off <= 0.5001; off += 0.025) {
      const camX = off * camOff * scalar * lensGain;
      const theta = Math.atan2(camX, dist) / D2R;
      const fVirtual = Math.min(1, Math.max(0, (theta - bgViewFadeStartDeg) /
        Math.max(1e-3, bgViewFadeEndDeg - bgViewFadeStartDeg)));
      const aH = Math.atan(off * 2 * Math.tan(p.hfov * 0.5 * D2R)) / D2R;
      // There is no webcam in headless, so the running-jitter band never
      // populates. Evaluate the SHIPPED-BEFORE band and the two ends of the
      // derived range instead — that shows what the derivation buys without
      // pretending a real tracker was measured.
      // A144: the band is anchored to the LEARNED loss boundary, not the
      // nominal frame edge. Evaluate at three boundaries: the nominal edge
      // (what ships before any loss is observed) and two tightened ones, so
      // the effect of the learner is visible without a webcam present.
      const edgeAngOf = (e) => Math.atan(Math.min(0.5, e) * 2 * Math.tan(p.hfov * 0.5 * D2R)) / D2R;
      const fAtEdge = (e) => { const ea = edgeAngOf(e); return Math.min(1, Math.max(0, (aH - (ea - 10)) / 10)); };
      rows.push({ off: +off.toFixed(3), theta: +theta.toFixed(1), aH: +aH.toFixed(1),
                  fVirtual: +fVirtual.toFixed(2),
                  e50: +fAtEdge(0.50).toFixed(2), e42: +fAtEdge(0.42).toFixed(2), e35: +fAtEdge(0.35).toFixed(2) });
    }
    return { profile: p, dist, scalar, lensGain, contentLensFovDeg, rows,
             band: 10, intrinsicSource: p.source,
             start: bgViewFadeStartDeg, end: bgViewFadeEndDeg };
  });

  console.log('\nDEVICE PROFILE  hfov ' + res.profile.hfov + '  vfov ' + res.profile.vfov +
              '   | portal dist ' + res.dist.toFixed(3) + '  tracking scalar ' + res.scalar +
              '  lens ' + res.contentLensFovDeg + 'deg (gain ' + res.lensGain.toFixed(3) + ')' + '  | face-frame band ' + res.band + 'deg');
  console.log('DOCUMENTED CONE  fade starts ' + res.start + 'deg, black at ' + res.end + 'deg\n');
  console.log('  FOV SOURCE  ' + res.intrinsicSource + '\n');
  console.log('  nose off   virtual theta   in-frame   fade(virtual)   edge=0.50   edge=0.42   edge=0.35');
  for (const r of res.rows)
    console.log('  ' + String(r.off).padStart(8) + String(r.theta).padStart(15) +
                String(r.aH).padStart(10) + String(r.fVirtual).padStart(16) +
                String(r.e50).padStart(12) + String(r.e42).padStart(12) + String(r.e35).padStart(12));
  const first = (key) => { const r = res.rows.find(x => Math.max(x.fVirtual, x[key]) > 0.01); return r ? r.theta : null; };
  const full  = (key) => { const r = res.rows.find(x => Math.max(x.fVirtual, x[key]) >= 0.999); return r ? r.theta : null; };
  console.log('\n  learned loss boundary    darkening BEGINS    FULLY BLACK   (documented cone: ' +
              res.start + ' / ' + res.end + ')');
  for (const [lab, key] of [['0.50 nominal frame edge', 'e50'], ['0.42 observed', 'e42'], ['0.35 observed', 'e35']])
    console.log('  ' + lab.padEnd(26) + String(first(key)).padStart(8) + ' deg' + String(full(key)).padStart(13) + ' deg');
  console.log('\n  The band is a fixed 10 deg by request; what moves is WHERE it is anchored.');
  console.log('  Seeded at the nominal edge and only ever pulled IN by an observed loss, so');
  console.log('  the first row is the shipped behaviour before any evidence arrives.');
  console.log('\n  NOTE the structural fact underneath: camOff=0.2 with scalar ' + res.scalar +
              ' and lens ' + res.contentLensFovDeg + 'deg maps the ENTIRE');
  console.log('  camera half-frame onto ' + res.rows[res.rows.length - 1].theta +
              ' deg of virtual angle. The documented ' + res.start + '/' + res.end + ' cone is');
  console.log('  UNREACHABLE by head tracking at this gain, so the virtual fade term never fires');
  console.log('  and the face-frame term is the only fade the user ever sees.');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
