const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const MPI = process.argv[2] !== 'off';
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate(async (MPI) => {
    bgMPIMode = MPI;
    bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer();
    await new Promise(r2 => { let n=0; const tick=()=>{ n++; n<6?requestAnimationFrame(tick):r2(); }; requestAnimationFrame(tick); });
    const L = mediaLayers[0];
    const g = (m) => m ? { vis: m.visible, scale: [m.scale.x.toFixed(4), m.scale.y.toFixed(4)], pos: [m.position.x.toFixed(3), m.position.y.toFixed(3), m.position.z.toFixed(3)] } : null;
    return {
      fg: g(L.mesh), plate: g(bgLayerMesh),
      mpi0: (typeof mpiLayers !== 'undefined' && mpiLayers && mpiLayers.length) ? g(mpiLayers[mpiLayers.length-1].mesh) : null,
      cam: { pos: [camera.position.x.toFixed(3), camera.position.y.toFixed(3), camera.position.z.toFixed(3)], fov: camera.fov, zoom: camera.zoom },
      terrarium: [typeof terrariumWidth !== 'undefined' ? terrariumWidth : null, typeof terrariumHeight !== 'undefined' ? terrariumHeight : null],
      geomParams: L.mesh.geometry.parameters ? [L.mesh.geometry.parameters.width, L.mesh.geometry.parameters.height] : null
    };
  }, MPI);
  console.log('MPI=' + MPI, JSON.stringify(res, null, 1));
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
