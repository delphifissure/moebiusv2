// A109: isolate the one suite FAIL a101 introduced — "dolly q!=P lock crest px"
// went 0..2 -> 3.0. Same measurement as regress.js's a67 invariant, run twice
// in ONE page with window._noPerPixelCone toggled between bakes, so the only
// difference between the two numbers is a101's per-depth cone.
//   node harness/a109_dolly.js        (run from /workspace/arc73)
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/arc73';
const H = path.join(WT, 'harness');

const MEASURE = async (page) => {
  await page.evaluate(() => { bgQuickBake = true; window._bgQuickBaked = false; buildBackgroundLayer(); });
  await page.waitForFunction(() => window._bgQuickBaked === true, null, { timeout: 480000, polling: 2000 });
  await new Promise(r => setTimeout(r, 400));
  return page.evaluate(async () => {
  const dImg = mediaLayers[0].textures.depth.image2d || mediaLayers[0].textures.depth.image;
  const w = dImg.naturalWidth || dImg.width, h = dImg.naturalHeight || dImg.height;
  const cv0 = document.createElement('canvas'); cv0.width = w; cv0.height = h;
  const cx0 = cv0.getContext('2d'); cx0.drawImage(dImg, 0, 0, w, h);
  const v = cx0.getImageData(Math.round(0.30 * w), Math.round(0.90 * h), 1, 1).data[0] / 255;
  const rel = v - currentNormPortalPlane;
  subjectFocalPlaneWorldZ = rel < 0
    ? portalPlaneWorldZ - (Math.abs(rel) / Math.max(currentNormPortalPlane, 0.0001)) * outerVolumeDepth
    : portalPlaneWorldZ + (rel / Math.max(1 - currentNormPortalPlane, 0.0001)) * innerVolumeDepth;
  initializeSubjectLockConstant();
  const crest = () => {
    const W2 = 720, H2 = 450;
    const cv = document.createElement('canvas'); cv.width = W2; cv.height = H2;
    const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W2, H2);
    const d = cx.getImageData(0, 0, W2, H2).data;
    const L = (x, y) => { const i = (y * W2 + x) * 4; return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; };
    const ys = {};
    for (let x = Math.round(0.08 * W2); x < Math.round(0.55 * W2); x += 3) {
      let bg = 0, by = -1;
      for (let y = Math.round(0.50 * H2); y < Math.round(0.98 * H2) - 2; y++) {
        const g = Math.abs(L(x, y + 2) - L(x, y - 2));
        if (g > bg) { bg = g; by = y; }
      }
      if (bg >= 12) ys[x] = by;
    }
    return ys;
  };
  const shoot = async (tval, lock) => {
    subjectLockActive = lock; dollyZoomActive = true;
    const pin = () => { dollyZoomTime = tval - dollyZoomSpeed * 100; };
    isSweeping = true;
    await new Promise(r2 => { let n = 0; const tick = () => { pin(); camera.position.x = 0.12 * dollyLatGain; camera.position.y = 0.02 * dollyLatGain; n++; n < 8 ? requestAnimationFrame(tick) : r2(); }; requestAnimationFrame(tick); });
    pin(); camera.position.x = 0.12 * dollyLatGain; camera.position.y = 0.02 * dollyLatGain; render();
    return crest();
  };
  const stats = (a, b) => {
    const dz = []; for (const x in a) if (x in b) dz.push(Math.abs(a[x] - b[x]));
    dz.sort((p, q) => p - q);
    if (!dz.length) return { n: 0, med: -1, mean: -1, p90: -1 };
    return { n: dz.length, med: dz[(dz.length / 2) | 0],
             mean: +(dz.reduce((s, x) => s + x, 0) / dz.length).toFixed(2),
             p90: dz[Math.min(dz.length - 1, Math.floor(dz.length * 0.9))] };
  };
  const lm = await shoot(0, true), lf = await shoot(Math.PI / 2, true);
  dollyZoomActive = false; render();
  const fm = await shoot(0, false), ff = await shoot(Math.PI / 2, false);
  dollyZoomActive = false; render();
  return { lock: stats(lm, lf), free: stats(fm, ff) };
  });
};

(async () => {
  fs.copyFileSync(path.join(WT, 'starwatcher_color.png'), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, 'starwatcher_depth.png'), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 933, height: 525 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 140)));
  await page.goto('http://localhost:8099/fp_test.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  for (const [tag, flag] of [['a101 per-depth cone', false], ['scalar cone (a88/a90)', true]]) {
    await page.evaluate((f) => { window._rayReproject = true; window._noVpScan = true; window._noPerPixelCone = f; }, flag);
    const r = await MEASURE(page);
    const line = tag.padEnd(24) + ' lock med=' + r.lock.med + ' mean=' + r.lock.mean + ' p90=' + r.lock.p90 +
                ' n=' + r.lock.n + '   |   free med=' + r.free.med + ' mean=' + r.free.mean + ' n=' + r.free.n;
    console.log(line);
    fs.appendFileSync('/workspace/moebiusv2/harness/a109_dolly.result', line + '\n');
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
