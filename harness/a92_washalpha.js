// A83 hole probe: dump the baked BG color target's ALPHA — if the naked
// pixels align with alpha-0 (never-painted wash), the hole source is the
// acceptance stage, not geometry.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/arc73';
const H = path.join(WT, 'harness');
const OUTD = '/workspace/moebiusv2/harness/val';
fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png'));
fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 933, height: 525 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 140)));
  await page.goto('http://localhost:8099/fp_test.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
  await page.evaluate(() => { window._noVpScan = true; bgQuickBake = true; window._bgQuickBaked = false; buildBackgroundLayer(); });
  await page.waitForFunction(() => window._bgQuickBaked === true, null, { timeout: 480000, polling: 2000 });
  const res = await page.evaluate(() => {
    if (!bgColorTarget) return { err: 'no bgColorTarget' };
    const w = bgColorTarget.width, h = bgColorTarget.height;
    const buf = new Uint16Array(w * h * 4);   // HalfFloatType
    try { renderer.readRenderTargetPixels(bgColorTarget, 0, 0, w, h, buf); }
    catch (e) { return { err: 'read: ' + e.message }; }
    // half-float alpha: check <~0.04 (half 0.04 ~ 0x2919); simpler: alpha bits==0 or tiny
    const halfToFloat = (hf) => { const s=(hf&0x8000)?-1:1, e=(hf>>10)&0x1f, f=hf&0x3ff;
      if (e===0) return s*f*Math.pow(2,-24); if (e===31) return f?NaN:s*Infinity; return s*(1+f/1024)*Math.pow(2,e-15); };
    let nZero = 0;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d'); const im = cx.createImageData(w, h);
    for (let i = 0; i < w*h; i++) {
      const a = halfToFloat(buf[i*4+3]);
      const y = h - 1 - ((i / w) | 0), x = i % w;   // flip Y (RT is bottom-up)
      const j = y*w + x;
      const v = a < 0.04 ? 255 : 0;
      if (a < 0.04) nZero++;
      im.data[j*4] = v; im.data[j*4+1] = 0; im.data[j*4+2] = 0; im.data[j*4+3] = 255;
      if (v === 0) { const c = Math.round(Math.min(1, halfToFloat(buf[i*4])) * 200); im.data[j*4] = c; im.data[j*4+1] = c; im.data[j*4+2] = c; }
    }
    cx.putImageData(im, 0, 0);
    return { w, h, zeroPct: +(100*nZero/(w*h)).toFixed(2), png: cv.toDataURL('image/png') };
  });
  if (res.err) { console.log('ERRINFO ' + res.err); }
  else {
    console.log('WASH-ALPHA zero:', res.zeroPct + '% of', res.w + 'x' + res.h);
    fs.writeFileSync(path.join(OUTD, 'A92_washalpha.png'), Buffer.from(res.png.split(',')[1], 'base64'));
    console.log('wrote A92_washalpha.png');
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
