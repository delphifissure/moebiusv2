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
  const regions = { lamp: [280,120,140,120], legs: [200,330,180,154] };
  for (const img of ['clr4_shot']) {
    for (const [name, [x,y,w,h]] of Object.entries(regions)) {
      const durl = await page.evaluate(async ({img,x,y,w,h}) => {
        const im = await new Promise(r => { const i = new Image(); i.onload=()=>r(i); i.onerror=()=>r(null); i.src='http://localhost:8099/'+img+'.png'; });
        if (!im) return null;
        const c = document.createElement('canvas'); const S=3; c.width=w*S; c.height=h*S;
        const cx = c.getContext('2d'); cx.imageSmoothingEnabled=false;
        cx.fillStyle='#ff00ff'; cx.fillRect(0,0,c.width,c.height); // magenta = transparent
        cx.drawImage(im, x,y,w,h, 0,0,w*S,h*S);
        return c.toDataURL('image/png');
      }, {img,x,y,w,h});
      if (durl) fs.writeFileSync('crop_'+img+'_'+name+'.png', Buffer.from(durl.split(',')[1],'base64'));
    }
  }
  console.log('crops done'); await browser.close(); srv.kill();
})().catch(e => { console.error(e); process.exit(1); });
