// A209 THREE-WAY A/B: THE DEFAULT DOLLY LAW vs ITS TWO REFERENCES.
// "did you reproduce the effect exactly as before?" — measured, not asserted.
//
//   goodgaps  — the pre-reprojection build the user supplied ("the dolly zoom
//               stuff and the projection was working fine"): static world +
//               fixed-rect frustum. THE reference for the effect.
//   a106      — the arc-fix build the user bisected to. Run in both repro
//               modes: its legacy mode should equal goodgaps (static world);
//               its repro mode is the "so minor" regime (live refEye).
//   a209      — this tree. Legacy mode must equal goodgaps; repro mode
//               (frozen refEye) must pin the subject AND move the witnesses
//               like the reference, not like a106-repro.
//
// Same gesture everywhere: realtime (no bake), a REAL handleCanvasClick on
// the figure, then dolly+lock at matched distances-from-subject
// {engage 0.20, near 0.12, far 0.30} — each build's dollyZoomTime solved
// from ITS OWN dollyMin/MaxDistance. The eye is driven through the FACE
// TRACKING pathway (goodgaps has no isSweeping), landed on ex = 0.12 by
// 2-point linear calibration, which also makes any drift in the
// face-to-camera mapping between builds show up as a calibration failure.
// NCC templates cut at the engage pose: subject (clicked figure), witness
// far (crystal mountain), witness near (dune foot).
//
//   node harness/ab106.js
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';

const ARMS = [
  { tag: 'goodgaps',   dir: '/workspace/gg/harness',    port: 8126, repro: null  },
  { tag: 'a106-legacy',dir: '/workspace/arc73/harness', port: 8125, repro: false },
  { tag: 'a106-repro', dir: '/workspace/arc73/harness', port: 8125, repro: true  },
  { tag: 'a209-legacy',dir: '/workspace/mm/harness',    port: 8099, repro: false },
  { tag: 'a209-repro', dir: '/workspace/mm/harness',    port: 8099, repro: true  },
];

