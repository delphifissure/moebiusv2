// A150: test shots + a REST-FRAME IDENTITY check between the two continuations.
//
// The far-envelope skirt with the island gate off paints a full-frame backdrop.
// That is only safe if it is strictly behind everything: at rest the frame must
// be pixel-for-pixel what a149 produced, because at rest nothing is revealed and
// the plate covers its whole footprint. Measured rather than assumed.
//
//   node harness/a150shots.js [troll|star|warrior]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const ASSET = process.argv[2] || 'troll';
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star: ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };
const DEGS = [0, 25, 45];

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const shots = {};
  for (const arm of ['a149', 'a150']) {
    const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 40; t++) {
      const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
      if (ok) break; await new Promise(r => setTimeout(r, 1000));
    }
    const out = await page.evaluate(async (o) => {
      window._rayReproject = true;
      bgViewFadeStartDeg = 35; bgViewFadeEndDeg = 45;
      bgQuickBake = true; bgMPIFullPlanes = false; bgMPIMode = false;
      bgBuildStamp = null; buildBackgroundLayer();
      isSweeping = true;
      const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
      const res = {};
      for (const deg of o.degs) {
        camera.position.set(dist * Math.tan(deg * Math.PI / 180), 0, dist);
        for (let n = 0; n < 3; n++) render();
        res[deg] = renderer.domElement.toDataURL('image/png');
      }
      // The footprint mask: the rest frame with the skirt hidden. Identical in
      // both arms by construction, so it is a fair polygon to diff inside — it
      // separates "the source frame changed" from "the beyond-frame margin,
      // which is exactly what the skirt is for, changed".
      camera.position.set(0, 0, dist);
      if (typeof bgSkirtMesh !== 'undefined' && bgSkirtMesh) {
        const v = bgSkirtMesh.visible; bgSkirtMesh.visible = false;
        for (let n = 0; n < 3; n++) render();
        res.footprint = renderer.domElement.toDataURL('image/png');
        bgSkirtMesh.visible = v;
      }
      camera.position.set(0, 0, dist); render();
      return res;
    }, { arm, degs: DEGS });
    shots[arm] = out;
    await page.close();
  }
  const dir = path.join(H, 'shots_a150_' + ASSET);
  fs.mkdirSync(dir, { recursive: true });
  const { PNG } = (() => { try { return require('pngjs'); } catch (e) { return {}; } })();
  for (const arm of ['a149', 'a150']) for (const deg of DEGS.concat(['footprint'])) {
    if (!shots[arm][deg]) continue;
    const b = Buffer.from(shots[arm][deg].split(',')[1], 'base64');
    fs.writeFileSync(path.join(dir, arm + '_' + deg + 'deg.png'), b);
  }
  console.log('shots -> ' + dir);
  if (PNG) {
    for (const deg of DEGS) {
      const a = PNG.sync.read(Buffer.from(shots.a149[deg].split(',')[1], 'base64'));
      const b = PNG.sync.read(Buffer.from(shots.a150[deg].split(',')[1], 'base64'));
      let n = 0, sum = 0, mx = 0, diffPx = 0;
      for (let i = 0; i < a.data.length; i += 4) {
        for (let c = 0; c < 3; c++) { const d = Math.abs(a.data[i + c] - b.data[i + c]);
          sum += d; if (d > mx) mx = d; if (d > 2) { diffPx++; break; } }
        n += 3;
      }
      console.log('  ' + String(deg).padStart(3) + ' deg   mean|delta| ' + (sum / n).toFixed(4) +
                  '   max ' + mx + '   pixels differing by >2: ' +
                  (100 * diffPx / (a.data.length / 4)).toFixed(3) + '%');
    }
  } else console.log('  (pngjs unavailable — shots written, diff skipped)');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
