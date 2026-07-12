// BG-only depth at a pose, plus depth histogram of the blob box.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const X = parseFloat(process.argv[2]||'0.123'), Y = parseFloat(process.argv[3]||'-0.055');
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
  const res = await page.evaluate(async ({X,Y}) => {
    isSweeping = true;
    if (mediaLayers[0] && mediaLayers[0].mesh) mediaLayers[0].mesh.visible = false;
    camera.position.x = X; camera.position.y = Y;
    await new Promise(r2 => { let n=0; const tick=()=>{ camera.position.x=X; camera.position.y=Y; n++; n<4?requestAnimationFrame(tick):r2(); }; requestAnimationFrame(tick); });
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
    if (mediaLayers[0] && mediaLayers[0].mesh) mediaLayers[0].mesh.visible = true;
    // full-frame PNG + histogram of blob box (350-430, 270-330 in canvas coords)
    const c = document.createElement('canvas'); c.width=W; c.height=H;
    const cx=c.getContext('2d'); const id=cx.createImageData(W,H);
    for (let yy=0; yy<H; yy++) for (let xx=0; xx<W; xx++) {
      const s=((H-1-yy)*W+xx)*4, d=(yy*W+xx)*4;
      if (px[s+3]<128){ id.data[d]=255;id.data[d+1]=0;id.data[d+2]=255; }
      else { const v=px[s]; id.data[d]=v;id.data[d+1]=v;id.data[d+2]=v; }
      id.data[d+3]=255;
    }
    cx.putImageData(id,0,0);
    const hist = {};
    for (let yy=270; yy<330; yy++) for (let xx=350; xx<430; xx++) {
      const s=((H-1-yy)*W+xx)*4; const v=px[s]; const b=(v/16|0)*16;
      hist[b]=(hist[b]||0)+1;
    }
    return { png: c.toDataURL('image/png'), hist, W, H };
  }, {X,Y});
  fs.writeFileSync('bgdepth_pose.png', Buffer.from(res.png.split(',')[1],'base64'));
  console.log('canvas', res.W+'x'+res.H, 'blob-box depth histogram (bucket:count):', JSON.stringify(res.hist));
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
