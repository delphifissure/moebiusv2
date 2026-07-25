// A119: WHAT IS THE MASK MARKING AT REST, WHERE DISOCCLUSION IS IMPOSSIBLE?
//
// At the rest pose the reprojection is identity, so no surface can be
// revealed. Yet the 'gaps' view draws a bright halo tracing the figure and the
// chain, and shimmer2 scored it at 4.11% of the frame — rising only to 4.35%
// at 0.85x rim, when TRUE reveal area should grow steeply with angle. So the
// mask is dominated by a population that has nothing to do with reveals.
//
// GAP DEFINITION USED HERE. Not a luma threshold on the 'gaps' view (that
// catches bright CONTENT too, and the troll is dark so it flattered the
// number). Instead: render 'final' and render 'gaps' at the same pose and diff
// them. A pixel the inpainter had to change IS a gap, by construction, with no
// threshold to argue about. Everything else is content.
//
// HYPOTHESIS. The halo is the FG-SUBTRACTION cut band, not a disocclusion.
// FG-sub deliberately cuts a strip along every silhouette so the near surface
// cannot stretch into the far one, and the inpainter refills it. That is
// defensible for the live picture, but it is WRONG in an SD export mask: it
// asks SD to repaint 4% of the frame that was never occluded.
//
// TEST. Sweep fgSubThresholdSlider. If the rest-pose gap area tracks the
// threshold, the halo is the cut band and nothing else.
//
//   node harness/halo.js [troll|star|warrior]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const OUTD = '/workspace/moebiusv2/harness/val';
const SRC = { troll:   ['defaultImgColor.png', 'defaultImgDepth.png'],
              star:    ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };
const ASSET = process.argv[2] || 'troll';

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 140)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  const res = await page.evaluate(async () => {
    isSweeping = true;
    const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
    const sel = document.getElementById('debugViewSelect');
    const thrS = document.getElementById('fgSubThresholdSlider');
    const W = 480, Hh = 300;
    const grab = () => { for (let n = 0; n < 3; n++) render();
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
      return cx.getImageData(0, 0, W, Hh).data; };
    const view = (v) => { if (sel) { sel.value = v; sel.dispatchEvent(new Event('change')); } };
    const measure = () => {
      view('final');  const f = grab();
      view('gaps');   const g = grab();
      view('final');
      let n = 0, tot = 0;
      for (let i = 0; i < W*Hh; i++) { const j = i*4;
        const lf = 0.299*f[j]+0.587*f[j+1]+0.114*f[j+2];
        const lg = 0.299*g[j]+0.587*g[j+1]+0.114*g[j+2];
        if (lf < 4 && lg < 4) continue;           // letterbox, not content
        tot++;
        if (Math.abs(lf - lg) > 8) n++;           // the inpainter changed it
      }
      return +(100*n/Math.max(1,tot)).toFixed(2);
    };
    const out = { sweep: [], byPose: [] };
    const thr0 = thrS ? thrS.value : null;
    camera.position.set(0, 0, dist);
    for (const thr of ['0.01', '0.03', '0.05', '0.10', '0.20', '0.50']) {
      if (thrS) { thrS.value = thr; thrS.dispatchEvent(new Event('input')); }
      out.sweep.push({ thr, restGapPct: measure() });
    }
    if (thrS && thr0 !== null) { thrS.value = thr0; thrS.dispatchEvent(new Event('input')); }
    for (const frac of [0.0, 0.15, 0.30, 0.52, 0.70, 0.85]) {
      camera.position.set(frac * dist * Math.tan(60*Math.PI/180), 0, dist);
      out.byPose.push({ frac, gapPct: measure() });
    }
    camera.position.set(0, 0, dist); view('final'); render();
    out.thrDefault = thr0;
    return out;
  });
  console.log('\n' + ASSET + '  gap = pixels the inpainter CHANGED (final vs gapped pass)');
  console.log('  default fgSubThreshold = ' + res.thrDefault);
  console.log('\n  REST POSE, sweeping the FG-subtraction threshold:');
  console.log('    fgSubThr   restGap%');
  for (const r of res.sweep) console.log('    ' + r.thr.padEnd(11) + String(r.restGapPct).padStart(7));
  console.log('\n  AT DEFAULT THRESHOLD, across the cone:');
  console.log('    rim frac    gap%');
  for (const r of res.byPose) console.log('    ' + String(r.frac).padEnd(11) + String(r.gapPct).padStart(6));
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
