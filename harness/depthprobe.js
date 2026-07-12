// Plate-depth forensics: where does plugDepth keep NEAR values (doppelganger)?
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
    window._dbgFillCapture = true;
    bgMPIFullPlanes=false; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer();
    const D = window._dbgFill;
    const { pw, ph, band, underMask, plug, srcDepth } = D;
    const X0=550, Y0=450, X1=1200, Y1=1100, CW=X1-X0, CH=Y1-Y0;
    const oT = bgOtsuThreshold(srcDepth, band);
    const mk = (fn) => { const c=document.createElement('canvas'); c.width=CW; c.height=CH;
      const cx=c.getContext('2d'); const id=cx.createImageData(CW,CH);
      for (let y=0;y<CH;y++) for (let x=0;x<CW;x++){ const i=(Y0+y)*pw+(X0+x), o=(y*CW+x)*4;
        const [r,g,b]=fn(i); id.data[o]=r; id.data[o+1]=g; id.data[o+2]=b; id.data[o+3]=255; }
      cx.putImageData(id,0,0); return c.toDataURL('image/png'); };
    const plugP = mk(i => { const v=Math.max(0,Math.min(255,plug[i]*255|0)); return [v,v,v]; });
    // residual near on the plate: plug depth still >= otsu (figure class), colour by class
    const resid = mk(i => {
      const nearPlate = plug[i] >= oT;
      if (nearPlate && underMask[i]) return [255,0,0];        // rind but STILL near (flood failed)
      if (nearPlate && band[i]) return [255,150,0];           // band but near
      if (nearPlate) return [255,255,0];                      // near plate, NOT in any completed set
      if (underMask[i]) return [0,180,0];
      if (band[i]) return [0,80,255];
      return [50,50,50];
    });
    let nNearOnly=0, nNearRind=0, nNearBand=0;
    for (let i=0;i<pw*ph;i++){ if (plug[i]>=oT){ if(underMask[i])nNearRind++; else if(band[i])nNearBand++; else nNearOnly++; } }
    return { plugP, resid, oT, nNearOnly, nNearRind, nNearBand };
  });
  fs.writeFileSync('depthprobe_plug.png', Buffer.from(res.plugP.split(',')[1],'base64'));
  fs.writeFileSync('depthprobe_resid.png', Buffer.from(res.resid.split(',')[1],'base64'));
  console.log('otsu', res.oT.toFixed(3), 'near-plate px: uncompleted', res.nNearOnly, 'rind-but-near', res.nNearRind, 'band-but-near', res.nNearBand);
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
