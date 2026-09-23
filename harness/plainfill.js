// S59 arm C, the plain fill, as a standalone JS module (NOT wired into moebius.js; the port waits for the A/B's
// decision). Same construction as harness/sheet_ab_fields.py, solved by multigrid-preconditioned conjugate gradients so
// a hole hundreds of texels wide converges (red-black SOR at a fixed 600 iterations, as _screenedPoissonBand runs, does
// not).
//   depth: per band component, a membrane pinned at the background edge (band texels with a non-band 4-neighbour
//          behind them by > 2 visible steps, S35 section 47) to the per-line law's own value there; free elsewhere;
//          texels not behind their occluder by 2 steps, and components with no pin, keep the law's value.
//   wash:  the same membrane per channel, pinned at the same edge texels to the colour of the law's own far rim
//          (farRimJ / farRimW); components with no such pin are pinned at their ring's source colour.
// Verified against the Python fields: node harness/plainfill.js <dump dir> <fields dir> <step>
// Troll (2026-09-23): depth max |JS - Python| 6.0e-8 (3.4e-5 visible steps), wash max 1 level (rounding), every count
// equal (band 258 610, 427 components, 3 206 edge pins, 16 856 no-pin, 3 942 not-behind). BUT 60.6 s (2 730 / 2 645 CG
// iterations, machine shared with a render and sheets.py): the port needs a multigrid (below).
'use strict';
let TOL = (typeof process !== 'undefined' && process.env && process.env.PF_TOL) ? Number(process.env.PF_TOL) : 1e-8;   // relative residual; 1e-8 measured at 0.0004 visible steps from the exact fill on the troll (1e-6: 81 steps)

