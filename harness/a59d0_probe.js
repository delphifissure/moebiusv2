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
  page.on('console', m => { const t=m.text(); if (/plate plugs|ERR/.test(t)) console.log('  [pg] '+t.slice(0,110)); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
  await page.evaluate(() => { window._bgIslandDilate = 0; bgQuickBake = true; buildBackgroundLayer(); });
  console.log('built d0 (disocc-only, flush depth)');
  const shot = async (dx, dy, fgOn, tag) => { const png = await page.evaluate(async ({dx,dy,fgOn}) => {
    const L = mediaLayers[0]; isSweeping = true;
    await new Promise(r2 => { let n=0; const tick=()=>{ camera.position.x=dx; camera.position.y=dy; camera.position.z=0.2; n++; n<6?requestAnimationFrame(tick):r2(); }; requestAnimationFrame(tick); });
    L.mesh.visible = fgOn; render(); const p = renderer.domElement.toDataURL('image/png'); L.mesh.visible = true; return p;
  }, {dx,dy,fgOn}); fs.writeFileSync(OUT+'/'+tag+'.png', Buffer.from(png.split(',')[1],'base64')); console.log('wrote '+tag); };
  await shot(0,0,false,'d0_headplate');   // tight silhouette head-on
  await shot(0.42,0,true,'d0_offcomp');   // off-axis composite: gaps?
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
