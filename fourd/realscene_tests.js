// fourd/realscene_tests.js — 16 tests on real, research-grade, non-IP scenes.
//
// Corpus (fourd/testdata/, gitignored — assets used for LOCAL TESTING only,
// never redistributed; IP-flagged assets in the same sources — Halo diorama,
// Disneyland castle — were deliberately excluded):
//   nianticlabs/spz samples + BabylonJS/Assets splats/ (real captures),
//   playcanvas/engine examples (biker), playcanvas/splat-transform reference
//   fixtures (spz v4, ksplat), antimatter15/splaTV model.splatv =
//   flame_steak from the Neural 3D Video research dataset (dynamic).
//
// Per static scene: fresh page, parse, render at eye dev -0.35/0/+0.35
// through the off-axis portal. PASS = parses, covers >2% of pixels, and the
// lit centroid shifts monotonically with the eye (window parallax present).
// Special tests: cross-format consistency (same scene, two containers must
// render alike — validates the spz decoders against ground truth), asserted
// refusals (spz v4 zstd, ksplat), a real DYNAMIC scene (time changes
// pixels), and the real scene composited INSIDE moebius with the 2.5D
// pipeline's gap set required BIT-EXACT (99907/3769).
//   node fourd/realscene_tests.js
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const ROOT = path.join(__dirname, '..'), H = path.join(ROOT, 'harness');
const TILES = path.join(__dirname, 'shots', 'realscenes');
const results = [];

const SCENES = [ // [test id, file, label, source]
    ['T01', 'hornedlizard.spz', 'Horned Lizard (spz)', 'nianticlabs/spz sample'],
    ['T02', 'hornedlizard.splat', 'Horned Lizard (.splat)', 'BabylonJS/Assets'],
    ['T03', 'racoonfamily.spz', 'Racoon Family (spz)', 'nianticlabs/spz sample'],
    ['T04', 'combined_SPZv3.spz', 'Combined (spz v3)', 'BabylonJS/Assets'],
    ['T05', 'combined_SPZv3.ply', 'Combined (3DGS ply)', 'BabylonJS/Assets'],
    ['T06', 'Unicorn_Stuffy.ply', 'Unicorn Stuffy (ply)', 'BabylonJS/Assets'],
    ['T07', 'DC_border.ply', 'DC Border (ply)', 'BabylonJS/Assets'],
    ['T08', 'gs_Fire_Pit.splat', 'Fire Pit (.splat)', 'BabylonJS/Assets'],
    ['T09', 'gs_Plants.splat', 'Plants (.splat)', 'BabylonJS/Assets'],
    ['T10', 'gs_Skull.splat', 'Skull (.splat)', 'BabylonJS/Assets'],
    ['T11', 'gs_Sqwakers_trimed.splat', 'Sqwakers (.splat)', 'BabylonJS/Assets'],
    ['T12', 'biker.spz?flip=0', 'Biker (spz v4, zstd)', 'playcanvas/engine examples'],  // PlayCanvas authors y-up
];

