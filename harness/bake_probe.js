// Compare RAW depth map vs LIVE-BAKED depth at the figure (head/staff region).
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
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && fgMarkDilationMaterial && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  await page.evaluate(() => { bgMPIFullPlanes=false; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer(); });
  await page.waitForTimeout(500);
  const out = await page.evaluate(async () => {
    // crop of the head/staff region in source space (1920x1323): x 480-800, y 250-700
    const [X,Y,W,H] = [480, 250, 340, 460], S = 2;
    const draw = (img) => { const c = document.createElement('canvas'); c.width=W*S; c.height=H*S;
      const cx = c.getContext('2d'); cx.imageSmoothingEnabled = false;
      cx.drawImage(img, X, Y, W, H, 0, 0, W*S, H*S); return c.toDataURL('image/png'); };
    const raw = await new Promise(r => { const i = new Image(); i.onload=()=>r(i); i.src='defaultImgDepth.png'; });
    const baked = mediaLayers[0].textures.depth.image;   // post-bake (+halo)
    const color = await new Promise(r => { const i = new Image(); i.onload=()=>r(i); i.src='defaultImgColor.png'; });
    return { raw: draw(raw), baked: draw(baked), color: draw(color) };
  });
  fs.writeFileSync('probe_raw.png', Buffer.from(out.raw.split(',')[1],'base64'));
  fs.writeFileSync('probe_baked.png', Buffer.from(out.baked.split(',')[1],'base64'));
  fs.writeFileSync('probe_color.png', Buffer.from(out.color.split(',')[1],'base64'));
  console.log('probe done'); await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
