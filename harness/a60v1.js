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
  page.on('console', m => { const t=m.text(); if (/RUNG-PLUG|live plug|ERR|error/i.test(t)) console.log('  [pg] '+t.slice(0,100)); });
  page.on('pageerror', e => console.log('  [PAGEERR] '+e.message.slice(0,120)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
  const rp = await page.evaluate(() => { bgQuickBake=false; bgMPIFullPlanes=false; bgMPIMode=false; buildBackgroundLayer(); return (typeof bgRayReproject!=='undefined'?bgRayReproject:'undef'); });
  console.log('built v1, reproject-default=' + rp);
  const shot = async (dx, dy, tag) => { const png = await page.evaluate(async ({dx,dy}) => {
    isSweeping = true;
    await new Promise(r2 => { let n=0; const tick=()=>{ camera.position.set(dx,dy,0.2); n++; n<6?requestAnimationFrame(tick):r2(); }; requestAnimationFrame(tick); });
    render(); return renderer.domElement.toDataURL('image/png');
  }, {dx,dy}); fs.writeFileSync(OUT+'/'+tag+'.png', Buffer.from(png.split(',')[1],'base64')); console.log('wrote '+tag); };
  await shot(0, 0, 'v1rp_c');
  await shot(0.42, 0, 'v1rp_r');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
