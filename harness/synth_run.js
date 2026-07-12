// SYNTHETIC GROUND-TRUTH SUITE: for each scene, build once and score:
//  (1) plate depth vs ANALYTIC truth inside occluder footprints
//  (2) protrusion test (contract form) at the standard pose
//  (3) transparent-hole count at the pose
// Ball scene: report the ball's depth integrity (despeckle must not flatten it).
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const NAME = process.argv[2];
const meta = JSON.parse(fs.readFileSync(`synth/${NAME}_meta.json`, 'utf8'));
(async () => {
  fs.copyFileSync(`synth/${NAME}_color.png`, 'defaultImgColor.png');
  fs.copyFileSync(`synth/${NAME}_depth.png`, 'defaultImgDepth.png');
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0,200)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate(async (meta) => {
    window._dbgFillCapture = true;
    bgMPIMode = true; bgPlugMode='directional'; bgValidMode='auto';
    const okBuild = buildBackgroundLayer();
    const D = window._dbgFill;
    if (!D) return { err: 'no dbg' };
    const { pw, ph, plug, srcDepth } = D;
    const gd = (y) => { // analytic ground/sky depth at plate row y (meta coords == plate coords)
      if (y < meta.horizon) return meta.dSky/255;
      const t = (y - meta.horizon) / Math.max(1, meta.H - meta.horizon);
      return (meta.dHor + (meta.dNear - meta.dHor)*t)/255;
    };
    // (1) plate truth inside occluder footprints
    let n1 = 0, sum1 = 0, max1 = 0;
    for (const o of (meta.occs||[])) {
      for (let y = o.y0; y < o.y1; y++) for (let x = o.x0; x < o.x1; x++) {
        const e = Math.abs(plug[y*pw+x] - gd(y));
        n1++; sum1 += e; if (e > max1) max1 = e;
      }
    }
    // ball integrity: displayed depth at ball core must stay ~dCore (not flattened)
    let ballErr = null;
    if (meta.ball) {
      const b = meta.ball;
      let s = 0, c = 0;
      for (let y = b.cy-10; y < b.cy+10; y++) for (let x = b.cx-10; x < b.cx+10; x++) { s += srcDepth[y*pw+x]; c++; }
      ballErr = Math.abs(s/c - b.dCore/255);
    }
    // (2,3) pose render: holes + protrusion
    isSweeping = true;
    camera.position.x = 0.123; camera.position.y = -0.055;
    await new Promise(r2 => { let n=0; const tick=()=>{ camera.position.x=0.123; camera.position.y=-0.055; n++; n<6?requestAnimationFrame(tick):r2(); }; requestAnimationFrame(tick); });
    const grab = (inc) => {
      if (typeof _depthPassIncludeBG !== 'undefined') _depthPassIncludeBG = inc;
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
    const fg = grab(false), all = grab(true);
    if (typeof _depthPassIncludeBG !== 'undefined') _depthPassIncludeBG = false;
    const W = fg.W, H = fg.H;
    // local FG max (radius 8) for the contract test
    const R8 = 8;
    const rowM = new Uint8Array(W*H), fgMax = new Uint8Array(W*H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let m = 0;
      for (let o = -R8; o <= R8; o++) { const xx = x+o; if (xx<0||xx>=W) continue;
        const ii = y*W+xx; if (fg.px[ii*4+3] >= 128 && fg.px[ii*4] > m) m = fg.px[ii*4]; }
      rowM[y*W+x] = m; }
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) { let m = 0;
      for (let o = -R8; o <= R8; o++) { const yy = y+o; if (yy<0||yy>=H) continue;
        if (rowM[yy*W+x] > m) m = rowM[yy*W+x]; }
      fgMax[y*W+x] = m; }
    let covered = 0, viol = 0, worst = 0, holes = 0;
    for (let i = 0; i < W*H; i++) {
      if (all.px[i*4+3] < 128) holes++;         // nothing rendered: transparent hole
      if (fg.px[i*4+3] < 128) continue;
      covered++;
      const d = all.px[i*4] - fgMax[i];
      if (d > 2) { viol++; if (d > worst) worst = d; }
    }
    // holes inside the content area only (exclude outside the terrarium image bounds):
    return { okBuild, n1, mean1: n1 ? sum1/n1 : 0, max1, ballErr, covered, viol, worst, holes, W, H };
  }, meta);
  console.log(NAME, JSON.stringify(res));
  if (errs.length) console.log(NAME, 'PAGEERRORS:', errs.slice(0,3));
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
