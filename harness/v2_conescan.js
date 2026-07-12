// FULL-CONE hole scan: poses out to the 45-degree fade edge (offset 0.2 at dist 0.2), incl. diagonals
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
  let built = false;
  for (let t = 0; t < 90; t++) {
    built = await page.evaluate(() => !!(typeof mpiFullMeshes !== 'undefined' && mpiFullMeshes && mpiFullMeshes.length)).catch(()=>false);
    if (built) break; await new Promise(r => setTimeout(r, 2000));
  }
  if (!built) { console.log('no build'); process.exit(1); }
  const A = 0.2, D = 0.1414; // 45 deg straight / diagonal components
  const poses = [[A,0],[-A,0],[0,A],[0,-A],[D,D],[D,-D],[-D,D],[-D,-D],[0.17,0.06],[-0.17,-0.06],[0.17,-0.1],[-0.17,0.1]];
  const out = [];
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
    out.push([X, Y, h]);
  }
  console.log('45deg-cone holes per pose:', JSON.stringify(out));
  await browser.close(); srv.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
