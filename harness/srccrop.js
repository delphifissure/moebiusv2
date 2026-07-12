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
    const im = await new Promise(r => { const i = new Image(); i.onload=()=>r(i); i.src='http://localhost:8099/defaultImgColor.png'; });
    const dm = await new Promise(r => { const i = new Image(); i.onload=()=>r(i); i.src='http://localhost:8099/defaultImgDepth.png'; });
    const c = document.createElement('canvas'); c.width=500; c.height=380;
    const cx = c.getContext('2d'); cx.imageSmoothingEnabled=false;
    cx.drawImage(im, 400, 880, 500, 380, 0, 0, 500, 190);   // colour top half
    cx.drawImage(dm, 400, 880, 500, 380, 0, 190, 500, 190); // depth bottom half
    return c.toDataURL('image/png');
  });
  fs.writeFileSync('srccrop_legs.png', Buffer.from(durl.split(',')[1],'base64'));
  console.log('done'); await browser.close(); srv.kill();
})().catch(e => { console.error(e); process.exit(1); });
