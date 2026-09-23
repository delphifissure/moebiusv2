// S59 arm C, the plain fill, as a standalone JS module (NOT wired into moebius.js; the port waits for the A/B's
// decision). Same construction as harness/sheet_ab_fields.py, solved by Jacobi-preconditioned conjugate gradients so
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
// iterations, machine shared with a render and sheets.py): the port needs a multigrid or a coarse-to-fine warm start.
'use strict';

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

    // solve: fixed texels hold vals; free texels in a component with a fixed texel satisfy deg u - sum u_nb = 0
    function membrane(fix, vals, nch) {
        const has = new Uint8Array(nc); for (let k = 0; k < n; k++) if (fix[k]) has[comp[k]] = 1;
        const out = new Float64Array(n * nch); const free = [];
        for (let k = 0; k < n; k++) { if (fix[k] || !has[comp[k]]) { for (let c = 0; c < nch; c++) out[k * nch + c] = vals[k * nch + c]; } else free.push(k); }
        const m = free.length, fidx = new Int32Array(n).fill(-1); for (let t = 0; t < m; t++) fidx[free[t]] = t;
        const deg = new Float64Array(m); for (let t = 0; t < m; t++) deg[t] = nbStart[free[t] + 1] - nbStart[free[t]];
        const Ap = (p, r) => { for (let t = 0; t < m; t++) { const k = free[t]; let s = deg[t] * p[t]; for (let q = nbStart[k]; q < nbStart[k + 1]; q++) { const f = fidx[nbList[q]]; if (f >= 0) s -= p[f]; } r[t] = s; } };
        let iters = 0, worst = 0;
        for (let c = 0; c < nch; c++) {
            const b = new Float64Array(m);
            for (let t = 0; t < m; t++) { const k = free[t]; let s = 0; for (let q = nbStart[k]; q < nbStart[k + 1]; q++) { const j = nbList[q]; if (fidx[j] < 0) s += out[j * nch + c]; } b[t] = s; }
            const u = new Float64Array(m), r = Float64Array.from(b), z = new Float64Array(m), p = new Float64Array(m), Apv = new Float64Array(m);
            for (let t = 0; t < m; t++) { z[t] = r[t] / deg[t]; p[t] = z[t]; }
            let rz = 0; for (let t = 0; t < m; t++) rz += r[t] * z[t];
            let bn = 0; for (let t = 0; t < m; t++) bn += b[t] * b[t]; bn = Math.sqrt(bn) || 1;
            let it = 0;
            for (; it < 20000; it++) {
                Ap(p, Apv); let pAp = 0; for (let t = 0; t < m; t++) pAp += p[t] * Apv[t];
                const a = rz / pAp; let rn = 0;
                for (let t = 0; t < m; t++) { u[t] += a * p[t]; r[t] -= a * Apv[t]; rn += r[t] * r[t]; }
                if (Math.sqrt(rn) / bn < 1e-10) { it++; break; }
                let rz2 = 0; for (let t = 0; t < m; t++) { z[t] = r[t] / deg[t]; rz2 += r[t] * z[t]; }
                const beta = rz2 / rz; rz = rz2; for (let t = 0; t < m; t++) p[t] = z[t] + beta * p[t];
            }
            iters = Math.max(iters, it);
            for (let t = 0; t < m; t++) out[free[t] * nch + c] = u[t];
            Ap(u, Apv); for (let t = 0; t < m; t++) worst = Math.max(worst, Math.abs(Apv[t] - b[t]));
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
