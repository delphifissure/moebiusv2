// A188c: THE STRETCH CUT IS EVALUATED AT ONE RESOLUTION AND CALIBRATED FOR
// ANOTHER.
//
// a188b showed the pass-1 buffer is already ghosted at its own resolution, so
// the defect is in the RENDER, and a188 showed it goes away when that buffer is
// canvas-sized. Something in the shader is therefore sensitive to how many
// pixels the frame is rasterised into. There is exactly one such thing on this
// path, and it discards fragments:
//
//   vec2 jxS = dFdx(vUv), jyS = dFdy(vUv);              // UV per RENDERED PIXEL
//   float uvRate = max(length(jxS), length(jyS));
//   float svMinS = abs(det(jxS,jyS)) / uvRate;          // minor singular value
//   float svRatio = svMinS / u_bandCutUvRate;
//   float svCutProb = clamp(1.0 - (svRatio - 0.2)/0.16, 0.0, 1.0);
//   float svDith = fract(sin(dot(gl_FragCoord.xy, ...)) * 43758.5453);
//   stretched = ... && (uvRate < u_bandCutUvRate || (svCutProb > 0 && svDith < svCutProb));
//
// CORRECTION TO THE FIRST VERSION OF THIS FILE, which claimed the threshold was
// denominated in source texels and therefore had the wrong units outright. It
// does not. It is
//
//   u_bandCutUvRate = bgBandCutStretchFrac / w      // w = the RENDERER's width
//
// and the measured shipped value is 2.6316e-3 = 1/380 against a 380 px canvas
// and a 1920 px source, which settles it. The quantity is correctly denominated
// in rendered pixels and it does track the canvas when the window resizes.
//
// The bug is narrower and entirely the simulated viewer's: pass 1 binds a target
// 1.75x wider and never updates the uniform. Every dFdx in that pass is 1/1.75
// of its canvas value while the threshold still names the canvas, so
//   - `uvRate < u_bandCutUvRate` — an UNDITHERED discard — starts firing on
//     content it was never meant to touch. That is the black wedge.
//   - svRatio drops by 1.75x, svCutProb rises, and the a83 DITHERED band cuts
//     into the figure. A dithered discard is exactly a striped, see-through
//     figure. That is the astronaut.
// One mechanism, both symptoms.
//
// THE ARMS, all at the same 1.75x buffer, differing only in the threshold:
//   A  shipped
//   B  0 — the documented "stretch test off" value
//   C  thr / S — the candidate fix: uvRate shrank by S, so the threshold must
//      shrink by S, and the cut then engages at the same PHYSICAL stretch.
//   D  thr * S — the same correction with the sign reversed.
//
// D IS KEPT BECAUSE IT IS WHAT THIS FILE TESTED FIRST, AND IT NEARLY PASSED.
// Its mean-gradient landed at 5.11 against PLAIN's 5.08 — closer than any other
// arm — while the IMAGE showed it wiping the astronaut to a flat silhouette. A
// scalar agreeing with the reference is not an image agreeing with the
// reference, and the sign of a correction cannot be read off a summary statistic.
//
//   node harness/svcut.js [star|troll|warrior] [quick|v2]
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
const PITCH = [0, 27];

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

    svState.pip = false; svState.showHud = false; svState.falloff = false;
    svState.active = true; svState.pipShowsRaw = false;
    svState.yawDeg = 0; svState.pitchDeg = 0;
    svRenderFrame();
    const S = svState.ss;

    // every material in the scene that carries the cut, so no copy is missed
    const cutMats = [];
    scene.traverse(m => { const u = m.material && m.material.uniforms;
      if (u && u.u_bandCutUvRate) cutMats.push([m.material, u.u_bandCutUvRate.value]); });
    const shipped = cutMats.length ? cutMats[0][1] : null;
    const setCut = (fn) => { for (const [mat, v0] of cutMats) mat.uniforms.u_bandCutUvRate.value = fn(v0); };

    const W = 720, Hh = 450;
    const shot = () => { const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const g = cv.getContext('2d'); g.drawImage(renderer.domElement, 0, 0, W, Hh);
      return { d: g.getImageData(0, 0, W, Hh).data, url: cv.toDataURL('image/png') }; };
    const edge = (d) => { const L = new Float32Array(W*Hh), on = new Uint8Array(W*Hh);
      for (let i = 0; i < W*Hh; i++) { L[i] = 0.299*d[i*4] + 0.587*d[i*4+1] + 0.114*d[i*4+2]; on[i] = d[i*4+3] >= 8 ? 1 : 0; }
      let s = 0, n = 0;
      for (let y = 1; y < Hh-1; y++) for (let x = 1; x < W-1; x++) { const i = y*W+x;
        if (!on[i] || !on[i-1] || !on[i+1] || !on[i-W] || !on[i+W]) continue;
        const gx = L[i+1]-L[i-1], gy = L[i+W]-L[i-W]; s += Math.sqrt(gx*gx+gy*gy); n++; }
      return { e: n ? s/n : 0, L, on };
    };
    const diff = (a, b) => { let s = 0, n = 0, big = 0;
      for (let i = 0; i < W*Hh; i++) { if (!a.on[i] || !b.on[i]) continue;
        const dv = Math.abs(a.L[i]-b.L[i]); s += dv; n++; if (dv > 16) big++; }
      return { mean: +(s/Math.max(1,n)).toFixed(2), big: +(100*big/Math.max(1,n)).toFixed(2) }; };

    const grab = (p) => { svState.pitchDeg = p; svRenderFrame(); svRenderFrame(); return shot(); };

    const urls = {}, rows = [];
    for (const p of o.pitch) {
      setCut(v => v);                     const A = grab(p);
      setCut(() => 0);                    const B = grab(p);
      setCut(() => shipped / S);          const C = grab(p);
      setCut(() => shipped * S);          const D = grab(p);
      setCut(() => shipped);              // restore
      urls['A' + p] = A.url; urls['B' + p] = B.url; urls['C' + p] = C.url; urls['D' + p] = D.url;
      const eA = edge(A.d), eB = edge(B.d), eC = edge(C.d), eD = edge(D.d);
      rows.push({ pitch: p, edgeA: +eA.e.toFixed(2), edgeB: +eB.e.toFixed(2),
                  edgeC: +eC.e.toFixed(2), edgeD: +eD.e.toFixed(2),
                  AB: diff(eA, eB), AC: diff(eA, eC), CB: diff(eC, eB) });
    }

    // the plain path at the same eyes, as the reference
    svState.pitchDeg = 0; svState.active = false; svState.pip = true; svState.showHud = true;
    isSweeping = true;
    for (const p of o.pitch) {
      svState.pitchDeg = p; const E = svEye(); svState.pitchDeg = 0;
      camera.position.set(E.x, E.y, E.z);
      for (let n = 0; n < 3; n++) render();
      const P = shot(); urls['P' + p] = P.url;
      const row = rows.find(q => q.pitch === p); row.edgeP = +edge(P.d).e.toFixed(2);
    }
    camera.position.set(0, 0, 0.2); render();
    return { rows, urls, shipped, ss: S, nMats: cutMats.length };
  }, { pitch: PITCH, mode: MODE });

  const pad = (s, n) => String(s).padStart(n);
  console.log('\n' + ASSET + '/' + MODE + '  pass-1 at ' + r.ss.toFixed(3) + 'x   ' +
    r.nMats + ' material(s) carry u_bandCutUvRate, shipped value ' +
    (r.shipped === null ? 'none' : r.shipped.toExponential(4)));
  console.log('\n  pitch   A shipped   B cut OFF   C thr/' + r.ss.toFixed(2) +
    '   D thr*' + r.ss.toFixed(2) + '   PLAIN  |  A vs B mean/>16   A vs C   C vs B');
  for (const w of r.rows)
    console.log('  ' + pad(w.pitch + '°', 6) + pad(w.edgeA, 12) + pad(w.edgeB, 12) +
      pad(w.edgeC, 12) + pad(w.edgeD, 12) + pad(w.edgeP, 9) + '  |' +
      pad(w.AB.mean + ' / ' + w.AB.big + '%', 18) + pad(w.AC.mean + ' / ' + w.AC.big + '%', 12) +
      pad(w.CB.mean + ' / ' + w.CB.big + '%', 14));
  console.log('\n  u_bandCutUvRate ships as bgBandCutStretchFrac / rendererWidth, so it DOES');
  console.log('  track the canvas — the bug is that pass 1 binds a wider target and leaves the');
  console.log('  uniform on the canvas value. uvRate is UV per rendered pixel and shrinks by S,');
  console.log('  so the threshold must shrink by S too: C = thr/S is the candidate fix.');
  console.log('  D = thr*S is the SAME correction with the sign reversed, kept because the');
  console.log('  first version of this test used it, its edge number landed next to PLAIN, and');
  console.log('  the IMAGE showed it wiping the figure to a silhouette. A scalar agreeing with');
  console.log('  the reference is not the same as an image agreeing with it.');

  for (const k of Object.keys(r.urls)) {
    const tag = { A: 'shipped', B: 'cutoff', C: 'thrdiv', D: 'thrmul', P: 'plain' }[k[0]];
    fs.writeFileSync(path.join(H, 'svcut_' + ASSET + '_' + MODE + '_p' + k.slice(1) + '_' + tag + '.png'),
      Buffer.from(r.urls[k].split(',')[1], 'base64'));
  }
  console.log('\n  wrote harness/svcut_' + ASSET + '_' + MODE + '_p*_{shipped,cutoff,rescaled,plain}.png');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
