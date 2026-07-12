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
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate(async () => {
    // read BAKED depth straight from the layer texture (pre-buildBackgroundLayer)
    const L = mediaLayers[0];
    const dSrc = L.textures.depth;
    const pw = dSrc.image2d ? dSrc.image2d.width : dSrc.image.width;
    const ph = dSrc.image2d ? dSrc.image2d.height : dSrc.image.height;
    const cv = document.createElement('canvas'); cv.width = pw; cv.height = ph;
    const cx = cv.getContext('2d');
    cx.drawImage(dSrc.image2d || dSrc.image, 0, 0, pw, ph);
    const dpx = cx.getImageData(0, 0, pw, ph).data;
    const X0=620, Y0=300, X1=900, Y1=650, CW=X1-X0, CH=Y1-Y0;
    const c = document.createElement('canvas'); c.width=CW; c.height=CH;
    const c2 = c.getContext('2d'); const id = c2.createImageData(CW,CH);
    let mx = 0;
    for (let y=0;y<CH;y++) for (let x=0;x<CW;x++){ const v=dpx[((Y0+y)*pw+(X0+x))*4];
      if (v>mx) mx=v;
      const o=(y*CW+x)*4; const g=Math.min(255,v*6); id.data[o]=g; id.data[o+1]=g; id.data[o+2]=g; id.data[o+3]=255; }
    c2.putImageData(id,0,0);
    // sample the light center column
    const cols = {};
    for (const X of [720,735,750,760]) { const col=[];
      for (let y=350; y<620; y+=20) col.push(dpx[(y*pw+X)*4]);
      cols[X]=col; }
    return { png: c.toDataURL('image/png'), cols, mx, pw, ph };
  });
  fs.writeFileSync('bakeprobe_light.png', Buffer.from(res.png.split(',')[1],'base64'));
  console.log('plate', res.pw+'x'+res.ph, 'max in box (x6 gain):', res.mx);
  for (const k in res.cols) console.log('x='+k, res.cols[k].join(','));
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
