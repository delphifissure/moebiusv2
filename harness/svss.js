// A188: THE SIMULATED VIEWER GHOSTS THE FOREGROUND AT REST, AND THE NUMBERS
// COULD NOT SEE IT.
//
// a187's contact sheet: at pitch 0 — the REST pose, same eye as the plain path —
// PLAIN draws the astronaut solid and opaque, while the SV's own pass-1 buffer
// (RAW, drawn flat, no pass-2 warp) draws him TRANSLUCENT and horizontally
// striped, with the ice mountain visible through his body. The dune party goes
// the same way. That is the user's report exactly, and it is present with the
// eye at the origin.
//
// MY OWN TABLE REPORTED 0.00 THERE, and the reason is worth writing down: every
// arm was scored against ITS OWN rest frame. RAW's rest frame is already ghosted,
// so a ghost that is present at every pose registers as no change at any pose.
// A self-referential metric cannot see a constant defect. The sheet could.
//
// THE HYPOTHESIS. Pass 1 does not render at canvas resolution: svEnsure builds
// the offscreen buffer at SV_SUPERSAMPLE = 1.75x linear and patches setViewport
// to scale by the same factor. Every OTHER buffer in the portal pipeline is
// sized to the CANVAS by onWindowResize, and any shader that recovers a
// screen-space UV from gl_FragCoord divided by a canvas-sized resolution will
// therefore sample at 1/1.75 of where it should. A misaligned screen-space
// composite is exactly how a solid figure becomes a striped, see-through one.
//
// THE PREDICTION, which is what makes this a test rather than a story: rebuild
// the pass-1 buffer at EXACTLY canvas size (ss = 1) and the ghosting must go. If
// the two arms look the same, the supersample is innocent and the cause is
// elsewhere in pass 1.
//
// The arms differ only in buffer resolution, so a correct pipeline would differ
// only by resampling blur — a few luma levels, spread evenly. A ghost is a large
// difference concentrated on one object, which is why the bounding box of the
// top-1% difference is reported: if the supersample is the cause, that box lands
// on the astronaut, not on the whole frame.
//
//   node harness/svss.js [star|troll|warrior] [quick|v2]
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
const PITCH = [0, 20, 27];

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
  page.on('console', m => { const t = m.text(); if (/\[SV\] a130 pass-1 buffer/.test(t)) console.log('  ' + t); });
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
    const W = 720, Hh = 450;
    const shot = () => { const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const g = cv.getContext('2d'); g.drawImage(renderer.domElement, 0, 0, W, Hh);
      return { d: g.getImageData(0, 0, W, Hh).data, url: cv.toDataURL('image/png') }; };
    const luma = (d) => { const L = new Float32Array(W*Hh), on = new Uint8Array(W*Hh);
      for (let i = 0; i < W*Hh; i++) { L[i] = 0.299*d[i*4] + 0.587*d[i*4+1] + 0.114*d[i*4+2]; on[i] = d[i*4+3] >= 8 ? 1 : 0; }
      return { L, on }; };
    const edge = (L, on) => { let s = 0, n = 0;
      for (let y = 1; y < Hh-1; y++) for (let x = 1; x < W-1; x++) { const i = y*W+x;
        if (!on[i] || !on[i-1] || !on[i+1] || !on[i-W] || !on[i+W]) continue;
        const gx = L[i+1] - L[i-1], gy = L[i+W] - L[i-W];
        s += Math.sqrt(gx*gx + gy*gy); n++; }
      return n ? s/n : 0; };

    svState.pip = false; svState.showHud = false; svState.falloff = false;
    svState.yawDeg = 0; svState.pitchDeg = 0;

    // ---- arm A: the shipped buffer ----
    svState.active = true; svState.pipShowsRaw = false;   // main view = drawRaw
    svRenderFrame();                                       // builds rt at SV_SUPERSAMPLE
    const ssA = svState.ss, rtA = svState.rt.width + 'x' + svState.rt.height;

    const armShots = {};
    const grabRaw = (p) => { svState.pitchDeg = p; svRenderFrame(); svRenderFrame(); return shot(); };
    for (const p of o.pitch) armShots['A' + p] = grabRaw(p);

    // ---- arm B: the SAME buffer at exactly canvas size ----
    // Only the resolution changes. Everything else — eye, lens, quad, uniforms —
    // is untouched, so any difference beyond resampling blur is the supersample.
    const cw = renderer.domElement.width, ch = renderer.domElement.height;
    svState.rt.dispose();
    svState.rt = new THREE.WebGLRenderTarget(cw, ch, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, stencilBuffer: false, depthBuffer: true });
    svState.ss = 1;
    svState.mat.uniforms.tPass1.value = svState.rt.texture;
    const ssB = svState.ss, rtB = svState.rt.width + 'x' + svState.rt.height;
    for (const p of o.pitch) armShots['B' + p] = grabRaw(p);

    svState.pitchDeg = 0; svState.active = false; svState.pip = true; svState.showHud = true;

    // ---- the plain path at the same eyes, for the picture ----
    isSweeping = true;
    const eyes = {};
    for (const p of o.pitch) { svState.pitchDeg = p; const E = svEye(); eyes[p] = { x: E.x, y: E.y, z: E.z }; }
    svState.pitchDeg = 0;
    for (const p of o.pitch) {
      const E = eyes[p]; camera.position.set(E.x, E.y, E.z);
      for (let n = 0; n < 3; n++) render();
      armShots['P' + p] = shot();
    }
    camera.position.set(0, 0, 0.2); render();

    const rows = [];
    for (const p of o.pitch) {
      const a = luma(armShots['A' + p].d), b = luma(armShots['B' + p].d);
      const diffs = [];
      let sum = 0, n = 0, big = 0;
      for (let i = 0; i < W*Hh; i++) {
        if (!a.on[i] || !b.on[i]) continue;
        const dv = Math.abs(a.L[i] - b.L[i]); sum += dv; n++; if (dv > 16) big++;
        diffs.push(dv);
      }
      diffs.sort((x, y) => x - y);
      const thr = diffs.length ? diffs[Math.floor(diffs.length * 0.99)] : 0;
      let x0 = W, x1 = -1, y0 = Hh, y1 = -1;
      for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) { const i = y*W+x;
        if (!a.on[i] || !b.on[i]) continue;
        if (Math.abs(a.L[i] - b.L[i]) < thr) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const pl = luma(armShots['P' + p].d);
      rows.push({ pitch: p,
        meanAbs: +(sum / Math.max(1, n)).toFixed(2),
        bigPct: +(100 * big / Math.max(1, n)).toFixed(2),
        box: x1 < 0 ? '-' : (x0 + '..' + x1 + ', ' + y0 + '..' + y1),
        edgeA: +edge(a.L, a.on).toFixed(2), edgeB: +edge(b.L, b.on).toFixed(2),
        edgeP: +edge(pl.L, pl.on).toFixed(2) });
    }
    const urls = {};
    for (const k of Object.keys(armShots)) urls[k] = armShots[k].url;
    return { rows, ssA, ssB, rtA, rtB, urls };
  }, { pitch: PITCH, mode: MODE });

  const pad = (s, n) => String(s).padStart(n);
  console.log('\n' + ASSET + '  mode=' + MODE + '  —  SV pass-1 buffer at ' + r.ssA.toFixed(3) +
    'x (' + r.rtA + ')  vs  1.000x (' + r.rtB + ')');
  console.log('\n  pitch   mean |dLuma|   >16 levels   box of the top-1% difference   edge A    edge B    edge PLAIN');
  for (const w of r.rows)
    console.log('  ' + pad(w.pitch + '°', 6) + pad(w.meanAbs, 14) + pad(w.bigPct + '%', 13) +
      pad(w.box, 32) + pad(w.edgeA, 9) + pad(w.edgeB, 10) + pad(w.edgeP, 13));
  console.log('\n  Arms differ ONLY in the pass-1 buffer resolution. A correct pipeline would');
  console.log('  differ by resampling blur alone — small, and spread over the whole frame.');
  console.log('  edge PLAIN is the ordinary path at the same eye: whichever arm sits closer to');
  console.log('  it is the one rendering the scene the portal actually built.');

  for (const k of Object.keys(r.urls)) {
    const tag = k[0] === 'A' ? 'ss' + r.ssA.toFixed(2) : (k[0] === 'B' ? 'ss1' : 'plain');
    const f = path.join(H, 'svss_' + ASSET + '_' + MODE + '_p' + k.slice(1) + '_' + tag + '.png');
    fs.writeFileSync(f, Buffer.from(r.urls[k].split(',')[1], 'base64'));
  }
  console.log('\n  wrote frames to harness/svss_' + ASSET + '_' + MODE + '_p*_{ss*,plain}.png');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
