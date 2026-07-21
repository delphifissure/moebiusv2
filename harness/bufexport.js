// CPU-warp workflow step 1: build once in the browser, export the baked
// buffers (conditioned depth, plate depth, plate color, disocc mask) so all
// subsequent pose renders happen on CPU in ~1s (cpuwarp.js).
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/arc73';
const H = path.join(WT, 'harness');
const ASSET = process.argv[2] || 'star';
const SRC = { star: ['starwatcher_color.png', 'starwatcher_depth.png'],
              troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              war: ['silverwarrior_color.png', 'silverwarrior_depth.png'],
              photo: ['roomImg1.png', 'roomDepth1.png'] }[ASSET];
const OUT = path.join('/workspace/moebiusv2/harness/bufcache', ASSET);
fs.mkdirSync(OUT, { recursive: true });
fs.copyFileSync(path.join(WT, SRC[0]), path.join(H, 'defaultImgColor.png'));
fs.copyFileSync(path.join(WT, SRC[1]), path.join(H, 'defaultImgDepth.png'));
fs.copyFileSync(path.join(WT, SRC[0]), path.join(OUT, 'color.png'));
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 933, height: 525 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 140)));
  await page.goto('http://localhost:8099/fp_test.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
  await page.evaluate(() => { window._foldProbe = true; window._srCapture = true; bgQuickBake = true; window._bgQuickBaked = false; buildBackgroundLayer(); });
  await page.waitForFunction(() => window._bgQuickBaked === true, null, { timeout: 480000, polling: 2000 });
  const meta = await page.evaluate(() => {
    const d = window._fpData;
    const out = { pw: d.pw, ph: d.ph, tearStep: d.tearStep, sCone: 0.0025 };
    window._exp = { dQ: d.dQ, P: d.P, claimed: d.claimedF };
    // plate colour target -> png dataURL (RGBA half-float read)
    if (bgColorTarget) {
      const w = bgColorTarget.width, h = bgColorTarget.height;
      const buf = new Uint16Array(w * h * 4);
      renderer.readRenderTargetPixels(bgColorTarget, 0, 0, w, h, buf);
      const h2f = (hf) => { const s=(hf&0x8000)?-1:1, e=(hf>>10)&0x1f, f=hf&0x3ff;
        if (e===0) return s*f*Math.pow(2,-24); if (e===31) return f?NaN:s*Infinity; return s*(1+f/1024)*Math.pow(2,e-15); };
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const cx = cv.getContext('2d'); const im = cx.createImageData(w, h);
      for (let i = 0; i < w*h; i++) {
        const y = h - 1 - ((i / w) | 0), x = i % w; const j = y*w + x;
        for (let c = 0; c < 3; c++) im.data[j*4+c] = Math.max(0, Math.min(255, Math.round(h2f(buf[i*4+c]) * 255)));
        im.data[j*4+3] = 255;
      }
      cx.putImageData(im, 0, 0);
      out.plateColorPng = cv.toDataURL('image/png');
      out.pcw = w; out.pch = h;
    }
    return out;
  });
  // stream Float32 buffers out in chunks (base64)
  const grab = async (name) => {
    const b64 = await page.evaluate((name) => {
      const a = window._exp[name];
      const f = (a instanceof Float32Array) ? a : Float32Array.from(a);
      const u8 = new Uint8Array(f.buffer);
      let s = ''; const CH = 0x8000;
      for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
      return btoa(s);
    }, name);
    fs.writeFileSync(path.join(OUT, name + '.f32'), Buffer.from(b64, 'base64'));
    console.log('exported ' + name);
  };
  await grab('dQ'); await grab('P'); await grab('claimed');
  if (meta.plateColorPng) { fs.writeFileSync(path.join(OUT, 'platecolor.png'), Buffer.from(meta.plateColorPng.split(',')[1], 'base64')); delete meta.plateColorPng; }
  fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta));
  console.log('meta ' + JSON.stringify(meta));
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
