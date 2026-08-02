// A195: DID THE OFF-PORTAL SUBJECT PIN EVER WORK? ASK THE OLD BUILDS.
//
// The user's account is that this was solved at the beginning of the project and
// has regressed. My reading of the history says it has been invalidated TWICE by
// changes to where content actually sits:
//
//   init (48e265d)   frameCorners is already there and already overwrites the
//                    projection AFTER the fov compensation, so the fov-based
//                    dolly zoom was dead from day one. The portal plane is
//                    pinned by the frustum; a subject AT the portal is pinned
//                    for free.
//   797e858          "working off-portal subject lock" — the mesh-scaling pin.
//   a59f             ray reprojection, added for the plug contours. It moves the
//                    plane the shader displaces from, which is what a67 says
//                    broke the mesh-scale pin.
//   496dfd4 (a67)    pin rebuilt as a lateral-offset gain g = (e-q)/(e0-q).
//   a167 / a172      the embed shifts all content by -innerVolumeDepth, so the
//                    content leaves the plane a67's gain defends.
//
// THAT IS A STORY, NOT A MEASUREMENT. Every step of it is a reading of a diff,
// and my readings of this particular mechanism have been wrong three times in a
// row today. So run the invariant against the actual builds.
//
// THE INVARIANT, stated so it means the same thing in every version: with the
// dolly sweeping and a subject plane q chosen OFF the portal plane, and the eye
// held off-axis, a world point on plane q must not move on screen.
//
// Version-neutral by construction:
//   - the probe point is (0, 0, q) in whatever coordinates that build uses, so
//     no assumption about embed, bias or reprojection is carried across;
//   - the lateral offset is injected through latestDetectedFaceX, which exists
//     in every version, rather than manualCamDX, which does not;
//   - the ACHIEVED eye range is reported beside the drift, so two builds can be
//     compared like for like instead of on trust.
//
// A build where the subject holds still and a build where it travels hundreds of
// pixels are distinguishable without any theory about why.
//
//   node harness/dollyhist.js
const { chromium } = require('playwright-core');
const { spawn, execSync } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const REVS = [
  ['48e265d', 'init — frameCorners already present'],
  ['797e858', '"working off-portal subject lock"'],
  ['496dfd4', 'a67 lateral-gain pin'],
  ['HEAD',    'a192 (today)'],
];

const probe = async (page, killGain) => page.evaluate(async (killGain) => {
  try {
    if (typeof camera === 'undefined' || !camera) return { err: 'no camera' };
    const P = portalPlaneWorldZ;
    const q = P + 0.5 * innerVolumeDepth;          // a subject clearly off the portal
    subjectFocalPlaneWorldZ = q;
    // A195b THE DECISIVE ARM, DONE WITH THE APP'S OWN SWITCH. The first draft
    // set dollyLatGain = 1 and then called updateCameraAndProjection, which
    // recomputes it — a dead arm, the same failure as the last three. But the
    // code already hard-resets the gain to 1 when the lock is off, so turning
    // subjectLockActive off drives this build exactly the way the pre-a67 ones
    // ran: dolly sweeping, lateral eye CONSTANT, no pin.
    subjectLockActive = !killGain;
    dollyZoomActive = true;
    if (typeof initializeSubjectLockConstant === 'function') initializeSubjectLockConstant();
    // lateral offset through the tracker, the one input every build shares
    baselineFaceTrackerOffsetX = 0; baselineFaceTrackerOffsetY = 0;
    latestDetectedFaceY = 0.5;
    latestDetectedFaceX = 0.5 + 0.5;               // a large, unambiguous deviation
    const W = renderer.domElement.width;
    const projX = (z) => (new THREE.Vector3(0, 0, z).project(camera).x * 0.5 + 0.5) * W;
    const step = (typeof dollyZoomSpeed === 'number' ? dollyZoomSpeed : 0.0005) * 100;
    const xs = [], exs = [], ps = [], es = [];
    for (const ph of [0, 0.4, 0.8, 1.2, 1.6, 2.0, 2.4, 2.8]) {
      dollyZoomTime = ph - step;
      updateCameraAndProjection();
      // A195c THE PROJECTION IS NOT THE WHOLE CAMERA. frameCorners rebuilds
      // projectionMatrix from camera.position every call, but Vector3.project
      // ALSO needs matrixWorldInverse, and that is only refreshed by
      // updateMatrixWorld — which normally happens inside render(). Dropping
      // render() left the view matrix frozen while the projection tracked the
      // eye, so the off-axis skew was applied with no camera translation to
      // cancel it and EVERYTHING shifted together. The tell was the control:
      // portal drift came out identical to subject drift (318.614 vs 318.61),
      // and the portal plane cannot drift. Old builds hid it because their eye
      // never moved, so there was nothing to desynchronise.
      camera.updateMatrixWorld(true);
      xs.push(projX(q));                            // the subject plane
      ps.push(projX(P + 1e-4));   // control: just OFF the portal plane. Exactly ON it
                                 // projected to NaN in every build including HEAD, where
                                 // a194b measured it cleanly at 0.000 after a render —
                                 // a degenerate case of this no-render path, not a build fault.
      exs.push(camera.position.x);
      es.push(camera.position.z);
    }
    dollyZoomActive = false; subjectLockActive = false;
    const rng = (a) => Math.max(...a) - Math.min(...a);
    return { P: +P.toFixed(4), q: +q.toFixed(4),
             subjectDrift: +rng(xs).toFixed(2),
             portalDrift: +rng(ps).toFixed(3),
             exFrom: +Math.min(...exs).toFixed(4), exTo: +Math.max(...exs).toFixed(4),
             eFrom: +Math.min(...es).toFixed(3), eTo: +Math.max(...es).toFixed(3),
             reproj: (typeof _rayReprojectNow === 'function') ? !!_rayReprojectNow() : 'n/a',
             embed: (typeof bgEmbedOffsetNow === 'function') ? +bgEmbedOffsetNow().toFixed(4) : 'n/a' };
  } catch (e) { return { err: String(e.message).slice(0, 90) }; }
}, killGain);

