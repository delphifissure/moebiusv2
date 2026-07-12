// synD forensics: footprint row errors + depth-pass hole classification vs content rect
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
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate(async (meta) => {
    window._dbgFillCapture = true;
    bgMPIMode = true; bgMPIFullPlanes=false; bgPlugMode='directional'; bgValidMode='auto';
    buildBackgroundLayer();
    const D = window._dbgFill;
    const { pw, ph, plug, band } = D;
    const gd = (y) => { if (y < meta.horizon) return meta.dSky/255;
      const t = (y - meta.horizon) / Math.max(1, meta.H - meta.horizon);
      return (meta.dHor + (meta.dNear - meta.dHor)*t)/255; };
    const o = meta.occs && meta.occs[0];
    const rows = [];
    if (o) for (let y=o.y0; y<o.y1; y+=6) {
      let s=0,c=0,mx=0,bandC=0;
      for (let x=o.x0;x<o.x1;x++){ const e=plug[y*pw+x]-gd(y); s+=e; c++;
        if (Math.abs(e)>Math.abs(mx)) mx=e; if (band[y*pw+x]) bandC++; }
      rows.push([y, +(s/c).toFixed(4), +mx.toFixed(4), bandC, +gd(y).toFixed(3), +(Math.max(0,(o.depth/255)-gd(y))).toFixed(3)]);
    }
    // pose depth-pass holes, classified vs content rect projected at pose
    isSweeping = true;
    camera.position.x = 0.123; camera.position.y = -0.055;
    await new Promise(r2 => { let n=0; const tick=()=>{ camera.position.x=0.123; camera.position.y=-0.055; n++; n<6?requestAnimationFrame(tick):r2(); }; requestAnimationFrame(tick); });
    if (typeof _depthPassIncludeBG !== 'undefined') _depthPassIncludeBG = true;
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
    if (typeof _depthPassIncludeBG !== 'undefined') _depthPassIncludeBG = false;
    // content rect: aspect-fit of meta.W x meta.H into W x H (rest); pose shifts < ~40px
    const s = Math.min(W/meta.W, H/meta.H);
    const cw = meta.W*s, ch = meta.H*s, x0=(W-cw)/2, y0=(H-ch)/2;
    const M = 12; // interior margin: ignore rim band where mesh edge sits
    let holesIn=0, holesOut=0, holesInDeep=0;
    let firstIn = null;
    for (let y=0;y<H;y++) for (let x=0;x<W;x++){
      if (px[(y*W+x)*4+3] >= 128) continue;
      const inside = x>=x0+M && x<x0+cw-M && y>=y0+M && y<y0+ch-M;
      if (inside) { holesIn++; if (!firstIn) firstIn=[x,y]; } else holesOut++;
      if (x>=x0+40 && x<x0+cw-40 && y>=y0+40 && y<y0+ch-40) holesInDeep++;
    }
    return { rows, holesIn, holesOut, holesInDeep, firstIn, rect: [x0|0,y0|0,cw|0,ch|0], W, H };
  }, meta);
  console.log(NAME, 'holesIn(12px margin):', res.holesIn, 'holesInDeep(40px):', res.holesInDeep, 'holesOut:', res.holesOut, 'firstIn:', JSON.stringify(res.firstIn), 'rect:', res.rect.join(','));
  if (res.rows.length) { console.log('rows [y, meanErr, maxErr, bandPx, truth, occGap]:');
    for (const r of res.rows) console.log(' ', r.join('  ')); }
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
