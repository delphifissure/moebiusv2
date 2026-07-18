// q != P subject-lock probe: put the subject focal plane ON THE ASTRONAUT
// (off the portal), run the dolly sweep off-axis (x=0.12), capture pinned
// near/mid/far frames with lock ON and OFF. The lock's mesh-scaling path
// (window._dzBase machinery) engages only when |q - P| > 1e-6 — this is its
// first measurement under ray-reprojection.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
fs.copyFileSync('../starwatcher_color.png', 'defaultImgColor.png');
fs.copyFileSync('../starwatcher_depth.png', 'defaultImgDepth.png');
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => console.log('  [PAGEERR] '+e.message.slice(0,140)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
  await page.evaluate(() => { window._rayReproject = true; bgQuickBake = true; buildBackgroundLayer(); });
  await new Promise(r => setTimeout(r, 400));
  // subject plane on the astronaut torso: sample the depth map at the torso
  // fraction and convert with the app's own peek->Z formula
  const setup = await page.evaluate(() => {
    const dImg = mediaLayers[0].textures.depth.image2d || mediaLayers[0].textures.depth.image;
    const w = dImg.naturalWidth || dImg.width, h = dImg.naturalHeight || dImg.height;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d'); cx.drawImage(dImg, 0, 0, w, h);
    const sx = Math.round(0.254 * w), sy = Math.round(0.40 * h);
    const v = cx.getImageData(sx, sy, 1, 1).data[0] / 255;   // torso norm depth
    const npp = currentNormPortalPlane;
    const rel = v - npp;
    const qZ = rel < 0
      ? portalPlaneWorldZ - (Math.abs(rel) / Math.max(npp, 0.0001)) * outerVolumeDepth
      : portalPlaneWorldZ + (rel / Math.max(1 - npp, 0.0001)) * innerVolumeDepth;
    subjectFocalPlaneWorldZ = qZ;
    initializeSubjectLockConstant();
    return { torsoV: v, npp, P: portalPlaneWorldZ, qZ, inner: innerVolumeDepth, outer: outerVolumeDepth,
             dolly: [dollyMinDistance, dollyMaxDistance] };
  });
  console.log('SETUP ' + JSON.stringify(setup));
  const T = { far: Math.PI/2 };
  for (const lock of [false]) {
    // reset lock state fully between modes
    await page.evaluate(() => { dollyZoomActive = false; render(); });
    for (const [dtag, tval] of Object.entries(T)) {
      const png = await page.evaluate(async ({ tval, lock }) => {
        subjectLockActive = lock;
        dollyZoomActive = true;
        const pin = () => { dollyZoomTime = tval - dollyZoomSpeed * 100; };
        isSweeping = true;
        await new Promise(r2 => { let n = 0; const tick = () => { pin(); camera.position.x = 0.12; camera.position.y = 0.02; n++; n < 10 ? requestAnimationFrame(tick) : r2(); }; requestAnimationFrame(tick); });
        pin(); camera.position.x = 0.12; camera.position.y = 0.02; render();
        return renderer.domElement.toDataURL('image/png');
      }, { tval, lock });
      const tag = 'dq_' + (lock ? 'lock' : 'free') + '_' + dtag;
      fs.writeFileSync(tag + '.png', Buffer.from(png.split(',')[1], 'base64'));
      console.log('wrote ' + tag);
    }
  }
  await page.evaluate(() => { dollyZoomActive = false; render(); });
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
