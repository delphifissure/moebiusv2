// What strip content sits at screen (288,198)? Dump slots at mapped plate coords.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('console', m => { const t=m.text(); if (/per-layer plates|layer-strip/i.test(t)) console.log('  [pg]', t.slice(0,140)); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate(async () => {
    window._dbgFillCapture = true;
    bgMPIMode = true; bgPlugMode='directional'; bgValidMode='auto';
    buildBackgroundLayer();
    const D = window._dbgFill;
    const { pw, ph } = D;
    // screen(288,198) of 860x484 -> plate
    const s = Math.min(860/pw, 484/ph), x0 = (860-pw*s)/2, y0 = (484-ph*s)/2;
    const px2 = Math.round((288-x0)/s), py2 = Math.round((198-y0)/s);
    // need slot data: re-derive via debug? _strip* are function-local. Use meanD/texLayer + mpiLayers instead:
    const md = window._mpiDebug;
    const out = [];
    for (let dy = -12; dy <= 12; dy += 6) { const r = ['y='+(py2+dy)];
      for (let dx = -30; dx <= 30; dx += 10) {
        const x = px2+dx, y = py2+dy, i = y*pw+x;
        r.push(x+':L'+(md ? md.texLayer[i] : '?')+' d'+D.srcDepth[i].toFixed(2)+' p'+D.plug[i].toFixed(2)+(D.band[i]?'B':D.underMask&&D.underMask[i]?'U':'-'));
      }
      out.push(r.join('  '));
    }
    const meanD = md ? Array.from(md.meanD).map(v=>+v.toFixed(3)) : null;
    return { pw, ph, px2, py2, out, meanD };
  });
  console.log('plate', res.pw+'x'+res.ph, ' screen(288,198) -> plate', res.px2+','+res.py2);
  console.log('layer meanD:', JSON.stringify(res.meanD));
  for (const r of res.out) console.log(r);
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
