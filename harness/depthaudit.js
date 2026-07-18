const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const OUT = process.argv[2] || '.';
fs.copyFileSync('../starwatcher_color.png', 'defaultImgColor.png');
fs.copyFileSync('../starwatcher_depth.png', 'defaultImgDepth.png');
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
  page.on('pageerror', e => console.log('  [PAGEERR] '+e.message.slice(0,140)));
  page.on('console', m => { const t=m.text(); if (/RUNG-A|STROKE-REPAIR|elements/i.test(t)) console.log('  [pg] '+t.slice(0,130)); });

  const configs = [
    { tag:'base',    flags:{} },
    { tag:'noramp',  flags:{noRamp:true} },
    { tag:'noadopt', flags:{noAdopt:true} },
    { tag:'raw',     flags:{noRamp:true, noAdopt:true, raw:true} },
  ];
  for (const c of configs) {
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
    for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
    const res = await page.evaluate((f) => {
      const L = mediaLayers[0];
      window._inkSeat = false;
      window._noRampCollapse = !!f.noRamp;
      window._noStrokeAdopt = !!f.noAdopt;
      window._rawPass = !!f.raw;
      L._liveBaked = false;
      const okEl = !!(L.elements && L.elements.depth);
      const ok = applyLiveBake(L);
      const oc = L.textures.depth.image2d;
      const w = oc.width, h = oc.height;
      return { ok, okEl, w, h, url: oc.toDataURL('image/png') };
    }, c.flags);
    console.log(c.tag, 'ok='+res.ok, 'elemDepth='+res.okEl, res.w+'x'+res.h);
    fs.writeFileSync(OUT+'/depth_'+c.tag+'.png', Buffer.from(res.url.split(',')[1],'base64'));
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
