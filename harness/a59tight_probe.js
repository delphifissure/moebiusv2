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
  const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
  page.on('console', m => { const t=m.text(); if (/plate plugs|ERR/.test(t)) console.log('  [pg] '+t.slice(0,120)); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
  const shot = async (dx, dy, fgOn) => await page.evaluate(async ({dx,dy,fgOn}) => {
    const L = mediaLayers[0]; isSweeping = true;
    await new Promise(r2 => { let n=0; const tick=()=>{ camera.position.x=dx; camera.position.y=dy; camera.position.z=0.2; n++; n<6?requestAnimationFrame(tick):r2(); }; requestAnimationFrame(tick); });
    L.mesh.visible = fgOn; render(); const png = renderer.domElement.toDataURL('image/png'); L.mesh.visible = true; return png;
  }, {dx,dy,fgOn});
  const build = async (dil) => { await page.evaluate((d) => { if (d < 0) delete window._bgIslandDilate; else window._bgIslandDilate = d; bgQuickBake = true; buildBackgroundLayer(); }, dil); await new Promise(r => setTimeout(r, 300)); };
  // config: [tag, dilate]  (dilate<0 = default bud band; >=0 = fixed px)
  for (const [tag, dil] of [['bud', -1], ['d0', 0], ['d6', 6]]) {
    await build(dil);
    const hp = await shot(0,0,false);      fs.writeFileSync(OUT+'/tight_'+tag+'_headplate.png', Buffer.from(hp.split(',')[1],'base64'));
    const oc = await shot(0.42,0,true);    fs.writeFileSync(OUT+'/tight_'+tag+'_offcomp.png',  Buffer.from(oc.split(',')[1],'base64'));
    console.log('wrote '+tag);
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
