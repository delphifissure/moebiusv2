// A212c ATTRIBUTION: is the taffy the LIVE screen-space inpainting repainting
// detector-flagged pixels over the baked composite? Arms at the user's pose,
// quick bake: (1) as shipped, (2) inpainting disabled, (3) inpainting
// disabled + FG hidden (pure plate).  node harness/a212_fill.js
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
  const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  console.log('served ' + await page.evaluate(() => MOEBIUS_BUILD));
  const shots = await page.evaluate(async () => {
    window._rayReproject = true;
    fgPreTear = false;                       // isolate: no tear in this probe
    bgQuickBake = true; buildBackgroundLayer();
    if (typeof updateVolumeGuidesVisibility === 'function') updateVolumeGuidesVisibility(false);
    isSweeping = true;
    camera.position.set(-0.756, 0.064, 0.320);
    const grab = () => {
      updateCameraAndProjection(); render(); updateCameraAndProjection(); render();
      const W = renderer.domElement.width, Hh = renderer.domElement.height;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      cv.getContext('2d').drawImage(renderer.domElement, 0, 0, W, Hh);
      return cv.toDataURL('image/png');
    };
    const out = {};
    const chk = document.getElementById('useInpaintingCheckbox');
    out.inpaintCtl = chk ? (chk.id + '=' + chk.checked) : 'checkbox not found';
    out.shipped = grab();
    // disable the screen-space fill the way the UI does
    if (chk) { chk.checked = false; chk.dispatchEvent(new Event('change')); }
    else if (typeof inpaintingEnabled !== 'undefined') inpaintingEnabled = false;
    out.noFill = grab();
    mediaLayers[0].mesh.visible = false;
    out.noFillNoFG = grab();
    mediaLayers[0].mesh.visible = true;
    if (chk) { chk.checked = true; chk.dispatchEvent(new Event('change')); }
    return out;
  });
  console.log('inpaint control: ' + shots.inpaintCtl);
  for (const k of ['shipped', 'noFill', 'noFillNoFG'])
    fs.writeFileSync(path.join(OUT, 'a212c_' + k + '.png'), Buffer.from(shots[k].split(',')[1], 'base64'));
  console.log('frames saved');
  await browser.close(); srv.kill(); process.exit(0);
})();
