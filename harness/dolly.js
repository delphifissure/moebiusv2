// A194: OFF-AXIS DOLLY ZOOM NO LONGER PINS THE SUBJECT PLANE.
//
// User report: an object on the selected focal plane should hold the same screen
// x/y while the world stretches around it during a dolly, off-axis included.
// It used to. Two things are checked here, because "the frustum is wrong" and
// "the pin is wrong" are different faults with the same symptom.
//
// (1) IS THE ASYMMETRIC FRUSTUM ITSELF CORRECT?
// frameCorners() builds Kooima's generalized perspective projection pinned to
// the portal rect. The a104 law says a world point at z = P + zOff lands at
//     X_screen = Px - ex * zOff / (H - zOff),     H = e - P
// so projecting a KNOWN world point through the live projection matrix and
// comparing against that closed form tests the frustum against theory, at every
// dolly distance and lateral offset. Agreement to sub-pixel means the frustum is
// right and the fault is elsewhere; disagreement means it is not.
//
// (2) WHERE THE PIN LOOKS LIKE IT BROKE.
// The a67 reprojection-native pin scales the applied lateral eye offset by
//     g = (e - q) / (e0 - q),        q = subjectFocalPlaneWorldZ
// which pins content whose zOff is exactly (q - P). That was true when a67 was
// written. It is not true now: a167 introduced the embed and a172 made it
// unconditional, so the shader's offset is
//     zOff = displacement + displacementBias + u_embedOffset
// with u_embedOffset = -max(0, innerVolumeDepth) = -0.04 by default. Subject
// content therefore sits at world z = q + embed, not q — while
// subjectFocalPlaneWorldZ is still computed in the PRE-EMBED frame (the "Set
// Subject Focus" button derives it as portalPlaneWorldZ +/- relDepth *
// volumeDepth, with no embed term).
//
// Substituting the content plane into the law with the shipped gain:
//     X = -ex0 * zOffc * (e - q) / [ (e0 - q) * (e - q - embed) ]
// which is constant in e only if embed == 0. With embed = -0.04 against a
// working distance of ~0.2 that is a 20% error in the denominator, growing as
// the dolly closes. The corrected gain is the same expression with the content
// plane substituted throughout:
//     g* = (e - q - embed) / (e0 - q - embed)
//
// THE ARMS. Same sweep, same lateral offset, three configurations:
//   SHIPPED    embed on, gain uses q
//   EMBED OFF  bgEmbedVolume = false — if the embed is the cause, this pins
//   CORRECTED  embed on, gain uses q + embed
// EMBED OFF is the control that distinguishes "the embed broke it" from "the pin
// was always wrong": if the pin were simply wrong, turning the embed off would
// not rescue it.
//
//   node harness/dolly.js [star|troll|warrior]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const ASSET = process.argv[2] || 'star';
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star: ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };
const LATERAL = [0, 0.05, 0.10];

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

  const r = await page.evaluate(async (o) => {
    window._rayReproject = true;
    const P = portalPlaneWorldZ;
    // a subject plane clearly OFF the portal, inside the inner volume
    const q = P + 0.5 * innerVolumeDepth;
    subjectFocalPlaneWorldZ = q;
    subjectLockActive = true;
    dollyZoomActive = true;
    // dollyZoomSpeed is a const in the page, so the phase cannot be frozen —
    // instead pre-subtract the increment updateCameraAndProjection is about to
    // apply, which lands the sweep on exactly the phase asked for.
    const PHSTEP = dollyZoomSpeed * 100;
    initializeSubjectLockConstant();

    const W = renderer.domElement.width, Hh = renderer.domElement.height;
    const embed = bgEmbedOffsetNow();
    const zOffc = (q - P) + embed;      // where subject content ACTUALLY sits

    // screen x of a world point, through the LIVE projection matrix
    const projX = (wx, wy, wz) => {
      const v = new THREE.Vector3(wx, wy, wz).project(camera);
      return (v.x * 0.5 + 0.5) * W;
    };
    // The a104 closed form, in pixels — SELF-CALIBRATED. Rather than assume the
    // portal rect's world size, project two known portal-plane points and read
    // the world->pixel map straight off the live projection. That way the law
    // check tests the frustum's SHAPE without depending on my arithmetic about
    // its scale, and it re-derives at every pose.
    const lawX = (zOff) => {
      const e = camera.position.z, ex = camera.position.x;
      const Hd = e - P;
      const Xw = -ex * zOff / (Hd - zOff);
      const a = projX(-0.05, 0, P), b = projX(0.05, 0, P);
      const scale = (b - a) / 0.1, origin = (a + b) / 2;
      return origin + Xw * scale;
    };

    // A194b THE FIRST RUN OF THIS FILE HAD TWO FAULTS AND BOTH ARE FIXED HERE.
    //
    //  1. AN UNCONTROLLED LATERAL TERM. The applied eye offset is
    //     (faceTrackCamX + gyroCamX + manualCamDX) * dollyLatGain, and the
    //     tracker path is live in the harness — latestDetectedFaceX plus a
    //     window-position term. So setting manualCamDX did not set the eye.
    //     Symptom: 1.08px of drift at lateral ZERO, and drift FALLING as the
    //     requested lateral rose, which is a hidden offset of opposite sign
    //     partially cancelling, not a gain error.
    //  2. THE CORRECTED ARM NEVER DIVERGED. Pre-scaling manualCamDX multiplies
    //     only part of the sum — at lateral 0 it scales zero by a ratio and
    //     changes nothing, which is exactly why that arm came back byte
    //     identical to shipped. Numbers were read from an arm not shown to have
    //     moved: the a134 rule, broken again.
    //
    // Both are cured by SOLVING for the eye instead of nudging it. One probe
    // call measures the gain g and the tracker term T = x/g; then
    //     manualCamDX = target/g - T
    // lands camera.position.x on the target exactly, whatever the tracker is
    // doing. The achieved ex is returned and asserted, so a miss is visible
    // rather than silent.
    const sample = (phase, lat, mode) => {
      bgEmbedVolume = (mode !== 'embedoff');
      // probe: what does the tracker contribute, and what gain is in force?
      dollyZoomTime = phase - PHSTEP;
      manualCamDX = 0; manualCamDY = 0;
      updateCameraAndProjection();
      const g = Math.abs(dollyLatGain) < 1e-9 ? 1 : dollyLatGain;
      const T = camera.position.x / g;
      const e = camera.position.z;
      const e0 = window._dzLat ? window._dzLat.e0 : e;
      const emb = bgEmbedOffsetNow();
      // the eye offset each arm intends to apply
      const gStar = (e - q - emb) / Math.max(1e-9, (e0 - q - emb));
      const target = (mode === 'corrected') ? lat * gStar : lat * g;
      dollyZoomTime = phase - PHSTEP;
      manualCamDX = target / g - T; manualCamDY = 0;
      updateCameraAndProjection();
      const exMiss = Math.abs(camera.position.x - target);
      render();
      const emb2 = bgEmbedOffsetNow();
      const zc = (q - P) + emb2;
      return { e: camera.position.z, ex: camera.position.x, exMiss, g, gStar,
               proj: projX(0, 0, P + zc), law: lawX(zc),
               projPortal: projX(0, 0, P) };
    };

    const phases = [0, 0.6, 1.2, 1.8, 2.4, 3.0];
    const out = { P, q, embed, W, H: Hh, arms: {} };
    for (const mode of ['shipped', 'embedoff', 'corrected']) {
      const byLat = {};
      for (const lat of o.lat) {
        window._dzLat = null; window._dzBase = null;   // fresh engage per arm
        const rows = [];
        for (const ph of phases) rows.push(sample(ph, lat, mode));
        const xs = rows.map(v => v.proj);
        const pxs = rows.map(v => v.projPortal);
        const lawErr = Math.max(...rows.map(v => Math.abs(v.proj - v.law)));
        byLat[lat] = {
          exRange: rows[0].ex.toFixed(4) + '..' + rows[rows.length-1].ex.toFixed(4),
          exMiss: +Math.max(...rows.map(v => v.exMiss)).toFixed(6),
          gRange: rows[0].g.toFixed(3) + '..' + rows[rows.length-1].g.toFixed(3),
          gStarRange: rows[0].gStar.toFixed(3) + '..' + rows[rows.length-1].gStar.toFixed(3),
          drift: +(Math.max(...xs) - Math.min(...xs)).toFixed(2),
          portalDrift: +(Math.max(...pxs) - Math.min(...pxs)).toFixed(3),
          lawErr: +lawErr.toFixed(3),
          eRange: rows[0].e.toFixed(3) + '..' + rows[rows.length-1].e.toFixed(3)
        };
      }
      out.arms[mode] = byLat;
    }
    bgEmbedVolume = true; dollyZoomActive = false; subjectLockActive = false;
    window._dzLat = null; manualCamDX = 0;
    return out;
  }, { lat: LATERAL });

  const pad = (s, n) => String(s).padStart(n);
  console.log('\n' + ASSET + '  portal P=' + r.P.toFixed(3) + '  subject q=' + r.q.toFixed(3) +
    '  embed=' + r.embed.toFixed(3) + '  canvas ' + r.W + 'x' + r.H);
  console.log('\n  (1) FRUSTUM CHECK — live projection vs the a104 closed form, worst |error| in px');
  console.log('  (2) PIN CHECK — screen-x travel of a SUBJECT-PLANE point across the dolly sweep\n');
  console.log('  arm          lateral  drift px  portal px  law px   ex achieved        ex miss   gain        g*');
  for (const mode of ['shipped', 'embedoff', 'corrected'])
    for (const lat of LATERAL) {
      const a = r.arms[mode][lat];
      console.log('  ' + mode.padEnd(12) + pad(lat, 8) + pad(a.drift, 10) + pad(a.portalDrift, 11) +
        pad(a.lawErr, 8) + pad(a.exRange, 18) + pad(a.exMiss, 10) + '  ' +
        a.gRange.padEnd(12) + a.gStarRange);
    }
  {
    let bad = 0;
    for (const mode of ['shipped','embedoff','corrected']) for (const lat of LATERAL)
      if (r.arms[mode][lat].exMiss > 1e-5) bad++;
    console.log('\n  eye targeting: ' + (bad ? '*** ' + bad + ' sample set(s) MISSED their target eye — numbers not trustworthy'
                                              : 'every arm landed on its intended eye (max miss < 1e-5)'));
    const sh = r.arms.shipped[LATERAL[1]], co = r.arms.corrected[LATERAL[1]];
    console.log('  arm divergence at lateral ' + LATERAL[1] + ': shipped ex ' + sh.exRange +
      ' vs corrected ex ' + co.exRange + (sh.exRange === co.exRange ? '   *** IDENTICAL — did not diverge' : '   (diverged)'));
  }
  console.log('\n  portal drift is the control: the projection pins the PORTAL plane by');
  console.log('  construction, so it must be ~0 in every arm. If it is not, the frustum is at');
  console.log('  fault and nothing else in this table can be read.');
  console.log('  subject drift is the regression: it should be ~0 and is the quantity the user');
  console.log('  reports moving. EMBED OFF distinguishes "the embed broke the pin" from "the');
  console.log('  pin was always wrong" — if the pin itself were wrong, disabling the embed');
  console.log('  would not rescue it.');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
