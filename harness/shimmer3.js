// A124: DOES BAKING ACTUALLY KILL THE SHIMMER?
//
// The realtime fill rebuilds a full pull-push pyramid every frame from the
// CURRENT warped frame (render(), ~L18435-18573). That is inherently
// view-dependent: it cannot be "frozen" in screen space because the gaps move
// with the camera. The view-INDEPENDENT fill is what the bake computes once in
// source space. So the shimmer fix is not a new mechanism — it is the bake,
// and the open question is whether the bake delivers it.
//
// METRIC, deliberately simple after several classification instruments went
// wrong: mean |dL| over lit pixels between two camera positions 0.0015 apart
// (sub-pixel parallax). Both arms render the SAME geometry through the SAME
// reprojection, so honest parallax contributes equally; any difference between
// arms is fill stability. No gap/non-gap split to get wrong.
//
//   node harness/shimmer3.js [troll|star|warrior]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const ASSET = process.argv[2] || 'troll';
const SRC = { troll: ['defaultImgColor.png','defaultImgDepth.png'],
              star: ['starwatcher_color.png','starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png','silverwarrior_depth.png'] };
(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const all = {};
  // Third arm: baked with the plate and cap cards HIDDEN. INTENDED as the
  // honest-parallax floor (geometry alone under the same reprojection).
  // IT IS NOT A FLOOR AND THE NUMBERS SHOULD NOT BE READ AS ONE. Measured
  // troll: 1.268 / 1.271 / 1.165 at 0.30 / 0.52 / 0.85 rim, i.e. HIGHER
  // than the baked arm's 0.931 / 0.852 / 0.752. Hiding the plate makes the
  // gaps render BLACK, and black<->content transitions at moving
  // silhouettes swing harder than a filled gap does, so the arm measures
  // the artifact it introduces. Kept as a recorded negative result: it
  // does NOT separate honest parallax from fill instability, and no
  // conclusion about the baked residual can be drawn from it.
  for (const [tag, bake] of [['realtime', false], ['quick-baked', true], ['FG-only floor', 'floor']]) {
    const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0,160)));
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 40; t++) {
      const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
      if (ok) break; await new Promise(r => setTimeout(r, 1000));
    }
    const rows = await page.evaluate(async (doBake) => {
      window._rayReproject = true;
      if (doBake) { bgQuickBake = true; bgMPIFullPlanes = false; bgMPIMode = false;
                    bgBuildStamp = null; buildBackgroundLayer(); }
      if (doBake === 'floor') {
        scene.traverse((o) => { if (!o.isMesh) return;
          const u = o.material && o.material.uniforms;
          if (u && u.u_isBackgroundLayer && u.u_isBackgroundLayer.value) o.visible = false; });
      }
      isSweeping = true;
      const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
      const W = 480, Hh = 300, EPS = 0.0015;
      const grab = () => { for (let n=0;n<3;n++) render();
        const cv=document.createElement('canvas'); cv.width=W; cv.height=Hh;
        const cx=cv.getContext('2d'); cx.drawImage(renderer.domElement,0,0,W,Hh);
        return cx.getImageData(0,0,W,Hh).data; };
      const out = [];
      for (const frac of [0.0, 0.30, 0.52, 0.85]) {
        const x = frac * dist * Math.tan(60*Math.PI/180);
        camera.position.set(x, 0, dist); const a = grab();
        camera.position.set(x + EPS, 0, dist); const b = grab();
        let s = 0, n = 0, mx = 0;
        for (let i = 0; i < W*Hh; i++) { const j=i*4;
          const la = 0.299*a[j]+0.587*a[j+1]+0.114*a[j+2];
          const lb = 0.299*b[j]+0.587*b[j+1]+0.114*b[j+2];
          if (la < 4 && lb < 4) continue;
          const d = Math.abs(la-lb); s += d; n++; if (d > mx) mx = d;
        }
        out.push({ frac, dMean: +(s/Math.max(1,n)).toFixed(3), dMax: +mx.toFixed(1) });
      }
      camera.position.set(0,0,dist); render();
      return out;
    }, bake);
    all[tag] = rows;
    console.log('\n=== ' + tag + ' ===');
    for (const r of rows) console.log('  rim ' + String(r.frac).padEnd(6) + ' dMean=' + String(r.dMean).padStart(7) + '  dMax=' + String(r.dMax).padStart(6));
    await page.close();
  }
  console.log('\n' + ASSET + '  frame change for a 0.0015 camera move (sub-pixel parallax)');
  console.log('  rim frac   realtime   quick-baked   ratio rt/baked');
  console.log('  (FG-only column is NOT a valid floor — hiding the plate renders gaps BLACK,');
  console.log('   and black<->content swings exceed a filled gap. Recorded, not usable.)');
  console.log('  rim frac   realtime   quick-baked   FG-only floor');
  for (let i = 0; i < all['realtime'].length; i++) {
    const r = all['realtime'][i], q = all['quick-baked'][i], f = all['FG-only floor'][i];
    console.log('  ' + String(r.frac).padEnd(11) + String(r.dMean).padStart(8) +
      String(q.dMean).padStart(14) + String(f.dMean).padStart(16));
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
