// Depth-composite verification: renders the depth pass WITH the plug included
// (magenta = unplugged hole) at three poses, and computes source-space Law-2
// stats on the plug itself: weld error at the band ring, and protrusion count
// (plug nearer than the local background far-field + 0.08, per PLUG_PORT_SPEC).
// Usage: node depth_dump.js <prefix>
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const PREFIX = process.argv[2] || 'dd';

(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('console', m => { const t=m.text(); if (/RUNG-PLUG|RUNG-A|error/i.test(t)) console.log('  [page]',t); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && fgMarkDilationMaterial && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  await page.evaluate(() => { bgMPIFullPlanes=false; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer(); });
  await page.waitForTimeout(800);

  // Law-2 stats on the plug texture (source space, exact)
  const stats = await page.evaluate(() => {
    const xE = bgDirectionalExport; if (!xE) return { err: 'no export' };
    const { pw, ph, band, plug } = xE; const N = pw * ph;
    const L = mediaLayers[0];
    // source depth (post-bake) — re-read from the layer's texture image
    const dImg = L.textures.depth.image2d || L.textures.depth.image;
    const c = document.createElement('canvas'); c.width = pw; c.height = ph;
    const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(dImg, 0, 0, pw, ph);
    const dpx = cx.getImageData(0, 0, pw, ph).data;
    const depth = new Float32Array(N); for (let i = 0; i < N; i++) depth[i] = dpx[i*4] / 255;
    // farField = boxMin(21) over background depth (valid = !band), sentinel +2
    const S = new Float32Array(N); for (let i = 0; i < N; i++) S[i] = band[i] ? 2 : depth[i];
    const r = 10, tmp = new Float32Array(N), ff = new Float32Array(N);
    for (let y = 0; y < ph; y++) { const row = y*pw;
      for (let x = 0; x < pw; x++) { let m = 2;
        for (let k = -r; k <= r; k++) { const xx = Math.min(pw-1, Math.max(0, x+k)); const v = S[row+xx]; if (v < m) m = v; }
        tmp[row+x] = m; } }
    for (let x = 0; x < pw; x++) { for (let y = 0; y < ph; y++) { let m = 2;
      for (let k = -r; k <= r; k++) { const yy = Math.min(ph-1, Math.max(0, y+k)); const v = tmp[yy*pw+x]; if (v < m) m = v; }
      ff[y*pw+x] = m; } }
    // protrusion: plug nearer (larger) than farField + 0.08, inside band
    let bandN = 0, protr = 0, protrMax = 0;
    // weld: ring pixels vs adjacent background depth
    let ringN = 0, weldSum = 0, weldMax = 0, weld02 = 0;
    for (let y = 1; y < ph-1; y++) for (let x = 1; x < pw-1; x++) { const i = y*pw+x;
      if (!band[i]) continue; bandN++;
      if (ff[i] < 2 && plug[i] > ff[i] + 0.08) { protr++; const e = plug[i]-ff[i]-0.08; if (e > protrMax) protrMax = e; }
      const nbs = [i-1, i+1, i-pw, i+pw];
      for (const j of nbs) if (!band[j]) { ringN++;
        const w = Math.abs(plug[i] - depth[j]); weldSum += w; if (w > weldMax) weldMax = w; if (w > 0.02) weld02++; break; }
    }
    return { pw, ph, bandN, protrusionPx: protr, protrusionFrac: +(protr/Math.max(1,bandN)).toFixed(5),
             protrusionMaxOver: +protrMax.toFixed(3),
             ring: { n: ringN, meanWeldErr: +(weldSum/Math.max(1,ringN)).toFixed(4), maxWeldErr: +weldMax.toFixed(3),
                     over0_02Frac: +(weld02/Math.max(1,ringN)).toFixed(4) } };
  });
  console.log('LAW2-STATS', JSON.stringify(stats));

  async function depthShot(name, x, y) {
    const t0 = Date.now();
    const durl = await page.evaluate(async ({x, y}) => {
      isSweeping = true;
      camera.position.x = x; camera.position.y = y;
      await new Promise(res => { let n=0; const tick=()=>{ camera.position.x=x; camera.position.y=y; n++; n<3?requestAnimationFrame(tick):res(); }; requestAnimationFrame(tick); });
      _depthPassIncludeBG = true; renderNormalizedDepthPass(); _depthPassIncludeBG = false;
      const rt = screenNormalizedDepthTarget, W = rt.width, H = rt.height;
      // copy to an 8-bit target for a portable readback (source may be half-float)
      const tmpRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat,
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
      const q = postProcessScene.children[0]; const prevMat = q.material;
      q.material = copyMaterial; copyMaterial.uniforms.tDiffuse.value = rt.texture;
      renderer.setRenderTarget(tmpRT); renderer.setViewport(0, 0, W, H); renderer.clear();
      renderer.render(postProcessScene, postProcessCamera);
      const px8 = new Uint8Array(W * H * 4);
      renderer.readRenderTargetPixels(tmpRT, 0, 0, W, H, px8);
      renderer.setRenderTarget(null); q.material = prevMat; tmpRT.dispose();
      const px = new Float32Array(W * H * 4);
      for (let k = 0; k < W * H * 4; k++) px[k] = px8[k] / 255;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const cx = c.getContext('2d'); const id = cx.createImageData(W, H);
      for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
        const s = ((H-1-yy)*W + xx) * 4, d = (yy*W + xx) * 4;   // GL flip
        if (px[s+3] < 0.5) { id.data[d]=255; id.data[d+1]=0; id.data[d+2]=255; } // magenta = hole
        else { const v = Math.max(0, Math.min(255, Math.round(px[s]*255))); id.data[d]=v; id.data[d+1]=v; id.data[d+2]=v; }
        id.data[d+3] = 255;
      }
      cx.putImageData(id, 0, 0);
      return c.toDataURL('image/png');
    }, {x, y});
    fs.writeFileSync(name, Buffer.from(durl.split(',')[1], 'base64'));
    console.log('depth shot', name, (Date.now()-t0)+'ms');
  }
  await depthShot(PREFIX + '_depth_c.png', 0, 0);
  await depthShot(PREFIX + '_depth_r11.png', 0.11, 0);
  await depthShot(PREFIX + '_depth_user.png', 0.123, -0.055);
  await browser.close(); srv.kill();
  console.log('done');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
