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
  page.on('pageerror', e => console.log('  [PAGEERR] '+e.message.slice(0,160)));
  page.on('console', m => { const t=m.text(); if (/DIR-PLATE|cliff gate|BG-LAYER/i.test(t)) console.log('  [pg] '+t.slice(0,160)); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
  const res = await page.evaluate(() => {
    window._srCapture = true; window._rayReproject = true; window._inkSeat = false; window._strokeAdopt = false;
    window._dirPlate = true;
    window._dpProbeXY = [Math.round(0.25*1920), Math.round(0.75*1323)];
    bgQuickBake = true; buildBackgroundLayer();
    const dbg = window._qbDbg, mk = window._qbMask;
    if (!dbg || !mk) return { err: 'build failed (no capture)' };
    const { plate, d, pw, ph } = dbg; const disocc = mk.disocc;
    const col = (mediaLayers[0].elements && mediaLayers[0].elements.color) || mediaLayers[0].textures.color.image;
    const cv=document.createElement('canvas'); cv.width=pw; cv.height=ph; const c=cv.getContext('2d');
    c.drawImage(col,0,0,pw,ph); const id=c.getImageData(0,0,pw,ph);
    let nD=0;
    for(let i=0;i<pw*ph;i++){ if(disocc[i]){ nD++; const r=id.data[i*4],g=id.data[i*4+1],b=id.data[i*4+2];
      id.data[i*4]=Math.min(255,r*0.2+255*0.8); id.data[i*4+1]=g*0.2; id.data[i*4+2]=b*0.2; } }
    c.putImageData(id,0,0);
    let gUrl = null, nG = 0;
    if (mk.ground) { const g = mk.ground;
      const cv2=document.createElement('canvas'); cv2.width=pw; cv2.height=ph; const c2=cv2.getContext('2d');
      c2.drawImage(col,0,0,pw,ph); const id2=c2.getImageData(0,0,pw,ph);
      for(let i=0;i<pw*ph;i++){ if(g[i]){ nG++; const r=id2.data[i*4],gg=id2.data[i*4+1],b=id2.data[i*4+2];
        id2.data[i*4]=r*0.2; id2.data[i*4+1]=Math.min(255,gg*0.2+255*0.8); id2.data[i*4+2]=b*0.2; } }
      c2.putImageData(id2,0,0); gUrl = cv2.toDataURL('image/png');
    }
    // vertical profile through the runaway red field (x=0.25w) and a
    // second through the party/crest (x=0.65w): d vs plate every 20 rows
    const prof = [];
    for (const fx of [0.25, 0.65]) { const X = Math.round(fx*pw); const row = [];
      for (let fy = 0.70; fy <= 0.995; fy += 0.02) { const Y = Math.round(fy*ph); const ii = Y*pw+X;
        row.push(fy.toFixed(2)+':d='+d[ii].toFixed(3)+',p='+plate[ii].toFixed(3)); }
      prof.push('x='+fx+' | '+row.join(' ')); }
    return { pw, ph, nD, nG, url: cv.toDataURL('image/png'), gUrl, prof, probe: JSON.stringify(window._dpProbeOut||null), fts: (typeof fgTearStep!=='undefined'?fgTearStep:'?'), sc: 0.0025 };
  });
  if (res.err) { console.log('ERR', res.err); }
  else {
    console.log('dir SD mask nD='+res.nD+' ('+(100*res.nD/(res.pw*res.ph)).toFixed(1)+'%), ground nG='+res.nG+' ('+(100*res.nG/(res.pw*res.ph)).toFixed(1)+'%), fgTearStep='+res.fts);
    for (const p of res.prof) console.log('PROFILE ' + p);
    console.log('DPPROBE ' + res.probe);
    fs.writeFileSync(OUT+'/dp_dir_post.png', Buffer.from(res.url.split(',')[1],'base64'));
    if (res.gUrl) fs.writeFileSync(OUT+'/dp_ground.png', Buffer.from(res.gUrl.split(',')[1],'base64'));
    console.log('wrote dp_dir_post.png + dp_ground.png');
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
