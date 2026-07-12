// Spatial forensics for a synth scene: plug error map inside footprints,
// floor-rind sweep mask, and pose hole map (content vs letterbox).
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const NAME = process.argv[2];
const meta = JSON.parse(fs.readFileSync(`synth/${NAME}_meta.json`, 'utf8'));
(async () => {
  fs.copyFileSync(`synth/${NAME}_color.png`, 'defaultImgColor.png');
  fs.copyFileSync(`synth/${NAME}_depth.png`, 'defaultImgDepth.png');
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('pageerror', e => console.log('PAGEERR', String(e).slice(0,200)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate(async (meta) => {
    window._dbgFillCapture = true;
    bgMPIMode = true; bgMPIFullPlanes=false; bgPlugMode='directional'; bgValidMode='auto';
    buildBackgroundLayer();
    const D = window._dbgFill;
    const { pw, ph, plug, srcDepth, band, underMask } = D;
    const gd = (y) => {
      if (y < meta.horizon) return meta.dSky/255;
      const t = (y - meta.horizon) / Math.max(1, meta.H - meta.horizon);
      return (meta.dHor + (meta.dNear - meta.dHor)*t)/255;
    };
    const o = meta.occs[0];
    const CW = o.x1-o.x0, CH = o.y1-o.y0;
    // error map: red = plug NEARER than truth, blue = plug FARTHER than truth
    const mk = (w, h, fn) => { const c=document.createElement('canvas'); c.width=w; c.height=h;
      const cx=c.getContext('2d'); const id=cx.createImageData(w,h);
      for (let y=0;y<h;y++) for (let x=0;x<w;x++){ const oo=(y*w+x)*4;
        const [r,g,b]=fn(x,y); id.data[oo]=r; id.data[oo+1]=g; id.data[oo+2]=b; id.data[oo+3]=255; }
      cx.putImageData(id,0,0); return c.toDataURL('image/png'); };
    // per-row error profile down the footprint center column band
    const rows = [];
    for (let y=o.y0; y<o.y1; y+=10) {
      let s=0,c=0; for (let x=o.x0+5;x<o.x1-5;x++){ s += plug[y*pw+x]-gd(y); c++; }
      rows.push([y, +(s/c).toFixed(4), +gd(y).toFixed(4)]);
    }
    const err = mk(CW, CH, (x,y) => {
      const i = (o.y0+y)*pw + (o.x0+x);
      const e = plug[i] - gd(o.y0+y);
      const m = Math.min(255, Math.abs(e)*1200);
      return e > 0 ? [m,40,40] : [40,40,m];
    });
    // srcDepth-based rind estimate: reproduce fgm sweep condition offline
    // (D may not carry fgm; approximate: count band/under coverage instead)
    let bandN=0, underN=0; for (let i=0;i<pw*ph;i++){ if(band[i])bandN++; if(underMask&&underMask[i])underN++; }
    // pose hole map
    isSweeping = true;
    camera.position.x = 0.123; camera.position.y = -0.055;
    await new Promise(r2 => { let n=0; const tick=()=>{ camera.position.x=0.123; camera.position.y=-0.055; n++; n<6?requestAnimationFrame(tick):r2(); }; requestAnimationFrame(tick); });
    const cnv = document.getElementById('canvas');
    const g = document.createElement('canvas'); g.width=cnv.width; g.height=cnv.height;
    const gx = g.getContext('2d'); gx.drawImage(cnv,0,0);
    const px = gx.getImageData(0,0,g.width,g.height).data;
    // content rect on canvas: mesh fit — derive from planeW/planeH & camera? use alpha of REST render instead:
    // classify holes by x-position: within middle 90% width band vs outer
    let holesIn=0, holesOut=0; const W=g.width, H=g.height;
    const holeMap = mk(W, H, (x,y)=>{ const a=px[(y*W+x)*4+3]; return a<128?[255,0,0]:[0,Math.min(255,px[(y*W+x)*4]),0]; });
    for (let y=0;y<H;y++) for (let x=0;x<W;x++){ if (px[(y*W+x)*4+3]<128){ if (x>W*0.18 && x<W*0.82) holesIn++; else holesOut++; } }
    return { rows, err, holeMap, bandN, underN, holesIn, holesOut, W, H, pw, ph };
  }, meta);
  fs.writeFileSync(`${NAME}_errmap.png`, Buffer.from(res.err.split(',')[1],'base64'));
  fs.writeFileSync(`${NAME}_holemap.png`, Buffer.from(res.holeMap.split(',')[1],'base64'));
  console.log('rows [y, meanErr(plug-truth), truth]:');
  for (const r of res.rows) console.log(' ', r.join('  '));
  console.log('band', res.bandN, 'under', res.underN, 'holesIn(mid82%)', res.holesIn, 'holesOut', res.holesOut);
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
