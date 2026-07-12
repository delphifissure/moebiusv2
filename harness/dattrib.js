// Depth-pass attribution at pose: FG-only vs PLATE-only (with BG included in pass).
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
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  await page.evaluate(() => { bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer(); });
  await page.waitForTimeout(800);
  const shot = async (mode) => await page.evaluate(async (mode) => {
    isSweeping = true;
    window._depthPassIncludeBG = true;
    if (typeof _depthPassIncludeBG !== 'undefined') _depthPassIncludeBG = true;
    if (bgLayerMesh) bgLayerMesh.visible = (mode !== 'fg');
    if (mediaLayers[0].mesh) mediaLayers[0].mesh.visible = (mode !== 'bg');
    camera.position.x = 0.123; camera.position.y = -0.055;
    await new Promise(r2 => { let n=0; const tick=()=>{ camera.position.x=0.123; camera.position.y=-0.055; n++; n<4?requestAnimationFrame(tick):r2(); }; requestAnimationFrame(tick); });
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
    if (bgLayerMesh) bgLayerMesh.visible = true;
    if (mediaLayers[0].mesh) mediaLayers[0].mesh.visible = true;
    const c = document.createElement('canvas'); c.width=W; c.height=H;
    const cx=c.getContext('2d'); const id=cx.createImageData(W,H);
    for (let yy=0; yy<H; yy++) for (let xx=0; xx<W; xx++) {
      const s=((H-1-yy)*W+xx)*4, d=(yy*W+xx)*4;
      if (px[s+3]<128){ id.data[d]=255;id.data[d+1]=0;id.data[d+2]=255; }
      else { const v=px[s]; id.data[d]=v;id.data[d+1]=v;id.data[d+2]=v; }
      id.data[d+3]=255;
    }
    cx.putImageData(id,0,0);
    return c.toDataURL('image/png');
  }, mode);
  for (const m of ['fg','bg']) {
    const d = await shot(m);
    fs.writeFileSync('dattrib_'+m+'.png', Buffer.from(d.split(',')[1],'base64'));
    console.log(m, 'done');
  }
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