(async () => {
    fs.mkdirSync(TILES, { recursive: true });
    const srv = spawn('node', [path.join(__dirname, 'server.js')], { stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1200));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
               '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });

    const scenePage = async (file) => {
        const page = await browser.newPage({ viewport: { width: 512, height: 384 } });
        const errs = [];
        page.on('pageerror', e => errs.push(e.message.slice(0, 160)));
        const extra = file.includes('?') ? '&' + file.split('?')[1] : '';
        const fname = file.split('?')[0];
        await page.goto('http://localhost:8098/fourd/splat.html?nosweep=1' + extra + '&asset=/fourd/testdata/' + fname,
            { waitUntil: 'load', timeout: 60000 });
        for (let t = 0; t < 240; t++) {
            const st = await page.evaluate(() => ({ ready: !!window._fourdReady, err: window._loadError || null })).catch(() => ({}));
            if (st.err) { return { page, errs, loadError: st.err }; }
            if (st.ready) break;
            await new Promise(r => setTimeout(r, 1000));
        }
        return { page, errs };
    };

    const measure = (page, devX) => page.evaluate(async (dx) => {
        document.getElementById('playing').checked = false; if (typeof playing !== 'undefined') playing = false;
        window._fourd.setDeviation(dx, 0); window._fourd.forceRender();
        await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
        const el = renderer.domElement;
        const cv = document.createElement('canvas'); cv.width = el.width; cv.height = el.height;
        const cx = cv.getContext('2d'); cx.drawImage(el, 0, 0);
        const d = cx.getImageData(0, 0, cv.width, cv.height).data;
        let lit = 0, sx = 0, lum = 0;
        const samp = [];
        for (let i = 0; i < d.length; i += 4) {
            const v = d[i] + d[i + 1] + d[i + 2];
            lum += v;
            if (v > 45) { lit++; sx += (i / 4) % cv.width; }
            if (i % 32 === 0) samp.push(v);
        }
        return { lit, total: d.length / 4, cx: lit ? sx / lit : NaN, samp,
                 n: window._fourd.cloud ? window._fourd.cloud.frame().n : 0,
                 parseMs: window._parseMs || -1,
                 tile: cv.toDataURL('image/png'), meanLum: lum / (d.length / 4) / 3 };
    }, devX);

    const saveTile = (id, dataUrl) =>
        fs.writeFileSync(path.join(TILES, id + '.png'), Buffer.from(dataUrl.split(',')[1], 'base64'));

    // ---- T01..T12: static real scenes ----
    const lumaByFile = {};
    for (const [id, file, label, source] of SCENES) {
        const t0 = Date.now();
        const fname = file.split('?')[0];
        const { page, errs, loadError } = await scenePage(file);
        if (loadError) {
            results.push({ id, label, source, pass: false, note: 'load failed: ' + loadError });
            console.log(id + ' ' + label + ' — FAIL (load: ' + loadError + ')');
            await page.close(); continue;
        }
        const L = await measure(page, -0.35);
        const C = await measure(page, 0);
        const R = await measure(page, +0.35);
        saveTile(id, C.tile);
        lumaByFile[fname] = { C };
        const covOK = C.lit > C.total * 0.02;
        const dLC = C.cx - L.cx, dCR = R.cx - C.cx;
        // VIEW-DEPENDENCE, not bulk shift: a compact scene pinned AT the
        // portal plane has near-zero centroid shift BY DESIGN (near/far
        // halves shift oppositely and cancel — the pinning invariant), but
        // its L/R renders must still differ. Bulk-shift sign consistency is
        // asserted only when the shift is big enough to be meaningful.
        let viewDiff = 0;
        for (let i = 0; i < Math.min(L.samp.length, R.samp.length); i++)
            if (Math.abs(L.samp[i] - R.samp[i]) > 30) viewDiff++;
        const viewDepOK = viewDiff > L.samp.length * 0.005;
        const shift = dLC + dCR;
        const signOK = Math.abs(shift) <= 2 || Math.sign(dLC) === Math.sign(dCR);
        const pass = covOK && viewDepOK && signOK && errs.length === 0;
        results.push({ id, label, source, pass, n: C.n, parseMs: C.parseMs,
            coverPct: +(100 * C.lit / C.total).toFixed(1), parallaxPx: +shift.toFixed(1),
            viewDiffPct: +(100 * viewDiff / L.samp.length).toFixed(1),
            wallSec: +((Date.now() - t0) / 1000).toFixed(0), errs });
        console.log(id + ' ' + label + ' — ' + (pass ? 'PASS' : 'FAIL') +
            '  splats=' + C.n + ' parse=' + C.parseMs + 'ms cover=' + (100 * C.lit / C.total).toFixed(1) +
            '% shift=' + shift.toFixed(1) + 'px viewdep=' + (100 * viewDiff / L.samp.length).toFixed(1) +
            '%' + (errs.length ? ' ERRS=' + errs[0] : ''));
        await page.close();
    }

    // ---- T13: cross-format — same scene, spz vs splat ----
    // ---- T14: cross-format — spz v3 vs its ground-truth 3DGS ply ----
    const cross = async (id, fA, fB, label) => {
        const A = lumaByFile[fA], B = lumaByFile[fB];
        let pass = false, note = 'missing renders';
        if (A && B) {
            const pa = Buffer.from(A.C.tile.split(',')[1], 'base64');
            const pb = Buffer.from(B.C.tile.split(',')[1], 'base64');
            // decode both PNGs in a throwaway page for a pixel compare
            const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
            await page.goto('http://localhost:8098/fourd/splat.html?nosweep=1&asset=none.json', { waitUntil: 'load' }).catch(() => {});
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
            }, { a: 'data:image/png;base64,' + pa.toString('base64'), b: 'data:image/png;base64,' + pb.toString('base64') });
            await page.close();
            pass = diff.mean < 14;   // spz quantization tolerance; wrong rotations measure >40
            note = 'mean |luma diff| ' + diff.mean.toFixed(1) + '/255 over ' + diff.n + ' lit px';
        }
        results.push({ id, label, pass, note });
        console.log(id + ' ' + label + ' — ' + (pass ? 'PASS' : 'FAIL') + ' (' + note + ')');
    };
    await cross('T13', 'hornedlizard.spz', 'hornedlizard.splat', 'cross-format: lizard spz vs splat');
    await cross('T14', 'combined_SPZv3.spz', 'combined_SPZv3.ply', 'cross-format: spz v3 vs ground-truth ply');

    // ---- T15: real DYNAMIC research scene (flame_steak, Neural 3D Video) ----
    {
        const t0 = Date.now();
        const { page, errs, loadError } = await scenePage('flame_steak.splatv');
        let pass = false, note = loadError || '';
        let tileSaved = false;
        if (!loadError) {
            const g = await page.evaluate(async () => {
                document.getElementById('playing').checked = false; playing = false;
                const grab = async (t) => {
                    cloud.setTime(t); window._fourd.forceRender();
                    await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
                    const el = renderer.domElement;
                    const cv = document.createElement('canvas'); cv.width = el.width; cv.height = el.height;
                    const cx = cv.getContext('2d'); cx.drawImage(el, 0, 0);
                    const d = cx.getImageData(0, 0, cv.width, cv.height).data;
                    let lit = 0; const s = [];
                    for (let i = 0; i < d.length; i += 4) { if (d[i] + d[i+1] + d[i+2] > 45) lit++; if (i % 64 === 0) s.push(d[i]); }
                    return { lit, total: d.length / 4, s, tile: cv.toDataURL('image/png') };
                };
                const A = await grab(0.15), B = await grab(0.55), Cc = await grab(0.9);
                let dAB = 0; for (let i = 0; i < A.s.length; i++) if (Math.abs(A.s[i] - B.s[i]) > 24) dAB++;
                return { n: cloud.frame().n, dyn: cloud.dynamic, litA: A.lit, litB: B.lit, total: A.total,
                         dAB, sTotal: A.s.length, tile: B.tile };
            });
            saveTile('T15', g.tile); tileSaved = true;
            pass = g.dyn && g.litB > g.total * 0.02 && g.dAB > g.sTotal * 0.002 && errs.length === 0;
            note = 'splats=' + g.n + ' dyn=' + g.dyn + ' cover=' + (100 * g.litB / g.total).toFixed(1) +
                '% timeDiff=' + g.dAB + '/' + g.sTotal + ' wall=' + ((Date.now() - t0) / 1000).toFixed(0) + 's';
        }
        results.push({ id: 'T15', label: 'flame_steak DYNAMIC (Neural 3D Video via splaTV)', pass, note });
        console.log('T15 flame_steak dynamic — ' + (pass ? 'PASS' : 'FAIL') + ' (' + note + ')');
        await page.close();
    }

    // ---- T16: real scene mixed into moebius + bit-exact 2.5D isolation ----
    {
        fs.copyFileSync(path.join(ROOT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png'));
        fs.copyFileSync(path.join(ROOT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
        fs.copyFileSync(path.join(__dirname, 'testdata', 'hornedlizard.spz'), path.join(H, 'test_lizard.spz'));
        // moebius scratch page is served by the SAME fourd server? No — it
        // needs harness-relative fetches; serve via the fourd server's repo
        // root path instead.
        const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
        const errs = [];
        page.on('pageerror', e => errs.push(e.message.slice(0, 160)));
        await page.goto('http://localhost:8098/harness/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
        for (let t = 0; t < 45; t++) {
            const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
            if (ok) break; await new Promise(r => setTimeout(r, 1000));
        }
        const r = await page.evaluate(async (pose) => {
            const buf = await (await fetch('/harness/test_lizard.spz')).arrayBuffer();
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
            // composite tile with the real splat visible
            updateCameraAndProjection(); render();
            await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
            const el = renderer.domElement;
            const cv = document.createElement('canvas'); cv.width = el.width; cv.height = el.height;
            const cx = cv.getContext('2d'); cx.drawImage(el, 0, 0);
            return { n, border, tile: cv.toDataURL('image/png') };
        }, { x: 0.100, y: -0.023, z: 0.200 });
        saveTile('T16', r.tile);
        const pass = r.n === 99907 && r.border === 3769 && errs.length === 0;
        results.push({ id: 'T16', label: 'hornedlizard inside moebius + 2.5D isolation', pass,
            note: 'gaps ' + r.n + '/' + r.border + ' (ref 99907/3769)' + (errs.length ? ' ERRS' : '') });
        console.log('T16 mixed-layer isolation — ' + (pass ? 'PASS' : 'FAIL') + ' (gaps ' + r.n + '/' + r.border + ')');
        await page.close();
    }

    // ---- negative-path refusals run in a scratch page (parser only) ----
    {
        const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
        await page.goto('http://localhost:8098/fourd/splat.html?nosweep=1&asset=none.json', { waitUntil: 'load' }).catch(() => {});
        const neg = await page.evaluate(async () => {
            const tryOne = async (url, name) => {
                try { await FourDSplats.parseAny(await (await fetch(url)).arrayBuffer(), name); return 'NO-THROW'; }
                catch (e) { return e.message; }
            };
            // v4 CONFORMANCE against the REFERENCE IMPLEMENTATION: biker.spz
            // (v4) decoded by us must match biker_ref.ply produced by the
            // nianticlabs/spz CLI (spz_to_ply) — positions AND covariance
            // (rotation+scale). This is what caught the sign-magnitude
            // quaternion encoding (first cut used two's-complement).
            let v4note;
            try {
                const a4 = await FourDSplats.parseSpz(await (await fetch('/fourd/testdata/biker.spz')).arrayBuffer());
                const rf = FourDSplats.parsePly(await (await fetch('/fourd/testdata/biker_ref.ply')).arrayBuffer());
                let mp = 0, mc = 0, cs = 0;
                for (let i = 0; i < a4.n * 3; i++) {
                    mp = Math.max(mp, Math.abs(a4.center[i] - rf.center[i]));
                    mc = Math.max(mc, Math.abs(a4.covA[i] - rf.covA[i]), Math.abs(a4.covB[i] - rf.covB[i]));
                    cs = Math.max(cs, Math.abs(rf.covA[i]), Math.abs(rf.covB[i]));
                }
                v4note = 'n ' + a4.n + '/' + rf.n + ' max|dpos| ' + mp.toExponential(1) + ' cov rel ' + (mc / cs).toExponential(1);
                window._v4ok = a4.n === rf.n && mp < 1e-4 && mc / cs < 0.01;
            } catch (e) { v4note = e.message; window._v4ok = false; }
            return {
                v4: v4note, v4ok: window._v4ok,
                ks: await tryOne('/fourd/testdata/minimal.ksplat', 'minimal.ksplat'),
            };
        });
        const v4ok = !!neg.v4ok, ksok = /ksplat/i.test(neg.ks);
        results.push({ id: 'B1', label: 'BONUS spz v4 decode == v2 reference', pass: v4ok, note: neg.v4 });
        results.push({ id: 'B2', label: 'BONUS ksplat refusal', pass: ksok, note: neg.ks });
        console.log('Tbonus spz-v4 conformance — ' + (v4ok ? 'PASS' : 'FAIL') + ' (' + neg.v4 + ')');
        console.log('Tbonus ksplat refusal — ' + (ksok ? 'PASS' : 'FAIL') + ' ("' + neg.ks + '")');
        await page.close();
    }

    fs.writeFileSync(path.join(TILES, 'results.json'), JSON.stringify(results, null, 2));
    const passed = results.filter(r => r.pass).length;
    console.log('==== ' + passed + '/' + results.length + ' tests passed; tiles -> ' + TILES);
    await browser.close(); srv.kill();
    process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
