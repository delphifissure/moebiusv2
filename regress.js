// MOEBIUS PLATE REGRESSION SUITE (a63b baseline)
// One command validates the directional-plate system across assets and paths:
//   node regress.js            — full suite (masks x 3 assets + 3-path star renders)
//   node regress.js masks      — mask numbers only (fastest)
// Run from the repo root; requires the harness server assets alongside
// (harness/scratch_server.js + scratch_moebius.html symlinks, playwright-core,
// and the headless chromium at CHROME below — see harness/ probes).
//
// EXPECTED RANGES are the a63b baselines with slack for despeckle jitter.
// A FAIL means the plate system changed behavior — find out why before
// trusting the change; REVIEW.md Addenda 60-63b document what each
// mechanism is for and the measured failure that motivated it.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = process.env.MOEBIUS_CHROME || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const HARNESS = path.join(__dirname, 'harness');

// A165 SMEAR-GATE COLUMNS (stLo, stHi, stMax) — pinned on a162, the build that
// fixed the a117 regression, with roughly 55% headroom on the fold percentage:
//     measured   star 15.5% / worst 6.2x   warrior 6.1% / 14.1x
//                photo 9.3% / 6.4x         troll 14.3% / 4.8x
// The lower bound is 0 deliberately: tearing MORE is not the failure this gate
// exists for, and a build that tears everything is caught by coverage instead.
// The upper bound is what a loosening trips — a117 would have read around 40%
// on troll with far larger ratios, and this suite would have failed the day it
// landed instead of eight builds later on a user's screenshot.
// warrior's 14.1x worst ratio is the outlier and is not yet explained; it is
// recorded rather than smoothed away.
//
// THREE COLUMNS BECAUSE THEY CARRY DIFFERENT AMOUNTS OF SIGNAL, established by
// running the gate against the a117 criterion itself (control, then reverted):
//     column               a162            a117 restored
//     folding survivors%   15.5/6.1/9.3/14.3   16.3/7.2/14.9/22.8
//     worst fold ratio      6.2/14.1/6.4/4.8   67.5/213.9/94.0/49.6
//     mean fold ratio       2.4/2.3/2.0/1.9    (rises with it)
// The PERCENTAGE is the weak column — a117 keeps far more triangles, so the
// denominator grows with the numerator and it barely moves. The RATIOS are the
// discriminating ones, up 10-15x, and only troll's percentage crossed. So the
// gate is pinned on all three but the ratios are what actually catch it. With
// these bands the a117 build fails on all four assets.
const ASSETS = [
  // [tag, color, depth, sdMin%, sdMax%, groundMin%, groundMax%]
  ['star',    'starwatcher_color.png',   'starwatcher_depth.png',   11.0, 16.0, 74.0, 84.0,  0, 24.0, 10.0, 3.4],
  // A106 RE-PIN (warrior SD 6.5..11.5 -> 8.0..14.0). The old band encoded the
  // a80 scan's linear-in-depth warp. That warp displaced the FG with a SCALAR
  // k, i.e. as if the head moved a fraction of its real excursion — measured
  // against the exact envelope at pw=1920, dRef at the median depth, t=1:
  //     d=0.20  -120.0 px vs -146.1 exact   0.82x
  //     d=0.40   -40.0     vs  -24.7        1.62x
  //     d=0.80   120.0     vs  357.4        0.34x
  //     d=0.95   180.0     vs  579.1        0.31x
  // Near content — which casts the widest reveals — was tested at under a third
  // of its true displacement, so reveals that DO open were judged never-exposed
  // and pruned out of the inpaint set. Isolated on one page, one asset, with
  // _legacyScanWarp toggled between bakes (harness/a106_ab.js):
  //     exact warp          SD 11.67%   ground 83.70%
  //     legacy linear warp  SD  9.56%   ground 83.70%
  //     scan OFF (ceiling)  SD 11.69%   ground 83.70%
  // 9.56 reproduces the pre-a106 build exactly and ground is identical in all
  // three, so the whole move is the warp. The ceiling settles what it means:
  // with the correct warp the scan prunes 0.02 points, so the 2.13 points the
  // legacy warp removed were reveals that genuinely open — texels that were
  // never inpainted. Re-pinned to the corrected behaviour, not widened to
  // accommodate it.
  ['warrior', 'silverwarrior_color.png', 'silverwarrior_depth.png',  8.0, 14.0, 79.0, 88.0,  0, 12.0, 22.0, 3.3],
  // photo's higher SD% is the known dense-texture pocket cost of leaving
  // pocket promotion opt-in (a63b decision, made on star+warrior evidence:
  // promotion amplified painterly boundary leaks). Revisit if SD budget
  // matters for photographic content. a72b: membrane back to opt-in
  // (user-reported device regressions) -> range restored to the a63b
  // baseline; with _plateMembrane=true it measures ~23.3.
  // a78: the prominence bound trims the a76 budget spill back out of the
  // mask (29.1 measured) — the ORIGINAL a63b range is restored. If this
  // drifts high again, claims are spilling past their own physics
  // (REVIEW Addenda 78, 80, 81).
  ['photo',   'roomImg1.png',            'roomDepth1.png',          24.0, 33.0, 58.0, 70.0,  0, 16.0, 10.0, 3.0],
  // TROLL = the app's SHIPPED DEFAULT (defaultImg*.png) and the one asset the
  // a62+ sweeps never covered (harness probes overwrite its filename).
  // a73 cure + a78 prominence bound: farther-value-wins fills reveals at
  // the far surface (gloop killed, Addendum 78) and the per-pixel
  // prominence bound trims the isotropic budget spill that the value flip
  // exposed (diamond blocks / sawtooth bands — the user's false
  // disocclusions, Addenda 80-81). 23.5 measured: the mask is
  // figure-shaped again. ground% stays collapsed (94.7) — cave-class
  // segmentation is a separate unsolved problem (Addendum 76) that the
  // value law makes HARMLESS.
  // A88 RE-PIN (troll SD 19..29 -> 9..18). The old band encoded the unscaled-sCone
  // bug: sCone is a slope per PIXEL, and as a fixed 0.0025 it made the fill's reach
  // scale as 1/pw, so every asset was wrong by (1920/pw) and the troll (851 px, the
  // smallest) carried the most inflated mask. Isolated by A/B: forcing sCone back to
  // the fixed value returns the troll mask to 23.4% exactly, while disabling a95's
  // seed threshold does not move it at all — the change is a88 alone. Every asset
  // moved as the theory predicts:
  //     troll   851  2.26x too big   23.5 -> 13.0
  //     star   1920  correct         14.1 -> 13.6
  //     photo  2047  1.07x too small 28.7 -> 27.5
  //     warrior 3000 1.56x too small  8.7 ->  9.3
  // Re-pinned to the corrected behaviour, not widened to accommodate it.
  ['troll',   'defaultImgColor.png',     'defaultImgDepth.png',      9.0, 18.0, 90.0, 98.0,  0, 22.0,  8.0, 2.9],
];

