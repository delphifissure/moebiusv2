// S53 — THE PER-TEXEL LAMBDA, CHECKED. No bake: the solver is called directly with synthetic fields.
//
// The change (2503.20211 Eq.9-11, via window._returnConfidence) lets the screened Poisson take lambda as a FIELD
// rather than one number. That touches the inner loop of the shipped return path, so the first thing to establish
// is that it did not change the shipped behaviour:
//
//   1. a CONSTANT field must reproduce the scalar path BIT FOR BIT. If it does not, every earlier return-contract
//      number is now suspect. This is the regression guarantee and it is asserted, not eyeballed.
//   2. lambda = 0 everywhere must equal the pure-gradient form, and a huge lambda must pin the band to the anchor.
//      These are the two limits the field interpolates between; if either is wrong the middle is meaningless.
//   3. a MIXED field must sit between the two, per texel: confident texels near the anchor, unconfident ones
//      pulled toward the harmonic/rim answer. Checked as an ordering, since the exact values have no closed form.
//   4. _returnConfidence itself: agreement -> lamMax, disagreement -> ~0, monotone in between.
//
//   node harness/s53_lambda_test.js
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process');
const path = require('path'); const H = __dirname;

(async () => {
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 40; t++) {
        const ok = await page.evaluate(() => typeof window._screenedPoissonBand === 'function').catch(() => false);
        if (ok) break; await new Promise(r => setTimeout(r, 500));
    }

    const res = await page.evaluate(() => {
        const pw = 48, ph = 40, N = pw * ph;
        const band = new Uint8Array(N), bc = new Float32Array(N), anchor = new Float32Array(N);
        const gx = new Float32Array(N), gy = new Float32Array(N);
        // a ramp outside, a band block in the middle, an anchor that disagrees with the rim
        for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
            const i = y * pw + x;
            bc[i] = 0.2 + 0.4 * (x / pw);
            anchor[i] = 0.9 - 0.3 * (y / ph);
            gx[i] = 0.001 * Math.sin(x * 0.3); gy[i] = 0.001 * Math.cos(y * 0.2);
            if (x > 10 && x < 38 && y > 8 && y < 32) band[i] = 1;
        }
        const call = (lam) => window._screenedPoissonBand({ pw, ph, band, bc, gx, gy, anchor, lam, iters: 800, tol: 1e-12 });
        const same = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };

        // 1. constant field == scalar, exactly. 0.75 is chosen because it is EXACTLY representable in float32; with
        // 0.7 the Float32Array holds 0.699999988... and the two paths differ by ~6e-8, which is the representation
        // and not the code. Both are checked, so the distinction is on the record rather than hidden by a loose
        // tolerance.
        const r = { bandPx: 0 }; for (let i = 0; i < N; i++) if (band[i]) r.bandPx++;
        const S = call(0.75);
        const F = call(new Float32Array(N).fill(0.75));
        r.constVsScalar = same(S.d, F.d);
        r.constItersEqual = (S.iters === F.iters);
        const S7 = call(0.7), F7 = call(new Float32Array(N).fill(0.7));
        r.constVsScalarF32 = same(S7.d, F7.d);

        // 2. the limits
        const z0 = call(0), zf0 = call(new Float32Array(N));                    // lam 0 both ways
        r.zeroVsZeroField = same(z0.d, zf0.d);
        const big = call(new Float32Array(N).fill(1e6));
        let mx = 0; for (let i = 0; i < N; i++) if (band[i]) mx = Math.max(mx, Math.abs(big.d[i] - anchor[i]));
        r.hugeLamPinsAnchor = mx;

        // 3. a mixed field sits between, per texel
        const mix = new Float32Array(N);
        for (let i = 0; i < N; i++) mix[i] = (i % 2) ? 1e6 : 0;
        const M = call(mix);
        let confidentErr = 0, betweenOk = 0, betweenTot = 0;
        for (let i = 0; i < N; i++) {
            if (!band[i]) continue;
            if (mix[i] > 1) confidentErr = Math.max(confidentErr, Math.abs(M.d[i] - anchor[i]));
            else { betweenTot++; const lo = Math.min(z0.d[i], anchor[i]), hi = Math.max(z0.d[i], anchor[i]);
                   if (M.d[i] >= lo - 1e-3 && M.d[i] <= hi + 1e-3) betweenOk++; }
        }
        r.mixConfidentTracksAnchor = confidentErr;
        r.mixUnconfidentBetween = betweenTot ? betweenOk / betweenTot : 0;

        // 4. the confidence field itself
        const a = new Float32Array([0.5, 0.5, 0.5, 0.5]), b = new Float32Array([0.5, 0.55, 0.75, 1.5]);
        const c = window._returnConfidence(a, b, { beta: 8, lamMax: 1 });
        r.conf = Array.from(c).map(v => +v.toFixed(4));
        r.confMonotone = c[0] > c[1] && c[1] > c[2] && c[2] > c[3];
        return r;
    });

    console.log('band texels                         ' + res.bandPx);
    console.log('1. constant field vs scalar  max|d| ' + res.constVsScalar.toExponential(2) + ' (lam 0.75, exact in f32)   iters equal: ' + res.constItersEqual);
    console.log('   the same at lam 0.7 (not exact)  ' + res.constVsScalarF32.toExponential(2) + '  <- float32 representation, not the code path');
    console.log('2. lam 0 scalar vs zero field       ' + res.zeroVsZeroField.toExponential(2));
    console.log('   huge lam pins to anchor  max|d|  ' + res.hugeLamPinsAnchor.toExponential(2));
    console.log('3. mixed: confident tracks anchor   ' + res.mixConfidentTracksAnchor.toExponential(2));
    console.log('   mixed: unconfident between       ' + (100 * res.mixUnconfidentBetween).toFixed(1) + '%');
    console.log('4. confidence [agree..disagree]     ' + JSON.stringify(res.conf) + '  monotone: ' + res.confMonotone);

    const fail = [];
    if (!(res.constVsScalar === 0)) fail.push('a constant lambda field does NOT reproduce the scalar path exactly');
    if (!res.constItersEqual) fail.push('iteration count differs between the scalar and constant-field paths');
    if (!(res.zeroVsZeroField === 0)) fail.push('lambda 0 differs between the scalar and field paths');
    if (!(res.hugeLamPinsAnchor < 1e-3)) fail.push('a huge lambda does not pin the band to the anchor');
    if (!(res.mixConfidentTracksAnchor < 1e-3)) fail.push('confident texels do not track the anchor under a mixed field');
    if (!(res.mixUnconfidentBetween > 0.95)) fail.push('unconfident texels do not lie between the anchor and the lam-0 solution');
    if (!(res.constVsScalarF32 < 1e-6)) fail.push('a constant lambda field diverges from the scalar beyond float32 representation');
    if (!res.confMonotone) fail.push('_returnConfidence is not monotone in the disagreement');
    console.log(fail.length ? ('\nFAILED:\n  - ' + fail.join('\n  - ')) : '\nALL CHECKS PASSED');
    await browser.close(); try { srv.kill(); } catch (e) {}
    process.exit(fail.length ? 1 : 0);
})();
