// Find argmax band-error pixels in footprint + local context dump
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
    const { pw, ph, plug, band, srcDepth } = D;
    const gd = (y) => { if (y < meta.horizon) return meta.dSky/255;
      const t = (y - meta.horizon) / Math.max(1, meta.H - meta.horizon);
      return (meta.dHor + (meta.dNear - meta.dHor)*t)/255; };
    const o = meta.occs[0];
    // top-20 band errors
    const errs = [];
    for (let y=o.y0;y<o.y1;y++) for (let x=o.x0;x<o.x1;x++){
      const i=y*pw+x; if(!band[i]) continue;
      const e=plug[i]-gd(y);
      errs.push([Math.abs(e), x, y, +plug[i].toFixed(4), +gd(y).toFixed(4), +srcDepth[i].toFixed(4)]);
    }
    errs.sort((a,b)=>b[0]-a[0]);
    return { top: errs.slice(0,20).map(e=>[+e[0].toFixed(4),e[1],e[2],e[3],e[4],e[5]]) };
  }, meta);
  console.log(NAME, 'top band errors [absErr, x, y, plug, truth, src]:');
  for (const t of res.top) console.log(' ', t.join('  '));
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
