// A50 PROBE: one session — quick bake, then (1) BG-solo render, (2) the
// EXACT texture bound as the plate's map (read back through copyMaterial),
// (3) bgColorTarget readback, (4) identity + uniform state report.
// argv[2]='star'|'troll', argv[3]=out dir.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const OUT = process.argv[3] || '.';
if (process.argv[2] === 'star') {
  fs.copyFileSync('../starwatcher_color.png', 'defaultImgColor.png');
  fs.copyFileSync('../starwatcher_depth.png', 'defaultImgDepth.png');
} else {
  fs.copyFileSync('../defaultImgColor.png', 'defaultImgColor.png');
  fs.copyFileSync('../defaultImgDepth.png', 'defaultImgDepth.png');
}
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate(async () => {
    bgQuickBake = true;
    buildBackgroundLayer();
    const dumpTex = (tex, W, H) => {
      const tmpRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat });
      const q = postProcessScene.children[0]; const prev = q.material;
      q.material = copyMaterial; copyMaterial.uniforms.tDiffuse.value = tex;
      renderer.setRenderTarget(tmpRT); renderer.setViewport(0, 0, W, H); renderer.clear();
      renderer.render(postProcessScene, postProcessCamera);
      const px = new Uint8Array(W * H * 4);
      renderer.readRenderTargetPixels(tmpRT, 0, 0, W, H, px);
      renderer.setRenderTarget(null); q.material = prev; tmpRT.dispose();
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const cx = c.getContext('2d');
      const id = cx.createImageData(W, H);
      for (let y = 0; y < H; y++) { const s = y * W * 4, d = (H - 1 - y) * W * 4;
        for (let x = 0; x < W * 4; x++) id.data[d + x] = px[s + x]; }
      for (let i = 3; i < id.data.length; i += 4) id.data[i] = 255;
      cx.putImageData(id, 0, 0);
      return c.toDataURL('image/png');
    };
    const mu = bgLayerMesh.material.uniforms;
    const mapTex = (mu.map && mu.map.value) || bgLayerMesh.material.map || null;
    const isBgTarget = !!(mapTex && bgColorTarget && mapTex === bgColorTarget.texture);
    const mapInfo = mapTex ? {
      isBgColorTarget: isBgTarget,
      isDataTexture: !!mapTex.isDataTexture,
      isCanvasTexture: !!mapTex.isCanvasTexture,
      imgW: mapTex.image && (mapTex.image.width || mapTex.image.videoWidth) || null,
      imgH: mapTex.image && (mapTex.image.height || mapTex.image.videoHeight) || null,
    } : null;
    // dump the ACTUAL bound map at its own size (or canvas size for RT textures)
    const mw = (mapInfo && mapInfo.imgW) || bgColorTarget.width;
    const mh = (mapInfo && mapInfo.imgH) || bgColorTarget.height;
    const mapPng = mapTex ? dumpTex(mapTex, Math.min(mw, 2048), Math.min(mh, 2048)) : null;
    const washPng = dumpTex(bgColorTarget.texture, bgColorTarget.width, bgColorTarget.height);
    // uniform state of the plate at render time
    const st = {};
    for (const k of ['u_useBandCut','u_bandCutAll','u_useDepthGrad','u_useLuma','u_useSobel','u_sdHighlight'])
      if (mu[k]) st[k] = mu[k].value;
    // BG-solo render
    for (const Lx of mediaLayers) if (Lx.mesh) Lx.mesh.visible = false;
    isSweeping = true;
    await new Promise(r2 => { let n = 0; const tick = () => {
      camera.position.x = 0.064; camera.position.y = 0.065; camera.position.z = 0.2;
      n++; n < 8 ? requestAnimationFrame(tick) : r2(); }; requestAnimationFrame(tick); });
    render();
    const solo = renderer.domElement.toDataURL('image/png');
    return { mapInfo, st, mapPng, washPng, solo,
      washW: bgColorTarget.width, washH: bgColorTarget.height };
  });
  fs.writeFileSync(OUT + '/pm_solo.png', Buffer.from(res.solo.split(',')[1], 'base64'));
  if (res.mapPng) fs.writeFileSync(OUT + '/pm_map.png', Buffer.from(res.mapPng.split(',')[1], 'base64'));
  fs.writeFileSync(OUT + '/pm_wash.png', Buffer.from(res.washPng.split(',')[1], 'base64'));
  console.log(JSON.stringify({ mapInfo: res.mapInfo, st: res.st, washW: res.washW, washH: res.washH }));
  await browser.close(); srv.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
