// S59 sheet A/B (S37 Phase C, stopping rule second edition). One bake with the start-up defaults, then three arms that
// differ only in the band texels' depth (A: the app's own plate, untouched; B, C: fieldB.f32 / fieldC.f32 from
// sheet_ab_fields.py written into the plate's displacement texture), all three with the SAME wash (wash.png, written
// into the plate's own colour canvas on band texels only) and plate 2 hidden. Shoots the rule's poses per arm and saves
// the plate's band depth as rendered (plate_<arm>.f32, source rows) for the relief view.
//   COLOR= DEPTH= DUMP=<streakclass dump> FIELDS=<sheet_ab_fields out> TAG= node harness/sheet_ab.js
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const H = __dirname, WT = path.resolve(__dirname, '..'); const TAG = process.env.TAG || 'ab'; const OUT = path.join(H, 'shots', 'sheet_ab', TAG); fs.mkdirSync(OUT, { recursive: true });
const Z = 0.2, T = (deg) => Z * Math.tan(deg * Math.PI / 180);
// the rule's poses: decision +-42 deg (x = +-0.180, y = 0.008, the "p45" of every S35/S53 frame), context 22.5 deg yaw, 30 deg pitch
const POSES = [['yawR42', 0.180, 0.008], ['yawL42', -0.180, 0.008], ['yaw22', T(22.5), 0], ['pitch30', 0, T(30)]];
(async () => {
    fs.copyFileSync(path.resolve(WT, process.env.COLOR || 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, process.env.DEPTH || 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
    await page.evaluate(() => document.getElementById('bgLayerBuildBtn').click());
    for (let t = 0; t < 320; t++) { if (await page.evaluate(() => !!window._bgQuickBaked && !!window._qbPlateF)) break; await new Promise(r => setTimeout(r, 1000)); }
    // guard: the bake's band is the dump's band (same app, same inputs), and the plate's band values are the dump's far field
    const disD = fs.readFileSync(path.join(process.env.DUMP, 'disocc.u8')).toString('base64');
    const ffD = fs.readFileSync(path.join(process.env.DUMP, 'farField.f32')).toString('base64');
    const g = await page.evaluate(([a, b]) => {
        const dec = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
        const dis0 = dec(a), ff0 = new Float32Array(dec(b).buffer); const { pw, ph } = window._qbSize; const N = pw * ph; const dis = window._qbDisocc;
        const tex = bgLayerMesh.material.uniforms.displacementMap.value.image.data;
        // the dump's band (streak_class.js) is the app's band where the law's fill lies behind the source depth; the rest of
        // _qbDisocc keeps its own depth (nothing is revealed there) and is left as baked on every arm
        let mis = 0, extra = 0, nb = 0, mx = 0; for (let i = 0; i < N; i++) { if (dis0[i] && !dis[i]) mis++; if (dis[i] && !dis0[i]) extra++; if (dis0[i]) { nb++; const x = i % pw, y = (i - x) / pw; mx = Math.max(mx, Math.abs(tex[(ph - 1 - y) * pw + x] - ff0[i])); } }
        window._abBand = dis0;
        window._abOrig = new Float32Array(tex);   // arm A, as baked
        const p2 = bgLayerMesh.userData && bgLayerMesh.userData.plate2; if (p2) p2.visible = false;
        return { pw, ph, band: nb, bandMismatch: mis, appBandOutsideDump: extra, plateVsDumpFarFieldMax: mx, plate2: !!p2, colourCanvas: !!(bgLayerMesh.material.uniforms.map.value.image && bgLayerMesh.material.uniforms.map.value.image.getContext) };
    }, [disD, ffD]);
    console.log('guard ' + JSON.stringify(g));
    if (g.bandMismatch) { console.log('ABORT: the dump band is not inside the bake band'); process.exit(2); }
    if (!g.colourCanvas) { console.log('ABORT: no plate colour canvas'); process.exit(2); }
    // PHASE=rims: dump the per-line law's own far rims (two candidates per texel and their weights) for sheet_ab_fields.py
    if (process.env.PHASE === 'rims') {
        const r = await page.evaluate(() => {
            const { pw, ph } = window._qbSize; const N = pw * ph; const J = window._geoFarRimJ, W = window._geoFarRimW;
            if (!J || !W || J.length !== 2 * N || W.length !== 2 * N) return { error: 'rims ' + (J && J.length) + ' ' + (W && W.length) + ' vs ' + 2 * N };
            const enc = (ta) => { const u8 = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength); let s = ''; const CH = 1 << 15; for (let k = 0; k < u8.length; k += CH) s += String.fromCharCode.apply(null, u8.subarray(k, k + CH)); return btoa(s); };
            return { J: enc(Int32Array.from(J)), W: enc(Float32Array.from(W)) };
        });
        if (r.error) { console.log('ABORT ' + r.error); process.exit(2); }
        fs.mkdirSync(process.env.FIELDS, { recursive: true });
        fs.writeFileSync(path.join(process.env.FIELDS, 'rimJ.i32'), Buffer.from(r.J, 'base64')); fs.writeFileSync(path.join(process.env.FIELDS, 'rimW.f32'), Buffer.from(r.W, 'base64'));
        fs.writeFileSync(path.join(process.env.FIELDS, 'rims_guard.json'), JSON.stringify(g)); console.log('rims written'); await browser.close(); srv.kill(); process.exit(0);
    }
    // the wash, band texels only, into the plate's own colour canvas (as the Sprint 25 return path writes colour)
    const wash = fs.readFileSync(path.join(process.env.FIELDS, 'wash.png')).toString('base64');
    const wc = await page.evaluate(async (b64) => {
        const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
        const { pw, ph } = window._qbSize; if (img.width !== pw || img.height !== ph) return { error: 'wash size' };
        const cv = document.createElement('canvas'); cv.width = pw; cv.height = ph; const c2 = cv.getContext('2d'); c2.drawImage(img, 0, 0); const w = c2.getImageData(0, 0, pw, ph).data;
        const mp = bgLayerMesh.material.uniforms.map; const cx = mp.value.image.getContext('2d'); const id = cx.getImageData(0, 0, pw, ph); const d = id.data; const dis = window._abBand;
        let n = 0; for (let i = 0; i < pw * ph; i++) if (dis[i]) { d[4 * i] = w[4 * i]; d[4 * i + 1] = w[4 * i + 1]; d[4 * i + 2] = w[4 * i + 2]; d[4 * i + 3] = 255; n++; }
        cx.putImageData(id, 0, 0); mp.value.needsUpdate = true; return { washTexels: n };
    }, wash);
    console.log('wash ' + JSON.stringify(wc));
    const shot = async (name) => { const b64 = await page.evaluate(() => { updateCameraAndProjection(); render(); updateCameraAndProjection(); render(); return renderer.domElement.toDataURL('image/png').split(',')[1]; }); fs.writeFileSync(path.join(OUT, name), Buffer.from(b64, 'base64')); };
    const report = { guard: g, wash: wc, arms: {} };
    for (const arm of ['A', 'B', 'C']) {
        const b64 = arm === 'A' ? null : fs.readFileSync(path.join(process.env.FIELDS, 'field' + arm + '.f32')).toString('base64');
        const info = await page.evaluate((b64) => {
            const { pw, ph } = window._qbSize; const N = pw * ph; const dis = window._abBand; const tex = bgLayerMesh.material.uniforms.displacementMap.value; const data = tex.image.data;
            data.set(window._abOrig);
            let ff = null; if (b64) { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); ff = new Float32Array(u.buffer); if (ff.length !== N) return { error: 'size' }; }
            let n = 0; if (ff) for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const i = y * pw + x; if (!dis[i]) continue; data[(ph - 1 - y) * pw + x] = ff[i]; n++; }
            tex.needsUpdate = true;
            // the tear index is the bake's (per-line field): count the rim-law decisions this arm's field would change (Sprint 25's instrument)
            const src = new Float32Array(N); for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) src[y * pw + x] = data[(ph - 1 - y) * pw + x];
            const orig = new Float32Array(N); for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) orig[y * pw + x] = window._abOrig[(ph - 1 - y) * pw + x];
            let flipped = 0, pairs = 0; try { const rl = bgRimLawFor(pw, ph);
                for (let i = 0; i < N; i++) { const x = i % pw, y = (i - x) / pw; for (const j of [x < pw - 1 ? i + 1 : -1, y < ph - 1 ? i + pw : -1]) { if (j < 0 || !(dis[i] || dis[j])) continue; pairs++; if (rl.joined(orig[i], orig[j]) !== rl.joined(src[i], src[j])) flipped++; } } } catch (e) { flipped = -1; }
            let s = ''; const CH = 1 << 15; const u8 = new Uint8Array(src.buffer); for (let k = 0; k < u8.length; k += CH) s += String.fromCharCode.apply(null, u8.subarray(k, k + CH));
            return { replaced: n, retear: { pairs, decisionsChanged: flipped }, plate: btoa(s) };
        }, b64);
        if (info.error) { console.log('ABORT ' + arm + ' ' + info.error); process.exit(2); }
        fs.writeFileSync(path.join(OUT, 'plate_' + arm + '.f32'), Buffer.from(info.plate, 'base64')); delete info.plate;
        report.arms[arm] = info; console.log(arm + ' ' + JSON.stringify(info));
        for (const [n, x, y] of POSES) { await page.evaluate(([x, y]) => { isSweeping = true; camera.position.set(x, y, 0.2); }, [x, y]); await shot(arm + '_' + n + '.png'); }
    }
    // guard (rule 7): arms must diverge downstream -- compare the decision frames
    fs.writeFileSync(path.join(OUT, 'render.json'), JSON.stringify(report, null, 1));
    await browser.close(); srv.kill(); console.log('done ' + OUT);
})();