let pass = 0, fail = 0;
const check = (label, val, lo, hi) => {
  const ok = val >= lo && val <= hi;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + ' = ' + val.toFixed(1) + '  (expect ' + lo + '..' + hi + ')');
  ok ? pass++ : fail++;
};

(async () => {
  const mode = process.argv[2] || 'full';
  // A110 SERVED-IDENTITY GUARD. Port 8099 is not owned by this run. A
  // scratch_server left behind by an earlier probe — in a DIFFERENT worktree —
  // keeps the port, our spawn dies of EADDRINUSE, and every measurement then
  // silently describes that other tree's build and that other tree's assets.
  // Measured: a full masks run reported identical numbers for all four assets
  // because a stale arc73 server was serving arc73's troll to every one of
  // them. Nothing in the output said so. Assert what is actually being served
  // before measuring anything.
  const srv = spawn('node', ['scratch_server.js'], { cwd: HARNESS, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  {
    const localStamp = (fs.readFileSync(path.join(__dirname, 'moebius.js'), 'utf8').split('\n')[0].match(/v[\d.]+-a\d+/) || ['?'])[0];
    const servedSrc = await fetch('http://localhost:8099/moebius.js').then(r => r.text()).catch(() => '');
    const servedStamp = (servedSrc.split('\n')[0].match(/v[\d.]+-a\d+/) || ['?'])[0];
    if (!servedSrc || servedStamp !== localStamp) {
      console.log('ABORT: port 8099 is serving ' + servedStamp + ' but this tree is ' + localStamp +
                  ' — a stale scratch_server from another worktree owns the port.');
      console.log('       pkill -f scratch_server, then re-run.');
      srv.kill(); process.exit(2);
    }
    console.log('served build = ' + servedStamp + ' (matches this tree)');
  }
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  let page = null;

  // fresh page per load + one retry: reloading the same page wedges the
  // software-GL context in headless environments (measured goto timeouts)
  const load = async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (page) await page.close().catch(() => {});
        page = await browser.newPage({ viewport: { width: 720, height: 450 } });
        page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 140)));
        await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
        for (let t = 0; t < 40; t++) {
          const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
          if (ok) return; await new Promise(r => setTimeout(r, 1000));
        }
      } catch (e) { console.log('  [load retry] ' + e.message.slice(0, 80)); }
    }
    throw new Error('page load failed after retries');
  };

  // ---- mask numbers per asset (quick-bake SD region + ground class) ----
  for (const [tag, color, depth, sdLo, sdHi, gLo, gHi, stLo, stHi, stMax, stMean] of ASSETS) {
    fs.copyFileSync(path.join(__dirname, color), path.join(HARNESS, 'defaultImgColor.png'));
    fs.copyFileSync(path.join(__dirname, depth), path.join(HARNESS, 'defaultImgDepth.png'));
    await load();
    const r = await page.evaluate(() => {
      window._srCapture = true; window._rayReproject = true;
      bgQuickBake = true; buildBackgroundLayer();
      const mk = window._qbMask; if (!mk) return null;
      let nD = 0, nG = 0; const N = mk.pw * mk.ph;
      for (let i = 0; i < N; i++) { if (mk.disocc[i]) nD++; if (mk.ground && mk.ground[i]) nG++; }
      return { sd: 100 * nD / N, g: 100 * nG / N, st: window._qbStretch || null };
    });
    if (!r) { console.log('FAIL  ' + tag + ' build (no capture)'); fail++; continue; }
    check(tag + ' SD%', r.sd, sdLo, sdHi);
    check(tag + ' ground%', r.g, gLo, gHi);
    // ---- A165 THE SMEAR GATE ----
    // The a117 regression — a triangle left in the mesh to stretch across a
    // reveal — was invisible to every metric in this suite, because SD% and
    // ground% are mask areas and the two metrics a117 DID cite (comb energy and
    // black%) both reward the artifact: a stretched triangle is smooth, so comb
    // falls, and it covers, so black falls. This measures the artifact itself.
    //
    // For each SURVIVING triangle, the ratio of its reprojected shift span at
    // the cone rim to its own cell extent. Above 1 the cell cannot be drawn
    // without folding. Scale-free, computed at bake time, no render and no
    // reference image.
    //
    // IT IS A TRIPWIRE, NOT A PROOF, and the distinction is worth stating. The
    // band cannot be zero: with the a160 criterion a cell survives when its
    // depth span is within one source quantum, and near the near end of the
    // range one quantum is still several pixels of parallax, so some surviving
    // cells fold benignly across a sub-quantum step. What it catches is a
    // LOOSENING — a117 would have read around 40% here with far larger ratios,
    // and this suite would have failed the day it landed.
    if (r.st) {
        check(tag + ' folding survivors%', r.st.foldPct, stLo, stHi);
        check(tag + ' worst fold ratio', r.st.maxRatio, 1.0, stMax);
        check(tag + ' mean fold ratio', r.st.meanRatio, 1.0, stMean);
    } else { console.log('FAIL  ' + tag + ' smear gate (no _qbStretch capture)'); fail++; }
  }

  // ---- 3-path build sanity on the reference (throws/holes get caught by build failure or blank canvas) ----
  if (mode === 'full') {
    fs.copyFileSync(path.join(__dirname, ASSETS[0][1]), path.join(HARNESS, 'defaultImgColor.png'));
    fs.copyFileSync(path.join(__dirname, ASSETS[0][2]), path.join(HARNESS, 'defaultImgDepth.png'));
    for (const [ptag, setup] of [
      ['quick', 'bgQuickBake=true;'],
      ['v1',    'bgQuickBake=false; bgMPIFullPlanes=false; bgMPIMode=false;'],
      ['v2',    'bgQuickBake=false; bgMPIFullPlanes=true; bgMPIMode=true;'],
    ]) {
      await load();
      const r = await page.evaluate(async (setup) => {
        window._rayReproject = true;
        eval(setup);
        const ok = buildBackgroundLayer();
        isSweeping = true;
        await new Promise(r2 => { let n = 0; const tick = () => { camera.position.set(0.42, 0.02, 0.2); n++; n < 6 ? requestAnimationFrame(tick) : r2(); }; requestAnimationFrame(tick); });
        render();
        // nonblack coverage: a broken path renders mostly blank
        const cv = document.createElement('canvas'); const W = 96, H = 60;
        cv.width = W; cv.height = H; const cx = cv.getContext('2d');
        cx.drawImage(renderer.domElement, 0, 0, W, H);
        const d = cx.getImageData(0, 0, W, H).data;
        let lit = 0; for (let i = 0; i < W * H; i++) if (d[i*4] + d[i*4+1] + d[i*4+2] > 24) lit++;
        return { ok: ok !== false, lit: 100 * lit / (W * H) };
      }, setup);
      check(ptag + ' render lit%', r.lit, 55, 100);
      if (!r.ok) { console.log('FAIL  ' + ptag + ' buildBackgroundLayer returned false'); fail++; }
    }
  }

  // ---- a67 q!=P subject-pin invariant (quick path, star) ----
  // Subject plane on the near dune, off-axis x=0.12, dolly pinned mid vs far,
  // lock on: the dune crest silhouette must hold (measured 1.0px median at
  // commit; free drifts ~7px — the second check proves the metric has teeth).
  if (mode === 'full') {
    fs.copyFileSync(path.join(__dirname, ASSETS[0][1]), path.join(HARNESS, 'defaultImgColor.png'));
    fs.copyFileSync(path.join(__dirname, ASSETS[0][2]), path.join(HARNESS, 'defaultImgDepth.png'));
    await load();
    const dz = await page.evaluate(async () => {
      window._rayReproject = true;
      bgQuickBake = true; buildBackgroundLayer();
      // subject = near dune via the app's own peek->Z mapping
      const dImg = mediaLayers[0].textures.depth.image2d || mediaLayers[0].textures.depth.image;
      const w = dImg.naturalWidth || dImg.width, h = dImg.naturalHeight || dImg.height;
      const cv0 = document.createElement('canvas'); cv0.width = w; cv0.height = h;
      const cx0 = cv0.getContext('2d'); cx0.drawImage(dImg, 0, 0, w, h);
      const v = cx0.getImageData(Math.round(0.30*w), Math.round(0.90*h), 1, 1).data[0] / 255;
      const rel = v - currentNormPortalPlane;
      subjectFocalPlaneWorldZ = rel < 0
        ? portalPlaneWorldZ - (Math.abs(rel) / Math.max(currentNormPortalPlane, 0.0001)) * outerVolumeDepth
        : portalPlaneWorldZ + (rel / Math.max(1 - currentNormPortalPlane, 0.0001)) * innerVolumeDepth;
      initializeSubjectLockConstant();
      const crest = () => {   // strongest vertical luma edge per column, lower half
        const W2 = 720, H2 = 450;   // native suite viewport: drift thresholds are calibrated in these px
        const cv = document.createElement('canvas'); cv.width = W2; cv.height = H2;
        const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W2, H2);
        const d = cx.getImageData(0, 0, W2, H2).data;
        const L = (x, y) => { const i = (y*W2+x)*4; return 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; };
        const ys = {};
        for (let x = Math.round(0.08*W2); x < Math.round(0.55*W2); x += 3) {
          let bg = 0, by = -1;
          for (let y = Math.round(0.50*H2); y < Math.round(0.98*H2) - 2; y++) {
            const g = Math.abs(L(x, y+2) - L(x, y-2));
            if (g > bg) { bg = g; by = y; }
          }
          if (bg >= 12) ys[x] = by;
        }
        return ys;
      };
      const shoot = async (tval, lock) => {
        subjectLockActive = lock; dollyZoomActive = true;
        const pin = () => { dollyZoomTime = tval - dollyZoomSpeed * 100; };
        isSweeping = true;
        await new Promise(r2 => { let n = 0; const tick = () => { pin(); camera.position.x = 0.12 * dollyLatGain; camera.position.y = 0.02 * dollyLatGain; n++; n < 8 ? requestAnimationFrame(tick) : r2(); }; requestAnimationFrame(tick); });
        pin(); camera.position.x = 0.12 * dollyLatGain; camera.position.y = 0.02 * dollyLatGain; render();
        return crest();
      };
      const med = (a, b) => {
        const dz2 = []; for (const x in a) if (x in b) dz2.push(Math.abs(a[x] - b[x]));
        dz2.sort((p, q2) => p - q2);
        return dz2.length ? dz2[(dz2.length / 2) | 0] : -1;
      };
      const lm = await shoot(0, true), lf = await shoot(Math.PI/2, true);
      dollyZoomActive = false; render();
      const fm = await shoot(0, false), ff = await shoot(Math.PI/2, false);
      dollyZoomActive = false; render();
      return { lock: med(lm, lf), free: med(fm, ff) };
    });
    // measured at commit (720px frame): lock 0-1px, free ~3.5px
    check('dolly q!=P lock crest px', dz.lock, 0, 2);
    check('dolly q!=P free crest px (metric teeth)', dz.free, 2, 60);
  }

  console.log('\n' + (fail ? 'REGRESSION: ' + fail + ' FAIL, ' + pass + ' pass' : 'ALL PASS (' + pass + ')'));
  await browser.close(); srv.kill(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
