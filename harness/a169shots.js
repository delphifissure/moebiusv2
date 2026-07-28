// A169: TEST SHOTS FOR A DELETION.
//
// a169 removed the a150 far envelope, the cloned skirt material and its inset,
// the a111 cap cards, and the a58 island gate on the render — plus the eight
// window flags that switched them. Every one of those was already OFF by
// default (a158, a160c, a161), so the correct outcome is that NOTHING MOVES.
// A null result is only evidence if the instrument could have shown a change,
// so this shoots the frames themselves rather than a summary statistic, and
// prints the served build so a stale copy cannot masquerade as agreement.
//
// Shipped default (v2) and quick, at rest / 25 / 45 deg, on two assets.
//
//   node harness/a169shots.js [troll|star|warrior]
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
  const dir = path.join(H, 'shots_a169_' + ASSET);
  fs.mkdirSync(dir, { recursive: true });

  for (const mode of ['v2', 'quick']) {
    const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 40; t++) {
      const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
      if (ok) break; await new Promise(r => setTimeout(r, 1000));
    }
    // A169: the a110 served-identity guard. Without it a shot sheet that agrees
    // with the previous build is indistinguishable from a shot sheet of the
    // previous build.
    const served = await page.evaluate(() => (typeof MOEBIUS_BUILD === 'string') ? MOEBIUS_BUILD : null);
    const onDisk = (fs.readFileSync(path.join(WT, 'moebius.js'), 'utf8')
                      .match(/MOEBIUS_BUILD\s*=\s*'([^']+)'/) || [])[1] || null;
    console.log(mode + ': served build = ' + served +
      (served === onDisk ? ' (matches this tree)' : '  *** TREE SAYS ' + onDisk + ' ***'));

    const out = await page.evaluate(async (o) => {
      window._rayReproject = true;
      bgViewFadeStartDeg = 35; bgViewFadeEndDeg = 45;
      bgQuickBake = (o.mode === 'quick');
      bgMPIFullPlanes = (o.mode === 'v2'); bgMPIMode = (o.mode === 'v2');
      bgBuildStamp = null; buildBackgroundLayer();
      isSweeping = true;
      const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
      const res = {};
      for (const deg of o.degs) {
        camera.position.set(dist * Math.tan(deg * Math.PI / 180), 0, dist);
        for (let n = 0; n < 3; n++) render();
        res[deg] = renderer.domElement.toDataURL('image/png');
      }
      camera.position.set(0, 0, dist); render();
      // The two frames a168 built, named so the sheet can be read against the
      // spec: the inner tank should be edge-on and invisible at rest.
      res.meta = {
        tank: (typeof bgFishtankMesh !== 'undefined' && !!bgFishtankMesh),
        outer: (typeof bgOuterFrameMesh !== 'undefined' && !!bgOuterFrameMesh),
        skirt: (typeof bgSkirtMesh !== 'undefined' && !!bgSkirtMesh),
        stretch: (typeof window._qbStretch === 'object') ? window._qbStretch : null
      };
      return res;
    }, { degs: DEGS, mode });

    for (const deg of DEGS) {
      if (!out[deg]) continue;
      fs.writeFileSync(path.join(dir, mode + '_' + deg + 'deg.png'),
        Buffer.from(out[deg].split(',')[1], 'base64'));
    }
    console.log('  ' + mode + ' meta: ' + JSON.stringify(out.meta));
    await page.close();
  }
  console.log('\nshots -> ' + dir);
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
