const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const OUT = process.argv[2] || '.';
fs.copyFileSync('../starwatcher_color.png', 'defaultImgColor.png');
fs.copyFileSync('../starwatcher_depth.png', 'defaultImgDepth.png');
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
  page.on('pageerror', e => console.log('  [PAGEERR] '+e.message.slice(0,120)));
  page.on('console', m => { const t=m.text(); if (/QUICK-BAKE.*cliff gate|plate plugs/i.test(t)) console.log('  [pg] '+t.slice(0,120)); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
  const res = await page.evaluate(() => {
    window._srCapture = true; window._rayReproject = true;
    bgQuickBake = true; buildBackgroundLayer();
    const m = window._qbMask; if (!m) return { err: 'no _qbMask' };
    const { disocc, pw, ph } = m;
    let nD = 0; for (let i=0;i<pw*ph;i++) if (disocc[i]) nD++;
    const cv = document.createElement('canvas'); cv.width=pw; cv.height=ph;
    const ctx = cv.getContext('2d');
    const col = (mediaLayers[0].elements && mediaLayers[0].elements.color) || mediaLayers[0].textures.color.image;
    ctx.drawImage(col, 0, 0, pw, ph);
    const id = ctx.getImageData(0,0,pw,ph);
    for (let i=0;i<pw*ph;i++){ if(disocc[i]){ const r=id.data[i*4],g=id.data[i*4+1],b=id.data[i*4+2];
      id.data[i*4]=Math.min(255,r*0.25+255*0.75); id.data[i*4+1]=g*0.25; id.data[i*4+2]=b*0.25; } }
    ctx.putImageData(id,0,0);
    return { pw, ph, nD, url: cv.toDataURL('image/png') };
  });
  if (res.err) { console.log('ERR', res.err); } else {
    console.log('SD mask '+res.pw+'x'+res.ph+' nD='+res.nD+' ('+(100*res.nD/(res.pw*res.ph)).toFixed(1)+'%)');
    fs.writeFileSync(OUT+'/sdmask_overlay.png', Buffer.from(res.url.split(',')[1],'base64'));
    console.log('wrote sdmask_overlay.png');
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
