// Bisect the rest-state depth holes at the head/staff: tear? bake? mesh?
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('console', m => { const t=m.text(); if (/RUNG|probe3|error/i.test(t)) console.log('  [page]', t); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && fgMarkDilationMaterial && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate(async () => {
    const out = {};
    const holeCount = () => {
      isSweeping = true;
      camera.position.x = 0; camera.position.y = 0;
      if (bgLayerMesh) bgLayerMesh.visible = false;   // FG only
      renderNormalizedDepthPass();
      if (bgLayerMesh) bgLayerMesh.visible = true;
      const rt = screenNormalizedDepthTarget, W = rt.width, H = rt.height;
      const tmpRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat });
      const q = postProcessScene.children[0]; const prev = q.material;
      q.material = copyMaterial; copyMaterial.uniforms.tDiffuse.value = rt.texture;
      renderer.setRenderTarget(tmpRT); renderer.setViewport(0,0,W,H); renderer.clear();
      renderer.render(postProcessScene, postProcessCamera);
      const px = new Uint8Array(W*H*4);
      renderer.readRenderTargetPixels(tmpRT, 0, 0, W, H, px);
      renderer.setRenderTarget(null); q.material = prev; tmpRT.dispose();
      // head/staff region on screen at 860x484: x 230-360, y 120-300 (GL y-flip)
      let holes = 0;
      for (let y = 120; y < 300; y++) for (let x = 230; x < 360; x++) {
        const gy = H - 1 - y; if (px[(gy*W+x)*4+3] < 128) holes++;
      }
      return holes;
    };
    const L = mediaLayers[0];
    // (a) current build
    bgMPIFullPlanes=false; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer();
    out.a_current = holeCount();
    // (b) untorn mesh: restore full index, no re-tear
    fgPreTear = false;
    if (L.mesh.geometry.userData._fullIndex) {
      L.mesh.geometry.setIndex(new THREE.BufferAttribute(L.mesh.geometry.userData._fullIndex, 1));
    }
    out.b_untorn = holeCount();
    // (c) untorn + RAW depth texture (bypass bake/halo)
    const rawImg = await new Promise(r => { const i = new Image(); i.onload=()=>r(i); i.src='defaultImgDepth.png'; });
    const rawTex = new THREE.Texture(rawImg); rawTex.needsUpdate = true;
    L.textures.depth = rawTex;
    L.mesh.material.uniforms.displacementMap.value = rawTex;
    out.c_untorn_raw = holeCount();
    return out;
  });
  console.log('PROBE3', JSON.stringify(res));
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
