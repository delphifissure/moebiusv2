const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const COLOR = process.argv[2], DEPTH = process.argv[3], TAG = process.argv[4] || 'gen';
const OUT = '.';
fs.copyFileSync(COLOR, 'defaultImgColor.png');
fs.copyFileSync(DEPTH, 'defaultImgDepth.png');
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
  page.on('pageerror', e => console.log('  [PAGEERR] '+e.message.slice(0,140)));
  page.on('console', m => { const t=m.text(); if (/DIR-PLATE|ink-adjacency|GUARD|BG-LAYER.*failed/i.test(t)) console.log('  [pg] '+t.slice(0,130)); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
  const res = await page.evaluate(() => {
    window._srCapture = true; window._rayReproject = true;
    bgQuickBake = true; buildBackgroundLayer();
    const dbg = window._qbDbg, mk = window._qbMask;
    if (!dbg || !mk) return { err: 'build failed' };
    const { pw, ph } = dbg; const disocc = mk.disocc; const g = mk.ground;
    const col = (mediaLayers[0].elements && mediaLayers[0].elements.color) || mediaLayers[0].textures.color.image;
    const ov = (fn, tint) => { const cv=document.createElement('canvas'); cv.width=pw; cv.height=ph; const c=cv.getContext('2d');
      c.drawImage(col,0,0,pw,ph); const id=c.getImageData(0,0,pw,ph);
      for(let i=0;i<pw*ph;i++){ if(fn(i)){ const r=id.data[i*4],gg=id.data[i*4+1],b=id.data[i*4+2];
        if(tint==='r'){id.data[i*4]=Math.min(255,r*0.2+255*0.8); id.data[i*4+1]=gg*0.2; id.data[i*4+2]=b*0.2;}
        else {id.data[i*4]=r*0.2; id.data[i*4+1]=Math.min(255,gg*0.2+255*0.8); id.data[i*4+2]=b*0.2;} } }
      c.putImageData(id,0,0); return cv.toDataURL('image/png'); };
    let nD=0,nG=0; for(let i=0;i<pw*ph;i++){ if(disocc[i])nD++; if(g&&g[i])nG++; }
    return { pw, ph, nD, nG, sd: ov(i=>disocc[i],'r'), gr: g?ov(i=>g[i],'g'):null };
  });
  if (res.err) console.log('ERR', res.err);
  else {
    console.log(TAG+': SD='+res.nD+' ('+(100*res.nD/(res.pw*res.ph)).toFixed(1)+'%), ground='+(100*res.nG/(res.pw*res.ph)).toFixed(1)+'%');
    fs.writeFileSync(OUT+'/gen_'+TAG+'_sd.png', Buffer.from(res.sd.split(',')[1],'base64'));
    if (res.gr) fs.writeFileSync(OUT+'/gen_'+TAG+'_ground.png', Buffer.from(res.gr.split(',')[1],'base64'));
    console.log('wrote gen_'+TAG+'_{sd,ground}.png');
  }
  // 3D shot at offset
  const png = await page.evaluate(async () => {
    isSweeping = true;
    await new Promise(r2 => { let n=0; const tick=()=>{ camera.position.set(0.35,0.03,0.2); n++; n<6?requestAnimationFrame(tick):r2(); }; requestAnimationFrame(tick); });
    render(); return renderer.domElement.toDataURL('image/png');
  });
  fs.writeFileSync(OUT+'/gen_'+TAG+'_3d.png', Buffer.from(png.split(',')[1],'base64'));
  console.log('wrote gen_'+TAG+'_3d.png');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
