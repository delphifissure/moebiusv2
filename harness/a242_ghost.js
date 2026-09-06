// A242 GHOST INDEX + plug-only shots. For every band (disocc) texel of the baked plate:
// the plug colour's distance to the nearest FAR-rim source colour (depth-compatible rim,
// A213's gate) versus the nearest NEAR-lip source colour (the incompatible rim = the
// figure side). Ghost index = share of band texels whose plug colour is nearer the near
// lip than the far rim (a clone, sharp or blurred). Also: seam at the far rim, gradient
// energy in the band vs the far side, row/column anisotropy. Plug-only shots (FG hidden,
// magenta = nothing) at rest and sheet1, and the composite at sheet1.
//   FLUSH=1 node harness/a242_ghost.js                       (the wash, baseline)
//   FLUSH=1 FLAGS=_plugMembrane=1 node harness/a242_ghost.js (A242 membrane)
//   IMG=<color>,<depth> TAG=<name> to stage another scene (troll restored on exit)
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = __dirname, WT = path.resolve(__dirname, '..');
const TAG = process.env.TAG || 'troll';
const ARM = (process.env.FLAGS ? process.env.FLAGS.replace(/[^A-Za-z0-9]+/g, '') : 'wash') + (process.env.SWEEP ? '_sweep' : '') + (process.env.HOLE ? '_hole' : '') + (process.env.GEO ? '_geo' : '') + (process.env.OBS ? '_obs' : '') + (process.env.GATEA ? '_gateA' : '') + (process.env.BOUNDARY ? '_bnd' : '') + (process.env.NX ? '_nx' + process.env.NX : '');
const OUT = path.join(__dirname, 'shots', 'a242', TAG);
const POSES = [['rest', 0, 0], ['sheet1', 0.180, 0.008]];
const Z = 0.199;
(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    if (process.env.IMG) { const [c, d] = process.env.IMG.split(','); fs.copyFileSync(path.resolve(WT, c), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, d), path.join(H, 'defaultImgDepth.png')); }
    else { fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); }
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    page.on('console', m => { const t = m.text(); if (t.includes('A242') || t.includes('A244') || t.includes('A246') || t.includes('A252') || t.includes('A253') || t.includes('A247') || t.includes('A249') || t.includes('A245') || t.includes('A215') || t.includes('band fill') || t.includes('A241') || t.includes('NOTE') || m.type() === 'warning' || m.type() === 'error') console.log('  [page:' + m.type() + '] ' + t.slice(0, 700)); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r2 => setTimeout(r2, 1000)); }
    const res = await page.evaluate(async (o) => {
        window._rayReproject = true; window._plugSweepCapture = true; window._plugCarve = false;
        if (o.flush) window._plateFlushExempt = true;
        if (o.flags) for (const f of o.flags) { const [k, v] = f.split('='); window[k] = (v === undefined) ? true : (isNaN(+v) ? v : +v); }
        const t0 = Date.now();
        if (o.geo) { window._plugGeoBand({ flush: !!o.flush, nx: o.nx || undefined, ny: o.ny || undefined, observed: !!o.obs, boundary: !!o.boundary, gateAPriori: !!o.gateA }); }   // A244: geometric band
        else if (o.sweep) { window._plugSweepBake({ flush: !!o.flush, holeDemand: !!o.hole, nx: o.nx || undefined }); }   // A232/A234: sweep-defined region + hole-driven demand (the band = the exact reveal)
        else { bgQuickBake = true; buildBackgroundLayer(); }
        isSweeping = true;
        const bakeMs = Date.now() - t0;
        const sz = window._qbSize, dQ = window._qbDQ, pF = window._qbPlateF, dis = window._qbDisocc;
        if (!sz || !dQ || !pF || !dis) return { err: 'missing capture' };
        const pw = sz.pw, ph = sz.ph, N = pw * ph;
        const TOLB = fgTearStep;
        // plate depth in source rows
        const pS = new Float32Array(N); for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) pS[y * pw + x] = pF[(ph - 1 - y) * pw + x];
        // source colour (source rows)
        const L = mediaLayers[0];
        const cImg = (L.elements && L.elements.color) || L.textures.color.image;
        const cv = document.createElement('canvas'); cv.width = pw; cv.height = ph; const cx = cv.getContext('2d', { willReadFrequently: true });
        cx.drawImage(cImg, 0, 0, pw, ph); const src = cx.getImageData(0, 0, pw, ph).data;
        // plug colour (source rows): the membrane/blend canvas if present, else the wash target copied to 8-bit
        let plug = null, plugFrom = '';
        if (window._qbPlateColor) { plug = window._qbPlateColor; plugFrom = 'plateColor canvas'; }
        else {
            const rt = new THREE.WebGLRenderTarget(pw, ph, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat, type: THREE.UnsignedByteType });
            if (o.flags.some(f => f.startsWith('_plugMembrane'))) console.log('NOTE: membrane flag set but no plate colour capture — the band fill did not run (see page warnings)');
            const postProcessQuad = postProcessScene.children[0];
            const prev = renderer.getRenderTarget(); postProcessQuad.material = copyMaterial; copyMaterial.uniforms.tDiffuse.value = bgColorTarget.texture;
            renderer.setRenderTarget(rt); renderer.setViewport(0, 0, pw, ph); renderer.clear(); renderer.render(postProcessScene, postProcessCamera);
            const buf = new Uint8Array(N * 4); renderer.readRenderTargetPixels(rt, 0, 0, pw, ph, buf); renderer.setRenderTarget(prev); rt.dispose();
            plug = new Uint8ClampedArray(N * 4);
            for (let y = 0; y < ph; y++) { const s = (ph - 1 - y) * pw * 4, d = y * pw * 4; plug.set(buf.subarray(s, s + pw * 4), d); }   // target rows are bottom-up
            plugFrom = 'bgColorTarget (' + bgColorTarget.width + 'x' + bgColorTarget.height + ')';
        }
        // BFS 1: far colour — from compatible rim texels through the band with the plate gate (A213's domain)
        const farC = new Int32Array(N).fill(-1);   // index of the rim source texel
        const nearC = new Int32Array(N).fill(-1);
        const q = new Int32Array(N); let qh = 0, qt = 0;
        const N4 = (i, x, y) => [x > 0 ? i - 1 : -1, x < pw - 1 ? i + 1 : -1, y > 0 ? i - pw : -1, y < ph - 1 ? i + pw : -1];
        let nBand = 0;
        for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const i = y * pw + x; if (dis[i]) { nBand++; continue; }
            for (const j of N4(i, x, y)) { if (j < 0 || !dis[j] || farC[j] >= 0) continue; if (Math.abs(pS[j] - dQ[i]) <= TOLB) { farC[j] = i; q[qt++] = j; } } }
        while (qh < qt) { const i = q[qh++]; const x = i % pw, y = (i / pw) | 0;
            for (const j of N4(i, x, y)) { if (j < 0 || !dis[j] || farC[j] >= 0) continue; if (Math.abs(pS[j] - pS[i]) <= TOLB) { farC[j] = farC[i]; q[qt++] = j; } } }
        const nFar = qt;
        // BFS 2: near colour — from INcompatible rim texels (the figure side), ungated (nearest by steps)
        qh = 0; qt = 0;
        for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const i = y * pw + x; if (dis[i]) continue;
            for (const j of N4(i, x, y)) { if (j < 0 || !dis[j] || nearC[j] >= 0) continue; if (Math.abs(pS[j] - dQ[i]) > TOLB) { nearC[j] = i; q[qt++] = j; } } }
        while (qh < qt) { const i = q[qh++]; const x = i % pw, y = (i / pw) | 0;
            for (const j of N4(i, x, y)) { if (j < 0 || !dis[j] || nearC[j] >= 0) continue; nearC[j] = nearC[i]; q[qt++] = j; } }
        const nNear = qt;
        // ghost index
        const cd3 = (a, i, b, j) => Math.abs(a[i * 4] - b[j * 4]) + Math.abs(a[i * 4 + 1] - b[j * 4 + 1]) + Math.abs(a[i * 4 + 2] - b[j * 4 + 2]);
        let nBoth = 0, nGhost = 0, sFar = 0, sNear = 0, nSeam = 0, sSeam = 0;
        let gxB = 0, gyB = 0, nGB = 0, gOut = 0, nGO = 0;
        const ghostMap = new Uint8Array(N);
        // A253: the ghost index per gap class (window._geoClass). A CONTINUOUS or INTERIOR fill is SUPPOSED to be
        // near the near lip's surface, so the standing index is also reported without classes 1 and 2.
        const gcls = (window._geoClass && window._geoClass.length === N) ? window._geoClass : null;
        const perCls = {}; const clsAdd = (c, ghost) => { const e = perCls[c] || (perCls[c] = { n: 0, ghost: 0 }); e.n++; if (ghost) e.ghost++; };
        for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const i = y * pw + x;
            if (!dis[i]) {
                // far-side reference gradient: non-band texels within 8 px of the band that are compatible with it
                let nearBand = false; for (let dy = -8; dy <= 8 && !nearBand; dy++) for (let dx = -8; dx <= 8; dx++) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= pw || yy >= ph) continue; const j = yy * pw + xx; if (dis[j] && Math.abs(pS[j] - dQ[i]) <= TOLB) { nearBand = true; break; } }
                if (nearBand && x < pw - 1 && y < ph - 1 && !dis[i + 1] && !dis[i + pw]) { gOut += cd3(src, i, src, i + 1) + cd3(src, i, src, i + pw); nGO++; }
                continue;
            }
            if (farC[i] >= 0 && nearC[i] >= 0) { nBoth++; const df = cd3(plug, i, src, farC[i]), dn = cd3(plug, i, src, nearC[i]); sFar += df; sNear += dn; if (dn < df) { nGhost++; ghostMap[i] = 1; } if (gcls) clsAdd(gcls[i], dn < df); }
            if (x < pw - 1 && dis[i + 1]) { gxB += cd3(plug, i, plug, i + 1); nGB++; }
            if (y < ph - 1 && dis[i + pw]) { gyB += cd3(plug, i, plug, i + pw); }
            // seam: band texel adjacent to a compatible rim texel
            for (const j of N4(i, x, y)) { if (j < 0 || dis[j]) continue; if (Math.abs(pS[i] - dQ[j]) <= TOLB) { sSeam += cd3(plug, i, src, j); nSeam++; break; } }
        }
        // shots: plug only (FG hidden) at both poses, composite at sheet1
        const shots = {};
        const grabRT = () => {
            const prevRT = renderer.getRenderTarget(); renderer.setClearColor(new THREE.Color(0, 0, 0), 0.0);
            renderer.setRenderTarget(pingPongRenderTargetB); renderer.clear(); renderer.render(scene, camera);
            const W = pingPongRenderTargetB.width, Hh = pingPongRenderTargetB.height;
            const isFloat = pingPongRenderTargetB.texture.type === THREE.FloatType || pingPongRenderTargetB.texture.type === THREE.HalfFloatType;
            const buf = isFloat ? new Float32Array(W * Hh * 4) : new Uint8Array(W * Hh * 4);
            renderer.readRenderTargetPixels(pingPongRenderTargetB, 0, 0, W, Hh, buf); renderer.setRenderTarget(prevRT);
            const c1 = document.createElement('canvas'); c1.width = W; c1.height = Hh; const x1 = c1.getContext('2d'); const im = x1.createImageData(W, Hh);
            const sc = isFloat ? 255 : 1, thr = isFloat ? 0.03 : 8;
            for (let i = 0; i < W * Hh; i++) { const o4 = i * 4, a = buf[o4 + 3];
                if (a < thr) { im.data[o4] = 255; im.data[o4 + 1] = 0; im.data[o4 + 2] = 255; } else { im.data[o4] = Math.min(255, buf[o4] * sc); im.data[o4 + 1] = Math.min(255, buf[o4 + 1] * sc); im.data[o4 + 2] = Math.min(255, buf[o4 + 2] * sc); }
                im.data[o4 + 3] = 255; }
            x1.putImageData(im, 0, 0);
            const c2 = document.createElement('canvas'); c2.width = W; c2.height = Hh; const x2 = c2.getContext('2d'); x2.translate(0, Hh); x2.scale(1, -1); x2.drawImage(c1, 0, 0);
            return c2.toDataURL('image/png');
        };
        for (const [name, px, py] of o.poses) {
            camera.position.set(px, py, o.z); updateCameraAndProjection(); render(); render();
            for (const Lx of mediaLayers) if (Lx.mesh) Lx.mesh.visible = false;
            shots['plugonly_' + name] = grabRT();
            for (const Lx of mediaLayers) if (Lx.mesh) Lx.mesh.visible = true;
            updateCameraAndProjection(); render();
            const el = renderer.domElement; const cc = document.createElement('canvas'); cc.width = el.width; cc.height = el.height; cc.getContext('2d').drawImage(el, 0, 0);
            shots['composite_' + name] = cc.toDataURL('image/png');
        }
        // ghost map PNG (texture space, upright): band grey, ghost red, far-anchored green
        const gm = document.createElement('canvas'); gm.width = pw; gm.height = ph; const gx = gm.getContext('2d'); const gi = gx.createImageData(pw, ph);
        for (let i = 0; i < N; i++) { const o4 = i * 4; let r = src[o4] * 0.35, g = src[o4 + 1] * 0.35, b = src[o4 + 2] * 0.35;
            if (dis[i]) { if (ghostMap[i]) { r = 230; g = 40; b = 40; } else if (farC[i] >= 0) { r = 40; g = 190; b = 70; } else { r = 120; g = 120; b = 120; } }
            gi.data[o4] = r; gi.data[o4 + 1] = g; gi.data[o4 + 2] = b; gi.data[o4 + 3] = 255; }
        gx.putImageData(gi, 0, 0); shots.ghostmap = gm.toDataURL('image/png');
        return { pw, ph, bakeMs, plugFrom, nBand, nFar, nNear, nBoth, nGhost, perCls: gcls ? perCls : null, meanFar: sFar / Math.max(1, nBoth), meanNear: sNear / Math.max(1, nBoth),
                 seam: sSeam / Math.max(1, nSeam), nSeam, gradBand: (gxB + gyB) / Math.max(1, 2 * nGB), gradOut: gOut / Math.max(1, 2 * nGO), anis: gxB / Math.max(1, gyB), shots };
    }, { poses: POSES, z: Z, flush: !!process.env.FLUSH, sweep: !!process.env.SWEEP, hole: !!process.env.HOLE, geo: !!process.env.GEO, obs: !!process.env.OBS, gateA: !!process.env.GATEA, boundary: !!process.env.BOUNDARY, nx: process.env.NX ? parseInt(process.env.NX) : 0, ny: process.env.NY ? parseInt(process.env.NY) : 0, flags: (process.env.FLAGS || '').split(',').filter(Boolean) });
    if (res.err) { console.log('ERR ' + res.err); process.exit(1); }
    // Phase 0 / A246 audit: the band, the plate depth, the observed depth/count and the geo stats as raw files (source rows) for offline comparison
    try { const raw = await page.evaluate(() => { const b64 = (ta) => { const u8 = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength); let s = ''; for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768)); return btoa(s); };
            const sz = window._qbSize, pw = sz.pw, ph = sz.ph, N = pw * ph; const pS = new Float32Array(N); const pF = window._qbPlateF; for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) pS[y * pw + x] = pF[(ph - 1 - y) * pw + x];
            const opt = (a) => a ? b64(a) : null;
            return { band: b64(window._qbDisocc), dQ: b64(window._qbDQ), plate: b64(pS), field: opt(window._geoFarField), obsDepth: opt(window._geoObsDepth), obsCount: opt(window._geoObsCount),
                     // A252 lip instrument (all source rows): lipDeep/lipNear/lipSpread/rampDrop/post Float32, kind/prov/cls Uint8, crossFrac Float32
                     lipDeep: opt(window._geoLipDeep), lipNear: opt(window._geoLipNear), lipSpread: opt(window._geoLipSpread), rampDrop: opt(window._geoRampDrop), crossFrac: opt(window._geoCrossFrac), kind: opt(window._geoKind), prov: opt(window._geoProv), cls: opt(window._geoClass), post: opt(window._geoPost),
                     stats: window._plugGeoStats || null }; });
        for (const k of ['band', 'dQ', 'plate', 'field', 'obsDepth', 'obsCount', 'lipDeep', 'lipNear', 'lipSpread', 'rampDrop', 'crossFrac', 'kind', 'prov', 'cls', 'post']) if (raw[k]) fs.writeFileSync(path.join(OUT, ARM + '_' + k + '.bin'), Buffer.from(raw[k], 'base64'));
        fs.writeFileSync(path.join(OUT, ARM + '_geostats.json'), JSON.stringify(Object.assign({ pw: res.pw, ph: res.ph }, raw.stats || {}), null, 1));
    } catch (eR) { console.log('  (raw export failed: ' + eR.message + ')'); }
    for (const k of Object.keys(res.shots)) { const f = path.join(OUT, ARM + '_' + k + '.png'); fs.writeFileSync(f, Buffer.from(res.shots[k].split(',')[1], 'base64')); }
    const pct = (a, b) => (100 * a / Math.max(1, b)).toFixed(1) + '%';
    console.log(`${TAG} [${ARM}${process.env.FLUSH ? ',flush' : ''}] plate ${res.pw}x${res.ph}, bake ${res.bakeMs} ms, plug colour from ${res.plugFrom}`);
    console.log(`   band ${res.nBand} texels; far-anchored (A213 domain) ${res.nFar} (${pct(res.nFar, res.nBand)}); with a near lip ${res.nNear}; scored ${res.nBoth}`);
    console.log(`   GHOST INDEX ${res.nGhost} of ${res.nBoth} = ${pct(res.nGhost, res.nBoth)} nearer the near lip than the far rim; mean |plug-far| ${res.meanFar.toFixed(1)}, |plug-near| ${res.meanNear.toFixed(1)} (sum of RGB, /255 each)`);
    console.log(`   far-rim seam ${res.seam.toFixed(2)} over ${res.nSeam} rim contacts; gradient in band ${res.gradBand.toFixed(2)} vs far side ${res.gradOut.toFixed(2)} (ratio ${(res.gradBand / Math.max(1e-6, res.gradOut)).toFixed(2)}); row/col anisotropy ${res.anis.toFixed(2)}`);
    if (res.perCls) { const CN = { 1: 'continuous', 2: 'interior-step', 7: 'extent-step', 3: 'single-lip', 4: 'fallback', 5: 'pinhole', 6: 'dilation' }; let nX = 0, gX = 0;
        const parts = Object.keys(res.perCls).sort().map(c => { const e = res.perCls[c]; if (c !== '1' && c !== '2') { nX += e.n; gX += e.ghost; } return `${CN[c] || c} ${pct(e.ghost, e.n)} of ${e.n}`; });
        console.log(`   GHOST per class: ${parts.join('; ')};  EXCLUDING continuous + interior (the classes meant to be near the near lip): ${pct(gX, nX)} of ${nX}`); }
    console.log('   shots -> ' + OUT);
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
