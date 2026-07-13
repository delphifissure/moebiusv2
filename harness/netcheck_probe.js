// A52 one-off: is the FG stretch net actually firing in quick mode?
// 1) dump armed uniforms; 2) uvRate=1.0 (whole mesh should discard if
// the net path works); 3) FG-solo (plate hidden) to localise striations.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const OUT = process.argv[2] || '.';
fs.copyFileSync('../starwatcher_color.png', 'defaultImgColor.png');
fs.copyFileSync('../starwatcher_depth.png', 'defaultImgDepth.png');
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
    const mu = L.mesh.material.uniforms;
    const st = {};
    for (const k of ['u_useBandCut','u_bandCutAll','u_bandCutUvRate','u_bandCutMismatch','u_bandCutMaxGrad'])
      st[k] = mu[k] ? mu[k].value : null;
    const pose = async () => { isSweeping = true;
      await new Promise(r2 => { let n = 0; const tick = () => {
        camera.position.x = 0.064; camera.position.y = 0.065; camera.position.z = 0.2;
        n++; n < 8 ? requestAnimationFrame(tick) : r2(); }; requestAnimationFrame(tick); });
      render(); };
    await pose();
    const base = renderer.domElement.toDataURL('image/png');
    mu.u_bandCutUvRate.value = 1.0;
    render();
    const nuke = renderer.domElement.toDataURL('image/png');
    mu.u_bandCutUvRate.value = st.u_bandCutUvRate;
    bgLayerMesh.visible = false;
    render();
    const fgsolo = renderer.domElement.toDataURL('image/png');
    bgLayerMesh.visible = true;
    return { st, base, nuke, fgsolo };
  });
  console.log(JSON.stringify(res.st));
  fs.writeFileSync(OUT + '/nc_base.png', Buffer.from(res.base.split(',')[1], 'base64'));
  fs.writeFileSync(OUT + '/nc_nuke.png', Buffer.from(res.nuke.split(',')[1], 'base64'));
  fs.writeFileSync(OUT + '/nc_fgsolo.png', Buffer.from(res.fgsolo.split(',')[1], 'base64'));
  await browser.close(); srv.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
