// STROKE-DEBRIS METRIC (ground truth): thin dark strokes drawn on the sky
// in COLOR ONLY (depth = sky) simulate the estimator missing line art.
// The baked BG must NOT carry the strokes — sample the bake along each
// stroke path and count texels darker than the local sky. argv[2] =
// moebius.js variant ('' = live).
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const SRC = process.argv[2] || null;
const meta = JSON.parse(fs.readFileSync('synth/synS_meta.json', 'utf8'));
(async () => {
  fs.copyFileSync('synth/synS_color.png', 'defaultImgColor.png');
  fs.copyFileSync('synth/synS_depth.png', 'defaultImgDepth.png');
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
    const sx = W / meta.W, sy = H / meta.H;
    const sky = [40, 90, 170];
    let n = 0, dark = 0, worst = 0;
    for (const s of meta.strokes) {
      const steps = 300;
      for (let i = 0; i <= steps; i++) {
        const xi = Math.round((s[0] + (s[2] - s[0]) * i / steps) * sx);
        const yi = Math.round((s[1] + (s[3] - s[1]) * i / steps) * sy);
        if (xi < 1 || xi >= W - 1 || yi < 1 || yi >= H - 1) continue;
        const o = ((H - 1 - yi) * W + xi) * 4;
        const lum = 0.299 * px[o] + 0.587 * px[o+1] + 0.114 * px[o+2];
        const skyLum = 0.299 * sky[0] + 0.587 * sky[1] + 0.114 * sky[2];
        n++;
        const drop = skyLum - lum;
        if (drop > 25) dark++;
        if (drop > worst) worst = drop;
      }
    }
    return { n, dark, pctDark: +(dark / n * 100).toFixed(1), worstDrop: Math.round(worst), W, H };
  }, meta);
  console.log((SRC || 'live'), 'stroke-in-bake:', JSON.stringify(res));
  await browser.close(); srv.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
