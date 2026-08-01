// A191c: THERE MAY BE NO PERIOD. THE "PERIOD 4" HAS ALWAYS BEEN A SEARCH FLOOR.
//
// a182 reported the warrior's comb band at "period 4, corr 0.712", a183 repeated
// it, and a191b reproduced it as "period 3". In every one of those runs the
// reported period is THE SMALLEST LAG THE SEARCH WAS ALLOWED TO CONSIDER, and
// the autocorrelation decays monotonically away from it:
//
//   a182 (floor 4):  [[4,0.712],[19,0.582],[21,0.574],[6,0.541]]
//   a191b (floor 3): [[3,0.752],[4,0.688],[5,0.654],[6,0.636],[7,0.627]]
//
// A monotonically decaying ACF has no periodic component. Peak-picking the
// global maximum of a truncated autocorrelation cannot distinguish "period P"
// from "broadband structure with correlation length P", and every run so far has
// been reporting the latter as the former. a182's own instrument note worried
// about exactly this and moved the floor from 2 to 4 — which relocated the
// artifact instead of removing it.
//
// THE RIGHT TOOL. Take the DFT of the column-averaged comb profile and find the
// dominant non-DC frequency. A period is then hgt/k by construction; it cannot
// pin to a search floor, and the spectrum shows whether there is a peak at all
// or just 1/f decay. Reported alongside:
//   - the spectral flatness of the profile (geometric mean / arithmetic mean of
//     the power spectrum). Near 1 = noise-like, no period. Near 0 = tonal.
//   - the ACF's LOCAL maxima only, which is what a period would produce.
//   - a crop of the analysed region, so the band under test can be seen rather
//     than assumed.
//
// If the spectrum is flat, the honest finding is that the warrior's band is NOT
// a periodic artifact, and a182/a183's refutations of the depth bins and the
// block grid were refuting a cause for a phenomenon that was never established.
// Those two refutations still stand on their own evidence — neither moved
// anything — but the thing they were refuting causes for needs restating.
//
//   node harness/band3.js [warrior|star|troll] [deg]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const ASSET = process.argv[2] || 'warrior';
const DEG = Number(process.argv[3] || 35);
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star: ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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

  const run = (o) => page.evaluate(async (o) => {
    window._rayReproject = true;
    bgViewFadeStartDeg = 35; bgViewFadeEndDeg = 45;
    bgQuickBake = false; bgMPIFullPlanes = true; bgMPIMode = true;
    bgBuildStamp = null; buildBackgroundLayer();
    isSweeping = true;
    const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
    camera.position.set(dist * Math.tan(o.deg * Math.PI / 180), 0, dist);
    for (let n = 0; n < 3; n++) render();
    const W = renderer.domElement.width, Hh = renderer.domElement.height;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
    const g = cv.getContext('2d'); g.drawImage(renderer.domElement, 0, 0, W, Hh);
    const px = g.getImageData(0, 0, W, Hh).data;
    const lum = new Float32Array(W*Hh);
    for (let i = 0; i < W*Hh; i++) lum[i] = 0.299*px[i*4] + 0.587*px[i*4+1] + 0.114*px[i*4+2];
    const comb = new Float32Array(W*Hh);
    for (let y = 1; y < Hh-1; y++) for (let x = 0; x < W; x++) {
      const i = y*W+x; comb[i] = Math.abs(2*lum[i] - lum[i-W] - lum[i+W]); }

    let rect = o.rect;
    if (!rect) {
      const sorted = Float32Array.from(comb).sort();
      const t = sorted[Math.floor(sorted.length * 0.99)];
      let x0 = W, x1 = -1, y0 = Hh, y1 = -1;
      for (let y = 1; y < Hh-1; y++) for (let x = 0; x < W; x++) {
        if (comb[y*W+x] < t) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0) return { none: true, W, H: Hh };
      rect = [x0/W, x1/W, y0/Hh, y1/Hh];
    }
    const X0 = Math.max(1, Math.round(rect[0]*W)), X1 = Math.min(W-2, Math.round(rect[1]*W));
    const Y0 = Math.max(1, Math.round(rect[2]*Hh)), Y1 = Math.min(Hh-2, Math.round(rect[3]*Hh));
    const hgt = Y1 - Y0 + 1;

    // crop of the analysed region, so the band under test can be SEEN
    const cc = document.createElement('canvas'); cc.width = X1-X0+1; cc.height = hgt;
    cc.getContext('2d').drawImage(cv, X0, Y0, X1-X0+1, hgt, 0, 0, X1-X0+1, hgt);
    const cropUrl = cc.toDataURL('image/png');

    const prof = new Float32Array(hgt);
    for (let y = 0; y < hgt; y++) { let s = 0;
      for (let x = X0; x <= X1; x++) s += comb[(Y0+y)*W + x];
      prof[y] = s / Math.max(1, X1 - X0 + 1); }
    let mean = 0; for (let y = 0; y < hgt; y++) mean += prof[y]; mean /= hgt;
    const c0 = new Float32Array(hgt);
    // Hann window: without it the profile's DC step and its ends leak across the
    // whole spectrum and every bin looks occupied, which would fake flatness.
    for (let y = 0; y < hgt; y++)
      c0[y] = (prof[y] - mean) * 0.5 * (1 - Math.cos(2*Math.PI*y/(hgt-1)));

    // naive DFT — hgt is at most a few hundred, so O(n^2) is nothing
    const K = hgt >> 1, pow = new Float64Array(K);
    for (let k = 1; k < K; k++) {
      let re = 0, imX = 0;
      for (let y = 0; y < hgt; y++) { const a = -2*Math.PI*k*y/hgt;
        re += c0[y]*Math.cos(a); imX += c0[y]*Math.sin(a); }
      pow[k] = re*re + imX*imX;
    }
    let kBest = 1, pBest = 0, sum = 0, logSum = 0, n = 0;
    for (let k = 1; k < K; k++) { if (pow[k] > pBest) { pBest = pow[k]; kBest = k; }
      sum += pow[k]; logSum += Math.log(pow[k] + 1e-12); n++; }
    const flatness = Math.exp(logSum/n) / (sum/n);      // 1 = white noise, 0 = tonal
    const peakShare = pBest / Math.max(1e-12, sum);
    const topK = [];
    for (let k = 1; k < K; k++) topK.push([k, pow[k]]);
    topK.sort((a,b) => b[1]-a[1]);

    // ACF, LOCAL maxima only — a period produces a local max, a decay does not
    let v0 = 0; for (let y = 0; y < hgt; y++) v0 += c0[y]*c0[y];
    const acf = [0];
    for (let lag = 1; lag < Math.min(220, hgt >> 1); lag++) {
      let s = 0; for (let y = 0; y + lag < hgt; y++) s += c0[y]*c0[y+lag];
      acf.push(s/(hgt-lag)/Math.max(1e-9, v0/hgt));
    }
    const localMax = [];
    for (let l = 2; l < acf.length-1; l++)
      if (acf[l] > acf[l-1] && acf[l] > acf[l+1] && acf[l] > 0.05)
        localMax.push([l, +acf[l].toFixed(3)]);
    localMax.sort((a,b) => b[1]-a[1]);

    return { W, H: Hh, rect, cropUrl, hgt,
             box: X0+'..'+X1+', '+Y0+'..'+Y1,
             dftPeriod: +(hgt/kBest).toFixed(2), dftK: kBest,
             peakShare: +peakShare.toFixed(4), flatness: +flatness.toFixed(3),
             topPeriods: topK.slice(0,4).map(([k,p]) => [+(hgt/k).toFixed(1), +(p/sum).toFixed(3)]),
             localMax: localMax.slice(0,4), nLocalMax: localMax.length };
  }, o);

  const big = await run({ deg: DEG, rect: null });
  if (big.none) { console.log('no comb region found'); await browser.close(); srv.kill(); process.exit(2); }
  await page.setViewportSize({ width: 720, height: 450 });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await new Promise(r => setTimeout(r, 1200));
  const small = await run({ deg: DEG, rect: big.rect });

  const pad = (s, n) => String(s).padStart(n);
  console.log('\n' + ASSET + ' at ' + DEG + ' deg — is there a PERIOD at all? (DFT, not ACF peak-picking)');
  console.log('  same normalised region both arms: [' + big.rect.map(v => v.toFixed(3)).join(', ') + ']\n');
  console.log('  backing store   rows   DFT period px   peak share   flatness   ACF local maxima');
  for (const m of [small, big]) {
    console.log('  ' + pad(m.W+'x'+m.H, 13) + pad(m.hgt, 7) + pad(m.dftPeriod, 16) +
      pad(m.peakShare, 13) + pad(m.flatness, 11) + '   ' +
      (m.nLocalMax ? JSON.stringify(m.localMax) : 'NONE'));
    console.log('        top periods (px, share of power): ' + JSON.stringify(m.topPeriods));
  }
  const ratio = big.H / small.H, pRatio = big.dftPeriod / Math.max(1e-9, small.dftPeriod);
  console.log('\n  backing height ratio ' + ratio.toFixed(3) + ',  DFT period ratio ' + pRatio.toFixed(3));
  const tonal = big.peakShare > 0.10 && small.peakShare > 0.10;
  console.log('  Is there a period to attribute? ' + (tonal
    ? 'YES — a single frequency carries >10% of the profile power in both arms'
    : 'NO — no frequency carries more than ' +
      (100*Math.max(big.peakShare, small.peakShare)).toFixed(1) +
      '% of the power; the profile is broadband, and the "period" reported since a182 is a search-floor artifact'));
  if (tonal) console.log('  Anchored where? ' + (Math.abs(pRatio - ratio) < Math.abs(pRatio - 1)
    ? 'SOURCE — period scales with resolution' : 'SCREEN — period fixed in pixels'));
  console.log('\n  flatness is the spectral flatness of the comb profile: 1 = white noise,');
  console.log('  0 = a pure tone. peak share is the fraction of profile power in the single');
  console.log('  strongest bin. ACF local maxima are reported instead of the global max,');
  console.log('  because a monotonically decaying ACF has no period and the global max of a');
  console.log('  truncated one is always its first lag — which is what a182, a183 and a191b');
  console.log('  each reported as a finding.');
  for (const [m, tag] of [[small,'small'],[big,'big']])
    if (m.cropUrl) fs.writeFileSync(path.join(H, 'band3_' + ASSET + '_' + tag + '_region.png'),
      Buffer.from(m.cropUrl.split(',')[1], 'base64'));
  console.log('\n  wrote harness/band3_' + ASSET + '_{small,big}_region.png — the analysed crop itself');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
