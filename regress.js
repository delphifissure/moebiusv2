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
  // [tag, color, depth, sdMin%, sdMax%, groundMin%, groundMax%,
  //  stLo, stHi, stMax, stMean,            <- a165 gate, QUICK bake
  //  v2Max, v2Mean]                        <- a178 gate, v2 measured COLD
  //
  // The v2 ceilings are ~1.5x the cold measurement, the same headroom the quick
  // columns carry. Cold values at a177: star 5.240/2.802, warrior 19.908/4.143,
  // photo 9.0/2.2, troll 6.789/2.138. They are ceilings on the WORST and MEAN
  // ratio only — foldPct is deliberately unbounded, because with the a160
  // criterion a survivor is a cell within one source quantum, and on an 8-bit
  // source one quantum already exceeds the fold limit, so a band on foldPct
  // would encode the file's bit depth rather than the geometry.
  ['star',    'starwatcher_color.png',   'starwatcher_depth.png',   11.0, 16.0, 74.0, 84.0,  0, 24.0, 10.0, 3.4,  8.0, 4.0],
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
  ['warrior', 'silverwarrior_color.png', 'silverwarrior_depth.png',  8.0, 14.0, 79.0, 88.0,  0, 12.0, 22.0, 3.3, 30.0, 6.0],
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
  ['photo',   'roomImg1.png',            'roomDepth1.png',          24.0, 33.0, 58.0, 70.0,  0, 16.0, 10.0, 3.0, 14.0, 3.4],
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
  ['troll',   'defaultImgColor.png',     'defaultImgDepth.png',      9.0, 18.0, 90.0, 98.0,  0, 22.0,  8.0, 2.9, 10.0, 3.2],
];

let pass = 0, fail = 0;
const check = (label, val, lo, hi) => {
  const ok = val >= lo && val <= hi;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + label + ' = ' + val.toFixed(1) + '  (expect ' + lo + '..' + hi + ')');
  ok ? pass++ : fail++;
};

