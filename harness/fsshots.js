// A171: WINDOWED vs FULLSCREEN, SHOT SIDE BY SIDE.
//
// The spill.js numbers say the frame is gone in fullscreen and the apron is
// bounded by the aperture crop instead. Numbers are not a look, so this shoots
// the frames themselves at matched poses.
//
// Fullscreen is driven FOR REAL — requestFullscreen() from a genuine Playwright
// click, so document.fullscreenElement is set and bgIsFullscreen() is exercised
// rather than stubbed. If the headless shell refuses, the run says so and shoots
// nothing, because a stubbed predicate would be photographing the stub.
//
// Each frame is stamped in its filename with what the build actually had in
// place at the moment of capture (matte on/GONE, crop 0/1), so a sheet can never
// be read as the wrong arm.
//
//   node harness/fsshots.js [troll|star|warrior] [v2|quick]
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
const DEGS = (process.env.DEGS ? process.env.DEGS.split(',').map(Number) : [0, 25, 45]);

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  const onDisk = (fs.readFileSync(path.join(WT, 'moebius.js'), 'utf8')
                    .match(/MOEBIUS_BUILD\s*=\s*'([^']+)'/) || [])[1] || null;
  const served = await page.evaluate(() => (typeof MOEBIUS_BUILD === 'string') ? MOEBIUS_BUILD : null);
  console.log('served build = ' + served + (served === onDisk ? ' (matches this tree)'
              : '  *** TREE SAYS ' + onDisk + ' ***'));

  await page.evaluate(async (o) => {
    const mode = o.mode;
    window._rayReproject = true;
    bgViewFadeStartDeg = 35; bgViewFadeEndDeg = 45;
    bgQuickBake = (mode === 'quick');
    bgMPIFullPlanes = (mode === 'v2'); bgMPIMode = (mode === 'v2');
    bgBuildStamp = null; buildBackgroundLayer();
    // FADE=1 leaves the a143/a144 view fade ENGAGED. Every other harness sets
    // isSweeping so the fade cannot mask geometry; here the question is
    // precisely whether the fade already covers the region where the a174 taper
    // degenerates, so the fade has to be allowed to do its job.
    isSweeping = (o.fade !== 1);
    document.body.addEventListener('click', () => {
      document.documentElement.requestFullscreen().catch(() => {});
    });
  }, { mode: MODE, fade: process.env.FADE === '1' ? 1 : 0 });

  const dir = path.join(H, 'shots_fs' + (process.env.FADE === '1' ? 'FADE' : '') + '_' + (onDisk || 'x').replace(/[^A-Za-z0-9.-]/g, '') + '_' + ASSET);
  fs.mkdirSync(dir, { recursive: true });

  const shoot = async (arm) => {
    const out = await page.evaluate(async (o) => {
      const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
      const res = { imgs: {} };
      for (const deg of o.degs) {
        // WITH THE FADE ENGAGED, camera.position IS NOT OURS TO SET. The render
        // loop rewrites camera.position.x from the tracker inputs every frame
        // when isSweeping is false, so a direct set is silently discarded and
        // every pose shoots the rest frame — which is exactly what the first
        // version of this arm did. manualCamDX is the supported input.
        if (o.fade === 1) { window.setViewOffset(dist * Math.tan(deg * Math.PI / 180), 0); }
        else { camera.position.set(dist * Math.tan(deg * Math.PI / 180), 0, dist); }
        for (let n = 0; n < 4; n++) render();
        res.imgs[deg] = renderer.domElement.toDataURL('image/png');
      }
      if (o.fade === 1) window.setViewOffset(0, 0);
      camera.position.set(0, 0, dist); render();
      res.fs = !!document.fullscreenElement;
      res.matte = (typeof bgOuterFrameMesh !== 'undefined' && !!bgOuterFrameMesh);
      res.crop = (typeof bgAperture !== 'undefined' && bgAperture) ? bgAperture.crop : null;
      res.embed = bgEmbedOffsetNow();
      res.nearestZOff = bgEmbedOffsetNow() + Math.max(0, innerVolumeDepth);
      return res;
    }, { degs: DEGS, fade: process.env.FADE === '1' ? 1 : 0 });
    const tag = arm + '_matte-' + (out.matte ? 'on' : 'GONE') + '_crop' + out.crop;
    for (const deg of DEGS)
      fs.writeFileSync(path.join(dir, tag + '_' + deg + 'deg.png'),
        Buffer.from(out.imgs[deg].split(',')[1], 'base64'));
    console.log('  ' + arm.padEnd(10) + ' fullscreen=' + String(out.fs).padEnd(5) +
      ' matte=' + (out.matte ? 'on' : 'GONE').padEnd(4) + ' crop=' + out.crop +
      ' embed=' + out.embed.toFixed(4) + ' nearest zOff=' + out.nearestZOff.toFixed(4));
    return out;
  };

  const w = await shoot('windowed');
  await page.mouse.click(5, 5);
  await new Promise(r => setTimeout(r, 600));
  const wentFs = await page.evaluate(() => !!document.fullscreenElement);
  if (!wentFs) {
    console.log('\n  *** requestFullscreen() REFUSED by this headless shell — no fullscreen sheet.');
  } else {
    const f = await shoot('FULLSCREEN');
    if (w.matte === f.matte && w.crop === f.crop)
      console.log('\n  *** THE TWO ARMS ARE IDENTICALLY CONFIGURED — the sheet proves nothing.');
  }
  console.log('\nshots -> ' + dir);
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
