// Visual bisect: FG-only depth image, untorn mesh, baked vs raw texture.
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
  page.on('console', m => { const t=m.text(); if (/probe8|error/i.test(t)) console.log('  [page]', t); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && fgMarkDilationMaterial && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate(async () => {
    const L = mediaLayers[0];
    bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer();
    const fgDepthImage = () => {
      isSweeping = true;
      camera.position.x = 0; camera.position.y = 0;
      if (bgLayerMesh) bgLayerMesh.visible = false;
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
      const c = document.createElement('canvas'); c.width=W; c.height=H;
      const cx = c.getContext('2d'); const id = cx.createImageData(W,H);
      for (let yy=0; yy<H; yy++) for (let xx=0; xx<W; xx++) {
        const s=((H-1-yy)*W+xx)*4, d=(yy*W+xx)*4;
        if (px[s+3] < 128) { id.data[d]=255; id.data[d+1]=0; id.data[d+2]=255; }
        else { const v=px[s]; id.data[d]=v; id.data[d+1]=v; id.data[d+2]=v; }
        id.data[d+3]=255;
      }
      cx.putImageData(id,0,0);
      return c.toDataURL('image/png');
    };
    // untorn: restore stashed full index
    const g = L.mesh.geometry;
    const restored = !!g.userData._fullIndex;
    if (restored) g.setIndex(new THREE.BufferAttribute(g.userData._fullIndex, 1));
    const untornBaked = fgDepthImage();
    // raw texture
    const rawImg = await new Promise(r => { const i = new Image(); i.onload=()=>r(i); i.src='defaultImgDepth.png'; });
    const rawTex = new THREE.Texture(rawImg); rawTex.needsUpdate = true;
    L.mesh.material.uniforms.displacementMap.value = rawTex;
    const untornRaw = fgDepthImage();
    return { restored, untornBaked, untornRaw };
  });
  fs.writeFileSync('probe8_untorn_baked.png', Buffer.from(res.untornBaked.split(',')[1],'base64'));
  fs.writeFileSync('probe8_untorn_raw.png', Buffer.from(res.untornRaw.split(',')[1],'base64'));
  console.log('PROBE8 restored:', res.restored);
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
