// A184: THE VERTICAL AXIS HAS NEVER BEEN TESTED.
//
// User report, at cam(0.024, 0.090, 0.177) — a dominantly VERTICAL pose on the
// starwatcher: "both the astronaut and the people walking up the dune are
// disappearing", with the debug sheet showing large red (invalid) regions in
// scene depth and big white holes in the gap mask along the bottom.
//
// Every harness written in this arc — edgeblack, spill, fsshots, sheet, stripes,
// v2order, popdepth — sweeps camera.position.X ONLY. The vertical axis has never
// been exercised by any of them, so an artifact that only appears when looking
// UP or DOWN could not have been caught, and was not. That is the finding this
// file starts from, not one it discovers.
//
// Sweeps Y at the user's own X and eye distance, and measures CONTENT LOSS
// against the rest frame rather than counting holes: a152's lesson is that
// black% and ABSENT% both read 0.00 while an object quietly loses its texture,
// so the metric here is per-tile luma STANDARD DEVIATION — detail present vs
// detail flattened — plus the honest hole counts alongside.
//
//   node harness/vertical.js [star|troll|warrior] [quick|v2]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const ASSET = process.argv[2] || 'star';
const MODE = process.argv[3] || 'quick';
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star: ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };
// the user's pose is (0.024, 0.090) at eye z 0.177 — bracket it on the Y axis
const USER_X = 0.024, USER_Z = 0.177;
const YS = [0, 0.03, 0.06, 0.090, 0.12, -0.090];

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
  const onDisk = (fs.readFileSync(path.join(WT, 'moebius.js'), 'utf8')
                    .match(/MOEBIUS_BUILD\s*=\s*'([^']+)'/) || [])[1] || null;
  const served = await page.evaluate(() => (typeof MOEBIUS_BUILD === 'string') ? MOEBIUS_BUILD : null);
  console.log('served build = ' + served + (served === onDisk ? ' (matches this tree)' : '  *** TREE SAYS ' + onDisk + ' ***'));

  const r = await page.evaluate(async (o) => {
    window._rayReproject = true;
    bgViewFadeStartDeg = 35; bgViewFadeEndDeg = 45;
    bgQuickBake = (o.mode === 'quick');
    bgMPIFullPlanes = (o.mode === 'v2'); bgMPIMode = (o.mode === 'v2');
    bgBuildStamp = null; buildBackgroundLayer();
    isSweeping = true;
    const W = 720, Hh = 450, T = 16;   // tile size for the detail metric
    const grab = () => { for (let n = 0; n < 3; n++) render();
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const g = cv.getContext('2d'); g.drawImage(renderer.domElement, 0, 0, W, Hh);
      return g.getImageData(0, 0, W, Hh).data; };
    const stats = (d) => {
      // per-tile luma std, plus holes. std is the a152 metric: an object that
      // loses its texture stays "painted" and never registers as black.
      const tx = (W / T) | 0, ty = (Hh / T) | 0, sd = [];
      let absent = 0, dark = 0, tot = 0;
      for (let i = 0; i < W * Hh; i++) {
        const a = d[i*4+3], l = 0.299*d[i*4] + 0.587*d[i*4+1] + 0.114*d[i*4+2];
        tot++; if (a < 8) absent++; else if (l < 8) dark++;
      }
      for (let by = 0; by < ty; by++) for (let bx = 0; bx < tx; bx++) {
        let s = 0, s2 = 0, n = 0;
        for (let y = by*T; y < (by+1)*T; y++) for (let x = bx*T; x < (bx+1)*T; x++) {
          const i = (y*W + x)*4; if (d[i+3] < 8) continue;
          const l = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
          s += l; s2 += l*l; n++;
        }
        sd.push(n > 8 ? Math.sqrt(Math.max(0, s2/n - (s/n)*(s/n))) : -1);
      }
      return { sd, absentPct: 100*absent/tot, darkPct: 100*dark/tot };
    };

    camera.position.set(0, 0, o.z); const base = stats(grab());
    const rows = [];
    // A185: the look-down black band — is it the FISHTANK's ceiling?
    // Looking from below you should see the tank's top wall, and the tank is
    // black, exactly like the side-wall wedge at horizontal angles. Against
    // that: a tank is roughly symmetric, and dark% is 2.5 looking up vs 23.0
    // looking down. So the arm hides the tank and nothing else.
    for (const yy of o.ys) {
      camera.position.set(o.x, yy, o.z);
      const s = stats(grab());
      let darkNoTank = null;
      if (typeof bgFishtankMesh !== 'undefined' && bgFishtankMesh) {
        const v = bgFishtankMesh.visible; bgFishtankMesh.visible = false;
        darkNoTank = stats(grab()).darkPct;
        bgFishtankMesh.visible = v;
      }
      // tiles that HAD detail at rest and lost most of it here
      let lost = 0, had = 0, sumDrop = 0;
      for (let i = 0; i < base.sd.length; i++) {
        if (base.sd[i] < 4) continue;          // no detail at rest -> nothing to lose
        had++;
        const now = s.sd[i] < 0 ? 0 : s.sd[i];
        const drop = (base.sd[i] - now) / base.sd[i];
        if (drop > 0.5) lost++;
        sumDrop += Math.max(0, drop);
      }
      const angY = Math.atan2(yy, o.z) * 180 / Math.PI;
      rows.push({ y: yy, angY: +angY.toFixed(1),
        lostTiles: lost, hadTiles: had,
        lostPct: +(100 * lost / Math.max(1, had)).toFixed(2),
        meanDrop: +(100 * sumDrop / Math.max(1, had)).toFixed(2),
        absentPct: +s.absentPct.toFixed(3), darkPct: +s.darkPct.toFixed(2),
        darkNoTank: darkNoTank === null ? null : +darkNoTank.toFixed(2) });
    }
    camera.position.set(0, 0, o.z); render();
    return { rows, baseTiles: base.sd.filter(v => v >= 4).length };
  }, { ys: YS, x: USER_X, z: USER_Z, mode: MODE });

  const pad = (s, n) => String(s).padStart(n);
  console.log('\n' + ASSET + '  mode=' + MODE + '  vertical sweep at the user\'s x=' + USER_X + ', eye z=' + USER_Z);
  console.log('  ' + r.baseTiles + ' tiles carry detail at rest (luma std >= 4)\n');
  console.log('    y      angY   tiles losing >50% detail    mean drop%   ABSENT%   dark%   dark w/o tank');
  for (const w of r.rows)
    console.log('  ' + pad(w.y.toFixed(3), 6) + pad(w.angY + '°', 8) +
                pad(w.lostTiles + ' / ' + w.hadTiles + '  (' + w.lostPct + '%)', 26) +
                pad(w.meanDrop, 13) + pad(w.absentPct, 10) + pad(w.darkPct, 8) +
                pad(w.darkNoTank === null ? '-' : w.darkNoTank, 16));
  console.log('\n  "dark w/o tank" hides ONLY bgFishtankMesh. If the look-down band is the');
  console.log('  tank ceiling, that column collapses to the look-up value; if it stays high,');
  console.log('  the band is missing content and the tank was a red herring.');
  console.log('\n  ABSENT/dark are the hole counts. The DETAIL columns are the a152 metric:');
  console.log('  a tile that keeps its pixels but loses its texture is invisible to hole-counting.');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
