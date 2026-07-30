// A173: HOW FAR MAY THE INNER VOLUME COME IN FRONT OF THE GLASS?
//
// a172 dropped the fullscreen pop-out because the only construction available
// translated the WHOLE volume (background magnified 1.18x) and the alternative —
// GROW innerVolumeDepth instead of translating — needed a depth with no
// derivation. This finds the derivation.
//
// THE SOURCE THAT DOES NOT APPLY. Stereoscopic comfort limits (Shibata, Kim,
// Hoffman, Banks, "The zone of comfort: predicting visual discomfort with
// stereo displays", J. Vision 11(8):11, 2011) bound negative parallax by the
// vergence-accommodation conflict. There is no such conflict here: this is a
// MONOCULAR head-tracked portal. One eye position is rendered, there is no
// binocular disparity at all, and every photon leaves the screen plane so
// accommodation never moves. Those numbers are about a different display.
//
// THE SOURCE THAT DOES. frameCorners() is Kooima's generalized perspective
// projection (Robert Kooima, "Generalized Perspective Projection", 2008): an
// off-axis asymmetric frustum pinned to the portal rect at portalPlaneWorldZ.
// So the frustum SIDE PLANES ARE THE WINDOW EDGES. Content in front of the
// screen plane that reaches them is cut by them — and a near object cut by the
// frame is exactly Lipton's window violation (Foundations of the Stereoscopic
// Cinema, 1982, ch. 6): the cut reads as occlusion and contradicts the parallax
// that puts the object in front. Unlike the comfort limits this is not a
// perceptual threshold to be sourced, it is a geometric fact to be solved.
//
// THE SOLVE. Under the a104 ray law a texel at portal-plane coordinate P with
// offset zOff, seen from an eye at lateral offset ex and distance H, meets the
// portal plane at
//
//     X_screen = P.x - ex * zOff / (H - zOff)
//
// Behind the glass (zOff < 0) that tracks the eye by LESS than |ex| and stays
// bounded; in front (zOff > 0) it runs the other way and grows without bound.
// It is cut when |X_screen| > hw. So, over the committed cone |ex| <= H*tan(θ):
//
//     |P.x| + H*tan(θ) * z/(H - z) <= hw,       z = zOff > 0
//
// Growing innerVolumeDepth from I to I+p while leaving the embed at -I holds
// the portal plane AND the far extent fixed and makes the near extent exactly
// +p, so with u = smoothstep(portalNorm, 1, d):
//
//     zOff(p) = u*(I + p) - I
//
// zOff is increasing in p and z/(H-z) is increasing in z, so each texel gives
// one upper bound on p, in closed form:
//
//     M   = hw - |P.x|                 (margin to the window edge)
//     z*  = H*M / (H*tan(θ) + M)       (the largest offset that texel may have)
//     p_i = (z* + I)/u - I
//
// and p_max = min over texels. Same in y. NOTHING here is chosen: hw/hh are the
// portal rect, θ is bgViewFadeEndDeg (the cone the build already commits to), H
// is live, I is innerVolumeDepth, and u comes from the depth map.
//
// The closed form is checked against BRUTE FORCE over the same texels, because
// a formula that agrees with itself is not evidence.
//
//   node harness/popdepth.js [troll|star|warrior|all]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H_DIR = path.join(WT, 'harness');
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star: ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };
const ASSETS = (process.argv[2] === 'all' || !process.argv[2])
  ? ['troll', 'star', 'warrior'] : [process.argv[2]];

