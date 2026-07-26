// A145: DOES THE FACE-EDGE PROBE RECOVER A BOUNDARY IT IS GIVEN?
//
// The probe synthesises frames with the user's own face pasted at chosen
// offsets and asks the detector where it stops answering, so the fade's
// tracking boundary is known BEFORE any interaction instead of being learned
// from the first real loss.
//
// THIS ENVIRONMENT CANNOT RUN IT END TO END. The MediaPipe/tfjs model loads
// from jsdelivr and there is no CDN egress here (curl returns 000), and there
// is no camera. So the model's own response — the one thing a synthetic face
// could never stand in for, which is why the probe uses the user's real face —
// is untestable from here and is stated as untested rather than implied to work.
//
// What IS testable, and is the part that can be wrong in the ways this arc
// keeps finding: the instrument. A stub detector is substituted whose failure
// boundary is known in closed form — it reports a face at the pasted location
// iff at least V of the pasted block is still inside the frame, which is
// exactly the mechanism that makes the real detector fail (clipping). Then:
//
//     detect iff  px + w/2 - W  <=  w(1 - V)
//     =>  t_true  =  0.5 - w/(2W) + w(1-V)/W
//
// With W=640, w=160, V=0.75 that is t_true = 0.4375 exactly. If the probe
// returns that, its sweep, its bisection, its proximity acceptance, its control
// check and its write into _faceEdge are all correct, and the only untested
// component is MediaPipe itself.
//
// Second arm: a stub that never detects anything. The probe must ABORT on its
// own control check rather than report a boundary — a probe that fails its
// control measures nothing, and reporting 0.20 there would be worse than
// reporting nothing.
//
//   node harness/faceprobe.js
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = path.join('/workspace/mm', 'harness');

(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
  const logs = [];
  page.on('console', m => { const t = m.text(); if (/A145/.test(t)) logs.push(t); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return typeof bgProbeFaceEdge === 'function'; } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 500));
  }

  const res = await page.evaluate(async () => {
    const W = 640, Hh = 480, w = 160, hgt = 200, V = 0.75;
    // grey backdrop with no magenta anywhere, so the only detectable thing in a
    // probe frame is the pasted block
    const frame = document.createElement('canvas'); frame.width = W; frame.height = Hh;
    const fc = frame.getContext('2d'); fc.fillStyle = '#808080'; fc.fillRect(0, 0, W, Hh);
    const tpl = document.createElement('canvas'); tpl.width = w; tpl.height = hgt;
    const tc = tpl.getContext('2d'); tc.fillStyle = '#ff00ff'; tc.fillRect(0, 0, w, hgt);

    offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = W; offscreenCanvas.height = Hh;
    offscreenCtx = offscreenCanvas.getContext('2d');

    // stub detector: find the magenta block, report a face at its centroid iff
    // enough of it is still inside the frame
    const makeStub = (blind) => ({
      estimateFaces: async (cv) => {
        if (blind) return [];
        const c = cv.getContext('2d', { willReadFrequently: true });
        const d = c.getImageData(0, 0, cv.width, cv.height).data;
        let n = 0, sx = 0, sy = 0;
        for (let y = 0; y < cv.height; y += 2) for (let x = 0; x < cv.width; x += 2) {
          const i = (y * cv.width + x) * 4;
          if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] > 200) { n++; sx += x; sy += y; }
        }
        const full = (w / 2) * (hgt / 2);
        if (!n || n / full < V) return [];
        return [{ keypoints: [{ x: sx / n, y: sy / n }, { x: sx / n, y: sy / n }] }];
      }
    });

    const run = async (blind) => {
      faceMeshDetector = makeStub(blind);
      window._faceTemplate = { canvas: tpl, frame, w, h: hgt, cx: W / 2, cy: Hh / 2 };
      window._faceEdge.x = 0.5; window._faceEdge.y = 0.5;
      const r = await window.bgReprobeFaceEdge();
      return { probed: r, edgeX: window._faceEdge.x, edgeY: window._faceEdge.y };
    };
    const good = await run(false);
    const blind = await run(true);
    // closed form, derived independently of the probe
    const tTrueX = 0.5 - w / (2 * W) + w * (1 - V) / W;
    const tTrueY = 0.5 - hgt / (2 * Hh) + hgt * (1 - V) / Hh;
    return { good, blind, tTrueX, tTrueY, W, Hh, w, hgt, V };
  });

  console.log('\nFACE-EDGE PROBE — does it recover a boundary it is given?');
  console.log('  stub: frame ' + res.W + 'x' + res.Hh + ', block ' + res.w + 'x' + res.hgt +
              ', detects while >= ' + (res.V * 100) + '% of the block is in frame');
  console.log('\n  ARM 1: stub with a known boundary');
  console.log('    closed form   x = ' + res.tTrueX.toFixed(4) + '   y = ' + res.tTrueY.toFixed(4));
  console.log('    probe found   x = ' + (res.good.probed ? res.good.probed.x.toFixed(4) : 'ABORTED') +
              '   y = ' + (res.good.probed ? res.good.probed.y.toFixed(4) : 'ABORTED'));
  if (res.good.probed) {
    const ex = Math.abs(res.good.probed.x - res.tTrueX), ey = Math.abs(res.good.probed.y - res.tTrueY);
    console.log('    error         x = ' + ex.toFixed(4) + '   y = ' + ey.toFixed(4) +
                '   => ' + ((ex < 0.02 && ey < 0.02) ? 'RECOVERED' : 'MISMATCH'));
    console.log('    written into _faceEdge: x=' + res.good.edgeX.toFixed(4) + ' y=' + res.good.edgeY.toFixed(4));
  }
  console.log('\n  ARM 2: stub that never detects (the control must fire)');
  console.log('    probe returned ' + (res.blind.probed === null ? 'null — ABORTED as designed' : JSON.stringify(res.blind.probed)));
  console.log('    _faceEdge left at x=' + res.blind.edgeX.toFixed(3) + ' y=' + res.blind.edgeY.toFixed(3) +
              ' (nominal edge, i.e. no boundary claimed)');
  console.log('\n  console:');
  for (const l of logs) console.log('    | ' + l.slice(0, 190));
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
