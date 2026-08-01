// A188: IS THE VERTICAL AXIS ACTUALLY SPECIAL, OR IS a184's METRIC JUST
// REACTING TO THE SCENE MOVING?
//
// a184 reported tiles losing >50% of their rest-frame detail: 28.1% at angY 0,
// rising monotonically to 55.0% at angY 34.1. It stated its own limit — the
// metric cannot separate "detail destroyed" from "different content in this
// tile because the scene legitimately moved" — and then read the trend anyway.
//
// TWO THINGS WERE MISSING AND BOTH ARE FIXED HERE.
//
// 1. NO HORIZONTAL CONTROL. a184's first row already read 28.1% at a pose that
//    is 7.7 deg HORIZONTAL and 0 deg vertical. Nothing in that table says
//    whether 34 deg of horizontal motion would read 55% too. If it does, the
//    "vertical" finding is the instrument measuring displacement. Every pose
//    here is therefore run at matched angle on BOTH axes.
//
// 2. THE METRIC IS NOT MOTION-INVARIANT. Per-tile std compares tile i to tile i,
//    so a rigid shift of a textured region moves detail into a neighbouring tile
//    and both tiles score as changed. The added metric is EDGE ENERGY: the mean
//    Sobel gradient magnitude over content pixels, and its 90th percentile.
//    Translating an image does not change how much gradient it contains;
//    WASHING IT OUT does. That is the difference the user is describing
//    ("the bg wash starts to appear in front of them" / "the foreground is
//    disappearing"), so it is the thing to measure.
//
// The fishtank and the outer frame are HIDDEN for every measurement. a185
// established the look-down black band is the tank's ceiling — spec, not defect
// — and leaving it in makes black tank pixels score as destroyed detail, which
// is exactly the confound a186 had to strip out of the depth-order table.
//
//   node harness/flatten.js [star|troll|warrior] [quick|v2]
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
const DEG = [0, 10, 20, 27, 34, 40];
const EYE_Z = 0.177;      // a184's / the user's own eye distance

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
    // a185: the tank is spec. Its black walls are not lost content, so they are
    // not allowed into a measurement of lost content.
    const hidden = [];
    const tank = (typeof bgFishtankMesh !== 'undefined') ? bgFishtankMesh : null;
    const outer = (typeof bgOuterFrameMesh !== 'undefined') ? bgOuterFrameMesh : null;
    for (const m of [tank, outer]) if (m && m.visible) { hidden.push(m); m.visible = false; }
    if (!hidden.length) console.warn('[a188] neither fishtank nor outer frame was visible to hide');
    const W = 720, Hh = 450, T = 16;
    const grab = () => { for (let n = 0; n < 3; n++) render();
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const g = cv.getContext('2d'); g.drawImage(renderer.domElement, 0, 0, W, Hh);
      return g.getImageData(0, 0, W, Hh).data; };

    const stats = (d) => {
      const lum = new Float32Array(W * Hh), on = new Uint8Array(W * Hh);
      let dark = 0, nOn = 0;
      for (let i = 0; i < W * Hh; i++) {
        const a = d[i*4+3];
        lum[i] = 0.299*d[i*4] + 0.587*d[i*4+1] + 0.114*d[i*4+2];
        on[i] = a >= 8 ? 1 : 0;
        if (on[i]) { nOn++; if (lum[i] < 8) dark++; }
      }
      // Sobel magnitude, content pixels with a full content neighbourhood only
      const mags = [];
      let sum = 0, n = 0;
      for (let y = 1; y < Hh - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y*W + x;
        if (!on[i] || !on[i-1] || !on[i+1] || !on[i-W] || !on[i+W] ||
            !on[i-W-1] || !on[i-W+1] || !on[i+W-1] || !on[i+W+1]) continue;
        const gx = (lum[i-W+1] + 2*lum[i+1] + lum[i+W+1]) - (lum[i-W-1] + 2*lum[i-1] + lum[i+W-1]);
        const gy = (lum[i+W-1] + 2*lum[i+W] + lum[i+W+1]) - (lum[i-W-1] + 2*lum[i-W] + lum[i-W+1]);
        const m = Math.sqrt(gx*gx + gy*gy);
        sum += m; n++; mags.push(m);
      }
      mags.sort((a, b) => a - b);
      const q = (p) => mags.length ? mags[Math.min(mags.length - 1, Math.floor(mags.length * p))] : 0;
      // per-tile std, kept so the a184 number is still reported side by side
      const tx = (W/T)|0, ty = (Hh/T)|0, sd = [];
      for (let by = 0; by < ty; by++) for (let bx = 0; bx < tx; bx++) {
        let s = 0, s2 = 0, k = 0;
        for (let y = by*T; y < (by+1)*T; y++) for (let x = bx*T; x < (bx+1)*T; x++) {
          const i = y*W + x; if (!on[i]) continue;
          s += lum[i]; s2 += lum[i]*lum[i]; k++;
        }
        sd.push(k > 8 ? Math.sqrt(Math.max(0, s2/k - (s/k)*(s/k))) : -1);
      }
      return { sd, edgeMean: sum / Math.max(1, n), edgeP90: q(0.90), edgeP99: q(0.99),
               contentPct: 100 * nOn / (W * Hh), darkPct: 100 * dark / Math.max(1, nOn) };
    };
    const lostVs = (base, s) => {
      let lost = 0, had = 0;
      for (let i = 0; i < base.sd.length; i++) {
        if (base.sd[i] < 4) continue; had++;
        const now = s.sd[i] < 0 ? 0 : s.sd[i];
        if ((base.sd[i] - now) / base.sd[i] > 0.5) lost++;
      }
      return +(100 * lost / Math.max(1, had)).toFixed(1);
    };

    // THIRD ARM: THE FOREGROUND ALONE. The user's own correction — "it could be
    // that the foreground is disappearing" — is a different claim from "the wash
    // is in front", and a186 already showed nothing draws in front of the
    // foreground on this axis. Hiding everything except the layer mesh answers it
    // directly: if the foreground loses its own gradient with nothing composited
    // over it, the plate is innocent and the FG mesh is stretching.
    const L = mediaLayers[0];
    const soloOn = () => { const h = [];
      scene.traverse(m => { if (m.isMesh && m !== L.mesh && m.visible) { h.push(m); m.visible = false; } });
      return h; };

    camera.position.set(0, 0, o.z);
    const base = stats(grab());
    let h0 = soloOn(); const fgBase = stats(grab());
    for (const m of h0) m.visible = true;

    const rows = [];
    for (const deg of o.deg) {
      const t = Math.tan(deg * Math.PI / 180) * o.z;
      for (const ax of ['H', 'V+', 'V-']) {
        if (deg === 0 && ax !== 'H') continue;
        camera.position.set(ax === 'H' ? t : 0, ax === 'V+' ? t : (ax === 'V-' ? -t : 0), o.z);
        const s = stats(grab());
        const h = soloOn(); const f = stats(grab());
        for (const m of h) m.visible = true;
        rows.push({ deg, ax,
          lost: lostVs(base, s),
          edge: +(100 * s.edgeMean / Math.max(1e-9, base.edgeMean)).toFixed(1),
          p90: +(100 * s.edgeP90 / Math.max(1e-9, base.edgeP90)).toFixed(1),
          p99: +(100 * s.edgeP99 / Math.max(1e-9, base.edgeP99)).toFixed(1),
          fgEdge: +(100 * f.edgeMean / Math.max(1e-9, fgBase.edgeMean)).toFixed(1),
          fgP90: +(100 * f.edgeP90 / Math.max(1e-9, fgBase.edgeP90)).toFixed(1),
          fgArea: +(100 * f.contentPct / Math.max(1e-9, fgBase.contentPct)).toFixed(1),
          content: +s.contentPct.toFixed(1), dark: +s.darkPct.toFixed(2) });
      }
    }
    camera.position.set(0, 0, o.z); render();
    for (const m of hidden) m.visible = true;
    return { rows, base: { edgeMean: +base.edgeMean.toFixed(2), edgeP90: +base.edgeP90.toFixed(1),
                           contentPct: +base.contentPct.toFixed(1),
                           fgEdgeMean: +fgBase.edgeMean.toFixed(2),
                           fgContentPct: +fgBase.contentPct.toFixed(1),
                           tiles: base.sd.filter(v => v >= 4).length } };
  }, { deg: DEG, z: EYE_Z, mode: MODE });

  const pad = (s, n) => String(s).padStart(n);
  console.log('\n' + ASSET + '  mode=' + MODE + '  eye z=' + EYE_Z +
    '   (fishtank + outer frame HIDDEN — a185: the tank is spec, not lost content)');
  console.log('  rest: mean |grad| ' + r.base.edgeMean + ', p90 ' + r.base.edgeP90 +
    ', content ' + r.base.contentPct + '% of frame, ' + r.base.tiles + ' tiles with detail\n');
  console.log('  FG alone at rest: mean |grad| ' + r.base.fgEdgeMean + ', covers ' + r.base.fgContentPct + '% of frame\n');
  console.log('   deg  axis   a184 lost%    edge%   p90%   p99%  |  FG edge%  FG p90%  FG area%  |  content%   dark%');
  let last = null;
  for (const w of r.rows) {
    if (last !== null && w.deg !== last) console.log('');
    last = w.deg;
    console.log('  ' + pad(w.deg, 4) + pad(w.ax, 6) + pad(w.lost, 13) +
      pad(w.edge, 9) + pad(w.p90, 7) + pad(w.p99, 7) + '  |' +
      pad(w.fgEdge, 10) + pad(w.fgP90, 9) + pad(w.fgArea, 10) + '  |' +
      pad(w.content, 11) + pad(w.dark, 8));
  }
  console.log('\n  edge%/p90%/p99% are the MOTION-INVARIANT columns: 100 = the frame still holds');
  console.log('  as much gradient as at rest. Translation does not move them; washing out does.');
  console.log('  a184 lost% is the old tile-matched metric, shown so the two can be compared.');
  console.log('\n  FG columns are the LAYER MESH ALONE, everything else hidden. If FG edge% falls');
  console.log('  with nothing composited over it, the foreground is destroying its own detail and');
  console.log('  the plate is innocent — which is the user\'s own reading of what they can see.');
  console.log('  FG area% is how much of the frame the foreground still covers: area falling while');
  console.log('  edge% holds is the mesh TEARING (honest holes); edge% falling while area holds is');
  console.log('  it STRETCHING (a smear that covers).');
  console.log('\n  THE CLAIM UNDER TEST: the vertical axis is special. It survives only if the');
  console.log('  V rows fall materially below the H row at the SAME angle. If H and V track');
  console.log('  each other, a184 measured displacement, not destruction.');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
