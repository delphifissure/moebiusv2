// V1 BAKE FG-BLEED METRIC (synthetic ground truth): inside the occluder
// footprint the baked BG color must be GROUND, never occluder red. Counts
// baked texels closer (L2, RGB) to the occluder color than to the local
// ground color, plus mean red-dominance. Run with the file to serve as
// argv[2] (a moebius.js variant) to A/B erosion radii.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const SRC = process.argv[2] || null;    // optional moebius.js variant path
const NAME = process.argv[3] || 'synA';
const meta = JSON.parse(fs.readFileSync(`synth/${NAME}_meta.json`, 'utf8'));
(async () => {
  fs.copyFileSync(`synth/${NAME}_color.png`, 'defaultImgColor.png');
  fs.copyFileSync(`synth/${NAME}_depth.png`, 'defaultImgDepth.png');
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
  const res = await page.evaluate((meta) => {
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
    const occ = [170, 40, 40], gnd = [158, 134, 90];
    const o = meta.occs[0];
    // bake target is at plate resolution — scale footprint from image coords
    const sx = W / meta.W, sy = H / meta.H;
    const X0 = Math.ceil(o.x0 * sx) + 1, X1 = Math.floor(o.x1 * sx) - 1;
    const Y0 = Math.ceil(o.y0 * sy) + 1, Y1 = Math.floor(o.y1 * sy) - 1;
    let n = 0, nOcc = 0, redDom = 0, worst = 0;
    for (let yi = Y0; yi < Y1; yi++) {
      const yt = H - 1 - yi;                 // texture rows are bottom-up
      for (let xi = X0; xi < X1; xi++) {
        const i = (yt * W + xi) * 4;
        const r = px[i], g = px[i+1], b = px[i+2];
        n++;
        const dOcc = (r-occ[0])**2 + (g-occ[1])**2 + (b-occ[2])**2;
        const dGnd = (r-gnd[0])**2 + (g-gnd[1])**2 + (b-gnd[2])**2;
        if (dOcc < dGnd) nOcc++;
        const rd = Math.max(0, r - (g + b) / 2);
        redDom += rd; if (rd > worst) worst = rd;
      }
    }
    return { n, nOcc, pctOcc: +(nOcc / n * 100).toFixed(3), meanRedDom: +(redDom / n).toFixed(2), worstRedDom: worst, W, H };
  }, meta);
  console.log((SRC || 'live moebius.js'), NAME, JSON.stringify(res));
  await browser.close(); srv.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
