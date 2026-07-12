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
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate(async () => {
    bgMPIFullPlanes = true; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer();
    isSweeping = true; camera.position.x = -0.14; camera.position.y = 0.1;
    await new Promise(r2 => { let n=0; const tick=()=>{ camera.position.x=-0.14; camera.position.y=0.1; n++; n<6?requestAnimationFrame(tick):r2(); }; requestAnimationFrame(tick); });
    if (typeof _depthPassIncludeBG !== 'undefined') _depthPassIncludeBG = true;
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
    if (typeof _depthPassIncludeBG !== 'undefined') _depthPassIncludeBG = false;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const cc = c.getContext('2d'); const id = cc.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const s = ((H-1-y)*W+x)*4, o = (y*W+x)*4;
      const hole = px[s+3] < 128;
      id.data[o] = hole ? 255 : (px[s]>>2); id.data[o+1] = hole ? 0 : (px[s]>>2); id.data[o+2] = hole ? 0 : (px[s]>>2); id.data[o+3] = 255;
    }
    cc.putImageData(id, 0, 0);
    return c.toDataURL('image/png');
  });
  fs.writeFileSync('vc_holemap.png', Buffer.from(res.split(',')[1], 'base64'));
  console.log('done');
  await browser.close(); srv.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
