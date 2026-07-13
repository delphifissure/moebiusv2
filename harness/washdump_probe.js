// A50 PROBE: after a QUICK bake at user scale, dump (1) the bgColorTarget
// wash as PNG, (2) an overlay of the wash-ink mask (green) vs strict
// stroke mask (red-only where not in wash mask) on the source, and (3)
// stats. argv[2]='star'|'troll', argv[3]=out dir.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const OUT = process.argv[3] || '.';
if (process.argv[2] === 'star') {
  fs.copyFileSync('../starwatcher_color.png', 'defaultImgColor.png');
  fs.copyFileSync('../starwatcher_depth.png', 'defaultImgDepth.png');
} else {
  fs.copyFileSync('../defaultImgColor.png', 'defaultImgColor.png');
  fs.copyFileSync('../defaultImgDepth.png', 'defaultImgDepth.png');
}
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate(() => {
    bgQuickBake = true;
    buildBackgroundLayer();
    const L = mediaLayers[0];
    // 1. wash readback
    const W = bgColorTarget.width, H = bgColorTarget.height;
    const tmpRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat });
    const q = postProcessScene.children[0]; const prev = q.material;
    q.material = copyMaterial; copyMaterial.uniforms.tDiffuse.value = bgColorTarget.texture;
    renderer.setRenderTarget(tmpRT); renderer.setViewport(0, 0, W, H); renderer.clear();
    renderer.render(postProcessScene, postProcessCamera);
    const px = new Uint8Array(W * H * 4);
    renderer.readRenderTargetPixels(tmpRT, 0, 0, W, H, px);
    renderer.setRenderTarget(null); q.material = prev; tmpRT.dispose();
    const wc = document.createElement('canvas'); wc.width = W; wc.height = H;
    const wcx = wc.getContext('2d');
    const wid = wcx.createImageData(W, H);
    for (let y = 0; y < H; y++) { const s = y * W * 4, d = (H - 1 - y) * W * 4;
      for (let x = 0; x < W * 4; x++) wid.data[d + x] = px[s + x]; }
    for (let i = 3; i < wid.data.length; i += 4) wid.data[i] = 255;
    wcx.putImageData(wid, 0, 0);
    // 2. mask overlay on source
    const w = L._washInkW || L._strokeMaskW, h = L._washInkH || L._strokeMaskH;
    const wm = L._washInkMask, sm = L._strokeMask;
    let out = { W, H, washPng: wc.toDataURL('image/png') };
    if (wm || sm) {
      const N = w * h;
      const cImg = (L.textures.color && L.textures.color.image) || (L.elements && L.elements.color);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const cx2 = c.getContext('2d');
      cx2.drawImage(cImg, 0, 0, w, h);
      const id = cx2.getImageData(0, 0, w, h);
      let nW = 0, nS = 0, nSonly = 0;
      for (let i = 0; i < N; i++) {
        const inW = wm && wm[i], inS = sm && sm[i];
        if (inW) nW++; if (inS) nS++;
        if (!inW && !inS) continue;
        const o = i * 4;
        if (inW) { id.data[o] = 30; id.data[o+1] = 255; id.data[o+2] = 60; }
        else { id.data[o] = 255; id.data[o+1] = 40; id.data[o+2] = 40; nSonly++; }
      }
      cx2.putImageData(id, 0, 0);
      out.maskPng = c.toDataURL('image/png');
      out.stats = { w, h, washMask: nW, strict: nS, strictOnly: nSonly };
    }
    // 3. quick-branch state: was the ink texture actually bound?
    out.useInk = !!(bgColorSeedMaterial && bgColorSeedMaterial.uniforms.u_useInk &&
                    bgColorSeedMaterial.uniforms.u_useInk.value);
    out.hasInkTex = !!(bgColorSeedMaterial && bgColorSeedMaterial.uniforms.tInk &&
                       bgColorSeedMaterial.uniforms.tInk.value);
    return out;
  });
  fs.writeFileSync(OUT + '/wash.png', Buffer.from(res.washPng.split(',')[1], 'base64'));
  if (res.maskPng) fs.writeFileSync(OUT + '/inkmask.png', Buffer.from(res.maskPng.split(',')[1], 'base64'));
  console.log(JSON.stringify({ W: res.W, H: res.H, stats: res.stats, useInk: res.useInk, hasInkTex: res.hasInkTex }));
  await browser.close(); srv.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
