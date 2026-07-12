// Stage isolation at specific pixels: fresh bgDirectionalPlug output vs final plugDepth
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
    const { pw, ph, plug, srcDepth, band } = D;
    // fresh directional plug on the same working depth
    const fresh = bgDirectionalPlug(srcDepth, pw, ph, {});
    const gd = (y) => { if (y < meta.horizon) return meta.dSky/255;
      const t = (y - meta.horizon) / Math.max(1, meta.H - meta.horizon);
      return (meta.dHor + (meta.dNear - meta.dHor)*t)/255; };
    const pts = [[188,193],[211,193],[188,209],[188,177],[170,193],[180,193],[186,193],[190,193],[200,193],[161,258]];
    const rows = pts.map(([x,y]) => {
      const i=y*pw+x;
      const a = fresh.rimSrc[i];
      return [x, y, band[i], fresh.band[i], +fresh.plug[i].toFixed(4), +plug[i].toFixed(4), +gd(y).toFixed(4),
              a>=0 ? (a%pw)+','+((a/pw)|0) : 'none', +srcDepth[i].toFixed(3)];
    });
    return { rows };
  }, meta);
  console.log(NAME, '[x y bandFinal bandFresh freshPlug finalPlug truth rimSrc src]:');
  for (const r of res.rows) console.log(' ', r.join('  '));
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
