// A71 UI test: drive the REAL moebius.html the way the user does —
// select a bake mode in the dropdown, click Build, verify what was built.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
fs.copyFileSync('../starwatcher_color.png', 'defaultImgColor.png');
fs.copyFileSync('../starwatcher_depth.png', 'defaultImgDepth.png');
// ui_test.html prepared separately (local deps)
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 900, height: 562 } });
  page.on('pageerror', e => console.log('  [PAGEERR] '+e.message.slice(0,140)));
  page.on('console', m => { const t = m.text(); if (t.indexOf('BG-BUILD') >= 0 || t.indexOf('MPI-V2') >= 0 || t.indexOf('QUICK-BAKE') >= 0) console.log('  [pg] ' + t.slice(0, 140)); });
  await page.goto('http://localhost:8099/ui_test.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
  const sel = await page.evaluate(() => {
    const s = document.getElementById('bgModeSel');
    return s ? { present: true, value: s.value, mode: window._bgBakeMode } : { present: false };
  });
  console.log('dropdown: ' + JSON.stringify(sel));
  // USER FLOW 1: pick Quick, click Build
  await page.evaluate(() => { const s = document.getElementById('bgModeSel'); s.value = 'quick'; s.dispatchEvent(new Event('change')); });
  await page.evaluate(() => document.getElementById("bgLayerBuildBtn").click());
  await page.waitForFunction(() => window._bgUserBuiltOnce === true, null, { timeout: 300000 });
  await new Promise(r => setTimeout(r, 800));
  const q = await page.evaluate(() => ({
    quickBaked: !!window._bgQuickBaked, mode: window._bgBakeMode,
    planes: !!(typeof mpiFullMeshes !== 'undefined' && mpiFullMeshes && mpiFullMeshes.length),
    plate: !!(typeof bgLayerMesh !== 'undefined' && bgLayerMesh) }));
  console.log((q.quickBaked && !q.planes ? 'PASS' : 'FAIL') + ' quick via dropdown: ' + JSON.stringify(q));
  // USER FLOW 2: switch dropdown to v2 — should auto-rebuild (built once already)
  await page.evaluate(() => { const s = document.getElementById('bgModeSel'); s.value = 'v2'; s.dispatchEvent(new Event('change')); });
  await page.waitForFunction(() => typeof mpiFullMeshes !== 'undefined' && mpiFullMeshes && mpiFullMeshes.length > 0, null, { timeout: 420000 });
  await new Promise(r => setTimeout(r, 800));
  const v = await page.evaluate(() => ({
    quickBaked: !!window._bgQuickBaked, mode: window._bgBakeMode,
    planes: (typeof mpiFullMeshes !== 'undefined' && mpiFullMeshes) ? mpiFullMeshes.length : 0 }));
  console.log((!v.quickBaked && v.planes > 0 ? 'PASS' : 'FAIL') + ' v2 auto-rebuild on switch: ' + JSON.stringify(v));
  // USER FLOW 3: back to quick — auto-rebuild, planes must be GONE
  await page.evaluate(() => { const s = document.getElementById('bgModeSel'); s.value = 'quick'; s.dispatchEvent(new Event('change')); });
  await page.waitForFunction(() => window._bgQuickBaked === true, null, { timeout: 300000 });
  await new Promise(r => setTimeout(r, 800));
  const q2 = await page.evaluate(() => ({
    quickBaked: !!window._bgQuickBaked,
    planes: (typeof mpiFullMeshes !== 'undefined' && mpiFullMeshes) ? mpiFullMeshes.length : 0,
    fgVisible: mediaLayers[0].mesh.visible }));
  console.log((q2.quickBaked && !q2.planes && q2.fgVisible ? 'PASS' : 'FAIL') + ' quick after v2 (planes cleaned, FG restored): ' + JSON.stringify(q2));
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
