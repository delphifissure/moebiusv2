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
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 2000)); }
  const shot = async (dx, dy, fgOn, plateOn) => await page.evaluate(async ({dx,dy,fgOn,plateOn}) => {
    const L = mediaLayers[0];
    isSweeping = true;
    await new Promise(r2 => { let n=0; const tick=()=>{ camera.position.x=dx; camera.position.y=dy; camera.position.z=0.2; n++; n<8?requestAnimationFrame(tick):r2(); }; requestAnimationFrame(tick); });
    const bgv = bgLayerMesh?bgLayerMesh.visible:null;
    const cv=(typeof bgCardMesh!=='undefined'&&bgCardMesh)?bgCardMesh.visible:null;
    if (bgLayerMesh) bgLayerMesh.visible = plateOn;
    L.mesh.visible = fgOn;
    if (typeof bgCardMesh!=='undefined'&&bgCardMesh) bgCardMesh.visible = plateOn;
    render(); const png = renderer.domElement.toDataURL('image/png');
    L.mesh.visible = true; if (bgLayerMesh&&bgv!==null) bgLayerMesh.visible=bgv;
    if (typeof bgCardMesh!=='undefined'&&bgCardMesh&&cv!==null) bgCardMesh.visible=cv;
    return png;
  }, {dx,dy,fgOn,plateOn});
  await page.evaluate(() => { bgQuickBake = true; buildBackgroundLayer(); });
  await new Promise(r => setTimeout(r, 500));
  const cases = [
    ['headon_plate', 0.0, 0.0, false, true],   // plug islands head-on: should hug silhouette
    ['headon_fg',    0.0, 0.0, true,  false],   // FG silhouette head-on for comparison
    ['off_plate',    0.42,0.0, false, true],    // plug islands off-axis: projected shape
    ['off_comp',     0.42,0.0, true,  true],    // full composite off-axis
    ['up_plate',     0.0, 0.42,false, true],    // look-down plug (dune/party region)
    ['up_comp',      0.0, 0.42,true,  true],
  ];
  for (const [tag,dx,dy,fg,pl] of cases) {
    const png = await shot(dx,dy,fg,pl);
    fs.writeFileSync(OUT+'/'+tag+'.png', Buffer.from(png.split(',')[1],'base64'));
    console.log('wrote '+tag);
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
