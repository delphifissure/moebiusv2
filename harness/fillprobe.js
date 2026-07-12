// Fill-path forensics for the black blob: which path coloured each pixel
// in the reveal right of the figure (source box ~650,620 - 1100,1000).
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
  page.on('console', m => { const t=m.text(); if (/RUNG-PLUG|error/i.test(t)) console.log('  [page]', t.slice(0,140)); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate(async () => {
    window._dbgFillCapture = true;
    bgMPIFullPlanes=false; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer();
    const D = window._dbgFill;
    if (!D) return { err: 'no _dbgFill' };
    const { pw, ph, fb, pre, smoothBase, band, underMask } = D;
    const X0=600, Y0=600, X1=1150, Y1=1020, CW=X1-X0, CH=Y1-Y0;
    // stats in box
    const n = [0,0,0,0,0];
    for (let y=Y0;y<Y1;y++) for (let x=X0;x<X1;x++) { const v=fb[y*pw+x]; if(v<5) n[v]++; }
    const mk = (fn) => { const c=document.createElement('canvas'); c.width=CW; c.height=CH;
      const cx=c.getContext('2d'); const id=cx.createImageData(CW,CH);
      for (let y=0;y<CH;y++) for (let x=0;x<CW;x++){ const i=(Y0+y)*pw+(X0+x), o=(y*CW+x)*4;
        const [r,g,b]=fn(i); id.data[o]=r; id.data[o+1]=g; id.data[o+2]=b; id.data[o+3]=255; }
      cx.putImageData(id,0,0); return c.toDataURL('image/png'); };
    const cat = mk(i => {
      const v = fb[i];
      if (v===1) return [40,90,255];    // band, own rim colour
      if (v===2) return [255,40,40];    // band, smoothBase FALLBACK
      if (v===3) return [40,200,40];    // under, carried rim colour
      if (v===4) return [255,220,0];    // under, smoothBase FALLBACK
      if (band[i]) return [150,0,150];  // band coloured elsewhere (reflection path)
      if (underMask && underMask[i]) return [0,150,150];
      return [60,60,60];
    });
    const preP = mk(i => [Math.min(255,pre[i*3]|0), Math.min(255,pre[i*3+1]|0), Math.min(255,pre[i*3+2]|0)]);
    const sb = mk(i => [Math.min(255,smoothBase[i*3]|0), Math.min(255,smoothBase[i*3+1]|0), Math.min(255,smoothBase[i*3+2]|0)]);
    return { cat, preP, sb, n, pw, ph };
  });
  if (res.err) { console.error(res.err); process.exit(1); }
  fs.writeFileSync('fillprobe_cat.png', Buffer.from(res.cat.split(',')[1],'base64'));
  fs.writeFileSync('fillprobe_pre.png', Buffer.from(res.preP.split(',')[1],'base64'));
  fs.writeFileSync('fillprobe_sb.png',  Buffer.from(res.sb.split(',')[1],'base64'));
  console.log('box counts [none,band+rim,band+FALLBACK,under+rim,under+FALLBACK]:', res.n.join(','), 'plate', res.pw+'x'+res.ph);
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
