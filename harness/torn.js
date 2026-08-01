// A190: WHEN THE FOREGROUND TEARS, IS THERE A PLUG BEHIND IT?
//
// a188 found the one real plain-path defect left on the vertical axis, and it is
// in the direction OPPOSITE the user's report: with the eye BELOW the panel
// centre — looking up into the scene — the foreground mesh alone loses 42% of
// its coverage by 40deg (100 -> 74.4 -> 66.3 -> 58.4) while the gradient of what
// survives RISES to 105-114%. Gradient up, area down is tearing, not smearing:
// the mesh is opening honest holes rather than stretching rubber across them.
//
// TEARING IS NOT A DEFECT. It is what a160's criterion is FOR. The defect, if
// there is one, is a hole that nothing fills — the user's standing requirement
// is "a single perfect plug that seamlessly slots in to fill all disocclusions".
// So the question is not how much the foreground tears. It is:
//
//     of the pixels where the foreground has torn away, how many show
//     NOTHING in the composited frame?
//
// THE INSTRUMENT BUG THIS FILE EXISTS TO NOT REPEAT. a188's flatten.js claimed
// to hide the fishtank and did not: its dark% at -27deg read 20.44 against
// a184's 22.96 at the same pose WITH the tank visible, so the arm never
// diverged. The cause is that the tank is REBUILT whenever _bgFishtankKey
// changes — which it does on every pose — so setting mesh.visible = false is
// discarded on the next render. The source documents the correct switch,
// window._noFishtank, which drops it and keeps it dropped. This file uses that
// AND asserts the arm diverged before reading a single number.
//
// Note what _noFishtank also does: it nulls bgAperture, so the a171 crop is off
// in these runs. Measurement is therefore restricted to the REST-FRAME content
// rect, which bounds the apron whether or not the crop is there.
//
//   node harness/torn.js [star|troll|warrior] [quick|v2]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const ASSET = process.argv[2] || 'star';
const MODE = process.argv[3] || 'quick';
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star: ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };
// eye BELOW centre is the failing direction; the mirror above is the control
const DEG = [0, 20, 27, 35, 40, 45];
const EYE_Z = 0.177;

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

  const r = await page.evaluate(async (o) => {
    window._rayReproject = true;
    bgViewFadeStartDeg = 35; bgViewFadeEndDeg = 45;
    bgQuickBake = (o.mode === 'quick');
    bgMPIFullPlanes = (o.mode === 'v2'); bgMPIMode = (o.mode === 'v2');
    bgBuildStamp = null; buildBackgroundLayer();
    isSweeping = true;
    const W = renderer.domElement.width, Hh = renderer.domElement.height;
    const grab = () => { for (let n = 0; n < 3; n++) render();
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const g = cv.getContext('2d'); g.drawImage(renderer.domElement, 0, 0, W, Hh);
      return g.getImageData(0, 0, W, Hh).data; };
    const shotUrl = () => { const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      cv.getContext('2d').drawImage(renderer.domElement, 0, 0, W, Hh); return cv.toDataURL('image/png'); };
    const darkPct = (d) => { let k = 0, n = 0;
      for (let i = 0; i < W*Hh; i++) { if (d[i*4+3] < 8) continue; n++;
        if (0.299*d[i*4] + 0.587*d[i*4+1] + 0.114*d[i*4+2] < 8) k++; }
      return 100 * k / Math.max(1, n); };

    // ---- THE DIVERGENCE ASSERT, BEFORE ANY NUMBER IS READ ----
    // a185 measured the tank as the whole of the look-up dark band, so hiding it
    // MUST move dark% at a pose where the ceiling is exposed. If it does not,
    // the switch did nothing and every row below would be about the tank.
    const tBelow = -Math.tan(35 * Math.PI / 180) * o.z;
    camera.position.set(0, tBelow, o.z);
    const darkWithTank = darkPct(grab());
    window._noFishtank = true; bgBuildStamp = null; buildBackgroundLayer();
    const darkNoTank = darkPct(grab());
    const tankGone = (typeof bgFishtankMesh === 'undefined') || bgFishtankMesh === null;
    const diverged = tankGone && Math.abs(darkWithTank - darkNoTank) > 1.0;

    const L = mediaLayers[0];
    const solo = () => { const h = [];
      scene.traverse(m => { if (m.isMesh && m !== L.mesh && m.visible) { h.push(m); m.visible = false; } });
      return h; };

    // measurement region = the rest-frame content rect (the letterbox aperture)
    camera.position.set(0, 0, o.z);
    const rest = grab();
    const inRect = new Uint8Array(W*Hh);
    let nRect = 0;
    for (let i = 0; i < W*Hh; i++) if (rest[i*4+3] >= 8) { inRect[i] = 1; nRect++; }
    const h0 = solo(); const fgRest = grab(); for (const m of h0) m.visible = true;
    let fgRestPx = 0;
    for (let i = 0; i < W*Hh; i++) if (inRect[i] && fgRest[i*4+3] >= 8) fgRestPx++;

    const rows = [], urls = {};
    for (const deg of o.deg) {
      const t = Math.tan(deg * Math.PI / 180) * o.z;
      for (const sgn of (deg === 0 ? [0] : [-1, 1])) {
        camera.position.set(0, sgn * t, o.z);
        const C = grab();
        if (sgn <= 0 && (deg === 0 || deg === 27 || deg === 40)) urls['d' + deg] = shotUrl();
        const hh2 = solo(); const F = grab(); for (const m of hh2) m.visible = true;
        let fgPx = 0, tornPx = 0, unfilledAbsent = 0, unfilledDark = 0, holeInRect = 0;
        for (let i = 0; i < W*Hh; i++) {
          if (!inRect[i]) continue;
          const fgHere = F[i*4+3] >= 8;
          if (fgHere) fgPx++;
          const cA = C[i*4+3] >= 8;
          const cL = 0.299*C[i*4] + 0.587*C[i*4+1] + 0.114*C[i*4+2];
          const empty = !cA || cL < 8;
          if (empty) holeInRect++;
          if (!fgHere) { tornPx++; if (!cA) unfilledAbsent++; else if (cL < 8) unfilledDark++; }
        }
        rows.push({ deg, sgn,
          fgCover: +(100 * fgPx / Math.max(1, fgRestPx)).toFixed(1),
          noFg: +(100 * tornPx / Math.max(1, nRect)).toFixed(1),
          holePct: +(100 * holeInRect / Math.max(1, nRect)).toFixed(3),
          unfilledOfTear: +(100 * (unfilledAbsent + unfilledDark) / Math.max(1, tornPx)).toFixed(3),
          absent: +(100 * unfilledAbsent / Math.max(1, nRect)).toFixed(3),
          dark: +(100 * unfilledDark / Math.max(1, nRect)).toFixed(3) });
      }
    }
    camera.position.set(0, 0, o.z); render();
    return { rows, urls, W, H: Hh, nRect, fgRestPx,
             darkWithTank: +darkWithTank.toFixed(2), darkNoTank: +darkNoTank.toFixed(2),
             tankGone, diverged };
  }, { deg: DEG, z: EYE_Z, mode: MODE });

  console.log('\n  ARM CHECK (a188 lesson): hiding the tank at -35deg moved dark% ' +
    r.darkWithTank + ' -> ' + r.darkNoTank + '; bgFishtankMesh null = ' + r.tankGone);
  if (!r.diverged) {
    console.log('  *** THE ARM DID NOT DIVERGE. The tank is still in the frame and every row');
    console.log('  *** below would be measuring it. Numbers withheld.');
    await browser.close(); srv.kill(); process.exit(2);
  }
  console.log('  arm diverged — the rows below are about content, not about the tank.\n');

  const pad = (s, n) => String(s).padStart(n);
  console.log(ASSET + '  mode=' + MODE + '  canvas ' + r.W + 'x' + r.H +
    '  content rect ' + r.nRect + ' px, foreground covers ' + r.fgRestPx + ' of it at rest\n');
  console.log('   deg  eye    FG cover%   no-FG% of rect   holes% of rect   UNFILLED% of the torn area   absent%  dark%');
  let last = null;
  for (const w of r.rows) {
    if (last !== null && w.deg !== last) console.log('');
    last = w.deg;
    const eye = w.sgn === 0 ? 'rest' : (w.sgn < 0 ? 'below' : 'above');
    console.log('  ' + pad(w.deg, 4) + pad(eye, 7) + pad(w.fgCover, 12) + pad(w.noFg, 17) +
      pad(w.holePct, 17) + pad(w.unfilledOfTear, 28) + pad(w.absent, 10) + pad(w.dark, 7));
  }
  console.log('\n  FG cover% is the layer mesh alone, against its own rest footprint: this is the');
  console.log('  tearing a188 found. It is NOT the defect — tearing is what the a160 criterion');
  console.log('  is for. UNFILLED% of the torn area IS the defect metric: of the pixels the');
  console.log('  foreground vacated, the fraction the composite leaves showing nothing. The');
  console.log('  standing requirement is a plug that fills ALL disocclusions, so the target is 0.');
  console.log('  The fishtank is dropped via window._noFishtank (not mesh.visible, which the');
  console.log('  per-pose rebuild discards) and the drop is asserted above.');

  for (const k of Object.keys(r.urls)) {
    fs.writeFileSync(path.join(H, 'torn_' + ASSET + '_' + MODE + '_below' + k.slice(1) + '.png'),
      Buffer.from(r.urls[k].split(',')[1], 'base64'));
  }
  console.log('\n  wrote harness/torn_' + ASSET + '_' + MODE + '_below*.png');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
