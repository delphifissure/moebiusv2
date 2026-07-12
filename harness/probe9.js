// FG-only depth crop at the staff, all fixes active.
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
  page.on('console', m => { const t=m.text(); if (/probe9|error/i.test(t)) console.log('  [page]', t); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && fgMarkDilationMaterial && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate(async () => {
    bgMPIFullPlanes=false; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer();
    const shotDepth = (fgOnly) => {
      isSweeping = true;
      camera.position.x = 0; camera.position.y = 0;
      if (bgLayerMesh) bgLayerMesh.visible = !fgOnly;
      renderNormalizedDepthPass();
      renderNormalizedDepthPass();   // render twice: first call may see stale state
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
      // crop screen (240,80)-(390,270), 4x, magenta=void
      const S=4, cw=150, ch=190;
      const c = document.createElement('canvas'); c.width=cw*S; c.height=ch*S;
      const cx = c.getContext('2d'); const id = cx.createImageData(cw*S, ch*S);
      for (let yy=0; yy<ch*S; yy++) for (let xx=0; xx<cw*S; xx++) {
        const sxp = 240 + (xx/S|0), syp = 80 + (yy/S|0);
        const s = ((H-1-syp)*W + sxp)*4, d = (yy*cw*S+xx)*4;
        if (px[s+3] < 128) { id.data[d]=255; id.data[d+1]=0; id.data[d+2]=255; }
        else { const v=px[s]; id.data[d]=v; id.data[d+1]=v; id.data[d+2]=v; }
        id.data[d+3]=255;
      }
      cx.putImageData(id,0,0);
      return c.toDataURL('image/png');
    };
    return { fg: shotDepth(true), both: shotDepth(false) };
  });
  fs.writeFileSync('probe9_fgonly.png', Buffer.from(res.fg.split(',')[1],'base64'));
  fs.writeFileSync('probe9_both.png', Buffer.from(res.both.split(',')[1],'base64'));
  console.log('probe9 done'); await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
