// S33: what are the plate's steep bends? For every pair of adjacent band texels whose far field differs by more than the
// visible step (a bend the eye sees as a wall off-axis), classify the pair by the RIMS the two texels continue from:
//   1 same axis, rims joined by the join law (one visible surface)  -> the per-line law disagreeing with itself (artifact)
//   2 same axis, rims not joined                                     -> a real step between two visible surfaces, carried into the band
//   3 the two texels were extrapolated along different axes          -> the axis arbitration flipped between neighbours (seam)
//   4 one of the two has no rim (sky, own depth)                     -> other
// Per-line plane bake with the start-up defaults (COLOR=, DEPTH=, TAG= as live_repro.js). Output harness/shots/streakclass/<TAG>/:
// vclass.u8 / hclass.u8 (class of the edge below / to the right of each texel, 0 = no visible bend or not band), vjump.f32 /
// hjump.f32 (|d far field| in visible steps), size.json, counts.json. Render with streak_class_render.py.
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const H = __dirname, WT = path.resolve(__dirname, '..'); const TAG = process.env.TAG || 'default'; const OUT = path.join(H, 'shots', 'streakclass', TAG); fs.mkdirSync(OUT, { recursive: true });
(async () => {
    fs.copyFileSync(path.resolve(WT, process.env.COLOR || 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, process.env.DEPTH || 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } }); const logs = [];
    page.on('console', m => { const t = m.text(); if (/\[S6\]|\[S2b\] rim law: t|\[S3\] far side|\[S10\]|shader error/.test(t)) logs.push(t.slice(0, 260)); });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
    if (process.env.FLAGS) await page.evaluate((f) => { for (const kv of f.split(',')) { const [k, v] = kv.split('='); window[k] = Number(v); } }, process.env.FLAGS);
    console.log('defaults: ' + await page.evaluate(() => JSON.stringify(window._bgPlateOptions)));
    await page.evaluate(() => document.getElementById('bgLayerBuildBtn').click());
    for (let t = 0; t < 320; t++) { if (await page.evaluate(() => !!window._bgQuickBaked && !!window._qbPlateF)) break; await new Promise(r => setTimeout(r, 1000)); }
    const res = await page.evaluate(() => {
        const { pw, ph } = window._qbSize; const N = pw * ph; const dQ = window._qbDQ, ff = window._geoFarField, rimJ = window._geoFarRimJ, mix = window._geoFarMix, axis = window._geoFarAxis, kind = window._geoFarKind, dis = window._qbDisocc;
        if (!(dQ && ff && rimJ && axis && dis)) return { error: 'missing arrays: ' + [!!dQ, !!ff, !!rimJ, !!axis, !!dis].join(',') };
        const rl = bgRimLawFor(pw, ph); const step = window._qbSrcQuantum;   // the effective quantum = the visible step (S10)
        const qg = (typeof window._qbSrcGrid === 'number' && window._qbSrcGrid > 0) ? window._qbSrcGrid : step;
        const band = new Uint8Array(N); let nBand = 0; for (let i = 0; i < N; i++) if (dis[i] && ff[i] < dQ[i] - qg) { band[i] = 1; nBand++; }
        // the rim that gave the texel its value: kind 2 (same plane) -> either (take the first present); otherwise the side with the larger mix
        const rimOf = (i) => { const a = rimJ[2 * i], b = rimJ[2 * i + 1]; if (a < 0) return b; if (b < 0) return a; if (kind && kind[i] === 2) return a; return (mix[i] >= 0.5) ? a : b; };
        const vclass = new Uint8Array(N), hclass = new Uint8Array(N), vjump = new Float32Array(N), hjump = new Float32Array(N);
        const counts = { v: { all: 0, above: 0, c: [0, 0, 0, 0, 0], joinedAny: [0, 0, 0, 0, 0], jumps: [[], [], [], [], []] }, h: { all: 0, above: 0, c: [0, 0, 0, 0, 0], joinedAny: [0, 0, 0, 0, 0], jumps: [[], [], [], [], []] } };
        const classify = (t, u) => {
            const at = axis[t], au = axis[u]; const rt = rimOf(t), ru = rimOf(u);
            if (rt < 0 || ru < 0) return [4, false];
            let anyJ = false; for (let s = 0; s < 2; s++) for (let s2 = 0; s2 < 2; s2++) { const a = rimJ[2 * t + s], b = rimJ[2 * u + s2]; if (a >= 0 && b >= 0 && (a === b || rl.joinedIdx(a, b, dQ, pw))) anyJ = true; }
            if (at !== au) return [3, anyJ];
            const j = (rt === ru) || rl.joinedIdx(rt, ru, dQ, pw);
            return [j ? 1 : 2, anyJ];
        };
        const doEdge = (t, u, C, J, key) => { const c = counts[key]; c.all++; const d = Math.abs(ff[t] - ff[u]); J[t] = d / step; if (d <= step) return; c.above++;
            const [k, anyJ] = classify(t, u); C[t] = k; c.c[k]++; if (anyJ) c.joinedAny[k]++; c.jumps[k].push(d / step); };
        for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const t = y * pw + x; if (!band[t]) continue;
            if (y < ph - 1 && band[t + pw]) doEdge(t, t + pw, vclass, vjump, 'v');
            if (x < pw - 1 && band[t + 1]) doEdge(t, t + 1, hclass, hjump, 'h'); }
        const q = (arr, p) => { if (!arr.length) return 0; const s = Float64Array.from(arr).sort(); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
        for (const key of ['v', 'h']) { const c = counts[key]; c.median = c.jumps.map(a => q(a, 0.5)); c.p90 = c.jumps.map(a => q(a, 0.9)); c.sum = c.jumps.map(a => a.reduce((s, v) => s + v, 0)); delete c.jumps; }
        // how many band texels have their rims on how many distinct joined surfaces, per band row: rows whose texels all continue one surface
        const b64 = (a) => { const u8 = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
        return { pw, ph, nBand, step, qg, counts, vclass: b64(vclass), hclass: b64(hclass), vjump: b64(vjump), hjump: b64(hjump), band: b64(band), dQ: b64(dQ), ff: b64(ff) };
    });
    if (res.error) { console.log('ERROR ' + res.error); } else {
        for (const k of ['vclass', 'hclass', 'vjump', 'hjump', 'band', 'dQ', 'ff']) fs.writeFileSync(path.join(OUT, k + (k.endsWith('jump') || k === 'dQ' || k === 'ff' ? '.f32' : '.u8')), Buffer.from(res[k], 'base64'));
        fs.writeFileSync(path.join(OUT, 'size.json'), JSON.stringify({ pw: res.pw, ph: res.ph }));
        const { vclass, hclass, vjump, hjump, band, dQ, ff, ...meta } = res; fs.writeFileSync(path.join(OUT, 'counts.json'), JSON.stringify(meta, null, 1));
        console.log('band ' + res.nBand + ' texels; step ' + res.step.toExponential(3) + '; vertical edges ' + res.counts.v.all + ', above step ' + res.counts.v.above + ' classes ' + JSON.stringify(res.counts.v.c) + '; horizontal ' + res.counts.h.all + ', above ' + res.counts.h.above + ' classes ' + JSON.stringify(res.counts.h.c));
    }
    fs.copyFileSync(path.join(H, 'defaultImgColor.png'), path.join(OUT, 'color.png'));
    console.log(logs.slice(0, 8).join('\n'));
    await browser.close(); srv.kill(); console.log('done ' + OUT);
})();
