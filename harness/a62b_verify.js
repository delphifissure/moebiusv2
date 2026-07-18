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
  page.on('console', m => { const t=m.text(); if (/DIR-PLATE|RUNG-PLUG directional|cliff gate|MPI-V2|MPI\]|QUICK-BAKE plate|ink-adjacency|BG-LAYER/i.test(t)) console.log('  [pg] '+t.slice(0,130)); });
  const shot = async (dx, dy, tag) => { const png = await page.evaluate(async ({dx,dy}) => {
    isSweeping = true;
    await new Promise(r2 => { let n=0; const tick=()=>{ camera.position.set(dx,dy,0.2); n++; n<6?requestAnimationFrame(tick):r2(); }; requestAnimationFrame(tick); });
    render(); return renderer.domElement.toDataURL('image/png');
  }, {dx,dy}); fs.writeFileSync(OUT+'/'+tag+'.png', Buffer.from(png.split(',')[1],'base64')); console.log('wrote '+tag); };
  const load = async () => { await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); } };

  // QUICK (refactored helper + closure)
  await load();
  await page.evaluate(() => { window._rayReproject=true; bgQuickBake=true; buildBackgroundLayer(); });
  await new Promise(r => setTimeout(r, 400));
  await shot(0.42, 0.02, 'a62b_quick');

  // V1 (dir plate feeds fl/floorC)
  await load();
  await page.evaluate(() => { window._rayReproject=true; bgQuickBake=false; bgMPIFullPlanes=false; bgMPIMode=false; buildBackgroundLayer(); });
  await new Promise(r => setTimeout(r, 400));
  await shot(0.42, 0.02, 'a62b_v1');

  // V2 (full planes; under-sheet fl = dir plate)
  await load();
  await page.evaluate(() => { window._rayReproject=true; bgQuickBake=false; bgMPIFullPlanes=true; bgMPIMode=true; buildBackgroundLayer(); });
  await new Promise(r => setTimeout(r, 400));
  await shot(0.42, 0.02, 'a62b_v2');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
