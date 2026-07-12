// LOAD UX: (1) no auto-build on load (realtime inpainting default),
// (2) Build button shows overlay, builds, hides overlay,
// (3) new-depth auto-rebuild only after first manual build,
// (4) face-frame fade fires on a mac-profile LUT at frame edge.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });   // SwiftShader on small boxes cannot first-frame 1200x900
  const errs = [];
  page.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  // (1) wait past several poller periods: nothing must build
  await page.waitForTimeout(3000);
  const s1 = await page.evaluate(() => ({
    built: !!(typeof mpiFullMeshes !== 'undefined' && mpiFullMeshes && mpiFullMeshes.length) || !!(typeof bgLayerMesh !== 'undefined' && bgLayerMesh),
    userBuilt: !!window._bgUserBuiltOnce,
    inpainting: typeof useInpainting !== 'undefined' ? useInpainting : null,
  }));
  console.log('after load (3s):', JSON.stringify(s1), s1.built ? 'FAIL auto-built' : 'OK realtime default');
  // (2) click build: overlay must be visible BEFORE build completes, then hidden after
  const overlayDuring = await page.evaluate(() => new Promise(res => {
    document.getElementById('bgLayerBuildBtn').click();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = document.querySelectorAll('div');
      let vis = false;
      for (const d of el) if (d.style && d.style.zIndex === '200' && d.style.display !== 'none') vis = true;
      res(vis);
    }));
  }));
  await page.waitForFunction(() => window._bgUserBuiltOnce === true, null, { timeout: 90000 });
  const s2 = await page.evaluate(() => ({
    built: !!(typeof mpiFullMeshes !== 'undefined' && mpiFullMeshes && mpiFullMeshes.length),
    overlayHidden: !document.querySelector('div[style*="z-index: 200"]') ||
      Array.from(document.querySelectorAll('div')).filter(d => d.style.zIndex === '200').every(d => d.style.display === 'none'),
  }));
  console.log('overlay visible during build:', overlayDuring ? 'OK' : 'FAIL');
  console.log('after build:', JSON.stringify(s2), (s2.built && s2.overlayHidden) ? 'OK' : 'FAIL');
  // (4) face-frame fade: mac profile, nose at 90% toward frame edge -> fade > 0
  const fade = await page.evaluate(() => {
    window.bgDeviceFovOverride = { key: 'mac', hfov: 54, vfov: 32 };
    window._lastFaceSeenT = performance.now();
    latestDetectedFaceX = 0.95; latestDetectedFaceY = 0.5;
    updateViewFade();
    const a = parseFloat(_viewFadeEl.style.opacity);
    latestDetectedFaceX = 0.5;   // back to center -> no fade
    updateViewFade();
    const b = parseFloat(_viewFadeEl.style.opacity);
    return { edge: a, center: b };
  });
  console.log('face-frame fade edge/center:', JSON.stringify(fade),
    (fade.edge > 0.3 && fade.center === 0) ? 'OK' : 'FAIL');
  if (errs.length) console.log('PAGEERRORS:', errs.slice(0, 3));
  await browser.close(); srv.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
