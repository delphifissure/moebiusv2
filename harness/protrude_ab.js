// PROTRUDE BISECT: same contract as protrude.js but argv[4] is a csv of
// stroke-repair kill flags set page-side before the build:
//   noGC   -> window._srNoGC   (skip A39 gap closing)
//   noP2   -> window._srNoP2   (skip A40 phase 2 + continuation)
//   noCont -> window._srNoCont (skip A40 continuation only)
// Usage: node protrude_ab.js [X] [Y] [flagsCsv]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const X = parseFloat(process.argv[2]||'0.123'), Y = parseFloat(process.argv[3]||'-0.055');
const FLAGS = (process.argv[4]||'').split(',').filter(Boolean);
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const logs = [];
  page.on('console', m => { const t = m.text(); if (/STROKE-REPAIR|RUNG-PLUG/.test(t)) logs.push(t); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  await page.evaluate((flags) => {
    if (flags.includes('noGC')) window._srNoGC = true;
    if (flags.includes('noScale')) window._srNoScale = true;
    if (flags.includes('bsVerbose')) window._bsVerbose = true;
    const so = flags.find(f => f.startsWith('scaleOnly:')); if (so) window._srScaleOnly = so.split(':')[1];
    if (flags.includes('noP2')) window._srNoP2 = true;
    if (flags.includes('noCont')) window._srNoCont = true;
    bgMPIMode = true; bgMPIFullPlanes=false; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer();
  }, FLAGS);
  await page.waitForTimeout(1500);
  await page.evaluate((flags) => {
    if (flags.includes('noStrips') && typeof mpiStripMeshes !== 'undefined' && mpiStripMeshes)
      for (const m of mpiStripMeshes) m.visible = false;
    if (flags.includes('noSlot0') && typeof mpiStripMeshes !== 'undefined' && mpiStripMeshes)
      for (const m of mpiStripMeshes) if (m.userData.slot === 0) m.visible = false;
    if (flags.includes('noSlot1') && typeof mpiStripMeshes !== 'undefined' && mpiStripMeshes)
      for (const m of mpiStripMeshes) if (m.userData.slot === 1) m.visible = false;
    if (flags.includes('noPlate') && typeof bgLayerMesh !== 'undefined' && bgLayerMesh)
      bgLayerMesh.visible = false;
  }, FLAGS);
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
    if (typeof _depthPassIncludeBG !== 'undefined') _depthPassIncludeBG = false;
    const fg = grab();
    if (typeof _depthPassIncludeBG !== 'undefined') _depthPassIncludeBG = true;
    const sheetWas = (typeof mpiMidMesh !== 'undefined' && mpiMidMesh) ? mpiMidMesh.visible : null;
    if (sheetWas !== null) mpiMidMesh.visible = false;
    const plateOnly = grab();
    if (sheetWas !== null) mpiMidMesh.visible = sheetWas;
    const all = grab();
    if (typeof _depthPassIncludeBG !== 'undefined') _depthPassIncludeBG = false;
    const W = fg.W, H = fg.H;
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
    const coords = [];
    for (let i = 0; i < W*H; i++) {
      const fa = fg.px[i*4+3];
      if (fa < 128) continue;
      covered++;
      const av = all.px[i*4], pv = plateOnly.px[i*4];
      const d = av - fgMax[i];
      if (d > 2) {
        viol++; if (d > worst) worst = d;
        if (pv - fgMax[i] > 2) violPlate++;
        if (coords.length < 400) coords.push([i%W, H-1-((i/W)|0), d, pv-fgMax[i]]);
      }
    }
    coords.sort((a,b)=>b[2]-a[2]);
    return { covered, viol, worst, violPlate, top: coords.slice(0,10) };
  }, {X,Y});
  console.log('flags=[' + FLAGS.join(',') + ']', `covered ${res.covered}px, violations ${res.viol}px, plate-only ${res.violPlate}px, worst ${res.worst}/255`);
  console.log('logs:', logs.join(' | ') || '(none)');
  console.log('worst coords:', JSON.stringify(res.top));
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
