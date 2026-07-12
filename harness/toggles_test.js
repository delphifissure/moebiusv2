// Debug toggles + depth-pass classification under v2 (and v1 solo fix)
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('pageerror', e => console.log('PAGEERR', String(e).slice(0,200)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  await page.evaluate(() => { bgMPIFullPlanes = true; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer(); });
  await page.waitForTimeout(400);
  // depth pass FG coverage under v2 (was 0 before the fix)
  const cov = await page.evaluate(() => {
    if (typeof _depthPassIncludeBG !== 'undefined') _depthPassIncludeBG = false;
    renderNormalizedDepthPass();
    const rt = screenNormalizedDepthTarget, W = rt.width, H = rt.height;
    const tmpRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat });
    const q = postProcessScene.children[0]; const prev = q.material;
    q.material = copyMaterial; copyMaterial.uniforms.tDiffuse.value = rt.texture;
    renderer.setRenderTarget(tmpRT); renderer.setViewport(0,0,W,H); renderer.clear();
    renderer.render(postProcessScene, postProcessCamera);
    const px = new Uint8Array(W*H*4);
    renderer.readRenderTargetPixels(tmpRT, 0, 0, W, H, px);
    renderer.setRenderTarget(null); q.material = prev; tmpRT.dispose();
    let n = 0; for (let i = 0; i < W*H; i++) if (px[i*4+3] >= 128) n++;
    return { covered: n, total: W*H };
  });
  console.log('v2 depth-pass FG coverage:', JSON.stringify(cov));
  // toggles: solo on (hide nearest primary bin), show-bg off (flat view)
  const shot = async (name) => {
    const d = await page.evaluate(async () => {
      isSweeping = true; camera.position.x = 0.123; camera.position.y = -0.055;
      await new Promise(res => { let n=0; const tick=()=>{ camera.position.x=0.123; camera.position.y=-0.055; n++; n<5?requestAnimationFrame(tick):res(); }; requestAnimationFrame(tick); });
      return document.getElementById('canvas').toDataURL('image/png');
    });
    fs.writeFileSync(name, Buffer.from(d.split(',')[1], 'base64'));
  };
  await page.evaluate(() => {
    let maxR = -1;
    for (const m of mpiFullMeshes) if (m.userData.v2tag === 'L0' && m.userData.v2rank > maxR) maxR = m.userData.v2rank;
    for (const m of mpiFullMeshes) if (m.userData.v2tag === 'L0' && m.userData.v2rank === maxR) m.visible = false;
  });
  await shot('tg_solo.png');
  await page.evaluate(() => {
    for (const m of mpiFullMeshes) m.visible = false;
    for (const Lx of mediaLayers) if (Lx.mesh) Lx.mesh.visible = true;
  });
  await shot('tg_flat.png');
  await page.evaluate(() => {
    for (const m of mpiFullMeshes) m.visible = true;
    for (const Lx of mediaLayers) if (Lx.mesh) Lx.mesh.visible = false;
  });
  console.log('done');
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
