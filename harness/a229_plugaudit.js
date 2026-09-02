// A229 PLUG AUDIT — what is the plug made of under each occluder? Texture-
// space dumps (upright) from the quick bake with the carve on:
//   audit_depth_src.png   dQ      source depth (white = near)
//   audit_depth_plate.png plateF  final plug depth
//   audit_depth_diff.png  |plateF - dQ| (white = plate departs source, i.e.
//                         NOT a clone; black = the plug sits AT the source depth)
//   audit_cat.png         carve criterion: red demand, green collar, blue rim,
//                         black dropped
//   audit_clone.png       kept texels whose plate depth is within one source
//                         quantum of dQ = texels that are a depth-CLONE of
//                         the foreground (yellow), over the kept region (grey)
// plus counts per category and the clone fraction per category.
//   node harness/a229_plugaudit.js
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = __dirname, WT = path.resolve(__dirname, '..');
// Other scenes: IMG=<color.png>,<depth.png> TAG=<name>  (files are staged as
// the harness's defaultImg pair for the run and the troll pair restored after)
const TAG = process.env.TAG || 'troll';
const OUT = path.join(__dirname, 'shots', 'a229', TAG === 'troll' ? '' : TAG);

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    if (process.env.IMG) {
        const [c, d] = process.env.IMG.split(',');
        fs.copyFileSync(path.resolve(WT, c), path.join(H, 'defaultImgColor.png'));
        fs.copyFileSync(path.resolve(WT, d), path.join(H, 'defaultImgDepth.png'));
    } else {
        fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png'));
        fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
    }
    process.on('exit', () => { try {
        fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png'));
        fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
               '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('console', m => { const t = m.text(); if (/a217|A229|plate plugs|cliff gate|viewpoint scan|a160b|flush|A59d|a59d/.test(t)) console.log('  [page] ' + t.slice(0, 170)); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) {
        const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
        if (ok) break; await new Promise(r2 => setTimeout(r2, 1000));
    }
    const res = await page.evaluate(async () => {
        window._rayReproject = true; window._plugCarve = true; window._srCapture = true;
        bgQuickBake = true; buildBackgroundLayer(); isSweeping = true;
        const dbg = window._qbDbg, msk = window._qbMask, cv = window._carveDbg;
        if (!dbg || !msk || !cv) return { err: 'missing debug: ' + [!!dbg, !!msk, !!cv] };
        const { pw, ph } = cv; const N = pw * ph;
        const dQ = dbg.d, plateQ = dbg.plate, disocc = msk.disocc, cat = cv.cat, plateF = cv.plateF;
        const q = (typeof window._qbSrcQuantum === 'number' && window._qbSrcQuantum > 0) ? window._qbSrcQuantum : 1 / 255;
        // stats per category (cat is flipped-row; dQ/plateQ/disocc are source-row)
        const cnt = [0, 0, 0, 0], clone = [0, 0, 0, 0], departed = [0, 0, 0, 0];
        for (let y = 0; y < ph; y++) { const sR = y * pw, dR = (ph - 1 - y) * pw;
            for (let x = 0; x < pw; x++) { const c = cat[dR + x]; cnt[c]++;
                const dd = Math.abs(plateF[dR + x] - dQ[sR + x]);
                if (dd <= q) clone[c]++; else departed[c]++; } }
        const toPng = (fill) => {
            const c = document.createElement('canvas'); c.width = pw; c.height = ph;
            const cx = c.getContext('2d'); const im = cx.createImageData(pw, ph);
            for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
                const o = (y * pw + x) * 4; const rgb = fill(x, y); im.data[o] = rgb[0]; im.data[o + 1] = rgb[1]; im.data[o + 2] = rgb[2]; im.data[o + 3] = 255; }
            cx.putImageData(im, 0, 0); return c.toDataURL('image/png');
        };
        const g = (v) => { const k = Math.max(0, Math.min(255, Math.round(v * 255))); return [k, k, k]; };
        const S = (x, y) => y * pw + x, F = (x, y) => (ph - 1 - y) * pw + x;   // source-row index, flipped index (upright output uses source rows)
        // OCCLUDER CORE flood (the proposed rule, measured before it is built):
        // from every disocc texel, walk into non-disocc 4-neighbours that are
        // NEARER than the background surface the band continues (dQ > plateQ
        // of the band texel + the 0.02 departure threshold that defines
        // disocc), carrying that background depth along. What it marks is the
        // part of the occluder's footprint the cone erosion could not reach.
        const core = new Uint8Array(N); const ref = new Float32Array(N);
        { const st = [];
          for (let i = 0; i < N; i++) if (disocc[i]) { st.push(i); ref[i] = plateQ[i]; }
          while (st.length) { const i = st.pop(); const x = i % pw, y = (i / pw) | 0; const r = ref[i];
              for (const nb of [x > 0 ? i - 1 : -1, x < pw - 1 ? i + 1 : -1, y > 0 ? i - pw : -1, y < ph - 1 ? i + pw : -1]) {
                  if (nb < 0 || disocc[nb] || core[nb]) continue;
                  if (dQ[nb] > r + 0.02) { core[nb] = 1; ref[nb] = r; st.push(nb); } } } }
        let nCore = 0, coreKept = 0, coreKeptClone = 0, coreDropped = 0;
        for (let y = 0; y < ph; y++) { const sR = y * pw, dR = (ph - 1 - y) * pw;
            for (let x = 0; x < pw; x++) { if (!core[sR + x]) continue; nCore++;
                const c = cat[dR + x]; if (c) { coreKept++; if (Math.abs(plateF[dR + x] - dQ[sR + x]) <= q) coreKeptClone++; } else coreDropped++; } }
        // CLIFF-BOUNDED variant: flood the same way but component-wise; a
        // component that steps CONTINUOUSLY (|d_n - d_i| <= fgTearStep, the
        // project's cliff semantic) onto a texel at background depth
        // (dQ <= ref + 0.02) is an attached ramp (ground, dune, water), not an
        // occluder core, and is rejected whole. Frame edges do not reject.
        // Continuity = the A212 per-cell fold test (a102 exact form): two
        // adjacent texels are one continuous surface iff their screen shift
        // at the cone rim differs by <= sqrt(2) px (one texel's own extent).
        // A soft-edged depth boundary that drops 0.5 over 6 texels is ~0.09
        // per texel: dozens of px of shift, a cliff. A ground plane's 0.001
        // per texel is continuous. fgTearStep (0.06/step) misread the head
        // edge as continuous on the first pass.
        const lut = bgShiftLUTFor(pw, ph);
        const TS = Math.SQRT2 / Math.max(1e-6, lut.span);   // mean-depth equivalent, for the log only
        const isCont = (a, b) => Math.abs(bgShiftPxAt(lut, a) - bgShiftPxAt(lut, b)) <= Math.SQRT2;
        const core2 = new Uint8Array(N); const lab = new Int32Array(N).fill(-1);
        let nComp = 0, nRamp = 0, rampTex = 0; const compOk = [], compInfo = [];
        for (let i0 = 0; i0 < N; i0++) {
            if (!disocc[i0]) continue;
            const x0 = i0 % pw, y0 = (i0 / pw) | 0; const r0 = plateQ[i0];
            for (const nb0 of [x0 > 0 ? i0 - 1 : -1, x0 < pw - 1 ? i0 + 1 : -1, y0 > 0 ? i0 - pw : -1, y0 < ph - 1 ? i0 + pw : -1]) {
                if (nb0 < 0 || disocc[nb0] || lab[nb0] >= 0 || !(dQ[nb0] > r0 + 0.02)) continue;
                const id = nComp++; let ok = true; const members = [nb0]; lab[nb0] = id; const st = [nb0];
                while (st.length) { const i = st.pop(); const x = i % pw, y = (i / pw) | 0;
                    for (const nb of [x > 0 ? i - 1 : -1, x < pw - 1 ? i + 1 : -1, y > 0 ? i - pw : -1, y < ph - 1 ? i + pw : -1]) {
                        if (nb < 0 || disocc[nb] || lab[nb] >= 0) continue;
                        if (dQ[nb] > r0 + 0.02) { lab[nb] = id; members.push(nb); st.push(nb); }
                        else if (isCont(dQ[nb], dQ[i])) ok = false;   // continuous step down to background depth: ramp
                    } }
                compOk[id] = ok; if (ok) for (const m of members) core2[m] = 1; else { nRamp++; rampTex += members.length; }
                let bx0 = pw, bx1 = 0, by0 = ph, by1 = 0; for (const m of members) { const mx = m % pw, my = (m / pw) | 0; if (mx < bx0) bx0 = mx; if (mx > bx1) bx1 = mx; if (my < by0) by0 = my; if (my > by1) by1 = my; }
                compInfo.push({ ok, n: members.length, bx0, bx1, by0, by1 });
            }
        }
        let nCore2 = 0; for (let i = 0; i < N; i++) if (core2[i]) nCore2++;
        compInfo.sort((a, b) => b.n - a.n);
        // A62's OWN object footprint: the directional plate's ground
        // segmentation (frame-edge flood bounded by luma edges + depth
        // cliffs). Non-ground texels are a62's occluders. Candidate rule:
        // "the plate under an a62 object footprint is the far-surface
        // continuation across the WHOLE footprint" -> the object texels the
        // hop budget did not reach (= non-ground AND not disocc) are the
        // cores this arc is about. Measured here, not built.
        const gr = msk.ground && msk.ground.length === N ? msk.ground : null;
        let nNonGround = 0, nObjCore = 0, nObjBand = 0; const objComps = [];
        if (gr) {
            const oc = new Uint8Array(N);
            for (let i = 0; i < N; i++) { if (gr[i]) continue; nNonGround++; if (disocc[i]) nObjBand++; else { nObjCore++; oc[i] = 1; } }
            const seen = new Uint8Array(N);
            for (let i0 = 0; i0 < N; i0++) { if (!oc[i0] || seen[i0]) continue; const st = [i0]; seen[i0] = 1; let n = 0, bx0 = pw, bx1 = 0, by0 = ph, by1 = 0;
                while (st.length) { const i = st.pop(); n++; const x = i % pw, y = (i / pw) | 0; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
                    for (const nb of [x > 0 ? i - 1 : -1, x < pw - 1 ? i + 1 : -1, y > 0 ? i - pw : -1, y < ph - 1 ? i + pw : -1]) if (nb >= 0 && oc[nb] && !seen[nb]) { seen[nb] = 1; st.push(nb); } }
                objComps.push({ n, bx0, bx1, by0, by1 }); }
            objComps.sort((a, b) => b.n - a.n);
        }
        return {
            pw, ph, q, cnt, cloneN: clone, departed, nCore, coreKept, coreKeptClone, coreDropped, nCore2, nComp, nRamp, rampTex, TS,
            comps: compInfo.slice(0, 12), hasGround: !!gr, nNonGround, nObjCore, nObjBand, objComps: objComps.slice(0, 10),
            a62: gr ? toPng((x, y) => { const i = S(x, y); return !gr[i] && !disocc[i] ? [0, 220, 255] : disocc[i] ? [255, 255, 255] : g(dQ[i] * 0.5); }) : null,
            core: toPng((x, y) => core[S(x, y)] ? [0, 220, 255] : disocc[S(x, y)] ? [255, 255, 255] : g(dQ[S(x, y)] * 0.5)),
            core2: toPng((x, y) => core2[S(x, y)] ? [0, 220, 255] : (lab[S(x, y)] >= 0 ? [255, 120, 0] : disocc[S(x, y)] ? [255, 255, 255] : g(dQ[S(x, y)] * 0.5))),
            src: toPng((x, y) => g(dQ[S(x, y)])),
            plate: toPng((x, y) => g(plateF[F(x, y)])),
            diff: toPng((x, y) => g(Math.abs(plateF[F(x, y)] - dQ[S(x, y)]) * 4)),
            cat: toPng((x, y) => { const c = cat[F(x, y)]; return c === 1 ? [220, 40, 40] : c === 2 ? [40, 200, 40] : c === 3 ? [50, 90, 255] : [0, 0, 0]; }),
            clone: toPng((x, y) => { const c = cat[F(x, y)]; if (!c) return [0, 0, 0]; return Math.abs(plateF[F(x, y)] - dQ[S(x, y)]) <= q ? [255, 220, 0] : [90, 90, 90]; }),
            disocc: toPng((x, y) => disocc[S(x, y)] ? [255, 255, 255] : [0, 0, 0]),
        };
    });
    if (res.err) { console.log('ERR ' + res.err); process.exit(1); }
    for (const k of ['src', 'plate', 'diff', 'cat', 'clone', 'disocc', 'core', 'core2'])
        fs.writeFileSync(path.join(OUT, 'audit_' + (k === 'src' ? 'depth_src' : k === 'plate' ? 'depth_plate' : k === 'diff' ? 'depth_diff' : k) + '.png'), Buffer.from(res[k].split(',')[1], 'base64'));
    const N = res.pw * res.ph, names = ['dropped', 'demand', 'collar', 'rim'];
    console.log('plate ' + res.pw + 'x' + res.ph + ', source quantum ' + res.q.toFixed(4) + ', fgTearStep ' + res.TS);
    for (let c = 0; c < 4; c++)
        console.log(names[c].padEnd(8) + String(res.cnt[c]).padStart(8) + ' texels (' + (100 * res.cnt[c] / N).toFixed(1) + '% of plate)' +
            '   at source depth (clone): ' + String(res.cloneN[c]).padStart(8) + ' (' + (100 * res.cloneN[c] / Math.max(1, res.cnt[c])).toFixed(1) + '%)' +
            '   departed: ' + String(res.departed[c]).padStart(8));
    const kept = res.cnt[1] + res.cnt[2] + res.cnt[3], keptClone = res.cloneN[1] + res.cloneN[2] + res.cloneN[3];
    console.log('KEPT ' + kept + ' texels; of these ' + keptClone + ' (' + (100 * keptClone / Math.max(1, kept)).toFixed(1) + '%) sit at the source depth = foreground clone');
    console.log('OCCLUDER CORE (naive flood from the band into nearer texels): ' + res.nCore + ' texels (' + (100 * res.nCore / N).toFixed(1) + '% of plate); ' +
        'of these the carve keeps ' + res.coreKept + ' (' + res.coreKeptClone + ' at source depth) and drops ' + res.coreDropped);
    console.log('OCCLUDER CORE (cliff-bounded, fold-limit continuity ~' + res.TS.toFixed(4) + ' depth/texel): ' + res.nCore2 + ' texels (' + (100 * res.nCore2 / N).toFixed(1) + '% of plate) in ' + (res.nComp - res.nRamp) + ' components; ' +
        res.nRamp + ' components rejected as attached ramps (' + res.rampTex + ' texels)');
    for (const c of res.comps) console.log('   ' + (c.ok ? 'CORE ' : 'ramp ') + String(c.n).padStart(7) + ' texels  x ' + c.bx0 + '-' + c.bx1 + '  y ' + c.by0 + '-' + c.by1 + ' (source rows, top-down)');
    if (res.hasGround) {
        fs.writeFileSync(path.join(OUT, 'audit_a62core.png'), Buffer.from(res.a62.split(',')[1], 'base64'));
        console.log('A62 FOOTPRINT: non-ground ' + res.nNonGround + ' texels (' + (100 * res.nNonGround / N).toFixed(1) + '% of plate) = band (disocc) ' + res.nObjBand +
            ' + UNREACHED OBJECT CORE ' + res.nObjCore + ' (' + (100 * res.nObjCore / N).toFixed(1) + '% of plate)');
        for (const c of res.objComps) console.log('   a62core ' + String(c.n).padStart(7) + ' texels  x ' + c.bx0 + '-' + c.bx1 + '  y ' + c.by0 + '-' + c.by1);
    } else console.log('A62 FOOTPRINT: no ground mask captured');
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
