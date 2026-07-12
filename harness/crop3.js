const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 600));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.goto('http://localhost:8099/blank.html');
  const out = await page.evaluate(async () => {
    const load = (src) => new Promise(r => { const i = new Image(); i.onload=()=>r(i); i.onerror=()=>r(null); i.src=src; });
    const comp = await load('http://localhost:8099/swk_depth_c.png');     // 860x484 composite
    const raw = await load('http://localhost:8099/defaultImgDepth.png');  // 1920x1323 source
    const col = await load('http://localhost:8099/defaultImgColor.png');
    // screen box (240,80)-(390,270) maps to source: x=(sx-79)*1920/702, y=sy*1323/484
    const draw = (img, sx, sy, sw, sh, S) => { const c = document.createElement('canvas');
      c.width = sw*S; c.height = sh*S; const cx = c.getContext('2d');
      cx.imageSmoothingEnabled = false; cx.drawImage(img, sx, sy, sw, sh, 0, 0, sw*S, sh*S);
      return c.toDataURL('image/png'); };
    const compCrop = draw(comp, 240, 80, 150, 190, 4);
    const rx = Math.round((240-79)*1920/702), ry = Math.round(80*1323/484);
    const rw = Math.round(150*1920/702), rh = Math.round(190*1323/484);
    const rawCrop = draw(raw, rx, ry, rw, rh, 1.5);
    const colCrop = draw(col, rx, ry, rw, rh, 1.5);
    return { compCrop, rawCrop, colCrop };
  });
  fs.writeFileSync('crop3_comp.png', Buffer.from(out.compCrop.split(',')[1],'base64'));
  fs.writeFileSync('crop3_raw.png', Buffer.from(out.rawCrop.split(',')[1],'base64'));
  fs.writeFileSync('crop3_col.png', Buffer.from(out.colCrop.split(',')[1],'base64'));
  console.log('done'); await browser.close(); srv.kill();
})().catch(e => { console.error(e); process.exit(1); });
