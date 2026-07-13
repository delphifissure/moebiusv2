// A50 PROBE: is the BG-solo outline the plate's SHARED PRE-TORN GEOMETRY?
// Quick bake, hide FG, set clear colour MAGENTA (holes light up), render;
// then restore the FULL index on the shared geometry and render again.
// argv[2]='star'|'troll', argv[3]=out dir.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const OUT = process.argv[3] || '.';
if (process.argv[2] === 'star') {
  fs.copyFileSync('../starwatcher_color.png', 'defaultImgColor.png');
  fs.copyFileSync('../starwatcher_depth.png', 'defaultImgDepth.png');
} else {
  fs.copyFileSync('../defaultImgColor.png', 'defaultImgColor.png');
  fs.copyFileSync('../defaultImgDepth.png', 'defaultImgDepth.png');
}
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate(async () => {
    bgQuickBake = true;
    buildBackgroundLayer();
    const L = mediaLayers[0];
    const shared = bgLayerMesh.geometry === L.mesh.geometry;
    for (const Lx of mediaLayers) if (Lx.mesh) Lx.mesh.visible = false;
    renderer.setClearColor(new THREE.Color(1, 0, 1), 1.0);   // magenta backdrop
    isSweeping = true;
    await new Promise(r2 => { let n = 0; const tick = () => {
      camera.position.x = 0.064; camera.position.y = 0.065; camera.position.z = 0.2;
      n++; n < 8 ? requestAnimationFrame(tick) : r2(); }; requestAnimationFrame(tick); });
    render();
    const torn = renderer.domElement.toDataURL('image/png');
    // restore the FULL index on the shared geometry and re-render
    const g = bgLayerMesh.geometry;
    let restored = false;
    if (g.userData._fullIndex) {
      g.setIndex(new THREE.BufferAttribute(g.userData._fullIndex.slice(), 1));
      restored = true;
    }
    render();
    const full = renderer.domElement.toDataURL('image/png');
    return { shared, restored, torn, full };
  });
  fs.writeFileSync(OUT + '/th_torn.png', Buffer.from(res.torn.split(',')[1], 'base64'));
  fs.writeFileSync(OUT + '/th_full.png', Buffer.from(res.full.split(',')[1], 'base64'));
  console.log(JSON.stringify({ sharedGeometry: res.shared, restoredFullIndex: res.restored }));
  await browser.close(); srv.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
