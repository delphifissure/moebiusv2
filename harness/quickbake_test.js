// A36 QUICK BAKE contract: sub-second CPU side, plate + all-viewpoint
// disocclusion mask + one-shot wash exist, stretch net armed on both
// surfaces, SD-region highlight toggles the uniforms, and the wash
// target actually carries paint. State-level (frameless) + one visual.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const logs = [];
  page.on('console', m => { const t = m.text(); if (/QUICK-BAKE/.test(t)) logs.push(t); });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate(() => {
    bgQuickBake = true;
    const t0 = performance.now();
    const ok = buildBackgroundLayer();
    const cpuMs = Math.round(performance.now() - t0);
    // wash readback: bgColorTarget must carry paint
    const W = bgColorTarget.width, H = bgColorTarget.height;
    const tmpRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat });
    const q = postProcessScene.children[0]; const prev = q.material;
    q.material = copyMaterial; copyMaterial.uniforms.tDiffuse.value = bgColorTarget.texture;
    renderer.setRenderTarget(tmpRT); renderer.setViewport(0, 0, W, H); renderer.clear();
    renderer.render(postProcessScene, postProcessCamera);
    const px = new Uint8Array(W * H * 4);
    renderer.readRenderTargetPixels(tmpRT, 0, 0, W, H, px);
    renderer.setRenderTarget(null); q.material = prev; tmpRT.dispose();
    let lit = 0, sum = 0;
    for (let i = 0; i < W * H; i++) { const l = px[i*4] + px[i*4+1] + px[i*4+2]; sum += l; if (l > 20) lit++; }
    const mu = bgLayerMesh ? bgLayerMesh.material.uniforms : null;
    const fu = mediaLayers[0].mesh.material.uniforms;
    // highlight toggle (checkbox listener path) + one real render with the
    // highlight ON so the injected GLSL actually compiles
    const chk = document.getElementById('sdRegionsChk');
    chk.checked = true; chk.dispatchEvent(new Event('change'));
    const hlOn = { plate: mu ? mu.u_sdHighlight.value : null, fg: fu.u_sdHighlight.value };
    let renderErr = null;
    try { useInpainting = false; render(); useInpainting = true; } catch (e) { renderErr = String(e).slice(0, 160); }
    chk.checked = false; chk.dispatchEvent(new Event('change'));
    const hlOff = { plate: mu ? mu.u_sdHighlight.value : null, fg: fu.u_sdHighlight.value };
    return {
      ok: ok !== false, cpuMs,
      plate: !!bgLayerMesh,
      maskTex: !!window._sdMaskTex,
      maskBound: mu ? (mu.u_sdMask.value === window._sdMaskTex) : false,
      plateSolid: mu ? (mu.u_useBandCut.value === false && mu.u_useDepthGrad.value === false) : false,
      netFG: fu.u_useBandCut.value === true && fu.u_bandCutAll.value === true,
      washLitPct: +(lit / (W * H) * 100).toFixed(1), washMean: +(sum / (W * H * 3)).toFixed(1),
      hlOn, hlOff, renderErr,
      srcVisible: mediaLayers[0].mesh.visible,
      quickFlag: !!window._bgQuickBaked,
    };
  });
  console.log(JSON.stringify(res, null, 1));
  console.log(logs[0] || '(no quick-bake log)');
  const checks = [
    ['build returned true',           res.ok],
    ['CPU side under 6s (SwiftShader box; sub-second on a real GPU)', res.cpuMs < 6000],
    ['plate mesh exists',             res.plate],
    ['disocclusion mask exists+bound', res.maskTex && res.maskBound],
    ['plate renders solid (all discards off)', res.plateSolid],
    ['stretch net armed on FG',       res.netFG],
    ['wash carries paint',            res.washLitPct > 50],
    ['highlight toggles on',          res.hlOn.plate === true && res.hlOn.fg === true],
    ['highlight render compiles',     !res.renderErr],
    ['highlight toggles off',         res.hlOff.plate === false && res.hlOff.fg === false],
    ['source stays visible',          res.srcVisible === true],
    ['single-pass flag set',          res.quickFlag === true],
  ];
  let pass = true;
  for (const [n, ok] of checks) { console.log((ok ? 'OK  ' : 'FAIL'), n); if (!ok) pass = false; }
  if (errs.length) console.log('PAGEERRORS:', errs.slice(0, 5));
  console.log(pass ? 'ALL CHECKS PASS' : 'CHECKS FAILED');
  await browser.close(); srv.kill();
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