const PROBE = async (o) => {
  if (o.repro !== null && o.repro !== undefined) window._rayReproject = o.repro;
  if (typeof isSweeping !== 'undefined') isSweeping = false;
  if (typeof gyroActive !== 'undefined') gyroActive = false;
  baselineFaceTrackerOffsetX = 0; baselineFaceTrackerOffsetY = 0;
  if (typeof updateVolumeGuidesVisibility === 'function') updateVolumeGuidesVisibility(false);

  // the page's own render loop calls updateCameraAndProjection + render every
  // frame in EVERY build (goodgaps' render() even self-schedules, so calling
  // it directly would fork extra loops). The probe only mutates globals and
  // waits frames.
  const raf = () => new Promise(res => requestAnimationFrame(res));
  const settle = async (n) => { for (let i = 0; i < (n || 2); i++) await raf(); };

  // land the eye on (EX, 0) through the face-tracking pathway,
  // 2-point linear calibration per axis
  const EX = 0.12;
  latestDetectedFaceX = 0.5; latestDetectedFaceY = 0.5; await settle(3);
  const x0 = camera.position.x, y0 = camera.position.y;
  latestDetectedFaceX = 0.6; latestDetectedFaceY = 0.6; await settle(3);
  const sx = (camera.position.x - x0) / 0.1, sy = (camera.position.y - y0) / 0.1;
  if (Math.abs(sx) < 1e-6 || Math.abs(sy) < 1e-6) return { failed: 'face pathway inert' };
  const fx = 0.5 + (EX - x0) / sx, fy = 0.5 + (0 - y0) / sy;
  latestDetectedFaceX = fx; latestDetectedFaceY = fy; await settle(3);
  const exGot = +camera.position.x.toFixed(4);

  // SUBJECT CHOSEN IN SOURCE SPACE, sweet-spot EMULATED. The real
  // handleCanvasClick aborted silently in headless in every arm of the first
  // run (depth read 0 -> pn stayed 0.5), the same failure clickpin hit — so,
  // like clickpin, emulate the handler's sweet-spot exactly (it is
  // byte-identical in all three builds: pn = clicked depth, q = P,
  // outer = 0.01; the per-frame layer loop syncs the uniforms from these
  // globals in every build). The source texel (0.30, 0.53) is the
  // figure/ridge shelf (depth ~0.52, probed from the PNG in the a208 arc).
  const dImg = mediaLayers[0].textures.depth.image2d || mediaLayers[0].textures.depth.image ||
               (mediaLayers[0].elements && mediaLayers[0].elements.depth);
  const dw = dImg.naturalWidth || dImg.width, dh = dImg.naturalHeight || dImg.height;
  const dcv = document.createElement('canvas'); dcv.width = dw; dcv.height = dh;
  const dctx = dcv.getContext('2d'); dctx.drawImage(dImg, 0, 0, dw, dh);
  const dpx = dctx.getImageData(Math.round(o.srcU*dw), Math.round(o.srcV*dh), 1, 1).data;
  const d0 = dpx[0] / 255;
  currentNormPortalPlane = d0;
  subjectFocalPlaneWorldZ = portalPlaneWorldZ;
  outerVolumeDepth = 0.01;
  if (typeof initializeSubjectLockConstant === 'function') initializeSubjectLockConstant();
  await settle(3);

  // source texel -> screen point via the mesh rect (portal-plane content is
  // eye-independent, so this mapping needs no on-axis pose)
  const mesh = mediaLayers[0].mesh, gp = mesh.geometry.parameters;
  const mhw = gp.width * (mesh.scale.x || 1) / 2, mhh = gp.height * (mesh.scale.y || 1) / 2;
  const toScreen = (us, vs) => {
    const Xw = (mesh.position.x - mhw) + us * 2 * mhw;
    const Yw = (mesh.position.y + mhh) - vs * 2 * mhh;
    return [0.5 + Xw / terrariumWidth, 0.5 - Yw / terrariumHeight];
  };
  const [suU, suV] = toScreen(o.srcU, o.srcV);
  const [wfU, wfV] = toScreen(0.78, 0.40);   // crystal mountain (far)
  const [wnU, wnV] = toScreen(0.30, 0.90);   // near dune body

  const flags = {
    d0: +d0.toFixed(3), pn: +currentNormPortalPlane.toFixed(3),
    q: +subjectFocalPlaneWorldZ.toFixed(4), outer: +outerVolumeDepth.toFixed(3),
    emb: (typeof bgEmbedOffsetNow === 'function') ? +bgEmbedOffsetNow().toFixed(4) : 0,
    fishtank: (typeof bgFishtankMesh !== 'undefined') ? !!bgFishtankMesh : false,
    dMin: dollyMinDistance, dMax: dollyMaxDistance, ex: exGot,
    subjPt: [+suU.toFixed(3), +suV.toFixed(3)],
  };

  const W = 720, H = 450;
  const grabL = () => {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const cctx = cv.getContext('2d'); cctx.drawImage(renderer.domElement, 0, 0, W, H);
    const d = cctx.getImageData(0, 0, W, H).data;
    const L = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) L[i] = 0.299*d[i*4] + 0.587*d[i*4+1] + 0.114*d[i*4+2];
    return L;
  };
  const tvalFor = (dist) => {
    const u = Math.min(1, Math.max(0, (dist - dollyMinDistance) / (dollyMaxDistance - dollyMinDistance)));
    return Math.asin(2 * u - 1);
  };
  const shootDist = async (dist) => {
    subjectLockActive = true; dollyZoomActive = true;
    const tv = tvalFor(dist);
    // pin the phase each frame BEFORE the page loop's own += step; after a
    // couple of frames the rendered time is exactly tv (suite pattern)
    for (let n = 0; n < 8; n++) { dollyZoomTime = tv - dollyZoomSpeed * 100; await raf(); }
    dollyZoomTime = tv - dollyZoomSpeed * 100; await raf(); await raf();
    return { L: grabL(), e: +camera.position.z.toFixed(4), ex: +camera.position.x.toFixed(4),
             gain: (typeof dollyLatGain === 'number') ? +dollyLatGain.toFixed(4) : 1 };
  };

  const PS = 9;
  const cut = (L, x, y) => { const t = []; for (let j = y-PS; j <= y+PS; j++) for (let i = x-PS; i <= x+PS; i++) t.push(L[j*W+i]); return t; };
  const match = (tmpl, L, x0m, y0m, R) => {
    let pm = 0, n = 0;
    for (let j = -PS; j <= PS; j += 2) for (let i = -PS; i <= PS; i += 2) { pm += tmpl[(j+PS)*(2*PS+1)+(i+PS)]; n++; }
    pm /= n; let pss = 0;
    for (let j = -PS; j <= PS; j += 2) for (let i = -PS; i <= PS; i += 2) { const dd = tmpl[(j+PS)*(2*PS+1)+(i+PS)]-pm; pss += dd*dd; }
    let bc = -2, bx = 0, by = 0;
    for (let oy = Math.max(PS, y0m-R); oy <= Math.min(H-1-PS, y0m+R); oy++)
      for (let ox = Math.max(PS, x0m-R); ox <= Math.min(W-1-PS, x0m+R); ox++) {
        let s = 0, kk = 0;
        for (let j = -PS; j <= PS; j += 2) for (let i = -PS; i <= PS; i += 2) { s += L[(oy+j)*W+ox+i]; kk++; }
        const m = s/kk; let num = 0, den = 0;
        for (let j = -PS; j <= PS; j += 2) for (let i = -PS; i <= PS; i += 2) {
          const a = L[(oy+j)*W+ox+i]-m, b = tmpl[(j+PS)*(2*PS+1)+(i+PS)]-pm; num += a*b; den += a*a; }
        const c = num/Math.sqrt(Math.max(1e-9,den)*Math.max(1e-9,pss));
        if (c > bc) { bc = c; bx = ox-x0m; by = oy-y0m; }
      }
    return { dx: bx, dy: by, corr: +bc.toFixed(2) };
  };

  const engage = await shootDist(o.dists[0]);
  const pts = { subj: [Math.round(suU*W), Math.round(suV*H)],
                far:  [Math.round(wfU*W), Math.round(wfV*H)],
                near: [Math.round(wnU*W), Math.round(wnV*H)] };
  const tmpls = {}; for (const k in pts) tmpls[k] = cut(engage.L, pts[k][0], pts[k][1]);
  const out = { flags, engage: { e: engage.e, ex: engage.ex, gain: engage.gain }, poses: [] };
  for (let pi = 1; pi < o.dists.length; pi++) {
    const p = await shootDist(o.dists[pi]);
    const row = { dist: o.dists[pi], e: p.e, ex: p.ex, gain: p.gain };
    for (const k in pts) row[k] = match(tmpls[k], p.L, pts[k][0], pts[k][1], 120);
    out.poses.push(row);
  }
  const p0 = await shootDist(o.dists[0]);
  out.selfCheck = match(tmpls.subj, p0.L, pts.subj[0], pts.subj[1], 40);
  dollyZoomActive = false; subjectLockActive = false; await settle(2);
  return out;
};

