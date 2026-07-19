// A80 calibration: measure the ACTUAL px shift per unit depth at the fade
// cone's edge offsets, from the projection math itself (no rendering).
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/arc73';
const H = path.join(WT, 'harness');
fs.copyFileSync(path.join(WT, 'starwatcher_color.png'), path.join(H, 'defaultImgColor.png'));
fs.copyFileSync(path.join(WT, 'starwatcher_depth.png'), path.join(H, 'defaultImgDepth.png'));
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 933, height: 525 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 140)));
  await page.goto('http://localhost:8099/fp_test.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
  await page.evaluate(() => {
    window._bgQuickBaked = false;
    const s = document.getElementById('bgModeSel');
    if (s) { s.value = 'quick'; s.dispatchEvent(new Event('change')); }
    document.getElementById('bgLayerBuildBtn').click();
  });
  await page.waitForFunction(() => window._bgQuickBaked === true, null, { timeout: 480000, polling: 2000 });
  await page.evaluate(async () => { isSweeping = true;
    await new Promise(r2 => { let n = 0; const tick = () => { camera.position.set(0, 0, 0.2); n++; n < 4 ? requestAnimationFrame(tick) : r2(); }; requestAnimationFrame(tick); });
    render(); });
  const cal = await page.evaluate(() => {
    const L = mediaLayers[0];
    const mesh = L.mesh;
    const u = mesh.material.uniforms;
    const dkeys = {};
    for (const k in u) if (/displ|depth|scale|bias/i.test(k)) { const v = u[k].value; if (typeof v === 'number') dkeys[k] = v; }
    const dispScale = u.displacementScale ? u.displacementScale.value : 0;
    const dispBias = u.displacementBias ? u.displacementBias.value : 0;
    const meshZ = mesh.position.z;
    const zAt = (d) => meshZ + (d * dispScale + dispBias) * (mesh.scale.z || 1);
    const W = renderer.domElement.width;
    const projX = (wx, wz, cam) => {
      const v = new THREE.Vector4(wx, 0, wz, 1);
      camera.position.set(cam, 0, 0.2); camera.updateMatrixWorld(true);
      camera.updateProjectionMatrix();
      const m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      v.applyMatrix4(m);
      return (v.x / v.w * 0.5 + 0.5) * W;
    };
    const out = { dkeys, dispScale, dispBias, meshZ, meshScaleZ: mesh.scale.z, portalZ: (typeof portalPlaneWorldZ !== 'undefined') ? portalPlaneWorldZ : null, W, results: {} };
    for (const off of [0.14, 0.2, 0.3]) {
      const x0 = projX(0, zAt(0), off);
      const x1 = projX(0, zAt(1), off);
      out.results['off' + off] = +(x1 - x0).toFixed(1);   // px shift per unit depth
    }
    // bake-space pw for conversion
    out.pw = L.textures.depth && L.textures.depth.image ? L.textures.depth.image.width : null;
    return out;
  });
  console.log('CALIB ' + JSON.stringify(cal));
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
