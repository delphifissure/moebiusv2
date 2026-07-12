// POST-BAKE UX CONTRACT (state-level): after a v1 bake (or v2 build),
// pipeline debug views and the Enable Inpainting checkbox must still
// work. On SwiftShader boxes the REALTIME pipeline cannot deliver frames
// at all (the user's GPU can), so this test verifies the SUPPRESSION
// CONTRACT synchronously: render() is invoked directly and the
// visibility flags it sets are inspected — no dependence on rAF/frames.
//   final + inpainting ON   -> baked meshes VISIBLE (composed view)
//   final + inpainting OFF  -> baked meshes HIDDEN  (raw parallax view)
//   any pipeline debug view -> baked meshes HIDDEN, sources visible
//   back to final + ON      -> baked meshes restored
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const MODE = process.argv[2] || 'v1';   // v1 | v2
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
  // #28 regression: nothing must have built on its own
  const auto = await page.evaluate(() => ({
    userBuilt: !!window._bgUserBuiltOnce,
    planes: (typeof mpiFullMeshes !== 'undefined' && mpiFullMeshes) ? mpiFullMeshes.length : 0,
    bg: !!(typeof bgLayerMesh !== 'undefined' && bgLayerMesh),
  }));
  console.log('no-autobuild-on-load:', JSON.stringify(auto),
    (!auto.userBuilt && !auto.planes && !auto.bg) ? 'OK' : 'FAIL');
  // build (long: SwiftShader grinds the GPU passes; evaluate blocks on readbacks)
  console.log('building', MODE, '...');
  const t0 = Date.now();
  const built = await page.evaluate((MODE) => {
    bgMPIFullPlanes = (MODE === 'v2');
    if (MODE === 'v1') { bgMPIMode = true; bgPlugMode = 'directional'; bgValidMode = 'auto'; }
    const ok = buildBackgroundLayer();
    return { ok: ok !== false,
      bg: !!(typeof bgLayerMesh !== 'undefined' && bgLayerMesh),
      planes: (typeof mpiFullMeshes !== 'undefined' && mpiFullMeshes) ? mpiFullMeshes.length : 0 };
  }, MODE);
  console.log('built in', ((Date.now()-t0)/1000).toFixed(0)+'s:', JSON.stringify(built));
  // state probe: set view + checkbox, call render() once, read visibility
  const probe = (view, inpaint) => page.evaluate(({ view, inpaint }) => {
    document.getElementById('debugViewSelect').value = view;
    const chk = document.getElementById('useInpaintingCheckbox');
    if (chk) { chk.checked = inpaint; chk.dispatchEvent(new Event('change')); }
    useInpainting = inpaint;
    render();
    const vis = (m) => (m ? m.visible : null);
    return {
      bg: (typeof bgLayerMesh !== 'undefined') ? vis(bgLayerMesh) : null,
      mid: (typeof mpiMidMesh !== 'undefined') ? vis(mpiMidMesh) : null,
      planesVisible: (typeof mpiFullMeshes !== 'undefined' && mpiFullMeshes && mpiFullMeshes.length)
        ? mpiFullMeshes.filter(m => m.visible).length : 0,
      partVisible: (typeof mpiLayers !== 'undefined' && mpiLayers && mpiLayers.length)
        ? mpiLayers.filter(Lr => Lr.mesh && Lr.mesh.visible).length : 0,
      src: vis(mediaLayers[0].mesh),
    };
  }, { view, inpaint });
  const composed = await probe('final', true);
  const raw      = await probe('final', false);
  const gaps     = await probe('gaps', true);
  const inp      = await probe('inpaint_only', true);
  const restored = await probe('final', true);
  console.log('final+ON   :', JSON.stringify(composed));
  console.log('final+OFF  :', JSON.stringify(raw));
  console.log('gaps       :', JSON.stringify(gaps));
  console.log('inpaintOnly:', JSON.stringify(inp));
  console.log('final+ON2  :', JSON.stringify(restored));
  // v1-MPI hides the source (the partition meshes render the FG);
  // v2 hides the source (the planes render everything). In BOTH cases the
  // raw/pipeline views must bring the source back and hide the stack.
  const srcHiddenComposed = (MODE === 'v2') || composed.partVisible > 0;
  const bakedShown  = (s) => MODE === 'v2' ? s.planesVisible > 0 : s.bg === true;
  const bakedHidden = (s) => (MODE === 'v2' ? s.planesVisible === 0 : (s.bg === false || s.bg === null)) && s.partVisible === 0;
  const checks = [
    ['composed shows baked',   bakedShown(composed)],
    ['raw hides baked+stack',  bakedHidden(raw)],
    ['raw shows source',       raw.src === true],
    ['gaps hides baked+stack', bakedHidden(gaps)],
    ['gaps shows source',      gaps.src === true],
    ['inpaint_only hides baked+stack', bakedHidden(inp)],
    ['restore shows baked',    bakedShown(restored)],
    ['restore src state',      srcHiddenComposed ? restored.src === false : restored.src === true],
    ['restore stack state',    restored.partVisible === composed.partVisible && restored.planesVisible === composed.planesVisible],
  ];
  let pass = true;
  for (const [n, ok] of checks) { console.log((ok ? 'OK  ' : 'FAIL'), n); if (!ok) pass = false; }
  if (errs.length) console.log('PAGEERRORS:', errs.slice(0, 5));
  console.log(pass ? 'ALL CHECKS PASS' : 'CHECKS FAILED');
  await browser.close(); srv.kill();
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
