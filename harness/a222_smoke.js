// A222 rollback smoke: one baked capture on the restored build — the shipped
// tear must reproduce the known C-arm numbers (gap 99907, boundary 3769).
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = process.env.WT || '/workspace/mm', H = path.join(WT, 'harness');
const POSE = { x: 0.100, y: -0.023, z: 0.200 };

(async () => {
  fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
  page.on('console', m => { const t = m.text();
    if (t.includes('[QUICK-BAKE]') || t.includes('[BUILD]')) console.log('  [page] ' + t.slice(0, 120)); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 45; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  const r = await page.evaluate(async (pose) => {
    window._rayReproject = true;
    bgQuickBake = true; buildBackgroundLayer();
    isSweeping = true;
    camera.position.set(pose.x, pose.y, pose.z);
    updateCameraAndProjection(); render(); render();
    renderNormalizedDepthPass();
    const thrR = parseFloat(document.getElementById('fgSubThresholdSlider')?.value || '0.05');
    try { runFGSubtraction(pingPongRenderTargetB?.texture || null, true, thrR); } catch (e) {}
    const hiddenBG = [];
    scene.traverse((m) => {
      if (!m.isMesh || !m.visible) return;
      const u = m.material && m.material.uniforms;
      if (u && u.u_isBackgroundLayer && u.u_isBackgroundLayer.value && !m.userData.v2Plane) { hiddenBG.push(m); m.visible = false; }
    });
    for (const un of ['u_useDepthGrad','u_useSobel','u_useLuma','u_useChroma','u_useCrease','u_useCurvature','u_useUVStretch','u_useGrazingAngle','u_useEdgeMask'])
      setAllLayerUniforms(un, false);
    const prevRT = renderer.getRenderTarget();
    renderer.setClearColor(new THREE.Color(0, 0, 0), 0.0);
    renderer.setRenderTarget(pingPongRenderTargetB); renderer.clear();
    renderer.render(scene, camera);
    const W = pingPongRenderTargetB.width, Hh = pingPongRenderTargetB.height;
    const isFloat = pingPongRenderTargetB.texture.type === THREE.FloatType || pingPongRenderTargetB.texture.type === THREE.HalfFloatType;
    const buf = isFloat ? new Float32Array(W * Hh * 4) : new Uint8Array(W * Hh * 4);
    renderer.readRenderTargetPixels(pingPongRenderTargetB, 0, 0, W, Hh, buf);
    renderer.setRenderTarget(prevRT);
    for (const m of hiddenBG) m.visible = true;
    const thr = isFloat ? 0.03 : 8;
    let n = 0, border = 0;
    const mask = new Uint8Array(W * Hh);
    for (let i = 0; i < W * Hh; i++) mask[i] = buf[i*4+3] < thr ? 1 : 0;
    for (let y = 1; y < Hh - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y*W + x; if (!mask[i]) continue; n++;
      if (!mask[i-1] || !mask[i+1] || !mask[i-W] || !mask[i+W]) border++;
    }
    // SD mask checksum: the demand mask must be byte-identical across builds
    let sdSum = 0, sdN = 0;
    try {
      const mTex = bgLayerMesh.material.uniforms.u_sdMask.value;
      const md = mTex.image.data; sdN = md.length;
      for (let i = 0; i < md.length; i++) sdSum += md[i] >= 0.5 ? 1 : 0;
    } catch (e) {}
    return { n, border, sdSum, sdN };
  }, POSE);
  console.log('baked gap px=' + r.n + '  boundary px=' + r.border + '  (shipped reference: 99907 / 3769)');
  console.log('SD mask texels=' + r.sdSum + ' of ' + r.sdN);
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
