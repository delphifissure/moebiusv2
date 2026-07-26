// A152 TEXTURE INTEGRITY — the metric the whole arc was missing.
//
// a151 was a large object losing its texture and rendering as a flat blob.
// black% saw nothing (a dark blue blob is nowhere near the black threshold),
// ABSENT% saw nothing (it is painted), and regress.js masks saw nothing (SD%
// and ground% are mask areas). An entire arc of coverage numbers had no
// instrument for "is the content still there".
//
// This one is deliberately blunt and hard to fool: over a grid of tiles
// covering the content, compare the LOCAL LUMA STANDARD DEVIATION of the
// render against the same tile of the SOURCE IMAGE, warped by nothing. A tile
// that has lost its detail collapses toward 0 while the source tile does not.
// Reported as the fraction of tiles whose std has fallen below half the
// source's, which is scale-free and needs no per-asset tuning.
//
// It also runs the MODE SWITCH, because that is what broke: cold quick, cold
// v2, and quick-then-v2 in one session must all agree.
//
//   node harness/texint.js [troll|star|warrior]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const ASSET = process.argv[2] || 'star';
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star: ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };
const TILE = 24;         // px of render per tile
const FLOOR = 0.5;       // a tile "lost its texture" below half the reference std

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
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
    isSweeping = true;
    const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
    const W = 600, Hh = 375;
    const shot = () => { for (let n = 0; n < 3; n++) render();
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
      return cx.getImageData(0, 0, W, Hh).data; };
    const tiles = (d) => {
      const T = o.tile, res = [];
      for (let ty = 0; ty + T <= Hh; ty += T) for (let tx = 0; tx + T <= W; tx += T) {
        let s = 0, s2 = 0, n = 0, painted = 0;
        for (let y = ty; y < ty + T; y++) for (let x = tx; x < tx + T; x++) {
          const i = (y * W + x) * 4;
          if (d[i + 3] < 8) continue;
          painted++;
          const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          s += L; s2 += L * L; n++;
        }
        if (n < T * T * 0.5) { res.push(null); continue; }
        const m = s / n; res.push(Math.sqrt(Math.max(0, s2 / n - m * m)));
      }
      return res;
    };
    const bake = (mode) => {
      bgQuickBake = (mode === 'quick');
      bgMPIFullPlanes = (mode === 'v2'); bgMPIMode = (mode === 'v2');
      bgBuildStamp = null; buildBackgroundLayer();
    };
    camera.position.set(0, 0, dist);
    const ref = tiles(shot());                    // realtime at rest = the reference look
    const score = (t) => {
      let lost = 0, tot = 0, worst = 0;
      for (let i = 0; i < ref.length; i++) {
        if (ref[i] === null || t[i] === null || ref[i] < 3) continue;   // flat in the source too
        tot++; const r = t[i] / ref[i];
        if (r < o.floor) lost++;
        if (1 - r > worst) worst = 1 - r;
      }
      return { lostPct: +(100 * lost / Math.max(1, tot)).toFixed(2), tiles: tot,
               worstDrop: +(100 * worst).toFixed(1) };
    };
    const res = {};
    for (const arm of [['quick cold', ['quick']], ['v2 cold', ['v2']],
                       ['quick then v2', ['quick', 'v2']], ['v2 then quick', ['v2', 'quick']]]) {
      for (const m of arm[1]) bake(m);
      const per = {};
      for (const deg of [0, 25]) {
        camera.position.set(dist * Math.tan(deg * Math.PI / 180), 0, dist);
        per[deg] = score(tiles(shot()));
      }
      res[arm[0]] = per;
      camera.position.set(0, 0, dist);
    }
    return res;
  }, { tile: TILE, floor: FLOOR });

  console.log('\n' + ASSET + '  TEXTURE INTEGRITY — tiles whose local detail collapsed vs the realtime reference');
  console.log('  (a tile counts as LOST when its luma std falls below ' + FLOOR + 'x the reference tile)');
  console.log('  arm                  0 deg lost%   worst drop     25 deg lost%   worst drop');
  let bad = 0;
  for (const [arm, per] of Object.entries(out)) {
    console.log('  ' + arm.padEnd(20) + String(per[0].lostPct).padStart(11) + String(per[0].worstDrop + '%').padStart(13) +
                String(per[25].lostPct).padStart(17) + String(per[25].worstDrop + '%').padStart(13));
    if (per[0].lostPct > 2 || per[25].lostPct > 5) bad++;
  }
  console.log('\n  ' + (bad ? bad + ' ARM(S) OVER THRESHOLD' : 'all arms within threshold'));
  await browser.close(); srv.kill(); process.exit(bad ? 1 : 0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