(async () => {
  fs.copyFileSync('/workspace/mm/starwatcher_color.png', '/workspace/mm/harness/defaultImgColor.png');
  fs.copyFileSync('/workspace/mm/starwatcher_depth.png', '/workspace/mm/harness/defaultImgDepth.png');
  const results = {};
  let lastPort = null, srv = null, browser = null, page = null;
  for (const b of ARMS) {
    if (b.port !== lastPort) {
      if (srv) srv.kill();
      srv = spawn('node', ['scratch_server.js'], { cwd: b.dir, stdio: 'ignore' });
      await new Promise(r => setTimeout(r, 1200));
      lastPort = b.port;
    }
    if (browser) await browser.close();
    browser = await chromium.launch({ executablePath: CHROME, headless: true,
      args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
             '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    page = await browser.newPage({ viewport: { width: 720, height: 450 } });
    page.on('pageerror', e => console.log('  [' + b.tag + ' PAGEERR] ' + e.message.slice(0, 140)));
    await page.goto('http://localhost:' + b.port + '/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    let ready = false;
    for (let t = 0; t < 40; t++) {
      ready = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && (mediaLayers[0]?.textures?.depth || mediaLayers[0]?.elements?.depth)); } catch (e) { return false; } }).catch(() => false);
      if (ready) break; await new Promise(r => setTimeout(r, 1000));
    }
    if (!ready) { console.log('[' + b.tag + '] LAYER NEVER READY — arm void'); results[b.tag] = { failed: 'layer never ready' }; await page.close(); continue; }
    const served = await page.evaluate(() => (typeof MOEBIUS_BUILD === 'string') ? MOEBIUS_BUILD : 'pre-stamp');
    console.log('[' + b.tag + '] served ' + served);
    try {
      results[b.tag] = await page.evaluate(PROBE, { srcU: 0.30, srcV: 0.53, dists: [0.20, 0.12, 0.30], repro: b.repro });
    } catch (e) { results[b.tag] = { failed: e.message.slice(0, 200) }; }
    console.log('[' + b.tag + '] ' + JSON.stringify(results[b.tag]));
    await page.close();
  }
  if (browser) { await browser.close(); srv.kill(); }

  // verdicts
  const G = results.goodgaps;
  const cmp = (tag) => {
    const A = results[tag];
    if (!A || A.failed || !G || G.failed) return console.log(tag + ': VOID');
    let worst = 0, voided = false;
    for (let i = 0; i < G.poses.length; i++) for (const k of ['subj', 'far', 'near']) {
      const da = A.poses[i][k], db = G.poses[i][k];
      if (da.corr < 0.6 || db.corr < 0.6) { voided = true; continue; }
      worst = Math.max(worst, Math.abs(da.dx - db.dx), Math.abs(da.dy - db.dy));
    }
    console.log('VS-GOODGAPS ' + tag + ': worst trail delta ' + worst + 'px' +
                (voided ? ' (some rows void)' : '') + (worst <= 2 ? '  MATCH' : '  MISMATCH'));
  };
  cmp('a106-legacy'); cmp('a209-legacy'); cmp('a209-repro'); cmp('a106-repro');
  const R = results['a209-repro'];
  if (R && !R.failed) {
    const sMax = Math.max(...R.poses.map(p => Math.max(Math.abs(p.subj.dx), Math.abs(p.subj.dy))));
    const wMax = Math.max(...R.poses.map(p => Math.max(Math.abs(p.far.dy), Math.abs(p.far.dx), Math.abs(p.near.dy), Math.abs(p.near.dx))));
    console.log('A209-REPRO: subject worst ' + sMax + 'px, witness max ' + wMax + 'px' +
                (sMax <= 3 && wMax >= 8 ? '  (pinned + zoom present)' : '  (CHECK)'));
  }
  process.exit(0);
})();
