// S62: the source-anchored hole solved in a Web Worker. Bakes one picture in source mode and checks
//   (1) the worker's plate / hole / wash against bgSourceHole run on the main thread on the same inputs (must be identical),
//   (2) how long the page stopped drawing while the hole solved (a 50 ms heartbeat's largest gap, worker vs main thread),
//   (3) the SD-regions tint reads the hole (u_sdPaint texels set == hole texels), with a screenshot at yaw +42.
//   COLOR= DEPTH= TAG= [PORT=8099] [NOWORKER=1] [SEL='{"bgPlateSkySel":"on"}'] [BUNDLE=1] [RETURN=<dir>] node harness/srchole_worker_check.js
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const H = __dirname, PORT = +(process.env.PORT || 8099); const OUT = path.join(__dirname, 'shots', 'srchole_worker', process.env.TAG || 'x'); fs.mkdirSync(OUT, { recursive: true });
const WT = path.resolve(__dirname, '..');
(async () => {
    fs.copyFileSync(path.resolve(WT, process.env.COLOR || 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, process.env.DEPTH || 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(PORT) }) }); await new Promise(r => setTimeout(r, 1500));
    { const r = await fetch('http://localhost:' + PORT + '/__root').then(x => x.text()).catch(() => ''); if (r !== H) { console.error('ABORT: port ' + PORT + ' is served from ' + (r.slice(0, 80) || 'nothing') + ', not this tree (' + H + ')'); srv.kill(); process.exit(4); } }
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } }); const logs = [];
    page.on('console', m => { const t = m.text(); if (/\[S62\]/.test(t)) logs.push(t.slice(0, 600)); });
    page.on('pageerror', e => logs.push('PAGEERR ' + e.message.slice(0, 300)));
    await page.goto('http://localhost:' + PORT + '/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth && mediaLayers[0]._depth16); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
    await page.evaluate(([noW, sel]) => {
        try { localStorage.clear(); } catch (e) {}
        if (noW) window.Worker = undefined;
        if (sel.__depth) { const dm = sel.__depth; if (dm.outer !== undefined) outerVolumeDepth = dm.outer; if (dm.inner !== undefined) innerVolumeDepth = dm.inner; if (dm.pn !== undefined) currentNormPortalPlane = dm.pn; delete sel.__depth; }
        const fS = bgSourceHoleInWorker, fF = bgFinishSourceHole;
        bgSourceHoleInWorker = function (o) { window._tSolve0 = performance.now(); return fS(o); };
        bgFinishSourceHole = function (r, c) { window._tSolve1 = performance.now(); return fF(r, c); };
        window._hb = []; setInterval(() => window._hb.push(performance.now()), 50);
        window._tl = []; for (const k of ['log', 'warn']) { const f = console[k].bind(console); console[k] = (...a) => { try { window._tl.push([performance.now(), String(a[0]).slice(0, 90)]); } catch (e) {} return f(...a); }; }
        for (const [id, v] of Object.entries(Object.assign({ bgPlateHoleSel: 'source', bgPlateRampSel: 'off' }, sel))) { const el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('change')); } }
    }, [!!process.env.NOWORKER, Object.assign(JSON.parse(process.env.SEL || '{}'), process.env.DEPTH_OUTER ? { __depth: { outer: +process.env.DEPTH_OUTER, inner: +(process.env.DEPTH_INNER || 0.0001), pn: +(process.env.DEPTH_PN || 0.5) } } : {})]);
    const t0 = Date.now(); await page.evaluate(() => document.getElementById('bgLayerBuildBtn').click());
    for (let t = 0; t < 1600; t++) { if (await page.evaluate(() => !!window._bgQuickBaked && !!window._qbPlateF && !!window._qbSourceHole)) break; await new Promise(r => setTimeout(r, 500)); }
    const bakeMs = Date.now() - t0;
    const res = await page.evaluate(() => {
        const hb = window._hb, a = window._tSolve0, b = window._tSolve1; let gap = 0, gapAll = 0;
        for (let k = 1; k < hb.length; k++) { const g = hb[k] - hb[k - 1]; if (hb[k] > a && hb[k - 1] < b + 50) gap = Math.max(gap, g); gapAll = Math.max(gapAll, g); }
        // the same inputs on the main thread
        const { pw, ph } = window._qbSize, N = pw * ph, dQ = window._qbDQ, L = mediaLayers[0];
        const cImg = (L.elements && L.elements.color) || L.textures.color.image; const cv = document.createElement('canvas'); cv.width = pw; cv.height = ph; const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(cImg, 0, 0, pw, ph);
        const rgba = cx.getImageData(0, 0, pw, ph).data, rgb = new Uint8ClampedArray(3 * N); for (let i = 0; i < N; i++) { rgb[3 * i] = rgba[4 * i]; rgb[3 * i + 1] = rgba[4 * i + 1]; rgb[3 * i + 2] = rgba[4 * i + 2]; }
        const rl = bgRimLawFor(pw, ph), lut = bgShiftLUTFor(pw, ph), step = 1 / Math.max(1e-6, Math.max(Math.abs(lut.m0), Math.abs(lut.m1)));
        const D = Math.max(1e-3, Math.abs(camera.position.z - portalPlaneWorldZ)), layerW = (pw / ph > terrariumWidth / terrariumHeight) ? terrariumWidth : terrariumHeight * pw / ph;
        const tM = performance.now(); const r = bgSourceHole({ dQ, rgb, pw, ph, rl, step, D, layerW, tol: 1e-8 }); const msMain = performance.now() - tM;
        const hole = window._qbSrcHole, pF = window._qbPlateF, pc = window._qbPlateColor; let dh = 0, dp = 0, dw = 0, nh = 0;
        for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const i = y * pw + x; if (!!hole[i] !== !!r.hole[i]) dh++; if (r.hole[i]) nh++; if (pF[(ph - 1 - y) * pw + x] !== r.plate[i]) dp++; for (let c = 0; c < 3; c++) if (pc[4 * i + c] !== r.wash[3 * i + c]) { dw++; break; } }
        const pt = bgLayerMesh.material.uniforms.u_sdPaint.value, pd = pt && pt.image && pt.image.data; let np = 0, pdiff = 0;
        if (pd) for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const v = pd[(ph - 1 - y) * pw + x] > 0.5; if (v) np++; if (v !== !!hole[y * pw + x]) pdiff++; }
        const fgSame = mediaLayers[0].mesh.material.uniforms.u_sdPaint && mediaLayers[0].mesh.material.uniforms.u_sdPaint.value === pt;
        const gaps = []; for (let k = 1; k < hb.length; k++) { const g = hb[k] - hb[k - 1]; if (g > 700) gaps.push({ from: Math.round(hb[k - 1]), ms: Math.round(g), logs: window._tl.filter(([t]) => t >= hb[k - 1] && t <= hb[k]).map(([t, m]) => Math.round(t - hb[k - 1]) + ' ' + m) }); }
        return { gaps, stats: window._qbSourceHole, frozenMsWhileSolving: Math.round(gap), frozenMsWholeBake: Math.round(gapAll), msMainThreadSolve: Math.round(msMain),
                 vsMainThread: { holeTexelsDiffering: dh, plateTexelsDiffering: dp, washTexelsDiffering: dw, hole: nh }, sdPaint: { texels: np, differingFromHole: pdiff, fgShares: fgSame } };
    });
    if (process.env.DUMP) {   // DUMP=1: the arrays truthkit/check_app_band.py scores (a257_probe's names and row orders)
        const dumps = await page.evaluate(() => {
            const { pw, ph } = window._qbSize, N = pw * ph, enc = (a) => { const u8 = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
            const ff2 = new Float32Array(N).fill(-1); const h2 = window._qbPlate2Has, p2 = window._qbPlateF2;
            if (h2 && p2) for (let i = 0; i < N; i++) if (h2[i]) ff2[i] = p2[(ph - 1 - ((i / pw) | 0)) * pw + (i % pw)];
            return { meta: { pw, ph, envDeg: 45, mode: 'source', outer: outerVolumeDepth, inner: innerVolumeDepth, pn: currentNormPortalPlane, D: Math.abs(camera.position.z - portalPlaneWorldZ), terrariumWidth, terrariumHeight }, 'disocc.u8': enc(Uint8Array.from(window._qbDisocc)), 'farField.f32': enc(Float32Array.from(window._geoFarField)), 'dQ.f32': enc(Float32Array.from(window._qbDQ)),
                     'plateF.f32': enc(Float32Array.from(window._qbPlateF)), 'farField2.f32': enc(ff2) };
        });
        fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(dumps.meta)); for (const k in dumps) if (k !== 'meta') fs.writeFileSync(path.join(OUT, k), Buffer.from(dumps[k], 'base64'));
    }
    const shot = async (name) => { const b64 = await page.evaluate(() => { updateCameraAndProjection(); render(); updateCameraAndProjection(); render(); return renderer.domElement.toDataURL('image/png').split(',')[1]; }); fs.writeFileSync(path.join(OUT, name), Buffer.from(b64, 'base64')); };
    await page.evaluate(() => { isSweeping = true; camera.position.set(0.180, 0.008, 0.2); });
    await shot('yawR42.png');
    await page.evaluate(() => { camera.position.set(-0.180, 0.008, 0.2); }); await shot('yawL42.png'); await page.evaluate(() => { camera.position.set(0.180, 0.008, 0.2); });
    if (process.env.RETURN) {   // RETURN=<dir with return_band_*.png>: the SD return imported on this bake (the round trip), shots after
        const files = {}; for (const n of fs.readdirSync(process.env.RETURN)) if (/^return_band_.*\.png$/.test(n)) files[n] = fs.readFileSync(path.join(process.env.RETURN, n)).toString('base64');
        res.returnImport = await page.evaluate(async (files) => {
            const fl = []; for (const n in files) { const b = Uint8Array.from(atob(files[n]), (c) => c.charCodeAt(0)); fl.push(new File([b], n, { type: 'image/png' })); }
            try { const st = await window._importPlaneReturnFiles(fl); return JSON.parse(JSON.stringify(st || null)); } catch (e) { return { error: String(e) }; }
        }, files);
        for (const [n, x] of [['yawR42', 0.180], ['yawL42', -0.180], ['rest', 0]]) { await page.evaluate((x) => { isSweeping = true; camera.position.set(x, 0.008, 0.2); }, x); await shot('ret_' + n + '.png'); }
        await page.evaluate(() => { isSweeping = true; camera.position.set(0.180, 0.008, 0.2); });
    }
    await page.evaluate(() => { const c = document.getElementById('sdRegionsChk'); c.checked = true; c.dispatchEvent(new Event('change')); });
    await shot('yawR42_sdregions.png');
    if (process.env.BUNDLE) {   // BUNDLE=1: the SD bundle at rest -> bundle.zip + atlas_lint
        await page.evaluate(() => { const c = document.getElementById('sdRegionsChk'); c.checked = false; c.dispatchEvent(new Event('change')); isSweeping = true; camera.position.set(0, 0, 0.2); });
        const zb = await page.evaluate(() => { const ra = window.alert; window.alert = () => {}; let href = null; const rc = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { href = this.href; };
            let threw = null; try { exportSDBundle(); } catch (e) { threw = String(e); } HTMLAnchorElement.prototype.click = rc; window.alert = ra; return { threw, b64: href ? href.split(',')[1] : null }; });
        if (zb.b64) { const BZ = path.join(OUT, 'bundle.zip'); fs.writeFileSync(BZ, Buffer.from(zb.b64, 'base64'));
            const lint = require('child_process').spawnSync('python3', [path.join(H, 'atlas_lint.py'), BZ], { encoding: 'utf8' }); fs.writeFileSync(path.join(OUT, 'lint.json'), lint.stdout); res.lint = lint.stdout.replace(/\s+/g, ' ').slice(0, 700); }
        else res.bundleError = zb.threw || 'no bundle';
    }
    const rep = Object.assign({ bakeMs, noWorker: !!process.env.NOWORKER }, res, { logs });
    fs.writeFileSync(path.join(OUT, 'check.json'), JSON.stringify(rep, null, 1)); console.log(JSON.stringify(Object.assign({}, rep, { logs: logs.slice(-4) })).slice(0, 3000));
    await browser.close(); srv.kill();
})();
