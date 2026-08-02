// A194c: SOLVE FOR THE PLANE THAT ZEROES THE DRIFT.
//
// a194b established: the frustum is exact (law error and portal drift both
// 0.000px), the embed is the cause (embed off -> 0.000px drift at every lateral),
// and the proposed gain g* = (e-q-embed)/(e0-q-embed) removes 84% of the drift
// but not all of it — 0.68 -> 0.11px at lateral 0.05, 1.37 -> 0.22px at 0.10,
// still exactly proportional to lateral offset, so a residual GAIN error rather
// than noise.
//
// Rather than guess the missing term, solve for it. The gain defends some plane
// a; the content sits on some plane c. With
//     ex(e) = lat * (e - a) / (e0 - a)      and      X = -ex * (c-P) / (e - c)
// the screen position is
//     X(e) = -lat * (c-P) / (e0-a) * (e-a)/(e-c)
// which is constant in e IF AND ONLY IF a == c. So sweeping a and minimising the
// drift measures c directly.
//
// THIS TEST IS DIAGNOSTIC EITHER WAY, and that is why it is worth running rather
// than reasoning further. The probe point is placed BY THIS HARNESS at P + (q-P)
// + embed, so c is q+embed by construction and the solve MUST return that. If it
// returns something else, the error is not a missing term in the plane at all —
// it is in my model of what the gain does to the eye, and the per-sample dump
// below is where that will show.
//
// The dump exists because the a194b table already contains a contradiction I
// could not resolve on paper: at phase 0 the gain reads 1.000, so the target eye
// should be exactly `lat`, yet the achieved eye was 0.1037 for lat 0.10 — while
// the miss against target measured < 1e-5. Both cannot be true unless the target
// itself was not what I thought. Printing e, gain, target and achieved per
// sample settles it by observation.
//
//   node harness/dollysolve.js [star|troll|warrior]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const ASSET = process.argv[2] || 'star';
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star: ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };
const LAT = 0.10;

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
    const q = P + 0.5 * innerVolumeDepth;
    subjectFocalPlaneWorldZ = q; subjectLockActive = true; dollyZoomActive = true;
    const PHSTEP = dollyZoomSpeed * 100;
    initializeSubjectLockConstant();
    const W = renderer.domElement.width;
    const embed = bgEmbedOffsetNow();
    const zc = (q - P) + embed;          // where this harness PLACES the probe point
    const c = P + zc;                    // the content plane, by construction

    const projX = (wx, wy, wz) => (new THREE.Vector3(wx, wy, wz).project(camera).x * 0.5 + 0.5) * W;
    const phases = [0, 0.4, 0.8, 1.2, 1.6, 2.0, 2.4, 2.8];

    // one dolly sweep with the eye driven to lat * (e-a)/(e0-a); returns drift
    const sweep = (a, dump) => {
      window._dzLat = null; window._dzBase = null;
      let e0 = null; const xs = [], rows = [];
      for (const ph of phases) {
        dollyZoomTime = ph - PHSTEP; manualCamDX = 0; manualCamDY = 0;
        updateCameraAndProjection();
        const g = Math.abs(dollyLatGain) < 1e-9 ? 1 : dollyLatGain;
        const T = camera.position.x / g;
        const e = camera.position.z;
        if (e0 === null) e0 = e;
        const target = o.lat * (e - a) / Math.max(1e-9, (e0 - a));
        dollyZoomTime = ph - PHSTEP; manualCamDX = target / g - T;
        updateCameraAndProjection();
        // A194d/A195c NO render() HERE, BUT updateMatrixWorld IS REQUIRED.
        // Skipping render() is fine for a projection-only measurement, but
        // Vector3.project needs matrixWorldInverse as well as projectionMatrix,
        // and only updateMatrixWorld refreshes it. Without it the view matrix
        // froze while the projection tracked the eye — which is what produced
        // this file's earlier monotonic scan curve with no minimum. Those
        // results were void. frameCorners() is called
        // from updateCameraAndProjection (moebius.js:17042), so the projection
        // matrix is fully determined without drawing anything — and projX reads
        // the matrix, not the framebuffer. The first version of this file issued
        // ~1600 full renders inside one page.evaluate, blocked the page for
        // minutes and crashed it. The measurement never needed a single one.
        camera.updateMatrixWorld(true);   // A195c: projection alone is not enough
        const ex = camera.position.x;
        const X = projX(0, 0, c);
        xs.push(X);
        if (dump) rows.push({ ph, e: +e.toFixed(5), g: +g.toFixed(5), T: +T.toFixed(5),
                              target: +target.toFixed(5), ex: +ex.toFixed(5),
                              miss: +Math.abs(ex - target).toFixed(7), X: +X.toFixed(3) });
      }
      return { drift: Math.max(...xs) - Math.min(...xs), rows, e0 };
    };

    // per-sample dump for the shipped-equivalent plane (a = q), to see the eye
    const dump = sweep(q, true);

    // coarse scan then golden-section refine over the defended plane
    const lo0 = P - 2 * Math.abs(zc) - 0.05, hi0 = P + 2 * Math.abs(zc) + 0.05;
    const scan = [];
    const NS = 21;
    for (let i = 0; i < NS; i++) {
      const a = lo0 + (hi0 - lo0) * i / (NS - 1);
      scan.push([a, sweep(a, false).drift]);
    }
    let best = scan[0];
    for (const s of scan) if (s[1] < best[1]) best = s;
    // refine around the best sample
    const step = (hi0 - lo0) / (NS - 1);
    let lo = best[0] - step, hi = best[0] + step;
    for (let it = 0; it < 24; it++) {
      const m1 = lo + (hi - lo) * 0.382, m2 = lo + (hi - lo) * 0.618;
      if (sweep(m1, false).drift < sweep(m2, false).drift) hi = m2; else lo = m1;
    }
    const aStar = 0.5 * (lo + hi);
    const dStar = sweep(aStar, false).drift;

    // A194e MEASURE FIRST, THEN DISABLE. The previous version turned
    // dollyZoomActive off on the line ABOVE these two measurements, so both ran
    // with a stationary camera and returned 0.0000 px — two dead arms, reported
    // as though they were the shipped and corrected results. The per-sample dump
    // (same function, same argument, still live) showed 305px of travel at the
    // same plane, which is the only reason it was caught. Third dead arm in this
    // harness; the ordering is now explicit.
    const dQ = sweep(q, false).drift;
    const dQE = sweep(q + embed, false).drift;
    dollyZoomActive = false; subjectLockActive = false;
    window._dzLat = null; manualCamDX = 0;
    return { P, q, embed, zc, c, aStar, dStar, e0: dump.e0, rows: dump.rows,
             driftAtQ: dQ, driftAtQE: dQE, scan,
             scanLo: lo0, scanHi: hi0 };
  }, { lat: LAT });

  const pad = (s, n) => String(s).padStart(n);
  console.log('\n' + ASSET + '  lateral ' + LAT + '   P=' + r.P.toFixed(4) +
    '  q=' + r.q.toFixed(4) + '  embed=' + r.embed.toFixed(4) +
    '  probe point placed at c=' + r.c.toFixed(4));
  console.log('\n  PER-SAMPLE, gain defending a = q (the shipped choice):');
  console.log('   phase        e      gain    tracker T    target ex    achieved ex      miss    screen X');
  for (const w of r.rows)
    console.log('  ' + pad(w.ph, 6) + pad(w.e, 10) + pad(w.g, 10) + pad(w.T, 13) +
      pad(w.target, 13) + pad(w.ex, 15) + pad(w.miss, 10) + pad(w.X, 12));
  console.log('\n  SCAN CURVE — drift vs the plane the gain defends (the whole shape, not just');
  console.log('  its argmin, because a search that reports a boundary point needs to be seen):');
  for (const [a, d] of r.scan)
    console.log('    a = ' + pad(a.toFixed(4), 8) + '   drift ' + pad(d.toFixed(3), 10) +
      (Math.abs(a - r.c) < 1e-9 ? '   <- content plane c' : ''));
  console.log('\n  SOLVE — drift as a function of the plane the gain defends:');
  console.log('    a = q            ' + r.driftAtQ.toFixed(4) + ' px   (shipped)');
  console.log('    a = q + embed    ' + r.driftAtQE.toFixed(4) + ' px   (my proposed correction)');
  console.log('    a = ' + r.aStar.toFixed(5) + '      ' + r.dStar.toFixed(4) + ' px   <- MINIMUM, found by search');
  console.log('\n  the content plane by construction is c = ' + r.c.toFixed(5));
  console.log('  solved plane minus content plane = ' + (r.aStar - r.c).toFixed(5));
  const near = Math.abs(r.aStar - r.c) < 1e-3;
  console.log('  ' + (near
    ? 'MATCHES the content plane, so the model is right and the residual was numerical'
    : 'DOES NOT match the content plane — the missing term is not in the plane, it is in how the gain reaches the eye; read the per-sample dump above'));
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
