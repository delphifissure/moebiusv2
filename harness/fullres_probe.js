// A46 PROBE: which classified ink actually ADOPTS near depth on a real
// asset. Builds v1, overlays on the colour image: GREEN = lifted ink,
// RED = classified but NOT lifted, on the source. Also screenshots the
// live render at the user's pose. argv[2] = 'star'|'troll'.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const OUT = process.argv[3] || '.';
if (process.argv[2] === 'star') {
  fs.copyFileSync('../starwatcher_color.png', 'defaultImgColor.png');
  fs.copyFileSync('../starwatcher_depth.png', 'defaultImgDepth.png');
} else if (process.argv[2] === 'troll') {
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
    window._srCapture = true;
    bgMPIFullPlanes = false; bgMPIMode = true; bgPlugMode = 'directional'; bgValidMode = 'auto';
    buildBackgroundLayer();
    window._srCapture = false;
    const L = mediaLayers[0];
    const S = window._srDbg;
    if (!S || !L._strokeMask || !L._inkAdopted) return { err: 'missing masks' };
    const w = S.w, h = S.h, N = w * h;
    const sm = L._strokeMask, am = L._inkAdopted;
    let nS = 0, nA = 0, nAink = 0;
    for (let i = 0; i < N; i++) { if (sm[i]) nS++; if (am[i]) { nA++; if (sm[i]) nAink++; } }
    // overlay
    const cImg = (L.textures.color && L.textures.color.image) || (L.elements && L.elements.color);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const cx = c.getContext('2d');
    cx.drawImage(cImg, 0, 0, w, h);
    const id = cx.getImageData(0, 0, w, h);
    for (let i = 0; i < N; i++) {
      if (!sm[i] && !am[i]) continue;
      const o = i * 4;
      if (am[i]) { id.data[o] = 30; id.data[o+1] = 255; id.data[o+2] = 60; }
      else { id.data[o] = 255; id.data[o+1] = 40; id.data[o+2] = 40; }
    }
    cx.putImageData(id, 0, 0);
    return { w, h, nS, nA, nAink, png: c.toDataURL('image/png') };
  });
  if (res.err) { console.log('ERR', res.err); process.exit(1); }
  fs.writeFileSync(OUT + '/adoptmap.png', Buffer.from(res.png.split(',')[1], 'base64'));
  console.log(JSON.stringify({ w: res.w, h: res.h, classified: res.nS, adoptedTotal: res.nA, adoptedInk: res.nAink }));
  // live render at the user's pose — canvas readback, no playwright screenshot
  const shot = await page.evaluate(async () => {
    isSweeping = true;
    await new Promise(r2 => { let n = 0; const tick = () => {
      camera.position.x = 0.065; camera.position.y = 0.065; camera.position.z = 0.2;
      n++; n < 8 ? requestAnimationFrame(tick) : r2(); }; requestAnimationFrame(tick); });
    render();
    return renderer.domElement.toDataURL('image/png');
  });
  fs.writeFileSync(OUT + '/pose_render.png', Buffer.from(shot.split(',')[1], 'base64'));
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
