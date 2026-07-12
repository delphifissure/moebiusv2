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
  for (const img of ['tn3_shot']) {
    const durl = await page.evaluate(async (img) => {
      const im = await new Promise(r => { const i = new Image(); i.onload=()=>r(i); i.onerror=()=>r(null); i.src='http://localhost:8099/'+img+'.png'; });
      if (!im) return null;
      const [x,y,w,h] = [380,330,300,140]; const S=3;
      const c = document.createElement('canvas'); c.width=w*S; c.height=h*S;
      const cx = c.getContext('2d'); cx.imageSmoothingEnabled=false;
      cx.drawImage(im, x,y,w,h, 0,0,w*S,h*S);
      return c.toDataURL('image/png');
    }, img);
    if (durl) fs.writeFileSync('crop2_'+img+'.png', Buffer.from(durl.split(',')[1],'base64'));
  }
  console.log('done'); await browser.close(); srv.kill();
})().catch(e => { console.error(e); process.exit(1); });