function plainFill(o) {
    const { pw, ph, band, dQ, law, step, rimJ, rimW, rgb } = o; const N = pw * ph;
    const bi = []; const idx = new Int32Array(N).fill(-1);
    for (let i = 0; i < N; i++) if (band[i]) { idx[i] = bi.length; bi.push(i); }
    const n = bi.length;
    // neighbours (band-band edges only: a non-band neighbour is a free boundary unless it pins)
    const nbStart = new Int32Array(n + 1), nbList = new Int32Array(4 * n); let e = 0;
    const edge = new Uint8Array(n), ringC = new Float64Array(3 * n), ringN = new Float64Array(n);
    for (let k = 0; k < n; k++) {
        nbStart[k] = e; const i = bi[k], x = i % pw;
        const cand = [x > 0 ? i - 1 : -1, x < pw - 1 ? i + 1 : -1, i >= pw ? i - pw : -1, i < N - pw ? i + pw : -1];
        for (const j of cand) {
            if (j < 0) continue;
            if (band[j]) nbList[e++] = idx[j];
            else {
                if (dQ[j] < dQ[i] - 2 * step) edge[k] = 1;
                ringC[3 * k] += rgb[3 * j]; ringC[3 * k + 1] += rgb[3 * j + 1]; ringC[3 * k + 2] += rgb[3 * j + 2]; ringN[k]++;
            }
        }
    }
    nbStart[n] = e;
    // components (band-band connectivity)
    const comp = new Int32Array(n).fill(-1); let nc = 0; const stack = [];
    for (let s = 0; s < n; s++) { if (comp[s] >= 0) continue; comp[s] = nc; stack.push(s);
        while (stack.length) { const k = stack.pop(); for (let q = nbStart[k]; q < nbStart[k + 1]; q++) { const m = nbList[q]; if (comp[m] < 0) { comp[m] = nc; stack.push(m); } } } nc++; }

    // solve: fixed texels hold vals; free texels in a component with a fixed texel satisfy deg u - sum u_nb = 0.
    // (A coarse-to-fine warm start was tried first and did not cut the iterations: the problem is conditioning, not the
    // starting point.) AGGREGATION MULTIGRID-PRECONDITIONED CG on the eliminated system A u = b over the free nodes (A = D - W: D the
    // weighted degree including links to fixed nodes, W the free-free links). Levels merge 2x2 blocks of the node
    // coordinates (piecewise-constant prolongation P, Galerkin coarse operator P^T A P); a V-cycle with one forward and
    // one backward Gauss-Seidel sweep per level is a symmetric preconditioner, so CG stays valid. The coarsest level
    // (< 500 nodes) is solved by Gauss-Seidel to convergence. Stops on the relative residual TOL.
    function buildLevel(m, rowStart, cols, vals, diag, xy) {    // CSR of the off-diagonal part (negative weights) + diag
        return { m, rowStart, cols, vals, diag, xy };
    }
    function coarsen(L) {
        const { m, rowStart, cols, vals, diag, xy } = L; const agg = new Int32Array(m), key2 = new Map(); let nc = 0; const cxy = [];
        for (let i = 0; i < m; i++) { const X = xy[2 * i] >> 1, Y = xy[2 * i + 1] >> 1, key = Y * 1048576 + X; let c = key2.get(key); if (c === undefined) { c = nc++; key2.set(key, c); cxy.push(X, Y); } agg[i] = c; }
        const cdiag = new Float64Array(nc); const links = new Map();
        for (let i = 0; i < m; i++) { const a = agg[i]; cdiag[a] += diag[i];
            for (let q = rowStart[i]; q < rowStart[i + 1]; q++) { const j = cols[q], bb = agg[j], v = vals[q]; if (a === bb) cdiag[a] += v; else { const k = a * nc + bb; links.set(k, (links.get(k) || 0) + v); } } }
        const cStart = new Int32Array(nc + 1); for (const k of links.keys()) cStart[Math.floor(k / nc) + 1]++; for (let c = 0; c < nc; c++) cStart[c + 1] += cStart[c];
        const cCols = new Int32Array(cStart[nc]), cVals = new Float64Array(cStart[nc]), fp = Int32Array.from(cStart.subarray(0, nc));
        for (const [k, v] of links) { const aa = Math.floor(k / nc), bb = k - aa * nc; cCols[fp[aa]] = bb; cVals[fp[aa]] = v; fp[aa]++; }
        return { agg, C: buildLevel(nc, cStart, cCols, cVals, cdiag, Int32Array.from(cxy)) };
    }
    function gs(L, x, rhs, backward) {
        const { m, rowStart, cols, vals, diag } = L;
        if (!backward) { for (let i = 0; i < m; i++) { let sum = rhs[i]; for (let q = rowStart[i]; q < rowStart[i + 1]; q++) sum -= vals[q] * x[cols[q]]; x[i] = sum / diag[i]; } }
        else { for (let i = m - 1; i >= 0; i--) { let sum = rhs[i]; for (let q = rowStart[i]; q < rowStart[i + 1]; q++) sum -= vals[q] * x[cols[q]]; x[i] = sum / diag[i]; } }
    }
    function residual(L, x, rhs, out) { const { m, rowStart, cols, vals, diag } = L; for (let i = 0; i < m; i++) { let sum = diag[i] * x[i]; for (let q = rowStart[i]; q < rowStart[i + 1]; q++) sum += vals[q] * x[cols[q]]; out[i] = rhs[i] - sum; } }
    function vcycle(levels, li, rhs) {     // returns x ~ A^-1 rhs from zero start
        const L = levels[li].L; const x = new Float64Array(L.m);
        if (li === levels.length - 1) { for (let s = 0; s < 60; s++) { gs(L, x, rhs, false); gs(L, x, rhs, true); } return x; }
        gs(L, x, rhs, false);
        const r = new Float64Array(L.m); residual(L, x, rhs, r);
        const { agg } = levels[li]; const C = levels[li + 1].L; const rc = new Float64Array(C.m); for (let i = 0; i < L.m; i++) rc[agg[i]] += r[i];
        const ec = vcycle(levels, li + 1, rc); for (let i = 0; i < L.m; i++) x[i] += ec[agg[i]];
        gs(L, x, rhs, true);
        return x;
    }
    function solveGraph(nN, adjStart, adjList, adjW, fixMask, fixVal) {
        const free = []; for (let k = 0; k < nN; k++) if (!fixMask[k]) free.push(k);
        const m = free.length, fidx = new Int32Array(nN).fill(-1); for (let t = 0; t < m; t++) fidx[free[t]] = t;
        const out = Float64Array.from(fixVal); if (!m) return { out, iters: 0 };
        // fine level: diag = weighted degree (all links), off-diagonal = -w for free-free links; rhs = sum w * fixed
        const rowStart = new Int32Array(m + 1), diag = new Float64Array(m), b = new Float64Array(m);
        for (let t = 0; t < m; t++) { const k = free[t]; let cnt = 0; for (let q = adjStart[k]; q < adjStart[k + 1]; q++) { diag[t] += adjW[q]; const j = adjList[q]; if (fidx[j] >= 0) cnt++; else b[t] += adjW[q] * fixVal[j]; } rowStart[t + 1] = rowStart[t] + cnt; }
        const cols = new Int32Array(rowStart[m]), vals = new Float64Array(rowStart[m]);
        for (let t = 0; t < m; t++) { const k = free[t]; let p0 = rowStart[t]; for (let q = adjStart[k]; q < adjStart[k + 1]; q++) { const f = fidx[adjList[q]]; if (f >= 0) { cols[p0] = f; vals[p0] = -adjW[q]; p0++; } } }
        const xy = new Int32Array(2 * m); for (let t = 0; t < m; t++) { xy[2 * t] = xyB[2 * free[t]]; xy[2 * t + 1] = xyB[2 * free[t] + 1]; }
        const levels = [{ L: buildLevel(m, rowStart, cols, vals, diag, xy) }];
        while (levels[levels.length - 1].L.m > 500) { const c = coarsen(levels[levels.length - 1].L); if (c.C.m >= levels[levels.length - 1].L.m) break; levels[levels.length - 1].agg = c.agg; levels.push({ L: c.C }); }
        const L0 = levels[0].L; const u = new Float64Array(m), r = Float64Array.from(b); let z = vcycle(levels, 0, r); const pv = Float64Array.from(z), Apv = new Float64Array(m);
        let rz = 0; for (let t = 0; t < m; t++) rz += r[t] * z[t];
        let bn = 0; for (let t = 0; t < m; t++) bn += b[t] * b[t]; bn = Math.sqrt(bn) || 1;
        const Ap = (x, o) => { for (let i = 0; i < m; i++) { let sum = L0.diag[i] * x[i]; for (let q = L0.rowStart[i]; q < L0.rowStart[i + 1]; q++) sum += L0.vals[q] * x[L0.cols[q]]; o[i] = sum; } };
        let it = 0;
        for (; it < 2000; it++) {
            let rn = 0; for (let t = 0; t < m; t++) rn += r[t] * r[t]; if (Math.sqrt(rn) / bn < TOL) break;
            Ap(pv, Apv); let pAp = 0; for (let t = 0; t < m; t++) pAp += pv[t] * Apv[t];
            const al = rz / pAp; for (let t = 0; t < m; t++) { u[t] += al * pv[t]; r[t] -= al * Apv[t]; }
            z = vcycle(levels, 0, r); let rz2 = 0; for (let t = 0; t < m; t++) rz2 += r[t] * z[t];
            const beta = rz2 / rz; rz = rz2; for (let t = 0; t < m; t++) pv[t] = z[t] + beta * pv[t];
        }
        for (let t = 0; t < m; t++) out[free[t]] = u[t];
        return { out, iters: it, levels: levels.length };
    }
    // the band texels as a graph (unit weights on band-band edges), shared by every channel
    const adjStart = nbStart, adjList = nbList.subarray(0, e), adjW = new Float64Array(e).fill(1);
    const xyB = new Int32Array(2 * n); for (let k = 0; k < n; k++) { xyB[2 * k] = bi[k] % pw; xyB[2 * k + 1] = (bi[k] / pw) | 0; }
    function membrane(fix, vals, nch) {
        const has = new Uint8Array(nc); for (let k = 0; k < n; k++) if (fix[k]) has[comp[k]] = 1;
        const out = new Float64Array(n * nch); let iters = 0, worst = 0;
        const fm = new Uint8Array(n); for (let k = 0; k < n; k++) fm[k] = (fix[k] || !has[comp[k]]) ? 1 : 0;
        for (let c = 0; c < nch; c++) {
            const fv = new Float64Array(n); for (let k = 0; k < n; k++) if (fm[k]) fv[k] = vals[k * nch + c];
            const r = solveGraph(n, adjStart, adjList, adjW, fm, fv); iters = Math.max(iters, r.iters);
            for (let k = 0; k < n; k++) out[k * nch + c] = r.out[k];
            // residual on the free texels (the Laplace equation)
            for (let k = 0; k < n; k++) { if (fm[k]) continue; let sum = (adjStart[k + 1] - adjStart[k]) * r.out[k]; for (let q = adjStart[k]; q < adjStart[k + 1]; q++) sum -= r.out[adjList[q]]; worst = Math.max(worst, Math.abs(sum)); }
        }
        return { out, has, iters, residual: worst };
    }
    // depth
    const dv = new Float64Array(n); for (let k = 0; k < n; k++) dv[k] = law[bi[k]];
    const D = membrane(edge, dv, 1);
    const depth = Float32Array.from(dQ); let notBehind = 0, noPin = 0;
    for (let k = 0; k < n; k++) { let v = D.out[k]; if (!D.has[comp[k]]) noPin++; else if (v >= dQ[bi[k]] - 2 * step) { v = law[bi[k]]; notBehind++; } depth[bi[k]] = v; }
    // wash
    const cfix = new Uint8Array(n), cv = new Float64Array(3 * n); let rimPins = 0, ringPins = 0;
    for (let k = 0; k < n; k++) {
        if (!edge[k]) continue; const i = bi[k]; let w = 0, r = 0, g = 0, bl = 0;
        for (let s = 0; s < 2; s++) { const j = rimJ[2 * i + s]; if (j >= 0 && j < N) { const ww = rimW[2 * i + s] > 0 ? rimW[2 * i + s] : 0; w += ww; r += ww * rgb[3 * j]; g += ww * rgb[3 * j + 1]; bl += ww * rgb[3 * j + 2]; } }
        if (w === 0) { let c = 0; for (let s = 0; s < 2; s++) { const j = rimJ[2 * i + s]; if (j >= 0 && j < N) { c++; r += rgb[3 * j]; g += rgb[3 * j + 1]; bl += rgb[3 * j + 2]; } } w = c; }
        if (w > 0) { cfix[k] = 1; cv[3 * k] = r / w; cv[3 * k + 1] = g / w; cv[3 * k + 2] = bl / w; rimPins++; }
    }
    const hasC = new Uint8Array(nc); for (let k = 0; k < n; k++) if (cfix[k]) hasC[comp[k]] = 1;
    for (let k = 0; k < n; k++) if (!hasC[comp[k]] && ringN[k] > 0) { cfix[k] = 1; for (let c = 0; c < 3; c++) cv[3 * k + c] = ringC[3 * k + c] / ringN[k]; ringPins++; }
    const W = membrane(cfix, cv, 3);
    const colour = Uint8ClampedArray.from(rgb);
    for (let k = 0; k < n; k++) if (W.has[comp[k]]) for (let c = 0; c < 3; c++) colour[3 * bi[k] + c] = Math.round(Math.min(255, Math.max(0, W.out[3 * k + c])));
    return { depth, colour, stats: { band: n, components: nc, edgePins: edge.reduce((a, v) => a + v, 0), noPin, notBehind, rimPins, ringPins, itersDepth: D.iters, itersWash: W.iters, residualDepth: D.residual, residualWash: W.residual } };
}
module.exports = { plainFill };

