// A55 verify: capture [SEAT-FLOOR] log + re-measure party depth in the
// SHIPPED depth (L.textures.depth.image2d) after a v1 (or quick) bake.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const MODE = process.argv[2] || 'v1';
fs.copyFileSync('../starwatcher_color.png', 'defaultImgColor.png');
fs.copyFileSync('../starwatcher_depth.png', 'defaultImgDepth.png');
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const logs = [];
  page.on('console', m => { const t = m.text(); if (/SEAT-FLOOR|STROKE-REPAIR|RUNG-A/.test(t)) logs.push(t); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate((MODE) => {
    if (MODE === 'quick') { bgQuickBake = true; buildBackgroundLayer(); }
    else { bgMPIFullPlanes = false; bgMPIMode = true; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer(); }
    const L = mediaLayers[0];
    const oc = L.textures.depth.image2d;
    const W = oc.width, H = oc.height;
    const px = oc.getContext('2d').getImageData(0,0,W,H).data;
    const stat = (x0,x1,y0,y1) => { let n=0,s=0,mn=2,mx=-1,inc=0,nc=0;
      for (let y=y0;y<y1;y++) for (let x=x0;x<x1;x++){ const v=px[(y*W+x)*4]/255; n++; s+=v; if(v<mn)mn=v; if(v>mx)mx=v;
        if(x>x0&&x<x1-1&&y>y0&&y<y1-1){ let a=2,b=-1; for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const u=px[((y+dy)*W+(x+dx))*4]/255; if(u<a)a=u; if(u>b)b=u;} nc++; if(b-a>0.06)inc++; } }
      return { mean:+(s/n).toFixed(3), min:+mn.toFixed(3), max:+mx.toFixed(3), spread:+(mx-mn).toFixed(3), incoh:+(inc/Math.max(1,nc)).toFixed(3) }; };
    return { W, H, party: stat(1180,1520,900,1120), ground: stat(820,1080,900,1000) };
  }, MODE);
  console.log(JSON.stringify(res));
  console.log(logs.filter(t=>/SEAT-FLOOR/.test(t)).join('\n') || '(no SEAT-FLOOR log)');
  await browser.close(); srv.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
