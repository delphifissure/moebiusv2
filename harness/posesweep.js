// POSE SWEEP: render a ring of IN-RANGE poses and measure how much of the frame
// is black. One bake, many renders (renders are cheap; the bake is not).
//
// The black is the question. a102 tears every cell whose screen-shift span
// exceeds the cell extent, which on 8-bit depth is 4-34% of cells depending on
// the asset — every torn cell is a hole the plate must back. If the plate does
// not back them, they render BLACK. So this A/Bs the fold tear directly:
//   default        a102 exact envelope tear
//   _noFoldTear    the pre-a91 fixed cliff-scale tear (tears far less)
// If black area tracks the tear, the tearing is outrunning its backing and
// that is a regression I introduced, not an out-of-range artifact.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const OUTD = '/workspace/moebiusv2/harness/val';
const SRC = { troll: ['defaultImgColor.png','defaultImgDepth.png'],
              star:  ['starwatcher_color.png','starwatcher_depth.png'],
              warrior:['silverwarrior_color.png','silverwarrior_depth.png'] };
const ASSET = process.argv[2] || 'troll';

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  for (const [tag, noFold] of [['a102 exact tear', false], ['legacy cliff tear', true]]) {
    const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 140)));
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 40; t++) {
      const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
      if (ok) break; await new Promise(r => setTimeout(r, 1000));
    }
    const res = await page.evaluate(async (nf) => {
      window._rayReproject = true; window._noFoldTear = nf;
      bgQuickBake = true; buildBackgroundLayer();
      const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
      const out = [];
      // DRIVE THE DRAG OFFSETS, NOT camera.position: render() recomputes
      // camera.position.x/y from (faceTrack + gyro + manual) every frame, so a
      // direct camera.position.set is overwritten before anything is drawn —
      // which is why the first run of this probe reported an identical number
      // at every pose. isSweeping is the app's own lock for automated moves.
      // BOTH, or nothing moves. render() recomputes camera.position.x/y from
      // (faceTrack + gyro + manual) inside `if (!isSweeping)`, so:
      //   camera.position without isSweeping -> render overwrites it to centre
      //   isSweeping with manualCamD*        -> that flag ignores them
      // The first two versions of this probe did one each; both reported an
      // identical number at every pose, which reads exactly like 'no effect'.
      const setPose = (px, py) => { isSweeping = true; camera.position.set(px, py, dist); };
      const blackPct = () => {
        const W = 240, Hh = 150;
        const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
        const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
        const d = cx.getImageData(0, 0, W, Hh).data;
        let black = 0;
        for (let i = 0; i < W*Hh; i++) if (d[i*4] + d[i*4+1] + d[i*4+2] < 24) black++;
        return 100 * black / (W*Hh);
      };
      // BASELINE at rest. A portrait layer in a landscape canvas is mostly
      // letterbox, so raw black% measures framing, not artifacts. Report the
      // DELTA against rest, which is the black the head move created.
      setPose(0, 0); for (let n = 0; n < 3; n++) render();
      const rest = blackPct();
      out.push({ deg: 0, dir: 'rest', black: rest, delta: 0 });
      for (const deg of [15, 30, 40]) {
        const r = dist * Math.tan(deg * Math.PI / 180);
        for (const [dx, dy, dname] of [[1,0,'R'],[-1,0,'L'],[0,1,'U'],[0,-1,'D']]) {
          setPose(r*dx, r*dy);
          for (let n = 0; n < 3; n++) render();
          const b = blackPct();
          out.push({ deg, dir: dname, black: b, delta: b - rest });
        }
      }
      setPose(0, 0); render();
      return { rows: out, rest };
    }, noFold);
    console.log('\n' + ASSET + '  ' + tag + '   (rest black = ' + res.rest.toFixed(1) + '% — letterbox)');
    const byDeg = {};
    for (const r of res.rows) { if (r.dir !== 'rest') (byDeg[r.deg] = byDeg[r.deg] || []).push(r); }
    console.log('  deg      R       L       U       D      mean    <- EXTRA black vs rest, % of frame');
    for (const deg of Object.keys(byDeg)) {
      const g = byDeg[deg], m = g.reduce((s,x)=>s+x.delta,0)/g.length;
      const get = n => (g.find(x=>x.dir===n)||{delta:-1}).delta.toFixed(1).padStart(7);
      console.log('  ' + String(deg).padStart(3) + get('R') + get('L') + get('U') + get('D') + m.toFixed(1).padStart(10));
    }
    await page.close();
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
