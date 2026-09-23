// Sprint 27 / S51 — THE CROSS-LINE LABELLING: choose the axis consistently, with the visible wall as the cost.
//
// S33 measured what the plate's bends are. On the troll, of 99 205 visible bends, 77.2 % by count are ONE SURFACE GIVEN
// TWO DEPTHS on adjacent rows (class 1) and 12.3 % are the row/column arbitration flipping between neighbours (class 3);
// only 10.4 % are a real step between two background surfaces (class 2). By wall length -- what the eye integrates --
// the two artefact classes are 74 %. S50 confirmed the consequence: every cliff rule in Sprint 26 was choosing how to
// draw a wall that should not exist.
//
// Two constructions have failed against this and both are recorded. S22 regularised the per-line law's PARAMETERS
// across lines (slope median, value median, both): the photograph's same-sheet seams fell 18 % against a bar of half,
// and on the kit every variant ADDED seams. Its own conclusion was that the residue is not slope noise but "the choice
// disagreements -- axis flips, kind flips, different rims on adjacent lines". S32 smoothed the FIELD instead (2-D
// clamped plate per run cluster) and was removed under rule 7 for making the row structure worse.
//
// S22 named the construction never attempted, and the reason it stopped:
//
//     "A consistent choice across lines (a labelling over candidates with a join cost) would be the next different
//      construction, and it needs a weight between arrival order and cross-line agreement that nothing in the scene
//      supplies."
//
// THAT WEIGHT NOW EXISTS. A disagreement between two adjacent texels draws a wall whose length in SCREEN PIXELS AT THE
// RIM is exactly reveal(d_i, d_j) -- S48's field. S33 already scored its classes in "visible steps" using S10's 1/k,
// which is a LINEARISATION of that same quantity; the field is its exact form under the real law, and the difference
// matters because the law spreads 40x across one picture (p50 0.116 px, p99 4.641 px). So both terms of the labelling
// are in one unit and nothing is borrowed:
//
//     minimise over per-texel axis choices:   SUM_i  data(i, l_i)  +  lambda * SUM_{i~j}  revealPx(v_i(l_i), v_j(l_j))
//
// data(i, l) is the candidate's own uncertainty (the S7b audit's farAxS: half the rim tolerance plus the slope
// uncertainty times the distance), converted to screen pixels by the same field. lambda = Infinity is a PARAMETER-FREE
// arm -- least visible wall subject to the evidence -- and is the one to read first.
//
// WHY THIS CAN FIX CLASS 1 AND NOT ONLY CLASS 3. For a VERTICAL bend the column candidate is continuous by construction
// along that direction (the two texels are on the same column and the column law extrapolates along it), so switching
// axis in the right region removes the disagreement outright. The choice cannot be made locally -- fixing a vertical
// bend by going to the column axis can open a horizontal one -- which is exactly why it has to be a global labelling
// and why the per-texel arbitration cannot get it right.
//
// NOTHING IS BUILT IN THE APP HERE. This measures whether the construction clears the bar, offline, on the arrays the
// bake already produces.
//
//   COLOR=..., DEPTH=..., TAG=..., LAMBDA=inf|1|0.25 SWEEPS=40 node harness/s51_label.js
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const H = __dirname, WT = path.resolve(__dirname, '..');
const TAG = process.env.TAG || 'troll';
const OUT = path.join(H, 'shots', 's51_label', TAG);

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    fs.copyFileSync(path.resolve(WT, process.env.COLOR || 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png'));
    fs.copyFileSync(path.resolve(WT, process.env.DEPTH || 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 220)));
    page.on('console', m => { const t = m.text(); if (/\[S3\] far side|\[S51\]|FAILED|rror/.test(t)) console.log('  [page] ' + t.slice(0, 260)); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
    await page.evaluate(() => { window._rayReproject = true; window._depthContractUI = false; });
    console.log('baking (start-up defaults) ...');
    await page.evaluate(() => document.getElementById('bgLayerBuildBtn').click());
    for (let t = 0; t < 400; t++) { if (await page.evaluate(() => !!window._bgQuickBaked && !!window._qbPlateF)) break; await new Promise(r => setTimeout(r, 1000)); }

    const res = await page.evaluate(([LAM, SWEEPS, RS, DUMP]) => {
        const sz = window._qbSize; if (!sz) return { error: 'no bake' };
        const pw = sz.pw, ph = sz.ph, N = pw * ph;
        const dQ = window._qbDQ, ff = window._geoFarField, axis = window._geoFarAxis, axV = window._geoFarAxV,
              axS = window._geoFarAxS, rimJ = window._geoFarRimJ, kind = window._geoFarKind, mix = window._geoFarMix,
              dis = window._qbDisocc;
        if (!(dQ && ff && axis && axV && axS && rimJ && dis)) return { error: 'missing arrays: ' + [!!dQ, !!ff, !!axis, !!axV, !!axS, !!rimJ, !!dis].join(',') };
        const rl = bgRimLawFor(pw, ph);
        const qg = (typeof window._qbSrcGrid === 'number' && window._qbSrcGrid > 0) ? window._qbSrcGrid : window._qbSrcQuantum;
        const band = new Uint8Array(N); let nBand = 0;
        for (let i = 0; i < N; i++) if (dis[i] && ff[i] < dQ[i] - qg) { band[i] = 1; nBand++; }

        // ---- the wall length in SCREEN PIXELS, exactly (S48), replacing S10's 1/k linearisation ----
        const L = window._revealLaw(pw, ph);
        const sOf = (d) => { const Z = -window._revealZofD(d, L); return Z / (L.D + Z); };
        const sH = L.exH * L.pxPerWorldScreen, sV = L.exV * L.pxPerWorldScreen;
        // a VERTICAL pair (one above the other) separates under the VERTICAL half-angle, and vice versa
        const wallV = (a, b) => Math.abs(sOf(a) - sOf(b)) * sV;
        const wallH = (a, b) => Math.abs(sOf(a) - sOf(b)) * sH;
        const VISIBLE = 1.0;   // a wall shorter than one screen pixel at the rim cannot be seen; S33 used the same idea in its own units

        // ---- S33's classification, on the ORIGINAL choice. It partitions the pairs; the labelling is then scored on
        //      that partition, which is conservative: it asks whether the walls that WERE artefacts got shorter and
        //      whether the real steps survived. ----
        const rimOf = (i) => { const a = rimJ[2 * i], b = rimJ[2 * i + 1]; if (a < 0) return b; if (b < 0) return a; if (kind && kind[i] === 2) return a; return (mix[i] >= 0.5) ? a : b; };
        const classify = (t, u) => {
            const at = axis[t], au = axis[u]; const rt = rimOf(t), ru = rimOf(u);
            if (rt < 0 || ru < 0) return 4;
            if (at !== au) return 3;
            return ((rt === ru) || rl.joinedIdx(rt, ru, dQ, pw)) ? 1 : 2;
        };
        // pair lists: vertical (i, i+pw) and horizontal (i, i+1), both band
        const pv = [], phz = [];
        for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
            const i = y * pw + x;
            if (!band[i]) continue;
            if (y < ph - 1 && band[i + pw]) pv.push(i);
            if (x < pw - 1 && band[i + 1]) phz.push(i);
        }
        const cv = new Uint8Array(pv.length), ch = new Uint8Array(phz.length);
        for (let k = 0; k < pv.length; k++) cv[k] = classify(pv[k], pv[k] + pw);
        for (let k = 0; k < phz.length; k++) ch[k] = classify(phz[k], phz[k] + 1);

        const score = (val) => {
            const o = { wall: [0, 0, 0, 0, 0], count: [0, 0, 0, 0, 0], total: 0, visible: 0 };
            for (let k = 0; k < pv.length; k++) { const i = pv[k], w = wallV(val[i], val[i + pw]); o.total += w;
                if (w > VISIBLE) { o.visible++; o.wall[cv[k]] += w; o.count[cv[k]]++; } }
            for (let k = 0; k < phz.length; k++) { const i = phz[k], w = wallH(val[i], val[i + 1]); o.total += w;
                if (w > VISIBLE) { o.visible++; o.wall[ch[k]] += w; o.count[ch[k]]++; } }
            return o;
        };

        // ---- the labelling ----
        // label 0 = continue along the ROW, 1 = along the COLUMN. Only texels with BOTH candidates are free; the rest
        // keep whatever the law gave them (the candidate field itself ends there -- S34's "domain boundary").
        const free = new Uint8Array(N); let nFree = 0;
        for (let i = 0; i < N; i++) if (band[i] && axV[2 * i] >= 0 && axV[2 * i + 1] >= 0) { free[i] = 1; nFree++; }
        const lab = new Uint8Array(N);
        for (let i = 0; i < N; i++) lab[i] = free[i] ? (axis[i] === 2 ? 1 : 0) : 0;   // seed at the law's own choice (axis 1 = row, 2 = column)
        // THE CANDIDATES ARE IN DISPARITY, NOT IN d. The law stores farAxV as the extrapolated DISPARITY and converts to
        // normalised depth afterwards, by bisection on the rim law's own table, then clamps at the texel's own visible
        // depth. The first run of this harness fed disparity straight into the depth law: `ff` was scored in d and the
        // relabelled field in disparity, the field "moved" a mean of 2.69 in a quantity bounded by [0,1], and the
        // artefact wall came out -992 %. Converted here exactly as the app does it.
        const dOfDisp = (v, i) => { let lo = 0, hi = 1; for (let it = 0; it < 24; it++) { const md = 0.5 * (lo + hi); if (rl.dispAt(md) < v) lo = md; else hi = md; } return Math.min(dQ[i], 0.5 * (lo + hi)); };
        const cand = new Float64Array(2 * N);
        for (let i = 0; i < N; i++) if (free[i]) { cand[2 * i] = dOfDisp(axV[2 * i], i); cand[2 * i + 1] = dOfDisp(axV[2 * i + 1], i); }
        const valAt = (i, l) => free[i] ? cand[2 * i + l] : ff[i];
        // a check the first run did not have: at the law's own labelling the reconstructed field must equal ff
        let seedErr = 0; for (let i = 0; i < N; i++) if (free[i]) { const e = Math.abs(cand[2 * i + lab[i]] - ff[i]); if (e > seedErr) seedErr = e; }
        // data cost in SCREEN PIXELS: the candidate's own uncertainty in d, priced by the same field at this texel's depth
        // the uncertainty is in the candidate's own units (disparity), so it is priced by converting BOTH ends
        const dataPx = (i, l) => { if (!free[i]) return 0; const s = axS[2 * i + l]; if (!(s >= 0)) return 1e6;
            const v = axV[2 * i + l]; return Math.abs(sOf(dOfDisp(v + s, i)) - sOf(dOfDisp(v, i))) * sH; };
        // THE ENERGY, so a search can be compared to another search rather than to a table of classes
        const energy = (lb) => { let e = 0;
            for (let k = 0; k < pv.length; k++) { const i = pv[k]; e += wallV(valAt(i, lb[i]), valAt(i + pw, lb[i + pw])); }
            for (let k = 0; k < phz.length; k++) { const i = phz[k]; e += wallH(valAt(i, lb[i]), valAt(i + 1, lb[i + 1])); }
            return e; };
        const lamInf = !isFinite(LAM);
        const cost = (i, l) => {
            const x = i % pw, y = (i - x) / pw, v = valAt(i, l);
            let s = 0;   // the visible wall this choice draws against its four neighbours, in screen px
            if (x > 0 && band[i - 1]) s += wallH(v, valAt(i - 1, lab[i - 1]));
            if (x < pw - 1 && band[i + 1]) s += wallH(v, valAt(i + 1, lab[i + 1]));
            if (y > 0 && band[i - pw]) s += wallV(v, valAt(i - pw, lab[i - pw]));
            if (y < ph - 1 && band[i + pw]) s += wallV(v, valAt(i + pw, lab[i + pw]));
            // lambda = Infinity: least visible wall, the candidate's own uncertainty breaking ties only
            return lamInf ? (s * 1e6 + dataPx(i, l)) : (dataPx(i, l) + LAM * s);
        };
        const ffD = new Float64Array(N); for (let i = 0; i < N; i++) ffD[i] = ff[i];
        const before = score(ffD);
        // ICM, red-black so a sweep is order-independent within a colour. THE ORACLE BOUND SAID THE LABEL SET HOLDS AN
        // 80.7 % ARTEFACT REDUCTION AND GREEDY DESCENT FROM THE LAW'S SEED FOUND 33 %, so the search is the limitation
        // and not the representation. Restarts: the law's own choice, then all-row, all-column, and random seeds; keep
        // the lowest energy. Cheap, and it separates "a weak optimiser" from "a local optimum that is the answer".
        let changed = 0, sweeps = 0;
        const RESTARTS = +(RS || 1);
        const runICM = () => { let ch2 = 0, sw = 0;
            for (sw = 0; sw < SWEEPS; sw++) { ch2 = 0;
                for (let par = 0; par < 2; par++)
                    for (let y = 0; y < ph; y++) for (let x = ((y & 1) ^ par); x < pw; x += 2) {
                        const i = y * pw + x; if (!free[i]) continue;
                        const c0 = cost(i, 0), c1 = cost(i, 1);
                        const nl = (c1 < c0) ? 1 : 0;
                        if (nl !== lab[i]) { lab[i] = nl; ch2++; }
                    }
                if (!ch2) break; }
            return { sw: sw + 1, ch: ch2 }; };
        let bestLab = null, bestE = Infinity; const seedLog = [];
        let rs = 1; for (let r = 0; r < RESTARTS; r++) {
            if (r === 0) { for (let i = 0; i < N; i++) lab[i] = free[i] ? (axis[i] === 2 ? 1 : 0) : 0; }
            else if (r === 1) { for (let i = 0; i < N; i++) lab[i] = 0; }
            else if (r === 2) { for (let i = 0; i < N; i++) lab[i] = free[i] ? 1 : 0; }
            else if (r === 3) {
                // THE ORACLE-VOTE SEED. Each free texel takes the label its own pairs prefer, counted over the four
                // neighbours with the neighbour held at the law's choice. If the oracle's per-pair optima are mutually
                // consistent this lands in a much better basin; if they conflict, the bound is loose and ICM's answer
                // is near the truth. This distinguishes "hard landscape" from "loose bound" without a max-flow.
                const seed0 = new Uint8Array(N); for (let i = 0; i < N; i++) seed0[i] = free[i] ? (axis[i] === 2 ? 1 : 0) : 0;
                for (let i = 0; i < N; i++) { if (!free[i]) { lab[i] = 0; continue; }
                    const x = i % pw, y = (i - x) / pw; let w0 = 0, w1 = 0;
                    const add = (j, wf) => { if (j < 0 || !band[j]) return; const vj = valAt(j, seed0[j]);
                        w0 += wf(cand[2 * i], vj); w1 += wf(cand[2 * i + 1], vj); };
                    add(x > 0 ? i - 1 : -1, wallH); add(x < pw - 1 ? i + 1 : -1, wallH);
                    add(y > 0 ? i - pw : -1, wallV); add(y < ph - 1 ? i + pw : -1, wallV);
                    lab[i] = (w1 < w0) ? 1 : 0; }
            }
            else { for (let i = 0; i < N; i++) { rs = (rs * 1103515245 + 12345) & 0x7fffffff; lab[i] = free[i] ? ((rs >> 16) & 1) : 0; } }
            const rr = runICM(); const e = energy(lab);
            seedLog.push({ seed: r === 0 ? 'law' : r === 1 ? 'all-row' : r === 2 ? 'all-col' : r === 3 ? 'ORACLE-VOTE' : 'random', sweeps: rr.sw, energy: Math.round(e) });
            if (e < bestE) { bestE = e; bestLab = lab.slice(); }
            sweeps = rr.sw; changed = rr.ch;
        }
        lab.set(bestLab);
        const after = new Float64Array(N); for (let i = 0; i < N; i++) after[i] = valAt(i, lab[i]);
        const aft = score(after);
        // ---- THE ORACLE BOUND: is the LABEL SET capable of the fix, independently of the optimiser? ----
        // For each visible bend, take the best of the four label combinations for that pair ALONE, ignoring that
        // neighbours share labels. That is a strict upper bound on what ANY labelling could achieve -- a perfect
        // optimiser included -- so if it is small the label set is proven insufficient and no better solver helps.
        const oracle = { wall: [0, 0, 0, 0, 0], best: [0, 0, 0, 0, 0] };
        const pairOracle = (i, j, cls, wf) => {
            const li = free[i] ? 2 : 1, lj = free[j] ? 2 : 1;
            let bw = Infinity;
            for (let a = 0; a < li; a++) for (let b = 0; b < lj; b++) bw = Math.min(bw, wf(valAt(i, a), valAt(j, b)));
            const cur = wf(ffD[i], ffD[j]);
            if (cur > VISIBLE) { oracle.wall[cls] += cur; oracle.best[cls] += Math.min(bw, cur); }
        };
        for (let k = 0; k < pv.length; k++) pairOracle(pv[k], pv[k] + pw, cv[k], wallV);
        for (let k = 0; k < phz.length; k++) pairOracle(phz[k], phz[k] + 1, ch[k], wallH);
        let flipped = 0; for (let i = 0; i < N; i++) if (free[i] && lab[i] !== (axis[i] === 2 ? 1 : 0)) flipped++;
        // how far the field moved, in d and in screen px, so "it smoothed everything flat" is checkable
        let mx = 0, sum = 0, n = 0; for (let i = 0; i < N; i++) if (band[i]) { const dd = Math.abs(after[i] - ff[i]); if (dd > mx) mx = dd; sum += dd; n++; }
        // DUMP=1: hand the exact energy to an external solver (s51_mincut.py). Everything is in the units the energy
        // uses -- screen-pixel positions s(d) = Z/(D+Z) before the half-angle factor -- so the solver cannot drift
        // from this file's definition. Base64 of little-endian typed arrays, full plate size.
        let dump = null;
        if (DUMP) {
            const b64 = (ta) => { const u = new Uint8Array(ta.buffer); let str = ''; for (let o = 0; o < u.length; o += 0x8000) str += String.fromCharCode.apply(null, u.subarray(o, o + 0x8000)); return btoa(str); };
            const s0 = new Float64Array(N), s1 = new Float64Array(N), d0 = new Float64Array(N), d1 = new Float64Array(N);
            const lawL = new Uint8Array(N), icmL = new Uint8Array(N);
            for (let i = 0; i < N; i++) { if (!band[i]) continue;
                s0[i] = sOf(valAt(i, 0)); s1[i] = free[i] ? sOf(valAt(i, 1)) : s0[i];
                if (free[i]) { d0[i] = dataPx(i, 0); d1[i] = dataPx(i, 1); lawL[i] = axis[i] === 2 ? 1 : 0; icmL[i] = lab[i]; } }
            const pvA = new Int32Array(pv), phA = new Int32Array(phz);
            dump = { sH, sV, VISIBLE, band: b64(band), free: b64(free), s0: b64(s0), s1: b64(s1), d0: b64(d0), d1: b64(d1),
                     lawL: b64(lawL), icmL: b64(icmL), pv: b64(pvA), ph: b64(phA), cv: b64(cv), ch: b64(ch), ffS: b64(Float64Array.from(ff, (v, i) => band[i] ? sOf(v) : 0)) };
        }
        return { dump, pw, ph, nBand, nFree, pairsV: pv.length, pairsH: phz.length, sweeps, lastChanged: changed, flipped,
                 seedErr, seedLog, before, after: aft, oracle, moved: { maxD: mx, meanD: sum / Math.max(n, 1) },
                 law: { exH: L.exH, exV: L.exV, pxPerWorldScreen: L.pxPerWorldScreen, D: L.D } };
    }, [process.env.LAMBDA === 'inf' || !process.env.LAMBDA ? Infinity : +process.env.LAMBDA, +(process.env.SWEEPS || 40), +(process.env.RESTARTS || 1), !!process.env.DUMP]);

    if (res.error) { console.log('FAILED: ' + res.error); }
    else {
        const f = (o) => o.wall.map(v => v.toFixed(0));
        console.log('\nplate ' + res.pw + 'x' + res.ph + ', band ' + res.nBand + ' texels, ' + res.nFree + ' with both candidates (' +
                    (100 * res.nFree / Math.max(res.nBand, 1)).toFixed(1) + '% free), pairs ' + res.pairsV + ' v / ' + res.pairsH + ' h');
        console.log('restarts: ' + JSON.stringify(res.seedLog));
        console.log('ICM: ' + res.sweeps + ' sweeps, ' + res.lastChanged + ' changed in the last, ' + res.flipped + ' texels relabelled (' +
                    (100 * res.flipped / Math.max(res.nFree, 1)).toFixed(1) + '% of free)');
        console.log('field moved: mean ' + res.moved.meanD.toFixed(5) + ' in d, max ' + res.moved.maxD.toFixed(4));
        // the seed check: at the law's own labelling the reconstructed field must BE the law's field. A large value
        // means the candidates are not in the units ff is in, which is exactly how the first run went wrong.
        console.log('seed identity: max |cand[law choice] - ff| = ' + res.seedErr.toExponential(2) +
                    (res.seedErr > 1e-3 ? '   <-- FAILS: the candidates do not reconstruct the law, the rest is meaningless' : '   ok'));
        if (res.moved.meanD > 1) console.log('  !! the field moved more than 1 in a quantity bounded by [0,1] -- unit error, do not read the table');
        console.log('\n  VISIBLE WALL LENGTH IN SCREEN PIXELS AT THE RIM, by S33 class (partition from the ORIGINAL choice)');
        console.log('  ' + 'arm'.padEnd(8) + 'visible bends' + '  class1 (artefact)'.padStart(20) + '  class2 (REAL step)'.padStart(20) + '  class3 (artefact)'.padStart(20) + '   total wall');
        for (const [nm, o] of [['before', res.before], ['after', res.after]]) {
            console.log('  ' + nm.padEnd(8) + String(o.visible).padStart(13) + '  ' + (o.wall[1].toFixed(0) + ' (' + o.count[1] + ')').padStart(18) +
                        '  ' + (o.wall[2].toFixed(0) + ' (' + o.count[2] + ')').padStart(18) + '  ' + (o.wall[3].toFixed(0) + ' (' + o.count[3] + ')').padStart(18) +
                        '   ' + o.total.toFixed(0));
        }
        const o = res.oracle;
        console.log('\n  THE ORACLE BOUND -- the best ANY labelling of this candidate set could do, per pair, ignoring');
        console.log('  that neighbours share labels. A strict upper bound: if it is small, no better solver helps.');
        console.log('  ' + 'class'.padEnd(8) + 'wall now'.padStart(12) + 'best possible'.padStart(16) + 'headroom'.padStart(12));
        for (const c of [1, 2, 3]) console.log('  ' + String(c).padEnd(8) + o.wall[c].toFixed(0).padStart(12) + o.best[c].toFixed(0).padStart(16) +
            ((100 * (1 - o.best[c] / Math.max(o.wall[c], 1e-9))).toFixed(1) + '%').padStart(12));
        const a1 = res.before.wall[1] + res.before.wall[3], a2 = res.after.wall[1] + res.after.wall[3];
        console.log('\n  ARTEFACT WALL (class 1 + 3): ' + a1.toFixed(0) + ' -> ' + a2.toFixed(0) + ' px  (' + (100 * (1 - a2 / Math.max(a1, 1e-9))).toFixed(1) + '% reduction; the bar is 50%)');
        console.log('  REAL STEP WALL (class 2):    ' + res.before.wall[2].toFixed(0) + ' -> ' + res.after.wall[2].toFixed(0) + ' px  (must survive)');
        if (res.dump) { fs.writeFileSync(path.join(OUT, 'energy_dump.json'), JSON.stringify(res.dump)); delete res.dump; console.log('  energy dumped for s51_mincut.py'); }
        fs.writeFileSync(path.join(OUT, 'label.json'), JSON.stringify(res, null, 1));
        console.log('  -> ' + OUT);
    }
    await browser.close(); try { srv.kill(); } catch (e) {}
})();
