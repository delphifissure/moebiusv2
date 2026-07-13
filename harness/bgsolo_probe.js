// A50 PROBE: BG-solo view of the v1 bake at user scale. Builds v1, hides
// every FG source mesh (the app's "foreground off" toggle), renders at a
// parallax pose, saves the canvas. Run live vs m_prefix.js to A/B the
// plate ink scrub. argv[2]='star'|'troll', argv[3]=out png, argv[4]=SRC
// variant ('' = live moebius.js), argv[5]='quick' for quick bake.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const OUT = process.argv[3] || 'bgsolo.png';
const SRC = process.argv[4] || null;
const QUICK = process.argv[5] === 'quick';
if (process.argv[2] === 'star') {
  fs.copyFileSync('../starwatcher_color.png', 'defaultImgColor.png');
  fs.copyFileSync('../starwatcher_depth.png', 'defaultImgDepth.png');
} else {
  fs.copyFileSync('../defaultImgColor.png', 'defaultImgColor.png');
  fs.copyFileSync('../defaultImgDepth.png', 'defaultImgDepth.png');
}
(async () => {
  let pageFile = 'scratch_moebius.html';
  if (SRC) {
    fs.copyFileSync(SRC, 'm_active.js');
    fs.writeFileSync('scratch_ab.html',
      fs.readFileSync('scratch_moebius.html', 'utf8').replace('src="moebius.js"', 'src="m_active.js"'));
    pageFile = 'scratch_ab.html';
  }
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('http://localhost:8099/' + pageFile, { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const shot = await page.evaluate(async (QUICK) => {
    if (QUICK) { bgQuickBake = true; buildBackgroundLayer(); }
    else {
      bgMPIFullPlanes = false; bgMPIMode = true; bgPlugMode = 'directional'; bgValidMode = 'auto';
      buildBackgroundLayer();
    }
    // "foreground off / bg only": hide every source layer mesh
    for (const Lx of mediaLayers) if (Lx.mesh) Lx.mesh.visible = false;
    isSweeping = true;
    await new Promise(r2 => { let n = 0; const tick = () => {
      camera.position.x = 0.064; camera.position.y = 0.065; camera.position.z = 0.2;
      n++; n < 8 ? requestAnimationFrame(tick) : r2(); }; requestAnimationFrame(tick); });
    render();
    return renderer.domElement.toDataURL('image/png');
  }, QUICK);
  fs.writeFileSync(OUT, Buffer.from(shot.split(',')[1], 'base64'));
  console.log('wrote', OUT);
  await browser.close(); srv.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
