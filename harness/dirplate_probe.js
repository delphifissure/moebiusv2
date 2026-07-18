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
  page.on('console', m => { const t=m.text(); if (/DIR-PLATE|cliff gate/i.test(t)) console.log('  [pg] '+t.slice(0,110)); });

  const run = async (dir, tag) => {
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
    for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
    const res = await page.evaluate((dir) => {
      window._srCapture = true; window._rayReproject = true; window._inkSeat = false; window._strokeAdopt = false;
      window._dirPlate = !!dir;
      bgQuickBake = true; buildBackgroundLayer();
      const dbg = window._qbDbg, mk = window._qbMask;
      const { plate, d, pw, ph } = dbg; const disocc = mk.disocc;
      const col = (mediaLayers[0].elements && mediaLayers[0].elements.color) || mediaLayers[0].textures.color.image;
      const mkOv = (fn) => { const cv=document.createElement('canvas'); cv.width=pw; cv.height=ph; const c=cv.getContext('2d');
        c.drawImage(col,0,0,pw,ph); const id=c.getImageData(0,0,pw,ph);
        for(let i=0;i<pw*ph;i++){ if(fn(i)){ const r=id.data[i*4],g=id.data[i*4+1],b=id.data[i*4+2];
          id.data[i*4]=Math.min(255,r*0.2+255*0.8); id.data[i*4+1]=g*0.2; id.data[i*4+2]=b*0.2; } }
        c.putImageData(id,0,0); return cv.toDataURL('image/png'); };
      let nPre=0,nPost=0; for(let i=0;i<pw*ph;i++){ if(d[i]-plate[i]>0.02)nPre++; if(disocc[i])nPost++; }
      return { pw, ph, nPre, nPost, pre: mkOv(i=>d[i]-plate[i]>0.02), post: mkOv(i=>disocc[i]) };
    }, dir);
    console.log(tag, 'preGate='+res.nPre, 'postGate='+res.nPost);
    fs.writeFileSync(OUT+'/dp_'+tag+'_pre.png', Buffer.from(res.pre.split(',')[1],'base64'));
    fs.writeFileSync(OUT+'/dp_'+tag+'_post.png', Buffer.from(res.post.split(',')[1],'base64'));
  };
  await run(false, 'base');
  await run(true, 'dir');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
