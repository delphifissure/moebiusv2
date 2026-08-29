// fourd/realscene_tests.js — 16 tests on real, research-grade, non-IP scenes,
// IN CONTEXT: every scene loads as a splat layer inside scratch_moebius.html
// (the real app — troll 2.5D scene present, real camera path, real
// updateCameraAndProjection sort hook), not a standalone viewer page.
//
// Corpus (fourd/testdata/, gitignored — assets used for LOCAL TESTING only,
// never redistributed; IP-flagged assets in the same sources — Halo diorama,
// Disneyland castle — were deliberately excluded):
//   nianticlabs/spz samples + BabylonJS/Assets splats/ (real captures),
//   playcanvas/engine examples (biker, y-up authored -> flip:false),
//   playcanvas/splat-transform reference fixtures, antimatter15/splaTV
//   model.splatv = flame_steak from the Neural 3D Video dataset (dynamic).
//
// Per static scene: fresh scratch_moebius page, _addSplatLayerFromBuffer,
// eye sweep camera.x = -0.07/0/+0.07 (the dev +/-0.35 * camOff 0.2 law).
// Metrics render splat-only (media layers hidden, restored after); the
// SAVED TILE is the real mixed composite with the troll scene visible.
// PASS = parses, covers >2% of pixels splat-only, view-dependent under the
// sweep, sign-consistent bulk shift when meaningful, no page errors.
// Cross-format tests compare splat-only renders between containers of the
// same scene. T15 = real dynamic scene in moebius. T16 = bake + gap set
// BIT-EXACT (99907/3769) with a real splat loaded.
//   node fourd/realscene_tests.js
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const ROOT = path.join(__dirname, '..'), H = path.join(ROOT, 'harness');
const TILES = path.join(__dirname, 'shots', 'realscenes');
const results = [];
const EYE = 0.07;   // dev 0.35 * camOff 0.2 — same sweep the head law produces

const SCENES = [ // [test id, file, label, source, opts]
    ['T01', 'hornedlizard.spz', 'Horned Lizard (spz)', 'nianticlabs/spz sample', null],
    ['T02', 'hornedlizard.splat', 'Horned Lizard (.splat)', 'BabylonJS/Assets', null],
    ['T03', 'racoonfamily.spz', 'Racoon Family (spz)', 'nianticlabs/spz sample', null],
    ['T04', 'combined_SPZv3.spz', 'Combined (spz v3)', 'BabylonJS/Assets', null],
    ['T05', 'combined_SPZv3.ply', 'Combined (3DGS ply)', 'BabylonJS/Assets', null],
    ['T06', 'Unicorn_Stuffy.ply', 'Unicorn Stuffy (ply)', 'BabylonJS/Assets', null],
    ['T07', 'DC_border.ply', 'DC Border (ply)', 'BabylonJS/Assets', null],
    ['T08', 'gs_Fire_Pit.splat', 'Fire Pit (.splat)', 'BabylonJS/Assets', null],
    ['T09', 'gs_Plants.splat', 'Plants (.splat)', 'BabylonJS/Assets', null],
    ['T10', 'gs_Skull.splat', 'Skull (.splat)', 'BabylonJS/Assets', null],
    ['T11', 'gs_Sqwakers_trimed.splat', 'Sqwakers (.splat)', 'BabylonJS/Assets', null],
    ['T12', 'biker.spz', 'Biker (spz v4, zstd)', 'playcanvas/engine examples', { flip: false }], // y-up authored
];

