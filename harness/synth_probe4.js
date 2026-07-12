// Band-only vs interior error split inside the occluder footprint
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
    bgMPIMode = true; bgPlugMode='directional'; bgValidMode='auto';
    buildBackgroundLayer();
    const D = window._dbgFill;
    const { pw, ph, plug, band } = D;
    const gd = (y) => { if (y < meta.horizon) return meta.dSky/255;
      const t = (y - meta.horizon) / Math.max(1, meta.H - meta.horizon);
      return (meta.dHor + (meta.dNear - meta.dHor)*t)/255; };
    const out = [];
    for (const o of (meta.occs||[])) {
      let bn=0,bs=0,bmx=0, inn=0,ins=0,imx=0;
      for (let y=o.y0;y<o.y1;y++) for (let x=o.x0;x<o.x1;x++){
        const i=y*pw+x, e=plug[i]-gd(y), ae=Math.abs(e);
        if (band[i]) { bn++; bs+=ae; if(ae>bmx)bmx=ae; }
        else { inn++; ins+=ae; if(ae>imx)imx=ae; }
      }
      // ALSO: band pixels OUTSIDE the footprint (reveal fill above/below/beside edges)
      let on=0,os=0,omx=0;
      const PAD=40;
      for (let y=Math.max(0,o.y0-PAD);y<Math.min(ph,o.y1+PAD);y++) for (let x=Math.max(0,o.x0-PAD);x<Math.min(pw,o.x1+PAD);x++){
        if (y>=o.y0&&y<o.y1&&x>=o.x0&&x<o.x1) continue;
        const i=y*pw+x; if(!band[i]) continue;
        const e=Math.abs(plug[i]-gd(y)); on++; os+=e; if(e>omx)omx=e;
      }
      out.push({ bandN:bn, bandMean:+(bs/Math.max(1,bn)).toFixed(4), bandMax:+bmx.toFixed(4),
                 intN:inn, intMean:+(ins/Math.max(1,inn)).toFixed(4), intMax:+imx.toFixed(4),
                 outerN:on, outerMean:+(os/Math.max(1,on)).toFixed(4), outerMax:+omx.toFixed(4) });
    }
    return out;
  }, meta);
  console.log(NAME, JSON.stringify(res));
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
