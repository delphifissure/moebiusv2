// (1) exportDebugContactSheet must restore suppressed meshes before its
// buffer refresh (degenerate all-hole/all-invalid panels bug), and
// (2) the build overlay's progress bar + % elements must exist and settle
// at 100% on hide. State-level; frameless.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 160)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate(() => {
    // stub the download so the sheet composes without navigating
    HTMLAnchorElement.prototype.click = function () {};
    bgMPIFullPlanes = false; bgMPIMode = true; bgPlugMode = 'directional'; bgValidMode = 'auto';
    buildBackgroundLayer();
    const partVis = () => (mpiLayers && mpiLayers.length) ? mpiLayers.filter(L => L.mesh && L.mesh.visible).length : 0;
    const composedBefore = { bg: bgLayerMesh ? bgLayerMesh.visible : null, part: partVis() };
    // enter a pipeline view -> suppression hides the stack
    document.getElementById('debugViewSelect').value = 'gaps';
    render();
    const suppressed = { bg: bgLayerMesh ? bgLayerMesh.visible : null, part: partVis(), src: mediaLayers[0].mesh.visible };
    // export the sheet FROM the suppressed state — must restore first
    let exportErr = null;
    try { exportDebugContactSheet(); } catch (e) { exportErr = String(e).slice(0, 160); }
    const afterExport = { bg: bgLayerMesh ? bgLayerMesh.visible : null, part: partVis(), src: mediaLayers[0].mesh.visible };
    // back to composed
    document.getElementById('debugViewSelect').value = 'final';
    useInpainting = true;
    render();
    const composedAfter = { bg: bgLayerMesh ? bgLayerMesh.visible : null, part: partVis(), src: mediaLayers[0].mesh.visible };
    // overlay bar elements
    showBuildOverlay('test', 1000);
    const barOk = !!document.getElementById('bgBuildBar') && !!document.getElementById('bgBuildPct');
    hideBuildOverlay();
    const pctAfter = document.getElementById('bgBuildPct').textContent;
    return { composedBefore, suppressed, afterExport, composedAfter, exportErr, barOk, pctAfter };
  });
  console.log(JSON.stringify(res, null, 1));
  const checks = [
    ['suppression engaged in gaps view', res.suppressed.bg === false && res.suppressed.part === 0 && res.suppressed.src === true],
    ['export restored the stack',        res.afterExport.bg === true && res.afterExport.part === res.composedBefore.part],
    ['export threw nothing',             !res.exportErr],
    ['composed state after final',       res.composedAfter.bg === true && res.composedAfter.part === res.composedBefore.part && res.composedAfter.src === false],
    ['overlay bar + pct exist',          res.barOk],
    ['pct settles at 100%',              res.pctAfter === '100%'],
  ];
  let pass = true;
  for (const [n, ok] of checks) { console.log((ok ? 'OK  ' : 'FAIL'), n); if (!ok) pass = false; }
  if (errs.length) console.log('PAGEERRORS:', errs.slice(0, 5));
  console.log(pass ? 'ALL CHECKS PASS' : 'CHECKS FAILED');
  await browser.close(); srv.kill();
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
