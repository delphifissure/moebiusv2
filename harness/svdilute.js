// A130 follow-up: WHY does black% read LOWER in the simulated view?
//
// simview.js measured, inside the projected content polygon, PiP off:
//     yaw   raw    sim
//      20   1.13   0.76
//      32   1.87   1.02
//      45   3.16   1.68
//      60   5.09   3.66
// The simulated view is a geometric remapping of the SAME pixels, so it cannot
// remove a hole. Two candidate mechanisms, both testable:
//   filter  pass 2 resamples the supersampled buffer onto a SMALLER screen area
//           (Omega drops to 84% at 45 deg, 66% at 60). Bilinear averaging blends
//           a thin black gap with its lit neighbours until the sum clears the
//           <24 black threshold. The hole is still there; the metric stops
//           counting it.
//   falloff the geometric attenuation DARKENS the sim view (0.71x at 45 deg),
//           which would push MORE pixels under the threshold, not fewer — so if
//           this were the driver the sign would be wrong. Included anyway
//           because "the sign is wrong" is a prediction worth testing.
// Arms: bilinear+falloff (shipped), NEAREST+falloff, bilinear+no falloff,
// NEAREST+no falloff. If the filter is the mechanism, the NEAREST arms recover
// the raw number.
//
//   node harness/svdilute.js [troll|star|warrior]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const ASSET = process.argv[2] || 'troll';
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star: ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };
const POSES = [20, 32, 45, 60];

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  const rows = await page.evaluate(async (poses) => {
    window._rayReproject = true;
    bgQuickBake = true; bgMPIFullPlanes = false; bgMPIMode = false;
    bgBuildStamp = null; buildBackgroundLayer();
    window.simViewer.on(); window.simViewer.pip(false);
    const holeFrac = (poly) => {
      const W = renderer.domElement.width, Hh = renderer.domElement.height;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0);
      const d = cx.getImageData(0, 0, W, Hh).data;
      const inside = (px, py) => { let c = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
          if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) c = !c;
        } return c; };
      let tot = 0, blk = 0;
      for (let y = 0; y < Hh; y += 2) for (let x = 0; x < W; x += 2) {
        if (!inside(x + 0.5, y + 0.5)) continue;
        const i = (y * W + x) * 4; tot++; if (d[i] + d[i + 1] + d[i + 2] < 24) blk++;
      }
      return tot ? 100 * blk / tot : NaN;
    };
    const contentPoly = (useSim) => {
      const R = svPanelRect(); const m = mediaLayers[0].mesh;
      m.geometry.computeBoundingBox(); const bb = m.geometry.boundingBox;
      const C = { w: (bb.max.x - bb.min.x) * m.scale.x, h: (bb.max.y - bb.min.y) * m.scale.y };
      const cw = renderer.domElement.width, ch = renderer.domElement.height, asp = R.W / R.H;
      let mw = cw, mh = Math.round(cw / asp);
      if (mh > ch) { mh = ch; mw = Math.round(ch * asp); }
      const mx = Math.round((cw - mw) / 2), my = Math.round((ch - mh) / 2);
      const cor = [[-C.w / 2, -C.h / 2], [C.w / 2, -C.h / 2], [C.w / 2, C.h / 2], [-C.w / 2, C.h / 2]];
      if (!useSim) return cor.map(([x, y]) => [mx + (x / R.W + 0.5) * mw, my + (0.5 - y / R.H) * mh]);
      return cor.map(([x, y]) => { const q = new THREE.Vector3(x, y, R.P).project(svState.cam2);
        return [mx + (q.x * 0.5 + 0.5) * mw, my + (1 - (q.y * 0.5 + 0.5)) * mh]; });
    };
    const draw = () => { for (let n = 0; n < 3; n++) render(); };
    // A render-target texture's filters are baked in at allocation, and marking
    // one needsUpdate makes three.js re-upload from its (null) image and blanks
    // the buffer — the first attempt read 100% black everywhere, which is a
    // broken instrument, not a result. Reallocate instead.
    let curFilter = null;
    const setFilter = (nearest) => {
      if (curFilter === nearest) return;
      curFilter = nearest;
      const w = svState.rt.width, h = svState.rt.height;
      const f = nearest ? THREE.NearestFilter : THREE.LinearFilter;
      svState.rt.dispose();
      svState.rt = new THREE.WebGLRenderTarget(w, h, { minFilter: f, magFilter: f,
        format: THREE.RGBAFormat, stencilBuffer: false, depthBuffer: true });
      svState.mat.uniforms.tPass1.value = svState.rt.texture;
    };
    const arms = [['bilinear + falloff (shipped)', false, true],
                  ['NEAREST  + falloff', true, true],
                  ['bilinear + no falloff', false, false],
                  ['NEAREST  + no falloff', true, false]];
    const out = [];
    draw();   // svEnsure() builds the pass-1 buffer on the first SV frame
    for (const a of poses) {
      window.simViewer.pose(a, 0);
      svState.pipShowsRaw = false; setFilter(false); window.simViewer.falloff(false);
      draw(); const raw = holeFrac(contentPoly(false));
      const rec = { yaw: a, raw: +raw.toFixed(2), sim: {} };
      for (const [tag, nearest, fall] of arms) {
        svState.pipShowsRaw = true; setFilter(nearest); window.simViewer.falloff(fall);
        draw(); rec.sim[tag] = +holeFrac(contentPoly(true)).toFixed(2);
      }
      out.push(rec);
    }
    window.simViewer.off();
    return { rows: out, arms: arms.map(a => a[0]) };
  }, POSES);

  console.log('\n' + ASSET + '  black% inside the projected CONTENT polygon (PiP off)');
  console.log('  yaw    raw   ' + rows.arms.map(a => a.padStart(28)).join(''));
  for (const r of rows.rows) {
    console.log('  ' + String(r.yaw).padStart(3) + String(r.raw).padStart(7) + '   ' +
      rows.arms.map(a => String(r.sim[a]).padStart(28)).join(''));
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
