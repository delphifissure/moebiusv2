// S53 — THE FREE SECOND ESTIMATE, WIRED AND MEASURED ON A REAL BAKE.
//
// The plane far side computes TWO continuation candidates per texel (planeFS.farAxV: the row one and the column
// one), picks one, and discards the other. 2503.20211 Eq.9-11 says the discarded one is worth keeping: the
// agreement of two estimators is a confidence map that needs no ground truth --
//   C = exp(-beta |D1 - D2| / D1), "assigning higher weights to consistent regions and lower weights to highly
//   inconsistent areas".
// The bake now builds that as window._geoFarConf and the return path takes lam: 'auto' to use it per texel
// instead of one global lambda.
//
// WHAT THIS MEASURES, rather than asserts:
//   1. coverage   -- how many band texels actually HAVE two candidates. If this is small the signal is a curiosity.
//   2. the field  -- its distribution, and whether it is structured or noise.
//   3. does it agree with the one uncertainty we already had (_geoFarAxS)? If the two are the same thing, this
//      adds nothing; if they disagree, it is a genuinely independent signal. Reported as a correlation.
//   4. does it MOVE the answer? A round trip with lam scalar vs lam 'auto', on the same return.
//   5. S33's classes: the disagreement should concentrate on the axis-arbitration texels (class 3), because that
//      class IS the two candidates disagreeing. If it does not, the wiring is suspect.
//
//   node harness/s53_conf.js
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const H = __dirname;
const OUT = process.env.OUT || path.join(H, 'shots', 's53_conf');

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 500, height: 300 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 220)));
    page.on('console', m => { const t = m.text(); if (/\[S53\]|\[S51\]|FAILED/.test(t)) console.log('  ' + t.slice(0, 260)); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }

    const r = await page.evaluate(async () => {
        window._rayReproject = true; window._depthContractUI = false;
        if (window._applyPlateOptions) window._applyPlateOptions();
        window._plugObjectRule = false; window._plugExtent = null; window._geoLipSeed = false; window._plugBack = false; window._plateFlushExempt = true;
        const ms = document.getElementById('bgModeSel'); if (ms) ms.value = 'quick'; bgQuickBake = true; window._bgBakeMode = 'quick';
        const t0 = Date.now(); window._plugGeoBand({ flush: true, observed: true, gateAPriori: true }); window._bgUserBuiltOnce = true;
        const bakeMs = Date.now() - t0;
        const pw = window._qbSize.pw, ph = window._qbSize.ph, N = pw * ph;
        const out = { bakeMs, pw, ph };

        const conf = window._geoFarConf, both = window._geoFarCandBoth, axS = window._geoFarAxS;
        const a = window._geoFarCandA, b = window._geoFarCandB, axis = window._geoFarAxis;
        if (!conf) return Object.assign(out, { error: 'no _geoFarConf' });
        // the band, in source rows, as the export uses it
        const dis = window._qbDisocc;
        const inBand = (i) => dis ? !!dis[i] : true;

        // 1/2. coverage and distribution over the band
        let nBand = 0, nBoth = 0; const vals = [];
        for (let i = 0; i < N; i++) { if (!inBand(i)) continue; nBand++; if (both && both[i]) { nBoth++; vals.push(conf[i]); } }
        vals.sort((x, y) => x - y);
        const pct = (p) => vals.length ? vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] : null;
        out.bandPx = nBand; out.bothPx = nBoth;
        out.conf = { p10: pct(0.1), p50: pct(0.5), p90: pct(0.9), min: vals[0], max: vals[vals.length - 1],
                     below0_5: vals.filter(v => v < 0.5).length, below0_1: vals.filter(v => v < 0.1).length };
        // the raw disagreement in d, which is what the confidence is a function of
        const dd = []; for (let i = 0; i < N; i++) if (inBand(i) && both && both[i]) dd.push(Math.abs(a[i] - b[i]));
        dd.sort((x, y) => x - y);
        out.disagree = { p50: dd[Math.floor(0.5 * dd.length)], p90: dd[Math.floor(0.9 * dd.length)], max: dd[dd.length - 1] };
        // the same disagreement in SCREEN PIXELS at the rim, which is the unit the confidence is now built in and
        // the unit Sprint 26's cliff tolerance is written in, so the two are directly comparable
        const px = window._geoFarConfPx;
        if (px) { const q = []; for (let i = 0; i < N; i++) if (inBand(i) && both && both[i]) q.push(px[i]); q.sort((x, y) => x - y);
            out.disagreePx = { p50: q[Math.floor(0.5 * q.length)], p90: q[Math.floor(0.9 * q.length)], p99: q[Math.floor(0.99 * q.length)], max: q[q.length - 1] }; }

        // 3. is it the same thing as _geoFarAxS? Spearman-ish: correlation of ranks is overkill; Pearson on the
        //    raw pair is enough to say "these are not the same signal".
        if (axS) {
            let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
            for (let i = 0; i < N; i++) {
                if (!inBand(i) || !(both && both[i])) continue;
                const x = conf[i], y = axS[i]; if (!isFinite(y)) continue;
                n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
            }
            const cov = sxy / n - (sx / n) * (sy / n);
            const sd = Math.sqrt(Math.max(sxx / n - (sx / n) ** 2, 0)) * Math.sqrt(Math.max(syy / n - (sy / n) ** 2, 0));
            out.corrWithFarAxS = sd > 0 ? cov / sd : null; out.corrN = n;
        }

        // 5. where does the disagreement sit? The axis map says which candidate the law took; a texel whose
        //    neighbours took the OTHER axis is S33's class 3, the arbitration flipping.
        if (axis) {
            let flip = 0, flipLowConf = 0, same = 0, sameLowConf = 0;
            for (let y = 1; y < ph - 1; y++) for (let x = 1; x < pw - 1; x++) {
                const i = y * pw + x; if (!inBand(i) || !(both && both[i])) continue;
                const f = (axis[i] !== axis[i - 1]) || (axis[i] !== axis[i + 1]) || (axis[i] !== axis[i - pw]) || (axis[i] !== axis[i + pw]);
                if (f) { flip++; if (conf[i] < 0.5) flipLowConf++; } else { same++; if (conf[i] < 0.5) sameLowConf++; }
            }
            out.class3 = { flip, flipLowConfFrac: flip ? flipLowConf / flip : null, same, sameLowConfFrac: same ? sameLowConf / same : null };
        }

        // 4. does it move the answer? Build a return from the bake's own far field (so the only variable is lambda)
        //    and reimport it twice: scalar lambda, then 'auto'.
        const plate = window._qbPlateF;
        if (plate && window._importPlaneReturn) {
            const flip = (i) => { const x = i % pw, y = (i - x) / pw; return (ph - 1 - y) * pw + x; };
            const dep = new Float32Array(N); for (let i = 0; i < N; i++) dep[i] = plate[flip(i)];
            // perturb the return inside the band so there is something for lambda to weigh
            const per = new Float32Array(dep); for (let i = 0; i < N; i++) if (inBand(i)) per[i] = Math.min(1, Math.max(0, dep[i] + 0.04 * Math.sin(i * 0.017)));
            // BOTH ARMS MUST BE SOLVED, or the comparison is not about lambda. The first version of this test passed
            // lam: 1 with no gradients, which takes the DEGENERATE no-solve branch, so it measured "solve vs no
            // solve" and not "scalar lambda vs per-texel lambda". forceSolve puts both arms through the solver.
            const s1 = window._importPlaneReturn({ depth: per, lam: 1, forceSolve: true });
            const d1 = window._qbPlateF.slice();
            window._plugGeoBand({ flush: true, observed: true, gateAPriori: true });        // re-bake to undo
            const s2 = window._importPlaneReturn({ depth: per, lam: 'auto', forceSolve: true });
            const d2 = window._qbPlateF.slice();
            let mx = 0, s = 0, n = 0;
            for (let i = 0; i < N; i++) { const j = flip(i); if (!inBand(i)) continue; const q = Math.abs(d1[j] - d2[j]); if (q > mx) mx = q; s += q; n++; }
            out.roundTrip = { form1: s1 && s1.depth && s1.depth.solve ? s1.depth.solve.form : (s1 && s1.solve ? s1.solve.form : null),
                              form2: s2 && s2.depth && s2.depth.solve ? s2.depth.solve.form : (s2 && s2.solve ? s2.solve.form : null),
                              maxAbsD: mx, meanAbsD: n ? s / n : 0, n };
        }
        return out;
    });

    console.log(JSON.stringify(r, null, 1));
    fs.writeFileSync(path.join(OUT, 'conf.json'), JSON.stringify(r, null, 1));
    console.log('-> ' + OUT);
    await browser.close(); try { srv.kill(); } catch (e) {}
})();
