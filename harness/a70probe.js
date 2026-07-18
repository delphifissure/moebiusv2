// A70 discriminator: is the gray figure ghost (a) baked into the plate wash
// texture, or (b) geometry (cap cards / FG fringe)? Outputs:
//   a70_wash.png    — the baked bgColorTarget wash readback
//   a70_noplate.png — quick render at the user cam with bgLayerMesh hidden
//   a70_normal.png  — same cam, full scene
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
fs.copyFileSync('../starwatcher_color.png', 'defaultImgColor.png');
fs.copyFileSync('../starwatcher_depth.png', 'defaultImgDepth.png');
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 933, height: 525 } });
  page.on('pageerror', e => console.log('  [PAGEERR] '+e.message.slice(0,140)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
  await page.evaluate(() => { window._rayReproject = true; bgQuickBake = true; buildBackgroundLayer(); });
  // wash readback
  const wash = await page.evaluate(() => {
    const rt = bgColorTarget; if (!rt) return null;
    const W = rt.width, H = rt.height;
    const buf = new Uint8Array(W * H * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const cx = cv.getContext('2d'); const id = cx.createImageData(W, H);
    // flip Y on readback
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const si = ((H-1-y)*W + x) * 4, di = (y*W + x) * 4;
      id.data[di] = buf[si]; id.data[di+1] = buf[si+1]; id.data[di+2] = buf[si+2]; id.data[di+3] = 255;
    }
    cx.putImageData(id, 0, 0);
    return cv.toDataURL('image/png');
  });
  if (wash) fs.writeFileSync('a70_wash.png', Buffer.from(wash.split(',')[1], 'base64'));
  console.log('wash captured: ' + !!wash);
  for (const [tag, hidePlate] of [['noplate', true], ['normal', false]]) {
    const png = await page.evaluate(async (hidePlate) => {
      if (typeof bgLayerMesh !== 'undefined' && bgLayerMesh) bgLayerMesh.visible = !hidePlate;
      isSweeping = true;
      await new Promise(r2 => { let n = 0; const tick = () => { camera.position.set(0.431, -0.065, 0.2); n++; n < 8 ? requestAnimationFrame(tick) : r2(); }; requestAnimationFrame(tick); });
      camera.position.set(0.431, -0.065, 0.2); render();
      return renderer.domElement.toDataURL('image/png');
    }, hidePlate);
    fs.writeFileSync('a70_' + tag + '.png', Buffer.from(png.split(',')[1], 'base64'));
    console.log('wrote a70_' + tag + '.png');
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
