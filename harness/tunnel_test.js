// TUNNELING METRIC: after ramp collapse + full tear, FG geometry should
// only ever render PLATEAU depths — a pixel at intermediate depth inside
// a window that spans a cliff is rubber (the smear/tunnel signature).
// Renders the FG-only depth pass at wide poses and counts:
//   covered  = FG-pass pixels
//   rubber   = covered pixels > margin from both local extremes of a
//              window whose span exceeds a cliff step
// argv[2] = moebius.js variant ('' = live).
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const SRC = process.argv[2] || null;
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
  await page.evaluate(() => { bgMPIFullPlanes = false; bgMPIMode = true; bgPlugMode = 'directional'; bgValidMode = 'auto'; buildBackgroundLayer(); });
  const poses = [[0.14, 0.05], [-0.14, -0.05], [0.1, 0.1], [0.16, 0.0]];
  for (const [X, Y] of poses) {
    const r = await page.evaluate(async ({ X, Y }) => {
      isSweeping = true;
      camera.position.x = X; camera.position.y = Y; camera.position.z = 0.2;
      await new Promise(r2 => { let n = 0; const tick = () => { camera.position.x = X; camera.position.y = Y; camera.position.z = 0.2; n++; n < 6 ? requestAnimationFrame(tick) : r2(); }; requestAnimationFrame(tick); });
      const measure = (includeBG) => {
        if (typeof _depthPassIncludeBG !== 'undefined') _depthPassIncludeBG = includeBG;
        renderNormalizedDepthPass();
        const rt = screenNormalizedDepthTarget, W = rt.width, H = rt.height;
        const tmpRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat });
        const q = postProcessScene.children[0]; const prev = q.material;
        q.material = copyMaterial; copyMaterial.uniforms.tDiffuse.value = rt.texture;
        renderer.setRenderTarget(tmpRT); renderer.setViewport(0, 0, W, H); renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);
        const px = new Uint8Array(W * H * 4);
        renderer.readRenderTargetPixels(tmpRT, 0, 0, W, H, px);
        renderer.setRenderTarget(null); q.material = prev; tmpRT.dispose();
        const R = 6, SPAN = 30, MARGIN = 12;   // 8-bit depth units
        const dep = new Int16Array(W * H).fill(-1);
        for (let i = 0; i < W * H; i++) if (px[i*4+3] >= 128) dep[i] = px[i*4];
        const rMin = new Int16Array(W*H), rMax = new Int16Array(W*H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          let mn = 32767, mx = -1;
          for (let o = -R; o <= R; o++) { const xx = x+o; if (xx<0||xx>=W) continue;
            const v = dep[y*W+xx]; if (v < 0) continue; if (v < mn) mn = v; if (v > mx) mx = v; }
          rMin[y*W+x] = mn; rMax[y*W+x] = mx;
        }
        let covered = 0, rubber = 0;
        for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
          const i = y*W+x; if (dep[i] < 0) continue;
          covered++;
          let mn = 32767, mx = -1;
          for (let o = -R; o <= R; o++) { const yy = y+o; if (yy<0||yy>=H) continue;
            const j = yy*W+x; if (rMin[j] < mn) mn = rMin[j]; if (rMax[j] > mx) mx = rMax[j]; }
          if (mx - mn > SPAN && dep[i] > mn + MARGIN && dep[i] < mx - MARGIN) rubber++;
        }
        return { covered, rubber, pct: +(rubber / Math.max(1, covered) * 100).toFixed(2) };
      };
      const fg = measure(false);
      const all = measure(true);
      if (typeof _depthPassIncludeBG !== 'undefined') _depthPassIncludeBG = false;
      return { fg, all };
    }, { X, Y });
    console.log((SRC ? 'variant' : 'live   '), 'pose', X, Y, JSON.stringify(r));
  }
  await browser.close(); srv.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
