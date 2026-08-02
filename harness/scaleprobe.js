// A204 DOES THE SHADER ACTUALLY READ u_dollyScale?
//
// a203's per-layer inventory showed every shader layer holding u_dollyScale =
// 0.9307 and u_refEye.z = 0.2 while the camera sat at 0.3423 - the correction was
// fully delivered to every layer - and the subject still moved. So the failure is
// NOT plumbing. Two possibilities remain and they need different fixes:
//
//   A. the material HAS the uniform but its vertexShader never reads it (a
//      uniforms object cloned from the same template as the shader I edited,
//      paired with a different shader source), or
//   B. the shader reads it and my projection model is wrong.
//
// One render separates them. Force the scale to an extreme value at a FIXED pose
// and hash the frame. If the hash does not move, nothing is reading it. Doing it
// per material also says exactly WHICH layers respond, which is the per-layer
// answer for the mechanism rather than for the plumbing.
//
// Then, if it does respond, measure the px coefficient directly: two patches at
// the same depth and different x, at two scales. A pure lateral scale about the
// eye axis must move them in proportion to their distance from that axis, and
// the measured ratio is a number my derivation predicts exactly.
//
//   node harness/scaleprobe.js [star|troll|warrior]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const ASSET = process.argv[2] || 'star';
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star: ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };

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
  const served = await page.evaluate(() => (typeof MOEBIUS_BUILD === 'string') ? MOEBIUS_BUILD : null);
  console.log('served build = ' + served);

  const r = await page.evaluate(async () => {
    if (typeof dollySubjectScale === 'undefined') window.dollySubjectScale = 1;
    window._rayReproject = true;
    bgQuickBake = true; bgMPIFullPlanes = false; bgMPIMode = false;
    bgBuildStamp = null; buildBackgroundLayer();
    const W = renderer.domElement.width, Hh = renderer.domElement.height;

    // a FIXED pose, held by isSweeping so nothing rewrites the eye
    isSweeping = true; dollyZoomActive = false; subjectLockActive = false;
    camera.position.set(0.12, 0.0, 0.34);
    updateCameraAndProjection();

    const shot = () => { for (let n = 0; n < 2; n++) render();
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      cv.getContext('2d').drawImage(renderer.domElement, 0, 0, W, Hh);
      const d = cv.getContext('2d').getImageData(0, 0, W, Hh).data;
      const L = new Float32Array(W * Hh);
      for (let i = 0; i < W * Hh; i++) L[i] = 0.299*d[i*4] + 0.587*d[i*4+1] + 0.114*d[i*4+2];
      return L; };
    const hashOf = (L) => { let h = 2166136261 >>> 0;
      for (let i = 0; i < L.length; i++) { h ^= Math.round(L[i]) & 255; h = Math.imul(h, 16777619) >>> 0; }
      return ('00000000' + h.toString(16)).slice(-8); };

    // collect the shader meshes and whether their SOURCE even mentions the uniform
    const mats = [];
    scene.traverse((m) => {
      if (!m.isMesh || !m.visible) return;
      const u = m.material && m.material.uniforms;
      if (!u || !u.u_dollyScale) return;
      const vs = m.material.vertexShader || '';
      mats.push({ mesh: m, u,
                  reads: vs.indexOf('u_dollyScale') >= 0,
                  declares: vs.indexOf('uniform float u_dollyScale') >= 0,
                  tris: (m.geometry && m.geometry.index) ? (m.geometry.index.count/3)|0 : 0 });
    });
    if (!mats.length) return { failed: 'no material carries u_dollyScale (is this an a202-class build?)' };

    const setAll = (v) => { for (const m of mats) m.u.u_dollyScale.value = v; };
    // the app rewrites uniforms every frame from dollySubjectScale, so drive that
    window.dollySubjectScale = 1; setAll(1);
    const hBase = hashOf(shot());
    window.dollySubjectScale = 0.5; setAll(0.5);
    const hHalf = hashOf(shot());
    window.dollySubjectScale = 1; setAll(1);
    const hBack = hashOf(shot());

    // per material: only this one gets the extreme scale
    const per = [];
    for (const target of mats) {
      window.dollySubjectScale = 1; setAll(1);
      // freeze the app's per-frame rewrite by making the value it writes 1, then
      // poke just this material AFTER updateCameraAndProjection has run
      const before = hashOf(shot());
      setAll(1); target.u.u_dollyScale.value = 0.5;
      // one raw render, no updateCameraAndProjection in between, so nothing resets it
      renderPortalFrame();
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      cv.getContext('2d').drawImage(renderer.domElement, 0, 0, W, Hh);
      const d = cv.getContext('2d').getImageData(0, 0, W, Hh).data;
      const L = new Float32Array(W * Hh);
      for (let i = 0; i < W * Hh; i++) L[i] = 0.299*d[i*4] + 0.587*d[i*4+1] + 0.114*d[i*4+2];
      const after = hashOf(L);
      per.push({ tris: target.tris, reads: target.reads, declares: target.declares,
                 changed: before !== after });
      target.u.u_dollyScale.value = 1;
    }
    window.dollySubjectScale = 1; setAll(1);
    isSweeping = false;
    return { hBase, hHalf, hBack, per, W, H: Hh,
             nMats: mats.length, camX: camera.position.x, camZ: camera.position.z };
  });

  if (r.failed) { console.log('*** ' + r.failed); await browser.close(); srv.kill(); process.exit(3); }
  console.log('\nfixed pose  camera x ' + r.camX + '  z ' + r.camZ + '   materials carrying u_dollyScale: ' + r.nMats);
  console.log('\nALL materials at scale 1.0 -> ' + r.hBase);
  console.log('ALL materials at scale 0.5 -> ' + r.hHalf + (r.hHalf !== r.hBase ? '   CHANGED' : '   *** IDENTICAL: nothing reads it ***'));
  console.log('back to 1.0              -> ' + r.hBack + (r.hBack === r.hBase ? '   (restored)' : '   *** NOT restored ***'));
  console.log('\nper material, only that one forced to 0.5:');
  console.log('  ' + 'tris'.padStart(9) + '   declares   reads   frame changed');
  for (const p of r.per)
    console.log('  ' + String(p.tris).padStart(9) + '   ' + String(p.declares).padStart(8) +
                '   ' + String(p.reads).padStart(5) + '   ' + String(p.changed).padStart(13));
  console.log('\n"declares"/"reads" are grep of the material\'s own vertexShader source.');
  console.log('A material that has the uniform, declares it, and still does not change');
  console.log('the frame is one whose geometry the scale cannot reach.');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
