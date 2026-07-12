// A38 probe: after a quick bake on synT (200x300 occluder), the wash at
// the occluder interior must be scene-colored (not occluder red) and the
// plate depth there must be floored to the far envelope.
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
  const res = await page.evaluate(() => {
    bgQuickBake = true;
    buildBackgroundLayer();
    // plate depth at occluder center (plateDT is a row-flipped DataTexture)
    const dt = bgLayerMesh.material.uniforms.displacementMap.value;
    const pw2 = dt.image.width, ph2 = dt.image.height, dd = dt.image.data;
    const at = (x, y) => dd[(ph2 - 1 - y) * pw2 + x];
    const plateCenter = +at(600, 500).toFixed(3);
    const plateRing = +at(510, 500).toFixed(3);   // 10px inside the left silhouette — the revealable ring
    // no-cliff contract: max horizontal plate gradient across the silhouette
    let gMax = 0;
    for (let x = 460; x < 560; x++) gMax = Math.max(gMax, Math.abs(at(x + 1, 500) - at(x, 500)));
    gMax = +gMax.toFixed(4);
    // wash color at occluder center
    const W = bgColorTarget.width, H = bgColorTarget.height;
    const tmpRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat });
    const q = postProcessScene.children[0]; const prev = q.material;
    q.material = copyMaterial; copyMaterial.uniforms.tDiffuse.value = bgColorTarget.texture;
    renderer.setRenderTarget(tmpRT); renderer.setViewport(0, 0, W, H); renderer.clear();
    renderer.render(postProcessScene, postProcessCamera);
    const px = new Uint8Array(W * H * 4);
    renderer.readRenderTargetPixels(tmpRT, 0, 0, W, H, px);
    renderer.setRenderTarget(null); q.material = prev; tmpRT.dispose();
    const sx = W / 1200, sy = H / 800;
    const xo = Math.round(600 * sx), yo = H - 1 - Math.round(500 * sy);
    const o = (yo * W + xo) * 4;
    const washC = [px[o], px[o+1], px[o+2]];
    const red = washC[0] > 120 && washC[1] < 80 && washC[2] < 80;
    const o2 = ((H - 1 - Math.round(500 * sy)) * W + Math.round(512 * sx)) * 4;
    const washRing = [px[o2], px[o2+1], px[o2+2]];
    const ringRed = washRing[0] > 120 && washRing[1] < 80 && washRing[2] < 80;
    return { plateCenter, plateRing, gMax, washC, red, washRing, ringRed };
  });
  const groundAt500 = +((40 + (230 - 40) * (500 - 300) / 500) / 255).toFixed(3);
  console.log((SRC ? 'PRE-FIX ' : 'LIVE    '), JSON.stringify(res), 'groundTruthFloor~' + groundAt500);
  console.log(' reveal ring ~ local ground  :', Math.abs(res.plateRing - groundAt500) < 0.08 ? 'OK' : 'FAIL(' + res.plateRing + ')');
  console.log(' no-cliff contract (gMax<=0.004):', res.gMax <= 0.004 ? 'OK' : 'FAIL(' + res.gMax + ')');
  console.log(' reveal-ring wash clean      :', !res.ringRed ? 'OK' : 'FAIL(red)');
  await browser.close(); srv.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