(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: H_DIR, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const onDisk = (fs.readFileSync(path.join(WT, 'moebius.js'), 'utf8')
                    .match(/MOEBIUS_BUILD\s*=\s*'([^']+)'/) || [])[1] || null;

  for (const asset of ASSETS) {
    fs.copyFileSync(path.join(WT, SRC[asset][0]), path.join(H_DIR, 'defaultImgColor.png'));
    fs.copyFileSync(path.join(WT, SRC[asset][1]), path.join(H_DIR, 'defaultImgDepth.png'));
    const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 40; t++) {
      const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth?.image); } catch (e) { return false; } }).catch(() => false);
      if (ok) break; await new Promise(r => setTimeout(r, 1000));
    }
    const served = await page.evaluate(() => (typeof MOEBIUS_BUILD === 'string') ? MOEBIUS_BUILD : null);
    if (served !== onDisk) console.log('*** served ' + served + ' but tree says ' + onDisk);

    const R = await page.evaluate(async () => {
      const L = mediaLayers[0];
      const gp = L.mesh.geometry.parameters || {};
      const hw = gp.width * (L.mesh.scale.x || 1) / 2;
      const hh = gp.height * (L.mesh.scale.y || 1) / 2;
      const zN = L.mesh.position.z;
      const Hd = Math.abs((camera.position.z) - zN) || 0.2;
      const I = Math.max(1e-6, innerVolumeDepth);
      const pn = currentNormPortalPlane;
      const theta = (typeof bgViewFadeEndDeg === 'number' ? bgViewFadeEndDeg : 45) * Math.PI / 180;
      const Emax = Hd * Math.tan(theta);

      // read the SOURCE depth map straight off its image
      const img = L.textures.depth.image;
      const w = img.width || img.videoWidth, h = img.height || img.videoHeight;
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const cx2 = cv.getContext('2d', { willReadFrequently: true });
      cx2.drawImage(img, 0, 0);
      const px = cx2.getImageData(0, 0, w, h).data;

      const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

      // ---- closed form ----
      let pClosed = Infinity, argx = -1, argy = -1, nInner = 0;
      // ---- and the pieces needed for the brute-force cross-check ----
      const uArr = new Float32Array(w * h), pxArr = new Float32Array(w * h), pyArr = new Float32Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const d = px[i] / 255;
          const u = (d < pn) ? 0 : ss(pn, 1, d);
          const idx = y * w + x;
          uArr[idx] = u;
          // image row 0 is the TOP of the picture; world +y is up
          const PX = ((x + 0.5) / w - 0.5) * 2 * hw;
          const PY = (0.5 - (y + 0.5) / h) * 2 * hh;
          pxArr[idx] = PX; pyArr[idx] = PY;
          if (u <= 0) continue;
          nInner++;
          for (const [P, half] of [[Math.abs(PX), hw], [Math.abs(PY), hh]]) {
            const M = half - P;
            // M <= 0 means the texel is already at the window edge: any protrusion cuts it
            const zStar = (M <= 0) ? 0 : (Hd * M) / (Emax + M);
            const pi = (zStar + I) / u - I;
            if (pi < pClosed) { pClosed = pi; argx = x; argy = y; }
          }
        }
      }
      if (!isFinite(pClosed)) pClosed = 0;
      pClosed = Math.max(0, pClosed);

      // ---- brute force: the largest p on a fine grid with ZERO cut texels ----
      const cutCount = (p) => {
        let n = 0;
        for (let idx = 0; idx < w * h; idx++) {
          const u = uArr[idx]; if (u <= 0) continue;
          const z = u * (I + p) - I; if (z <= 0) continue;
          const g = Emax * z / (Hd - z);
          if (Math.abs(pxArr[idx]) + g > hw || Math.abs(pyArr[idx]) + g > hh) n++;
        }
        return n;
      };
      let lo = 0, hi = Math.max(1e-4, Hd * 0.999);
      if (cutCount(hi) === 0) { lo = hi; }
      else { for (let it = 0; it < 60; it++) { const mid = 0.5 * (lo + hi); if (cutCount(mid) === 0) lo = mid; else hi = mid; } }

      // THE DISTRIBUTION, not just the minimum. p_max is a min over texels, so a
      // single texel of near content sitting on the border sets it for the whole
      // image. Knowing how much is being surrendered to how few texels is the
      // difference between "pop-out is impossible" and "pop-out is impossible
      // AT THE BORDER", which are different problems with different fixes.
      const pis = [];
      for (let idx = 0; idx < w * h; idx++) {
        const u = uArr[idx]; if (u <= 0) continue;
        let worst = Infinity;
        for (const [P, half] of [[Math.abs(pxArr[idx]), hw], [Math.abs(pyArr[idx]), hh]]) {
          const M = half - P;
          const zStar = (M <= 0) ? 0 : (Hd * M) / (Emax + M);
          const pi = (zStar + I) / u - I;
          if (pi < worst) worst = pi;
        }
        pis.push(Math.max(0, worst));
      }
      pis.sort((a, b) => a - b);
      const q = (f) => pis.length ? pis[Math.min(pis.length - 1, Math.floor(f * pis.length))] : 0;
      const pct = { p0: q(0), p001: q(0.0001), p01: q(0.001), p1: q(0.01), p5: q(0.05), p50: q(0.5) };

      return { hw, hh, zN, Hd, I, pn, thetaDeg: theta * 180 / Math.PI, Emax, w, h,
               nInner, innerPct: 100 * nInner / (w * h),
               pClosed, pBrute: lo, pct,
               cutAtP: cutCount(lo), cutAt105: cutCount(lo * 1.05), cutAt150: cutCount(lo * 1.5),
               bindX: argx, bindY: argy,
               bindPx: pxArr[argy * w + argx], bindPy: pyArr[argy * w + argx],
               bindU: uArr[argy * w + argx] };
    });

    const f = (v, n) => (typeof v === 'number' ? v.toFixed(n) : String(v));
    console.log('\n' + asset + '  (' + R.w + 'x' + R.h + ')  build ' + served);
    console.log('  portal half-extent      hw=' + f(R.hw, 4) + '  hh=' + f(R.hh, 4) +
                '   eye distance H=' + f(R.Hd, 4));
    console.log('  innerVolumeDepth I=' + f(R.I, 4) + '   portal plane norm=' + f(R.pn, 3) +
                '   cone θ=' + f(R.thetaDeg, 1) + '°  ->  Emax=H·tanθ=' + f(R.Emax, 4));
    console.log('  inner-volume footprint: ' + R.nInner + ' texels (' + f(R.innerPct, 2) + '% of the frame)');
    console.log('  binding texel at image (' + R.bindX + ',' + R.bindY + ')  P=(' +
                f(R.bindPx, 4) + ',' + f(R.bindPy, 4) + ')  u=' + f(R.bindU, 4));
    console.log('  p_max  closed form = ' + f(R.pClosed, 6));
    console.log('  p_max  brute force = ' + f(R.pBrute, 6) +
                '   (agree to ' + f(Math.abs(R.pClosed - R.pBrute), 8) + ')');
    console.log('  cut texels at p_max = ' + R.cutAtP + ',  at 1.05·p_max = ' + R.cutAt105 +
                ',  at 1.5·p_max = ' + R.cutAt150);
    console.log('  => pop-out is ' + f(100 * R.pClosed / R.I, 1) + '% of innerVolumeDepth, ' +
                f(100 * R.pClosed / R.Hd, 2) + '% of the viewing distance');
    const P = R.pct;
    console.log('  per-texel budget, sorted:  min ' + f(P.p0, 5) + '   0.01% ' + f(P.p001, 5) +
                '   0.1% ' + f(P.p01, 5) + '   1% ' + f(P.p1, 5) +
                '   5% ' + f(P.p5, 5) + '   median ' + f(P.p50, 5));
    console.log('     (i.e. allowing N% of inner-volume texels to be cut would buy that much p)');
    await page.close();
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
