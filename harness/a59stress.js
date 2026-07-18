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
  const page = await browser.newPage({ viewport: { width: 760, height: 470 } });
  page.on('console', m => { const t=m.text(); if (/plate plugs|ERR|error/i.test(t)) console.log('  [pg] '+t.slice(0,100)); });
  page.on('pageerror', e => console.log('  [PAGEERR] '+e.message.slice(0,120)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
  await page.evaluate(() => { bgQuickBake = true; buildBackgroundLayer(); });
  console.log('built');
  // reproduce the user's extreme angle; optionally set a distant focal plane (mountain)
  const shot = async (px, py, pz, focal, reproj, tag) => { const png = await page.evaluate(async ({px,py,pz,focal,reproj}) => {
    window._rayReproject = reproj;
    if (focal != null) currentNormPortalPlane = focal;   // move the focal/split plane (distant = low)
    const L = mediaLayers[0]; isSweeping = true;
    await new Promise(r2 => { let n=0; const tick=()=>{ camera.position.set(px,py,pz); n++; n<8?requestAnimationFrame(tick):r2(); }; requestAnimationFrame(tick); });
    render(); return renderer.domElement.toDataURL('image/png');
  }, {px,py,pz,focal,reproj}); fs.writeFileSync(OUT+'/'+tag+'.png', Buffer.from(png.split(',')[1],'base64')); console.log('wrote '+tag); };
  // user's exact camera, default focal: OFF (reproduce streaks) vs ON
  await shot(-0.233, 0.040, 0.056, 0.5, false, 'st_ext_off');
  await shot(-0.233, 0.040, 0.056, 0.5, true,  'st_ext_on');
  // distant focal plane (mountain ~0.25) + strong rotate: the user's worst case
  await shot(-0.30, 0.05, 0.10, 0.25, false, 'st_farfoc_off');
  await shot(-0.30, 0.05, 0.10, 0.25, true,  'st_farfoc_on');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
