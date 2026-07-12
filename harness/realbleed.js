// REAL-ASSET BAKE DUMP: build v1 and write bgColorTarget to a PNG so two
// moebius.js variants can be diffed (FG-bleed fringe check). argv[2] =
// variant file ('' = live moebius.js), argv[3] = output png name.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const SRC = process.argv[2] || null;
const OUT = process.argv[3] || 'bake_dump.png';
(async () => {
  let pageFile = 'scratch_moebius.html';
  if (SRC) {
    fs.copyFileSync(SRC, 'm_active.js');
    fs.writeFileSync('scratch_ab.html',
      fs.readFileSync('scratch_moebius.html', 'utf8').replace('src="moebius.js"', 'src="m_active.js"'));
    pageFile = 'scratch_ab.html';
  }
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto('http://localhost:8099/' + pageFile, { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate(() => {
    bgMPIFullPlanes = false; bgMPIMode = true; bgPlugMode = 'directional'; bgValidMode = 'auto';
    buildBackgroundLayer();
    const rt = bgColorTarget, W = rt.width, H = rt.height;
    const tmpRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat });
    const q = postProcessScene.children[0]; const prev = q.material;
    q.material = copyMaterial; copyMaterial.uniforms.tDiffuse.value = rt.texture;
    renderer.setRenderTarget(tmpRT); renderer.setViewport(0, 0, W, H); renderer.clear();
    renderer.render(postProcessScene, postProcessCamera);
    const px = new Uint8Array(W * H * 4);
    renderer.readRenderTargetPixels(tmpRT, 0, 0, W, H, px);
    renderer.setRenderTarget(null); q.material = prev; tmpRT.dispose();
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const cx = c.getContext('2d'); const id = cx.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const s = ((H - 1 - y) * W + x) * 4, o = (y * W + x) * 4;
      id.data[o] = px[s]; id.data[o+1] = px[s+1]; id.data[o+2] = px[s+2]; id.data[o+3] = 255;
    }
    cx.putImageData(id, 0, 0);
    return { W, H, png: c.toDataURL('image/png') };
  });
  fs.writeFileSync(OUT, Buffer.from(res.png.split(',')[1], 'base64'));
  console.log((SRC || 'live'), '->', OUT, res.W + 'x' + res.H);
  await browser.close(); srv.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
