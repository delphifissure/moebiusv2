// CPU-replicate the tear decision per texel-cell; map surviving WALL cells
// (displayed-depth span > step but kept) by the branch that kept them.
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
    bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer();
    const D = window._dbgFill;
    const { pw, ph, plug, srcDepth, thinM, haloM, dispD, rawD } = D;
    const step = fgTearStep;
    // streak region in source coords: screen (170-400, 90-360)
    const X0=250, Y0=240, X1=890, Y1=990, CW=X1-X0, CH=Y1-Y0;
    const rib = (i) => (thinM && thinM[i]) || (haloM && haloM[i]);
    // replicate cliffCore quickly for region only (pad 3)
    const counts = { wallThin:0, wallMismatch:0, wallNoRule:0, torn:0 };
    const mk = (fn) => { const c=document.createElement('canvas'); c.width=CW; c.height=CH;
      const cx=c.getContext('2d'); const id=cx.createImageData(CW,CH);
      for (let y=0;y<CH;y++) for (let x=0;x<CW;x++){ const i=(Y0+y)*pw+(X0+x), o=(y*CW+x)*4;
        const [r,g,b]=fn(i); id.data[o]=r; id.data[o+1]=g; id.data[o+2]=b; id.data[o+3]=255; }
      cx.putImageData(id,0,0); return c.toDataURL('image/png'); };
    // per CELL (i, right, down, diag): displayed span; decision approx (2 tris share cell)
    const cls = new Uint8Array(pw*ph);
    for (let y=Y0; y<Y1-1; y++) for (let x=X0; x<X1-1; x++) {
      const i=y*pw+x, i2=i+1, i3=i+pw, i4=i+pw+1;
      const dd=[dispD[i],dispD[i2],dispD[i3],dispD[i4]];
      const dmx=Math.max(...dd), dmn=Math.min(...dd);
      if (dmx-dmn <= step) continue;              // no displayed cliff here
      const rw=[rawD[i],rawD[i2],rawD[i3],rawD[i4]];
      const mn=Math.min(...rw), mx=Math.max(...rw);
      let mnI=[i,i2,i3,i4][rw.indexOf(mn)];
      const nR=(rib(i)?1:0)+(rib(i2)?1:0)+(rib(i3)?1:0)+(rib(i4)?1:0);
      const farMatch = Math.abs(plug[mnI]-mn) <= step;
      let c;
      if (nR>0 && nR<4 && farMatch) c=1;               // halo-edge torn
      else if (nR>0) c=2;                              // ribbon-kept WALL
      else if (mx-mn>step && farMatch) c=1;            // sharp torn
      else if (mx-mn>step) c=3;                        // far-mismatch WALL
      else c=4;                                        // displayed cliff, NO raw cliff, no ribbon: invisible to all rules
      cls[i]=c;
      if (c===1) counts.torn++; else if (c===2) counts.wallThin++;
      else if (c===3) counts.wallMismatch++; else counts.wallNoRule++;
    }
    const map = mk(i => {
      const c=cls[i];
      if (c===1) return [0,255,0];        // torn
      if (c===2) return [255,60,60];      // ribbon-kept wall
      if (c===3) return [255,220,0];      // far-mismatch wall
      if (c===4) return [80,140,255];     // cliff invisible to rules
      if (thinM&&thinM[i]) return [180,0,180];
      if (haloM&&haloM[i]) return [120,0,120];
      const v=Math.min(255,srcDepth[i]*255*2|0); return [v*0.35|0,v*0.35|0,v*0.35|0];
    });
    return { map, counts };
  });
  fs.writeFileSync('wallprobe_map.png', Buffer.from(res.map.split(',')[1],'base64'));
  console.log('cells:', JSON.stringify(res.counts));
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
