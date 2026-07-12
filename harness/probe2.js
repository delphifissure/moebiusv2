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
  page.on('console', m => { const t=m.text(); if (/RUNG-A|RUNG-PLUG|error/i.test(t)) console.log('  [page]',t); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && fgMarkDilationMaterial && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  await page.evaluate(() => { bgMPIFullPlanes=false; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer(); });
  await page.waitForTimeout(500);
  const out = await page.evaluate(async () => {
    const L = mediaLayers[0];
    const raw = await new Promise(r => { const i = new Image(); i.onload=()=>r(i); i.src='defaultImgDepth.png'; });
    const baked = L.textures.depth.image;
    const W = raw.width, H = raw.height, N = W*H;
    const cv = document.createElement('canvas'); cv.width=W; cv.height=H;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(raw,0,0,W,H); const rp = cx.getImageData(0,0,W,H).data;
    cx.clearRect(0,0,W,H); cx.drawImage(baked,0,0,W,H); const bp = cx.getImageData(0,0,W,H).data;
    // cliff-diff mask at half res: red where |baked-raw|>0.06 (baked farther), green where baked nearer
    const hw = W>>1, hh = H>>1;
    const m = document.createElement('canvas'); m.width=hw; m.height=hh;
    const mx = m.getContext('2d'); const id = mx.createImageData(hw,hh);
    for (let y=0;y<hh;y++) for (let x=0;x<hw;x++) {
      const i = (y*2)*W + x*2, o=(y*hw+x)*4;
      const d = (bp[i*4]-rp[i*4])/255;
      const base = rp[i*4]>>1;
      id.data[o]=base; id.data[o+1]=base; id.data[o+2]=base; id.data[o+3]=255;
      if (d < -0.06) { id.data[o]=255; id.data[o+1]=0; id.data[o+2]=0; }       // baked FARTHER (erosion)
      else if (d > 0.06) { id.data[o]=0; id.data[o+1]=255; id.data[o+2]=0; }   // baked nearer (halo etc.)
    }
    mx.putImageData(id,0,0);
    return { mask: m.toDataURL('image/png') };
  });
  fs.writeFileSync('probe2_mask.png', Buffer.from(out.mask.split(',')[1],'base64'));
  // FG-only depth at rest
  const durl = await page.evaluate(async () => {
    isSweeping = true; camera.position.x = 0; camera.position.y = 0;
    await new Promise(res => { let n=0; const tick=()=>{ n++; n<3?requestAnimationFrame(tick):res(); }; requestAnimationFrame(tick); });
    if (bgLayerMesh) bgLayerMesh.visible = false;
    renderNormalizedDepthPass();
    if (bgLayerMesh) bgLayerMesh.visible = true;
    const rt = screenNormalizedDepthTarget, W = rt.width, H = rt.height;
    const tmpRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const q = postProcessScene.children[0]; const prev = q.material;
    q.material = copyMaterial; copyMaterial.uniforms.tDiffuse.value = rt.texture;
    renderer.setRenderTarget(tmpRT); renderer.setViewport(0,0,W,H); renderer.clear();
    renderer.render(postProcessScene, postProcessCamera);
    const px8 = new Uint8Array(W*H*4);
    renderer.readRenderTargetPixels(tmpRT, 0, 0, W, H, px8);
    renderer.setRenderTarget(null); q.material = prev; tmpRT.dispose();
    const c = document.createElement('canvas'); c.width=W; c.height=H;
    const cx = c.getContext('2d'); const id = cx.createImageData(W,H);
    for (let yy=0; yy<H; yy++) for (let xx=0; xx<W; xx++) {
      const s=((H-1-yy)*W+xx)*4, d=(yy*W+xx)*4;
      if (px8[s+3] < 128) { id.data[d]=255; id.data[d+1]=0; id.data[d+2]=255; }
      else { const v=px8[s]; id.data[d]=v; id.data[d+1]=v; id.data[d+2]=v; }
      id.data[d+3]=255;
    }
    cx.putImageData(id,0,0);
    return c.toDataURL('image/png');
  });
  fs.writeFileSync('probe2_fgdepth.png', Buffer.from(durl.split(',')[1],'base64'));
  console.log('probe2 done'); await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
