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
  const durl = await page.evaluate(async () => {
    const im = await new Promise(r => { const i = new Image(); i.onload=()=>r(i); i.src='http://localhost:8099/defaultImgDepth.png'; });
    // boost contrast x2 so mid-grays separate; full frame at half res
    const W = im.width>>1, H = im.height>>1;
    const c = document.createElement('canvas'); c.width=W; c.height=H;
    const cx = c.getContext('2d'); cx.drawImage(im, 0, 0, W, H);
    const id = cx.getImageData(0,0,W,H);
    for (let k = 0; k < W*H; k++) { const v = Math.min(255, id.data[k*4]*2); id.data[k*4]=v; id.data[k*4+1]=v; id.data[k*4+2]=v; }
    cx.putImageData(id,0,0);
    return c.toDataURL('image/png');
  });
  fs.writeFileSync('rawdepth_full.png', Buffer.from(durl.split(',')[1],'base64'));
  console.log('done'); await browser.close(); srv.kill();
})().catch(e => { console.error(e); process.exit(1); });
