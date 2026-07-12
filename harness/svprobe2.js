// SV bottom-gap forensics: what is the plate carrying between the wolves?
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
  page.on('console', m => { const t=m.text(); if (/standing-content|floor rind|membrane|ceiling/i.test(t)) console.log('  [pg]', t.slice(0,120)); });
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
    const { pw, ph, plug, srcDepth, band, underMask } = D;
    // screen(373,483) of 860x484: content fit for pw x ph
    const cw = 860, chh = 484;
    const s = Math.min(cw/pw, chh/ph), W2 = pw*s, H2 = ph*s, x0 = (cw-W2)/2;
    const px2 = Math.round((373 - x0)/s), py2 = Math.round(483/s);
    // dump a horizontal transect across the bottom rows around px2
    const rows = [];
    for (let y = Math.max(0,ph-6); y < ph; y += 2) { const r = ['y='+y];
      for (let x = Math.max(0,px2-90); x <= Math.min(pw-1,px2+90); x += 15) { const i=y*pw+x;
        r.push(x+':'+(band[i]?'B':underMask&&underMask[i]?'U':'-')+plug[i].toFixed(2)+'/'+srcDepth[i].toFixed(2)); }
      rows.push(r.join(' ')); }
    // also a vertical transect at px2
    const col = [];
    for (let y = ph-160; y < ph; y += 12) { const i=y*pw+px2;
      col.push(y+':'+(band[i]?'B':underMask&&underMask[i]?'U':'-')+plug[i].toFixed(2)+'/'+srcDepth[i].toFixed(2)); }
    return { pw, ph, px2, py2, rows, col };
  });
  console.log('plate', res.pw+'x'+res.ph, 'mapped screen(373,483) -> plate', res.px2+','+res.py2);
  for (const r of res.rows) console.log(r);
  console.log('col at x='+res.px2+':', res.col.join('  '));
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
