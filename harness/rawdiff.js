// Raw scene render (no composite) diff: MPI on vs off, same page.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
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
  const raw = async (mode) => await page.evaluate(async (mode) => {
    bgMPIMode = mode; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer();
    isSweeping = true;
    camera.position.x = 0; camera.position.y = 0;
    await new Promise(r2 => { let n=0; const tick=()=>{ camera.position.x=0; camera.position.y=0; n++; n<4?requestAnimationFrame(tick):r2(); }; requestAnimationFrame(tick); });
    const W = 860, H = 484;
    const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat });
    renderer.setRenderTarget(rt); renderer.setViewport(0,0,W,H);
    renderer.setClearColor(new THREE.Color(0,0,0), 1); renderer.clear();
    renderer.render(scene, camera);
    const px = new Uint8Array(W*H*4);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
    renderer.setRenderTarget(null); rt.dispose();
    let s = '';
    // return a hash-ish signature + full buffer as base64 in chunks is heavy; compute diff in-page instead
    window['_raw_' + (mode?'on':'off')] = px;
    return true;
  }, mode);
  await raw(false);
  await raw(true);
  const res = await page.evaluate(() => {
    const a = window._raw_on, b = window._raw_off;
    let bad = 0, worst = 0, n = a.length/4;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(a[i*4]-b[i*4]) + Math.abs(a[i*4+1]-b[i*4+1]) + Math.abs(a[i*4+2]-b[i*4+2]);
      if (d > 30) bad++;
      if (d > worst) worst = d;
    }
    // diff map
    const W = 860, H = 484;
    const c = document.createElement('canvas'); c.width=W; c.height=H;
    const cx = c.getContext('2d'); const id = cx.createImageData(W,H);
    for (let i = 0; i < n; i++) {
      const y = H-1-((i/W)|0), x = i%W;  // GL bottom-first -> image top-first
      const o = (y*W+x)*4;
      const d = Math.abs(a[i*4]-b[i*4]) + Math.abs(a[i*4+1]-b[i*4+1]) + Math.abs(a[i*4+2]-b[i*4+2]);
      if (d > 30) { id.data[o]=255; id.data[o+1]=0; id.data[o+2]=0; }
      else { const v = a[i*4]>>2; id.data[o]=v; id.data[o+1]=v; id.data[o+2]=v; }
      id.data[o+3]=255;
    }
    cx.putImageData(id,0,0);
    return { bad, n, worst, map: c.toDataURL('image/png') };
  });
  fs.writeFileSync('rawdiff_map.png', Buffer.from(res.map.split(',')[1],'base64'));
  console.log('raw scene diff on-vs-off:', JSON.stringify({bad:res.bad, n:res.n, worst:res.worst}));
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
