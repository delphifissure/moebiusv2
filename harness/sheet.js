// A181: ONE LABELLED CONTACT SHEET PER ASSET.
//
// Individual frames are hard to compare on a phone. This composites the poses
// into a single image with the pose, the mode and the served build burned in, so
// a sheet can never be read as the wrong build or the wrong arm — the same
// reason fsshots.js puts matte/crop in its filenames.
//
// Poses are chosen to bracket what a head actually does: rest, 15 and 25 deg
// inside the cone, and 35 deg which is bgViewFadeStartDeg — the last pose at
// full opacity and therefore the worst honest one.
//
//   node harness/sheet.js [troll|star|warrior] [v2|quick]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const ASSET = process.argv[2] || 'troll';
const MODE = process.argv[3] || 'v2';
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star: ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };
// A184: poses are now (x,y) WORLD offsets, not X-only degrees, because the
// vertical axis had never been shot. POSES="x:y,x:y,..." overrides.
const POSES = (process.env.POSES
  ? process.env.POSES.split(',').map(t => t.split(':').map(Number))
  : [[0, 0], [0.024, 0.030], [0.024, 0.090], [0.024, -0.090]]);
const CW = 720, CH = 450;

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: CW, height: CH } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  const onDisk = (fs.readFileSync(path.join(WT, 'moebius.js'), 'utf8')
                    .match(/MOEBIUS_BUILD\s*=\s*'([^']+)'/) || [])[1] || null;
  const served = await page.evaluate(() => (typeof MOEBIUS_BUILD === 'string') ? MOEBIUS_BUILD : null);
  console.log(ASSET + '/' + MODE + ': served ' + served +
    (served === onDisk ? ' (matches tree)' : '  *** TREE SAYS ' + onDisk + ' ***'));

  const dataUrl = await page.evaluate(async (o) => {
    window._rayReproject = true;
    bgViewFadeStartDeg = 35; bgViewFadeEndDeg = 45;
    bgQuickBake = (o.mode === 'quick');
    bgMPIFullPlanes = (o.mode === 'v2'); bgMPIMode = (o.mode === 'v2');
    bgBuildStamp = null; buildBackgroundLayer();
    isSweeping = true;
    const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
    const shots = [];
    for (const pz of o.poses) {
      camera.position.set(pz[0], pz[1], dist);
      for (let n = 0; n < 3; n++) render();
      const c = document.createElement('canvas'); c.width = o.cw; c.height = o.ch;
      c.getContext('2d').drawImage(renderer.domElement, 0, 0, o.cw, o.ch);
      shots.push(c);
    }
    camera.position.set(0, 0, dist); render();

    const PAD = 8, LAB = 30, TOP = 40;
    const W = o.cw * 2 + PAD * 3, Hh = TOP + (o.ch + LAB) * 2 + PAD * 3;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
    const g = cv.getContext('2d');
    g.fillStyle = '#111'; g.fillRect(0, 0, W, Hh);
    g.fillStyle = '#eee'; g.font = 'bold 20px sans-serif';
    g.fillText(o.asset + '  —  ' + o.mode + '  —  ' + o.build, PAD, 26);
    for (let i = 0; i < shots.length; i++) {
      const col = i % 2, row = (i / 2) | 0;
      const x = PAD + col * (o.cw + PAD), y = TOP + PAD + row * (o.ch + LAB + PAD);
      g.drawImage(shots[i], x, y);
      g.strokeStyle = '#444'; g.strokeRect(x + 0.5, y + 0.5, o.cw - 1, o.ch - 1);
      g.fillStyle = '#eee'; g.font = '17px sans-serif';
      const pz = o.poses[i];
      const aX = (Math.atan2(pz[0], dist) * 180 / Math.PI).toFixed(1);
      const aY = (Math.atan2(pz[1], dist) * 180 / Math.PI).toFixed(1);
      g.fillText('cam(' + pz[0].toFixed(3) + ', ' + pz[1].toFixed(3) + ')   angX ' + aX +
                 '°  angY ' + aY + '°' + (Math.abs(pz[1]) > 0.08 ? '   <- the reported pose' : ''),
                 x + 2, y + o.ch + 21);
    }
    return cv.toDataURL('image/png');
  }, { poses: POSES, mode: MODE, cw: CW, ch: CH, asset: ASSET, build: served });

  const out = path.join(H, 'sheetV_' + (onDisk || 'x').replace(/[^A-Za-z0-9.-]/g, '') + '_' + ASSET + '_' + MODE + '.png');
  fs.writeFileSync(out, Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('  -> ' + out);
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