(async () => {
  fs.copyFileSync(path.join(WT, 'starwatcher_color.png'), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, 'starwatcher_depth.png'), path.join(H, 'defaultImgDepth.png'));
  const html = fs.readFileSync(path.join(H, 'scratch_moebius.html'), 'utf8');
  fs.writeFileSync(path.join(H, 'hist.html'), html.replace('src="moebius.js"', 'src="moebius_hist.js"'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });

  const out = [];
  for (const [rev, label] of REVS) {
    let src;
    try { src = execSync(`git -C ${WT} show ${rev}:moebius.js`, { maxBuffer: 1 << 28 }).toString(); }
    catch (e) { out.push([rev, label, { err: 'checkout failed' }]); continue; }
    fs.writeFileSync(path.join(H, 'moebius_hist.js'), src);
    const stamp = (src.match(/v[\d.]+-a\d+/) || ['(pre-stamp)'])[0];
    const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
    let pageErr = null;
    page.on('pageerror', e => { if (!pageErr) pageErr = e.message.slice(0, 80); });
    try {
      await page.goto('http://localhost:8099/hist.html', { waitUntil: 'load', timeout: 90000 });
      let ready = false;
      for (let t = 0; t < 30; t++) {
        ready = await page.evaluate(() => { try { return !!(typeof camera !== 'undefined' && camera && typeof updateCameraAndProjection === 'function'); } catch (e) { return false; } }).catch(() => false);
        if (ready) break; await new Promise(r => setTimeout(r, 1000));
      }
      const res = ready ? await probe(page, false) : { err: 'never became ready' };
      const resNG = ready ? await probe(page, true) : null;
      if (resNG && !resNG.err) res.noGainDrift = resNG.subjectDrift;
      if (resNG && !resNG.err) res.noGainEx = resNG.exFrom + '..' + resNG.exTo;
      res.stamp = stamp; res.pageErr = pageErr;
      out.push([rev, label, res]);
    } catch (e) { out.push([rev, label, { err: String(e.message).slice(0, 80), stamp }]); }
    await page.close();
  }

  const pad = (s, n) => String(s).padStart(n);
  console.log('\nDOES A POINT ON THE OFF-PORTAL SUBJECT PLANE HOLD ITS SCREEN POSITION?');
  console.log('dolly sweeping, subject at q = P + 0.5*innerVolumeDepth, eye held off-axis\n');
  console.log('  rev       build          subject drift   portal drift   eye x range        gain=1 drift   gain=1 eye');
  for (const [rev, label, r] of out) {
    if (r.err) { console.log('  ' + rev.padEnd(10) + label.padEnd(15) + '  ERROR: ' + r.err); continue; }
    console.log('  ' + rev.padEnd(10) + (r.stamp || '').padEnd(15) +
      pad(r.subjectDrift, 14) + pad(r.portalDrift, 15) +
      pad(r.exFrom + '..' + r.exTo, 19) +
      pad(r.noGainDrift === undefined ? '-' : r.noGainDrift, 15) +
      pad(r.noGainEx || '-', 20));
    if (r.pageErr) console.log('             [pageerror] ' + r.pageErr);
  }
  console.log('\n  portal drift is the control and must be ~0 in every build — the frustum pins');
  console.log('  the portal plane by construction, so a build where it is NOT ~0 is broken in');
  console.log('  some other way and its subject column cannot be read.');
  console.log('  eye x range shows the arms are comparable: a build that never moved the eye');
  console.log('  laterally would show ~0 drift for a reason that has nothing to do with the pin.');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
