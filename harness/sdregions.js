// A210 smoke test: SD-regions view marks OUTPAINT (orange, beyond the source
// frame) and INPAINT (cyan, interior disocclusions) at an off-axis pose, in
// quick-bake and in realtime (no bake). Saves frames for eyeballing and
// counts tinted pixels of each class.
//   node harness/sdregions.js
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const OUT = process.env.OUT || '/tmp/claude-0/-home-user-moebius/989b3965-28fd-58c7-96b5-b4b22c709919/scratchpad';

(async () => {
  fs.copyFileSync(path.join(WT, 'starwatcher_color.png'), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, 'starwatcher_depth.png'), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  console.log('served ' + await page.evaluate(() => MOEBIUS_BUILD));

  const run = async (bake, tag) => {
    const r = await page.evaluate(async (o) => {
      window._rayReproject = true;
      if (o.bake) { bgQuickBake = true; buildBackgroundLayer(); }
      window._sdHighlightOn = true;
      const setH = (mm) => { if (mm && mm.uniforms && mm.uniforms.u_sdHighlight) mm.uniforms.u_sdHighlight.value = true; };
      if (typeof bgLayerMesh !== 'undefined' && bgLayerMesh) setH(bgLayerMesh.material);
      if (typeof bgSkirtMesh !== 'undefined' && bgSkirtMesh) setH(bgSkirtMesh.material);
      for (const Lx of mediaLayers) if (Lx.mesh) setH(Lx.mesh.material);
      if (typeof updateVolumeGuidesVisibility === 'function') updateVolumeGuidesVisibility(false);
      isSweeping = true;
      camera.position.set(0.28, 0.03, 0.2);
      updateCameraAndProjection(); render(); updateCameraAndProjection(); render();
      const W = 720, Hh = 450;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
      const d = cx.getImageData(0, 0, W, Hh).data;
      let orange = 0, cyan = 0;
      for (let i = 0; i < W * Hh; i++) {
        const R = d[i*4], G = d[i*4+1], B = d[i*4+2];
        if (R > 150 && G > 60 && G < 160 && B < 80) orange++;
        else if (B > 150 && G > 100 && R < 110) cyan++;
      }
      isSweeping = false;
      return { orangePct: +(100*orange/(W*Hh)).toFixed(2), cyanPct: +(100*cyan/(W*Hh)).toFixed(2),
               backdrop: !!(typeof bgSDDemandMesh !== 'undefined' && bgSDDemandMesh && bgSDDemandMesh.visible),
               png: cv.toDataURL('image/png') };
    }, { bake });
    fs.writeFileSync(path.join(OUT, 'a210_' + tag + '.png'), Buffer.from(r.png.split(',')[1], 'base64'));
    delete r.png;
    console.log(tag + ': ' + JSON.stringify(r));
  };
  await run(false, 'realtime');
  await run(true, 'quick');
  await browser.close(); srv.kill(); process.exit(0);
})();