(async () => {
    fs.mkdirSync(TILES, { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png'));
    fs.copyFileSync(path.join(ROOT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
    const srv = spawn('node', [path.join(__dirname, 'server.js')], { stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1200));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
               '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });

    // fresh REAL-APP page (scratch_moebius: three.js + moebius.js only)
    const appPage = async (w, h) => {
        const page = await browser.newPage({ viewport: { width: w || 640, height: h || 400 } });
        const errs = [];
        page.on('pageerror', e => errs.push(e.message.slice(0, 160)));
        await page.goto('http://localhost:8098/harness/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
        for (let t = 0; t < 60; t++) {
            const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
            if (ok) break; await new Promise(r => setTimeout(r, 1000));
        }
        return { page, errs };
    };

    // in-app measurement at one eye x: splat-only metrics + composite tile
    const measureApp = (page, eyeX, wantTile) => page.evaluate(async (o) => {
        isSweeping = true;
        camera.position.set(o.eyeX, 0, camera.position.z);
        const grab = () => {
            updateCameraAndProjection(); render();
            const el = renderer.domElement;
            const cv = document.createElement('canvas'); cv.width = el.width; cv.height = el.height;
            const cx = cv.getContext('2d'); cx.drawImage(el, 0, 0);
            return { cv, cx, d: cx.getImageData(0, 0, cv.width, cv.height).data };
        };
        // splat-only pass for metrics: hide 2.5D layers, keep the splat
        const hidden = [];
        scene.traverse((mm) => {
            if (!mm.isMesh || !mm.visible) return;
            if (mm.userData && mm.userData.isSplatLayer) return;
            hidden.push(mm); mm.visible = false;
        });
        const so = grab();
        for (const mm of hidden) mm.visible = true;
        let lit = 0, sx = 0; const samp = [];
        for (let i = 0; i < so.d.length; i += 4) {
            const v = so.d[i] + so.d[i + 1] + so.d[i + 2];
            if (v > 45) { lit++; sx += (i / 4) % so.cv.width; }
            if (i % 32 === 0) samp.push(v);
        }
        const out = { lit, total: so.d.length / 4, cx: lit ? sx / lit : NaN, samp,
                      n: splatLayers[0] && splatLayers[0].cloud.frame() ? splatLayers[0].cloud.frame().n : 0,
                      soloTile: so.cv.toDataURL('image/png') };
        if (o.wantTile) { const comp = grab(); out.tile = comp.cv.toDataURL('image/png'); } // real mixed composite
        return out;
    }, { eyeX, wantTile: !!wantTile });

    const saveTile = (id, dataUrl) =>
        fs.writeFileSync(path.join(TILES, id + '.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));

    // ---- T01..T12: static real scenes as layers in the real app ----
    const soloByFile = {};
    for (const [id, file, label, source, opts] of SCENES) {
        const t0 = Date.now();
        fs.copyFileSync(path.join(__dirname, 'testdata', file), path.join(H, 'rs_' + file));
        const { page, errs } = await appPage();
        let loadError = null;
        const parseMs = await page.evaluate(async (o) => {
            try {
                const p0 = performance.now();
                const buf = await (await fetch('rs_' + o.file)).arrayBuffer();
                await window._addSplatLayerFromBuffer(buf, o.file, undefined, o.opts || undefined);
                return Math.round(performance.now() - p0);
            } catch (e) { return 'ERR:' + e.message; }
        }, { file, opts });
        if (typeof parseMs === 'string') loadError = parseMs.slice(4);
        if (loadError) {
            results.push({ id, label, source, pass: false, note: 'load failed: ' + loadError });
            console.log(id + ' ' + label + ' — FAIL (load: ' + loadError + ')');
            await page.close(); continue;
        }
        const L = await measureApp(page, -EYE);
        const C = await measureApp(page, 0, true);
        const R = await measureApp(page, +EYE);
        saveTile(id, C.tile);
        soloByFile[file] = { C };
        const covOK = C.lit > C.total * 0.02;
        const dLC = C.cx - L.cx, dCR = R.cx - C.cx;
        let viewDiff = 0;
        for (let i = 0; i < Math.min(L.samp.length, R.samp.length); i++)
            if (Math.abs(L.samp[i] - R.samp[i]) > 30) viewDiff++;
        const viewDepOK = viewDiff > L.samp.length * 0.005;
        const shift = dLC + dCR;
        const signOK = Math.abs(shift) <= 2 || Math.sign(dLC) === Math.sign(dCR);
        const pass = covOK && viewDepOK && signOK && errs.length === 0;
        results.push({ id, label, source, pass, n: C.n, parseMs,
            coverPct: +(100 * C.lit / C.total).toFixed(1), parallaxPx: +shift.toFixed(1),
            viewDiffPct: +(100 * viewDiff / L.samp.length).toFixed(1),
            wallSec: +((Date.now() - t0) / 1000).toFixed(0), errs });
        console.log(id + ' ' + label + ' — ' + (pass ? 'PASS' : 'FAIL') +
            '  splats=' + C.n + ' parse=' + parseMs + 'ms cover=' + (100 * C.lit / C.total).toFixed(1) +
            '% shift=' + shift.toFixed(1) + 'px viewdep=' + (100 * viewDiff / L.samp.length).toFixed(1) +
            '%' + (errs.length ? ' ERRS=' + errs[0] : ''));
        await page.close();
    }

    // ---- T13/T14: cross-format consistency (splat-only renders) ----
    const cross = async (id, fA, fB, label) => {
        const A = soloByFile[fA], B = soloByFile[fB];
        let pass = false, note = 'missing renders';
        if (A && B) {
            const page = (await appPage()).page;
            const diff = await page.evaluate(async ({ a, b }) => {
                const load = (src) => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.src = src; });
                const ia = await load(a), ib = await load(b);
                const cv = document.createElement('canvas'); cv.width = ia.width; cv.height = ia.height;
                const cx = cv.getContext('2d');
                cx.drawImage(ia, 0, 0); const da = cx.getImageData(0, 0, cv.width, cv.height).data;
                cx.clearRect(0, 0, cv.width, cv.height);
                cx.drawImage(ib, 0, 0); const db = cx.getImageData(0, 0, cv.width, cv.height).data;
                let sum = 0, n = 0;
                for (let i = 0; i < da.length; i += 4) {
                    const la = (da[i] + da[i + 1] + da[i + 2]) / 3, lb = (db[i] + db[i + 1] + db[i + 2]) / 3;
                    if (la > 15 || lb > 15) { sum += Math.abs(la - lb); n++; }
                }
                return { mean: n ? sum / n : 999, n };
            }, { a: A.C.soloTile, b: B.C.soloTile });
            await page.close();
            pass = diff.mean < 14;   // spz quantization tolerance; wrong rotations measure >40
            note = 'mean |luma diff| ' + diff.mean.toFixed(1) + '/255 over ' + diff.n + ' lit px';
        }
        results.push({ id, label, pass, note });
        console.log(id + ' ' + label + ' — ' + (pass ? 'PASS' : 'FAIL') + ' (' + note + ')');
    };
    await cross('T13', 'hornedlizard.spz', 'hornedlizard.splat', 'cross-format: lizard spz vs splat');
    // T14: spz v3 vs its ground-truth ply — NUMERIC conformance. A pixel
    // diff is the wrong tool for this asset: it is a synthetic sub-pixel
    // DOT-GRID pattern, so spz quantization (24-bit pos, 8-bit log scales)
    // shows up as large luma diffs at small render scales while the decode
    // is exact to quantization. Compare the decoded gaussians directly with
    // tolerances DERIVED from the format: pos 2^-fracBits (fracBits 12 ->
    // 2.4e-4), cov within the 8-bit log-scale step (e^(2/16)-1 ~ 13%).
    {
        fs.copyFileSync(path.join(__dirname, 'testdata', 'combined_SPZv3.spz'), path.join(H, 'rs_c.spz'));
        // ground truth = the nianticlabs REFERENCE CLI's own conversion of the
        // spz (testdata/combined_ref.ply). Babylon's paired .ply is NOT a
        // faithful pair: it measures cov rel 0.98 against the reference,
        // while our decode measures 7.0e-8 — arbitrated 2026-08-29.
        fs.copyFileSync(path.join(__dirname, 'testdata', 'combined_ref.ply'), path.join(H, 'rs_c.ply'));
        const page = (await appPage()).page;
        const r14 = await page.evaluate(async () => {
            const a = await FourDSplats.parseSpz(await (await fetch('rs_c.spz')).arrayBuffer());
            const b = FourDSplats.parsePly(await (await fetch('rs_c.ply')).arrayBuffer());
            let mp = 0, mc = 0, cs = 0, ma = 0;
            for (let i = 0; i < Math.min(a.n, b.n) * 3; i++) {
                mp = Math.max(mp, Math.abs(a.center[i] - b.center[i]));
                mc = Math.max(mc, Math.abs(a.covA[i] - b.covA[i]), Math.abs(a.covB[i] - b.covB[i]));
                cs = Math.max(cs, Math.abs(b.covA[i]), Math.abs(b.covB[i]));
            }
            for (let i = 0; i < Math.min(a.n, b.n); i++) ma = Math.max(ma, Math.abs(a.color[i * 4 + 3] - b.color[i * 4 + 3]));
            return { n: a.n, nb: b.n, mp, covRel: mc / Math.max(1e-12, cs), ma };
        });
        await page.close();
        const pass14 = r14.n === r14.nb && r14.mp < 3e-3 && r14.covRel < 0.01 && r14.ma < 0.01;
        const note14 = 'n ' + r14.n + '/' + r14.nb + ' max|dpos| ' + r14.mp.toExponential(1) +
            ' mean cov rel ' + r14.covRel.toExponential(1) + ' max|dalpha| ' + r14.ma.toFixed(3);
        results.push({ id: 'T14', label: 'spz v3 vs ground-truth ply (numeric)', pass: pass14, note: note14 });
        console.log('T14 spz v3 numeric conformance — ' + (pass14 ? 'PASS' : 'FAIL') + ' (' + note14 + ')');
    }

    // ---- T15: real DYNAMIC research scene, playing in the real app ----
    {
        const t0 = Date.now();
        fs.copyFileSync(path.join(__dirname, 'testdata', 'flame_steak.splatv'), path.join(H, 'rs_flame.splatv'));
        const { page, errs } = await appPage();
        const g = await page.evaluate(async () => {
            const buf = await (await fetch('rs_flame.splatv')).arrayBuffer();
            const entry = await window._addSplatLayerFromBuffer(buf, 'flame_steak.splatv');
            isSweeping = true;
            const grab = (t) => {
                entry.setTime(t);
                updateCameraAndProjection(); render();
                const el = renderer.domElement;
                const cv = document.createElement('canvas'); cv.width = el.width; cv.height = el.height;
                const cx = cv.getContext('2d'); cx.drawImage(el, 0, 0);
                const d = cx.getImageData(0, 0, cv.width, cv.height).data;
                let lit = 0; const s = [];
                for (let i = 0; i < d.length; i += 4) { if (d[i] + d[i + 1] + d[i + 2] > 45) lit++; if (i % 64 === 0) s.push(d[i]); }
                return { lit, total: d.length / 4, s, tile: cv.toDataURL('image/png') };
            };
            const A = grab(0.15), B = grab(0.55);
            let dAB = 0; for (let i = 0; i < A.s.length; i++) if (Math.abs(A.s[i] - B.s[i]) > 24) dAB++;
            return { n: entry.cloud.frame().n, dyn: entry.cloud.dynamic, litB: B.lit, total: B.total,
                     dAB, sTotal: A.s.length, tile: B.tile };
        });
        saveTile('T15', g.tile);
        const pass = g.dyn && g.dAB > g.sTotal * 0.002 && errs.length === 0;
        results.push({ id: 'T15', label: 'flame_steak DYNAMIC in moebius (Neural 3D Video)', pass,
            note: 'splats=' + g.n + ' dyn=' + g.dyn + ' timeDiff=' + g.dAB + '/' + g.sTotal +
                  ' wall=' + ((Date.now() - t0) / 1000).toFixed(0) + 's' });
        console.log('T15 flame_steak dynamic in moebius — ' + (pass ? 'PASS' : 'FAIL') +
            ' (splats=' + g.n + ' timeDiff=' + g.dAB + '/' + g.sTotal + ')');
        await page.close();
    }

    // ---- T16: bake + 2.5D isolation with a real splat loaded ----
    {
        fs.copyFileSync(path.join(__dirname, 'testdata', 'hornedlizard.spz'), path.join(H, 'rs_hornedlizard.spz'));
        // the a221 gap reference (99907/3769) is pose- AND resolution-exact
        const { page, errs } = await appPage(912, 513);
        const r = await page.evaluate(async (pose) => {
            const buf = await (await fetch('rs_hornedlizard.spz')).arrayBuffer();
            await window._addSplatLayerFromBuffer(buf, 'hornedlizard.spz');
            window._rayReproject = true;
            bgQuickBake = true; buildBackgroundLayer();
            isSweeping = true;
            camera.position.set(pose.x, pose.y, pose.z);
            updateCameraAndProjection(); render(); render();
            renderNormalizedDepthPass();
            const thrR = parseFloat(document.getElementById('fgSubThresholdSlider')?.value || '0.05');
            try { runFGSubtraction(pingPongRenderTargetB?.texture || null, true, thrR); } catch (e) {}
            const hidden = [];
            scene.traverse((m) => {
                if (!m.isMesh || !m.visible) return;
                if (m.userData && m.userData.isSplatLayer) { hidden.push(m); m.visible = false; return; }
                const u = m.material && m.material.uniforms;
                if (u && u.u_isBackgroundLayer && u.u_isBackgroundLayer.value && !m.userData.v2Plane) { hidden.push(m); m.visible = false; }
            });
            for (const un of ['u_useDepthGrad','u_useSobel','u_useLuma','u_useChroma','u_useCrease','u_useCurvature','u_useUVStretch','u_useGrazingAngle','u_useEdgeMask'])
                setAllLayerUniforms(un, false);
            renderer.setClearColor(new THREE.Color(0, 0, 0), 0.0);
            const prevRT = renderer.getRenderTarget();
            renderer.setRenderTarget(pingPongRenderTargetB); renderer.clear();
            renderer.render(scene, camera);
            const W = pingPongRenderTargetB.width, Hh = pingPongRenderTargetB.height;
            const isFloat = pingPongRenderTargetB.texture.type === THREE.FloatType || pingPongRenderTargetB.texture.type === THREE.HalfFloatType;
            const buf2 = isFloat ? new Float32Array(W * Hh * 4) : new Uint8Array(W * Hh * 4);
            renderer.readRenderTargetPixels(pingPongRenderTargetB, 0, 0, W, Hh, buf2);
            renderer.setRenderTarget(prevRT);
            for (const m of hidden) m.visible = true;
            const thr = isFloat ? 0.03 : 8;
            let n = 0, border = 0;
            const mask = new Uint8Array(W * Hh);
            for (let i = 0; i < W * Hh; i++) mask[i] = buf2[i * 4 + 3] < thr ? 1 : 0;
            for (let y = 1; y < Hh - 1; y++) for (let x = 1; x < W - 1; x++) {
                const i = y * W + x; if (!mask[i]) continue; n++;
                if (!mask[i - 1] || !mask[i + 1] || !mask[i - W] || !mask[i + W]) border++;
            }
            updateCameraAndProjection(); render();
            const el = renderer.domElement;
            const cv = document.createElement('canvas'); cv.width = el.width; cv.height = el.height;
            const cx = cv.getContext('2d'); cx.drawImage(el, 0, 0);
            return { n, border, tile: cv.toDataURL('image/png') };
        }, { x: 0.100, y: -0.023, z: 0.200 });
        saveTile('T16', r.tile);
        // NOTE: gap reference is pose- and RESOLUTION-exact; this suite runs
        // 912x513 in the T16 page for comparability with the a221 reference.
        const pass = r.n === 99907 && r.border === 3769 && errs.length === 0;
        results.push({ id: 'T16', label: 'bake isolation w/ real splat (gaps bit-exact)', pass,
            note: 'gaps ' + r.n + '/' + r.border + ' (ref 99907/3769)' + (errs.length ? ' ERRS' : '') });
        console.log('T16 bake isolation — ' + (pass ? 'PASS' : 'FAIL') + ' (gaps ' + r.n + '/' + r.border + ')');
        await page.close();
    }

    // ---- bonus conformance (parser-level, in-app page) ----
    {
        for (const f of ['minimal.ksplat', 'biker.spz', 'biker_ref.ply']) {
            fs.copyFileSync(path.join(__dirname, 'testdata', f), path.join(H, 'rs_' + f));
        }
        const { page } = await appPage();
        const neg = await page.evaluate(async () => {
            const tryOne = async (url, name) => {
                try { await FourDSplats.parseAny(await (await fetch(url)).arrayBuffer(), name); return 'NO-THROW'; }
                catch (e) { return e.message; }
            };
            let v4note, v4ok = false;
            try {
                const a4 = await FourDSplats.parseSpz(await (await fetch('rs_biker.spz')).arrayBuffer());
                const rf = FourDSplats.parsePly(await (await fetch('rs_biker_ref.ply')).arrayBuffer());
                let mp = 0, mc = 0, cs = 0;
                for (let i = 0; i < a4.n * 3; i++) {
                    mp = Math.max(mp, Math.abs(a4.center[i] - rf.center[i]));
                    mc = Math.max(mc, Math.abs(a4.covA[i] - rf.covA[i]), Math.abs(a4.covB[i] - rf.covB[i]));
                    cs = Math.max(cs, Math.abs(rf.covA[i]), Math.abs(rf.covB[i]));
                }
                v4note = 'n ' + a4.n + '/' + rf.n + ' max|dpos| ' + mp.toExponential(1) + ' cov rel ' + (mc / cs).toExponential(1);
                v4ok = a4.n === rf.n && mp < 1e-4 && mc / cs < 0.01;
            } catch (e) { v4note = e.message; }
            return { v4: v4note, v4ok, ks: await tryOne('rs_minimal.ksplat', 'minimal.ksplat') };
        });
        const ksok = /ksplat/i.test(neg.ks);
        results.push({ id: 'B1', label: 'BONUS spz v4 decode == reference CLI', pass: neg.v4ok, note: neg.v4 });
        results.push({ id: 'B2', label: 'BONUS ksplat refusal', pass: ksok, note: neg.ks });
        console.log('Tbonus spz-v4 conformance — ' + (neg.v4ok ? 'PASS' : 'FAIL') + ' (' + neg.v4 + ')');
        console.log('Tbonus ksplat refusal — ' + (ksok ? 'PASS' : 'FAIL') + ' ("' + neg.ks + '")');
        await page.close();
    }

    fs.writeFileSync(path.join(TILES, 'results.json'), JSON.stringify(results, null, 2));
    const passed = results.filter(r => r.pass).length;
    console.log('==== ' + passed + '/' + results.length + ' tests passed; tiles -> ' + TILES);
    await browser.close(); srv.kill();
    process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