(async () => {
  const mode = process.argv[2] || 'full';
  const DOLLY_ONLY = (mode === 'dolly');   // A208: run just the dolly invariant
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
  for (const [tag, color, depth, sdLo, sdHi, gLo, gHi, stLo, stHi, stMax, stMean, v2Max, v2Mean] of (DOLLY_ONLY ? [] : ASSETS)) {
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
    // A178 THE SAME GATE ON THE SHIPPED DEFAULT. Everything above is measured on
    // the QUICK bake, so until now the suite had no reading at all on v2 — which
    // is what let v2 sit at 56x worst stretch (a176) while the quick path was
    // held to 4.8x.
    //
    // A179 MEASURED COLD, ON A FRESH PAGE. The first version baked v2 in the
    // same page straight after quick, and that reads a DIFFERENT geometry:
    // harness/v2order.js, one page, v2 -> quick -> v2, on star —
    //     v2 cold        keep 256165  worst 5.240
    //     v2 after quick keep 251042  worst 7.564
    //     v2 again       keep 250197  worst 7.564
    // so the quick bake changes the v2 bake, AND v2 is not idempotent against
    // itself. Both are open defects (see the addendum); until they are fixed a
    // guard measured after a quick bake would be pinned to a contaminated state
    // and would not fail when the COLD path regressed. Reload first.
    await load();
    const rv2 = await page.evaluate(() => {
      window._srCapture = true; window._rayReproject = true;
      bgQuickBake = false; bgMPIFullPlanes = true; bgMPIMode = true;
      bgBuildStamp = null; buildBackgroundLayer();
      return window._v2Stretch || null;
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
    // A178: v2 front planes. The backdrop is excluded by the gate itself — it
    // keeps its cliff cells deliberately, so binding the visible geometry to the
    // most-hidden geometry's stretch would be meaningless.
    //
    // foldPct is NOT bounded here. With the a160 criterion a cell survives when
    // its depth span is within one source quantum, and on an 8-bit source one
    // quantum already exceeds the fold limit, so foldPct sits near 50-70% by
    // construction and a band on it would encode the source's bit depth rather
    // than the geometry. The RATIOS carry the signal — that is the a165 lesson,
    // and it is the same here.
    if (rv2) {
        check(tag + ' v2 worst fold ratio', rv2.maxRatio, 1.0, v2Max);
        check(tag + ' v2 mean fold ratio', rv2.meanRatio, 1.0, v2Mean);
        console.log('      (v2 ' + rv2.keep + ' front quads, ' + rv2.foldPct + '% folding, ' +
                    rv2.tornPct + '% torn, backdrop ' + rv2.backdropQuads + ' quads excluded)');
    } else { console.log('FAIL  ' + tag + ' v2 smear gate (no _v2Stretch capture)'); fail++; }
  }

  // ---- 3-path build sanity on the reference (throws/holes get caught by build failure or blank canvas) ----
  if (mode === 'full' && !DOLLY_ONLY) {
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
  if (mode === 'full' || DOLLY_ONLY) {
    fs.copyFileSync(path.join(__dirname, ASSETS[0][1]), path.join(HARNESS, 'defaultImgColor.png'));
    fs.copyFileSync(path.join(__dirname, ASSETS[0][2]), path.join(HARNESS, 'defaultImgDepth.png'));
    await load();
    const dz = await page.evaluate(async () => {
      window._rayReproject = true;
      bgQuickBake = true; buildBackgroundLayer();
      // A208d: SET q FROM THE FEATURE THE METRIC TRACKS. The drift metric
      // (crest) is a LUMA edge tracker. A208b/c found the strongest DEPTH edge
      // and sampled bey+0.02h — the far side of the ridge silhouette (0.157,
      // the valley) — so the check pinned background and then measured the
      // subject's drift: 162px of legitimate world stretch reported as pin
      // failure. The 0.90h body sample (0.741, near dune) is a third surface;
      // pinning it left a 4px residual for the same reason. Source-space probe
      // (a208 log): strongest luma edges in the subject columns sit at depth
      // 0.502..0.529 — the NEAR side of the ridge silhouette. So: locate the
      // strongest luma edge in the sampled column with the same law crest()
      // uses, then take the nearer (max) side of the depth map across it.
      const dImg = mediaLayers[0].textures.depth.image2d || mediaLayers[0].textures.depth.image;
      const cImg = mediaLayers[0].textures.color.image2d || mediaLayers[0].textures.color.image;
      const w = dImg.naturalWidth || dImg.width, h = dImg.naturalHeight || dImg.height;
      const cv0 = document.createElement('canvas'); cv0.width = w; cv0.height = h;
      const cx0 = cv0.getContext('2d'); cx0.drawImage(dImg, 0, 0, w, h);
      const col = cx0.getImageData(Math.round(0.30*w), 0, 1, h).data;
      const cvC = document.createElement('canvas'); cvC.width = w; cvC.height = h;
      const cxC = cvC.getContext('2d'); cxC.drawImage(cImg, 0, 0, w, h);
      const colC = cxC.getImageData(Math.round(0.30*w), 0, 1, h).data;
      const lum = y => 0.299*colC[y*4] + 0.587*colC[y*4+1] + 0.114*colC[y*4+2];
      // same law as crest(): strongest luma step in the lower half; the ±
      // window is the crest() ±2px at H2=450 scaled to source rows.
      const gw = Math.max(2, Math.round(h * 2 / 450));
      let be = 0, bey = Math.round(0.90*h);
      for (let y = Math.round(0.50*h) + gw; y < Math.round(0.98*h) - gw; y++) {
        const g = Math.abs(lum(y+gw) - lum(y-gw));
        if (g > be) { be = g; bey = y; }
      }
      const so = Math.max(gw + 2, Math.round(0.01*h));  // sample just clear of the gradient window
      const vUp = col[Math.max(0, bey - so)*4] / 255;
      const vDn = col[Math.min(h-1, bey + so)*4] / 255;
      const v = Math.max(vUp, vDn);   // nearer side = the subject side of its silhouette
      const vBody = col[Math.round(0.90*h)*4] / 255;   // reference: the near-dune body sample
      // A208: the app's own volume mapping (a200), not a private linear copy —
      // this was copy #4 of the law a200 unified; linear-vs-smoothstep mis-sets
      // the plane by up to 9.6% of the half-volume.
      if (typeof volumeWorldZForNormDepth === 'function') {
        subjectFocalPlaneWorldZ = volumeWorldZForNormDepth(v);
      } else {
        const rel = v - currentNormPortalPlane;
        subjectFocalPlaneWorldZ = rel < 0
          ? portalPlaneWorldZ - (Math.abs(rel) / Math.max(currentNormPortalPlane, 0.0001)) * outerVolumeDepth
          : portalPlaneWorldZ + (rel / Math.max(1 - currentNormPortalPlane, 0.0001)) * innerVolumeDepth;
      }
      initializeSubjectLockConstant();
      const W2 = 720, H2 = 450;   // native suite viewport: drift thresholds are calibrated in these px
      const grabL = () => {
        const cv = document.createElement('canvas'); cv.width = W2; cv.height = H2;
        const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W2, H2);
        const d = cx.getImageData(0, 0, W2, H2).data;
        const L = new Float32Array(W2 * H2);
        for (let i = 0; i < W2 * H2; i++) L[i] = 0.299*d[i*4] + 0.587*d[i*4+1] + 0.114*d[i*4+2];
        return L;
      };
      const crest = (L) => {   // strongest vertical luma edge per column, lower half
        const ys = {};
        for (let x = Math.round(0.08*W2); x < Math.round(0.55*W2); x += 3) {
          let bg = 0, by = -1;
          for (let y = Math.round(0.50*H2); y < Math.round(0.98*H2) - 2; y++) {
            const g = Math.abs(L[(y+2)*W2+x] - L[(y-2)*W2+x]);
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
        return grabL();
      };
      // A208e: THE LOCK-ARM METRIC MUST PRESERVE FEATURE IDENTITY. The
      // strongest-edge crest tracker is fine for the free arm, but under the
      // lock the corner adjustment (k>1 at the far phase) shrinks the content
      // rect and pulls its bottom border — a ~120-strength horizontal edge —
      // into the 0.50..0.98h search band at y≈435, where it out-gradients
      // every scene edge in EVERY column. Strongest-edge diffs then measure
      // the ridge at mid against the BORDER at far: 155..168px of pure
      // feature switch, reported as pin failure — and the old far-cols
      // "stretch" PASS was the same border artifact (the far columns' scene
      // edges barely move; probed with per-column top-3 edge tables in
      // harness/dollysuite.js, a208e log). Both lock measurements are now NCC
      // template matches, which carry identity by appearance and a corr floor
      // so a blind match fails instead of passing silently. Only |dy| is
      // asserted: the tracked features are near-horizontal edges, so dx is
      // unconstrained by the aperture problem; the x-pin is defended at 2px
      // (both repro paths, full phase sweep, real click gesture) by
      // harness/clickpin.js.
      const PS = 9;
      const nccMatch = (Lm, Lf, cx, cy) => {
        const tmpl = []; let pm = 0, n = 0;
        for (let y = cy-PS; y <= cy+PS; y++) for (let x = cx-PS; x <= cx+PS; x++) tmpl.push(Lm[y*W2+x]);
        for (let y = -PS; y <= PS; y += 2) for (let x = -PS; x <= PS; x += 2) { pm += tmpl[(y+PS)*(2*PS+1)+(x+PS)]; n++; }
        pm /= n; let pss = 0;
        for (let y = -PS; y <= PS; y += 2) for (let x = -PS; x <= PS; x += 2) { const dd = tmpl[(y+PS)*(2*PS+1)+(x+PS)]-pm; pss += dd*dd; }
        let bc = -2, bx = 0, by = 0;
        for (let oy = Math.max(PS, cy-200); oy <= Math.min(H2-1-PS, cy+200); oy++)
          for (let ox = Math.max(PS, cx-60); ox <= Math.min(W2-1-PS, cx+60); ox++) {
            let s = 0, kk = 0;
            for (let y = -PS; y <= PS; y += 2) for (let x = -PS; x <= PS; x += 2) { s += Lf[(oy+y)*W2+ox+x]; kk++; }
            const m = s/kk; let num = 0, den = 0;
            for (let y = -PS; y <= PS; y += 2) for (let x = -PS; x <= PS; x += 2) {
              const a = Lf[(oy+y)*W2+ox+x]-m, b = tmpl[(y+PS)*(2*PS+1)+(x+PS)]-pm; num += a*b; den += a*a; }
            const c = num/Math.sqrt(Math.max(1e-9,den)*Math.max(1e-9,pss));
            if (c > bc) { bc = c; bx = ox-cx; by = oy-cy; }
          }
        return { dx: bx, dy: by, corr: bc };
      };
      const med = (a, b, x0, x1) => {
        const dz2 = []; for (const x in a) { const xi = +x;
          if (xi < x0 * W2 || xi > x1 * W2) continue;
          if (x in b) dz2.push(Math.abs(a[x] - b[x])); }
        dz2.sort((p, q2) => p - q2);
        return dz2.length ? dz2[(dz2.length / 2) | 0] : -1;
      };
      const Lm = await shoot(0, true);
      const dbgMid = { e: +camera.position.z.toFixed(4), ex: +camera.position.x.toFixed(4),
                       gain: +dollyLatGain.toFixed(4),
                       refEye: (typeof bgRefEyeZNow === 'function') ? +bgRefEyeZNow().toFixed(4) : null };
      const Lf = await shoot(Math.PI/2, true);
      const dbgFar = { e: +camera.position.z.toFixed(4), ex: +camera.position.x.toFixed(4),
                       gain: +dollyLatGain.toFixed(4),
                       refEye: (typeof bgRefEyeZNow === 'function') ? +bgRefEyeZNow().toFixed(4) : null };
      dollyZoomActive = false; render();
      const fm = crest(await shoot(0, false)), ff = crest(await shoot(Math.PI/2, false));
      dollyZoomActive = false; render();
      // subject: the mid-phase crest at the sampled column — the silhouette of
      // the very plane q was set from. stretch: the near-dune body low in the
      // frame (source depth 0.741 at 0.90h — decisively off the 0.525 plane),
      // 0.93h keeps the patch inside content at both phases (border reaches
      // 0.967h at the far phase).
      const x30 = Math.round(0.30*W2);
      let cg = 0, crestY = -1;
      for (let y = Math.round(0.50*H2); y < Math.round(0.98*H2) - 2; y++) {
        const g = Math.abs(Lm[(y+2)*W2+x30] - Lm[(y-2)*W2+x30]);
        if (g > cg) { cg = g; crestY = y; }
      }
      const subj = nccMatch(Lm, Lf, x30, crestY);
      const stretch = nccMatch(Lm, Lf, x30, Math.round(0.93*H2));
      return { lock: subj.corr >= 0.6 ? Math.abs(subj.dy) : -1,
               stretch: stretch.corr >= 0.6 ? Math.abs(stretch.dy) : -1,
               free: med(fm, ff, 0.24, 0.36),
               dbg: { v: +v.toFixed(4), vUp: +vUp.toFixed(4), vDn: +vDn.toFixed(4),
                      vBody: +vBody.toFixed(4), bey, crestY,
                      q: +subjectFocalPlaneWorldZ.toFixed(4),
                      P: portalPlaneWorldZ, pn: +currentNormPortalPlane.toFixed(3),
                      emb: (typeof bgEmbedOffsetNow === 'function') ? +bgEmbedOffsetNow().toFixed(4) : null,
                      mid: dbgMid, far: dbgFar,
                      subj: { dx: subj.dx, dy: subj.dy, corr: +subj.corr.toFixed(2) },
                      str: { dx: stretch.dx, dy: stretch.dy, corr: +stretch.corr.toFixed(2) } } };
    });
    // A208 re-baseline, stated: the old 0..2 bound over ALL columns encoded the
    // frozen world (it asserted the absence of the dolly zoom). Now: the
    // subject-plane template must hold (0..3 — clickpin-verified 2px residual
    // plus a pixel of metric quantization; -1 means the match fell below the
    // 0.6 corr floor and is a failure), the off-plane dune template must MOVE
    // (4..200; measured 11 at commit — under the a104 frozen-image disease it
    // reads ~0, which is the regression this bound defends against), and the
    // free arm keeps its crest-median teeth.
    if (dz.dbg) console.log('  [dolly dbg] ' + JSON.stringify(dz.dbg));
    check('dolly q!=P lock SUBJECT-plane pin |dy| px', dz.lock, 0, 3);
    check('dolly lock WORLD STRETCH |dy| px (near dune)', dz.stretch, 4, 200);
    check('dolly q!=P free crest px (metric teeth)', dz.free, 2, 60);
  }

  console.log('\n' + (fail ? 'REGRESSION: ' + fail + ' FAIL, ' + pass + ' pass' : 'ALL PASS (' + pass + ')'));
  await browser.close(); srv.kill(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(2); });
