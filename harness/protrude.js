// PROTUBERANCE TEST: at every pixel the FG covers, the full-scene depth pass
// must equal the FG-only depth pass (BG/plate/sheet behind -> FG wins z).
// Any covered pixel where full-scene is NEARER than FG = BG protruding.
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
  await page.evaluate(() => { bgMPIMode = true; bgMPIFullPlanes=false; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer(); });
  await page.waitForTimeout(1500);
  const res = await page.evaluate(async ({X,Y}) => {
    isSweeping = true;
    camera.position.x = X; camera.position.y = Y;
    await new Promise(r2 => { let n=0; const tick=()=>{ camera.position.x=X; camera.position.y=Y; n++; n<6?requestAnimationFrame(tick):r2(); }; requestAnimationFrame(tick); });
    const grab = () => {
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
      return { px, W, H };
    };
    // pass 1: FG only
    if (typeof _depthPassIncludeBG !== 'undefined') _depthPassIncludeBG = false;
    const fg = grab();
    // pass 2: FG + plate only (sheet hidden)
    if (typeof _depthPassIncludeBG !== 'undefined') _depthPassIncludeBG = true;
    const sheetWas = (typeof mpiMidMesh !== 'undefined' && mpiMidMesh) ? mpiMidMesh.visible : null;
    if (sheetWas !== null) mpiMidMesh.visible = false;
    const plateOnly = grab();
    if (sheetWas !== null) mpiMidMesh.visible = sheetWas;
    // pass 3: everything
    const all = grab();
    if (typeof _depthPassIncludeBG !== 'undefined') _depthPassIncludeBG = false;
    const W = fg.W, H = fg.H;
    // CONTRACT test: a backing surface may legitimately occlude FAR FG
    // content (an off-frame near continuation sliding over the plain
    // behind it). A true PROTRUSION is a winner NEARER than every FG
    // surface in its neighbourhood — nearer than any occluder it could
    // plausibly sit behind. Local max of FG depth over radius 8.
    const R8 = 8;
    const fgMaxRow = new Uint8Array(W*H), fgMax = new Uint8Array(W*H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let m = 0;
      for (let o = -R8; o <= R8; o++) { const xx = x+o; if (xx<0||xx>=W) continue;
        const ii = y*W+xx; if (fg.px[ii*4+3] >= 128 && fg.px[ii*4] > m) m = fg.px[ii*4]; }
      fgMaxRow[y*W+x] = m; }
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) { let m = 0;
      for (let o = -R8; o <= R8; o++) { const yy = y+o; if (yy<0||yy>=H) continue;
        if (fgMaxRow[yy*W+x] > m) m = fgMaxRow[yy*W+x]; }
      fgMax[y*W+x] = m; }
    let covered = 0, viol = 0, worst = 0, violPlate = 0;
    const map = new Uint8Array(W*H);
    const coords = [];
    for (let i = 0; i < W*H; i++) {
      const fa = fg.px[i*4+3], fv = fg.px[i*4];
      if (fa < 128) continue;
      covered++;
      const av = all.px[i*4], pv = plateOnly.px[i*4];
      const d = av - fgMax[i];
      if (d > 2) {
        viol++; if (d > worst) worst = d; map[i] = Math.min(255, d*8);
        if (pv - fgMax[i] > 2) violPlate++;
        if (coords.length < 400) coords.push([i%W, H-1-((i/W)|0), d, pv-fgMax[i]]);
      }
    }
    // violation map png
    const c = document.createElement('canvas'); c.width=W; c.height=H;
    const cx=c.getContext('2d'); const id=cx.createImageData(W,H);
    for (let yy=0; yy<H; yy++) for (let xx=0; xx<W; xx++) {
      const s=(H-1-yy)*W+xx, o=(yy*W+xx)*4;
      const v = fg.px[s*4+3] >= 128 ? (fg.px[s*4]>>2) : 0;
      id.data[o]=map[s]?255:v; id.data[o+1]=v; id.data[o+2]=v; id.data[o+3]=255;
    }
    cx.putImageData(id,0,0);
    coords.sort((a,b)=>b[2]-a[2]);
    return { covered, viol, worst, violPlate, top: coords.slice(0,15), png: c.toDataURL('image/png') };
  }, {X,Y});
  fs.writeFileSync('protrude_map.png', Buffer.from(res.png.split(',')[1],'base64'));
  console.log(`covered ${res.covered}px, violations ${res.viol}px, of which plate-only ${res.violPlate}px, worst ${res.worst}/255`);
  console.log('worst coords x,y,d,dPlate:', JSON.stringify(res.top));
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
