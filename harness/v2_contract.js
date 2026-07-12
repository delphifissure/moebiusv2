// V2 CONTRACT: rest fidelity vs flat source, hole scan across the support cone, per-pose coverage
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
  const shotData = async (X, Y) => await page.evaluate(async ({X,Y}) => {
    isSweeping = true; camera.position.x = X; camera.position.y = Y;
    await new Promise(res => { let n=0; const tick=()=>{ camera.position.x=X; camera.position.y=Y; n++; n<5?requestAnimationFrame(tick):res(); }; requestAnimationFrame(tick); });
    return document.getElementById('canvas').toDataURL('image/png');
  }, {X,Y});
  // reference: flat source at rest (pre-build)
  const ref = await shotData(0, 0);
  fs.writeFileSync('vc_ref.png', Buffer.from(ref.split(',')[1], 'base64'));
  await page.evaluate(() => { bgMPIFullPlanes = true; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer(); });
  await page.waitForTimeout(400);
  const rest = await shotData(0, 0);
  fs.writeFileSync('vc_rest.png', Buffer.from(rest.split(',')[1], 'base64'));
  // geometry-coverage holes across the support cone (tan35deg*0.2 = 0.14)
  const poses = [[0.14,0],[0.14,-0.10],[0.14,0.10],[-0.14,0],[-0.14,0.10],[0,0.14],[0,-0.14],[0.10,0.067],[-0.10,-0.067]];
  const holes = [];
  for (const [X,Y] of poses) {
    const h = await page.evaluate(async ({X,Y}) => {
      isSweeping = true; camera.position.x = X; camera.position.y = Y;
      await new Promise(r2 => { let n=0; const tick=()=>{ camera.position.x=X; camera.position.y=Y; n++; n<5?requestAnimationFrame(tick):r2(); }; requestAnimationFrame(tick); });
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
      let n2 = 0;
      const x0 = (W*0.05)|0, x1 = (W*0.95)|0, y0 = (H*0.05)|0, y1 = (H*0.95)|0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (px[(y*W+x)*4+3] < 128) n2++;
      return n2;
    }, {X,Y});
    holes.push([X, Y, h]);
  }
  console.log('holes per pose (middle 90%):', JSON.stringify(holes));
  await browser.close(); srv.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