if (require.main === module) {
    // verification against sheet_ab_fields.py on the same inputs
    const fs = require('fs'), path = require('path'); const [dump, fields, stepS] = process.argv.slice(2); const step = Number(stepS);
    const { pw, ph } = JSON.parse(fs.readFileSync(path.join(dump, 'size.json'))); const N = pw * ph;
    const f32 = (p) => { const b = fs.readFileSync(p); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
    const band = fs.readFileSync(path.join(dump, 'disocc.u8')), dQ = f32(path.join(dump, 'dQ.f32')), law = f32(path.join(dump, 'farField.f32'));
    const rj = fs.readFileSync(path.join(fields, 'rimJ.i32')); const rimJ = new Int32Array(rj.buffer, rj.byteOffset, rj.byteLength / 4); const rimW = f32(path.join(fields, 'rimW.f32'));
    const { execSync } = require('child_process');
    const rgb = execSync(`python3 -c "import sys,numpy as np;from PIL import Image;sys.stdout.buffer.write(np.asarray(Image.open('${path.join(dump, 'color.png')}').convert('RGB'),np.uint8).tobytes())"`, { maxBuffer: 64 << 20 });
    const t0 = Date.now(); const r = plainFill({ pw, ph, band, dQ, law, step, rimJ, rimW, rgb }); const ms = Date.now() - t0;
    const Cpy = f32(path.join(fields, 'fieldC.f32')); let mx = 0; for (let i = 0; i < N; i++) if (band[i]) mx = Math.max(mx, Math.abs(Cpy[i] - r.depth[i]));
    const washPy = execSync(`python3 -c "import sys,numpy as np;from PIL import Image;sys.stdout.buffer.write(np.asarray(Image.open('${path.join(fields, 'wash.png')}').convert('RGB'),np.uint8).tobytes())"`, { maxBuffer: 64 << 20 });
    let cm = 0; for (let i = 0; i < N; i++) if (band[i]) for (let c = 0; c < 3; c++) cm = Math.max(cm, Math.abs(washPy[3 * i + c] - r.colour[3 * i + c]));
    console.log(JSON.stringify({ ms, ...r.stats, maxDepthDiffVsPython: mx, maxDepthDiffInSteps: mx / step, maxWashDiffVsPython: cm }));
}
