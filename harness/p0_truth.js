// PHASE 0.1 TRUTH METRICS (Addendum 184). Stages a synthetic scene from p0_synth.js, bakes
// the flagged stack, and scores the plug against the KNOWN hidden layer in texel space:
//   R  = the true revealable set: far-layer texels under the occluder that some pose of the
//        cone exposes (the true two-layer scene warped by the app's own shift law, quad-filled
//        like the CPU sweep; the near layer is the TRUE occluder at its true depth)
//   B  = the app's band (window._qbDisocc), H = the occluder's footprint at rest
//   coverage: |R|, |B∩R| (revealable texels the plug fills), |R−B| (revealable texels the plug
//             leaves at the occluder's depth: a hole or a clone at some pose)
//   hidden depth: over B∩R, plate depth − true far depth, in source quanta (1/255 for the 8-bit
//             grade, 1/65535 for 16-bit) and in rim-shift texels (the unit the screen sees)
//   colour: over B∩R, mean |plug − true far colour| per channel (0..255), beside the CLONE scale
//             (mean |occluder colour − true far colour| over the same texels) — a plug scoring
//             near the clone scale is a clone; near 0 is the truth
// Error maps (depth, colour) are written as PNGs. Screenshots come from a242_ghost.js / a228_carve.js
// with IMG= pointing at the same files.
//   SCENE=figure|screen|pole GRADE=16|8 [GEO=1] [OBS=1] [BOUNDARY=1] [FLUSH=1] [FLAGS=...] node harness/p0_truth.js
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = __dirname, WT = path.resolve(__dirname, '..');
const SCENE = process.env.SCENE || 'figure', GRADE = process.env.GRADE || '16';
const ARM = (process.env.FLAGS ? process.env.FLAGS.replace(/[^A-Za-z0-9]+/g, '') : 'wash') + (process.env.GEO ? '_geo' : '') + (process.env.OBS ? '_obs' : '') + (process.env.GATEA ? '_gateA' : '') + (process.env.BOUNDARY ? '_bnd' : '');
const OUT = path.join(__dirname, 'shots', 'p0', SCENE + '_d' + GRADE);
const POSES = [[0, 0], [0.100, -0.023], [0.141, 0.023], [0.180, 0.008], [-0.141, 0.023], [0.06, 0.012], [-0.09, -0.02], [0.16, -0.03]];   // the eight of a228_carve
(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const truth = JSON.parse(fs.readFileSync(path.join(H, 'synth', SCENE + '_truth.json'), 'utf8'));
    fs.copyFileSync(path.join(H, 'synth', truth.files.color), path.join(H, 'defaultImgColor.png'));
    fs.copyFileSync(path.join(H, 'synth', GRADE === '8' ? truth.files.depth8 : truth.files.depth16), path.join(H, 'defaultImgDepth.png'));
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    page.on('console', m => { const t = m.text(); if (t.includes('A244') || t.includes('A246') || t.includes('A242') || t.includes('A99') || t.includes('a89') || t.includes('A241b') || m.type() === 'error') console.log('  [page:' + m.type() + '] ' + t.slice(0, 600)); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r2 => setTimeout(r2, 1000)); }
    const res = await page.evaluate(async (o) => {
        window._rayReproject = true; window._plugSweepCapture = true; window._plugCarve = false;
        if (o.flush) window._plateFlushExempt = true;
        if (o.flags) for (const f of o.flags) { const [k, v] = f.split('='); window[k] = (v === undefined) ? true : (isNaN(+v) ? v : +v); }
        const t0 = Date.now();
        if (o.geo) window._plugGeoBand({ flush: !!o.flush, nx: o.nx || undefined, observed: !!o.obs, boundary: !!o.boundary, gateAPriori: !!o.gateA });
        else { bgQuickBake = true; buildBackgroundLayer(); }
        const bakeMs = Date.now() - t0;
        const sz = window._qbSize, dQ = window._qbDQ, pF = window._qbPlateF, dis = window._qbDisocc;
        if (!sz || !dQ || !pF || !dis) return { err: 'missing capture' };
        const pw = sz.pw, ph = sz.ph, N = pw * ph;
        const pS = new Float32Array(N); for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) pS[y * pw + x] = pF[(ph - 1 - y) * pw + x];
        // truth at plate resolution (nearest)
        const fetchBin = async (f) => new Uint8Array(await (await fetch('/synth/' + f)).arrayBuffer());
        const tw = o.truth.w, th = o.truth.h;
        const farD0 = new Float32Array((await fetchBin(o.truth.files.farDepth)).buffer), farC0 = await fetchBin(o.truth.files.farRGB), nearM0 = await fetchBin(o.truth.files.nearMask), compD0 = new Float32Array((await fetchBin(o.scene + '_comp_depth.f32')).buffer);
        const farD = new Float32Array(N), farC = new Uint8Array(N * 3), nearM = new Uint8Array(N), compD = new Float32Array(N);
        for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const i = y * pw + x, j = Math.min(th - 1, Math.floor(y * th / ph)) * tw + Math.min(tw - 1, Math.floor(x * tw / pw));
            farD[i] = farD0[j]; farC[i * 3] = farC0[j * 3]; farC[i * 3 + 1] = farC0[j * 3 + 1]; farC[i * 3 + 2] = farC0[j * 3 + 2]; nearM[i] = nearM0[j]; compD[i] = compD0[j]; }
        // the app's shift law
        const lut = bgShiftLUTFor(pw, ph);
        const _pz = (typeof portalPlaneWorldZ === 'number') ? portalPlaneWorldZ : 0; const D = Math.max(1e-3, Math.abs(camera.position.z - _pz));
        const exRim = D * Math.tan(((typeof bgViewFadeEndDeg === 'number') ? bgViewFadeEndDeg : 45) * Math.PI / 180);
        const asp = terrariumHeight / terrariumWidth;
        // poses: the eight + the 17x5 grid's boundary
        const poses = o.poses.slice(); const NX = 17, NY = 5;
        for (let iy = 0; iy < NY; iy++) for (let ix = 0; ix < NX; ix++) if (ix === 0 || ix === NX - 1 || iy === 0 || iy === NY - 1) poses.push([exRim * (2 * ix / (NX - 1) - 1), exRim * asp * (2 * iy / (NY - 1) - 1)]);
        // R: true revealable set. Near layer = true occluder texels at their true depth, quad-filled; a hidden far texel
        // is revealed at a pose when its landing cell (through its TRUE far depth) is not covered by the near layer.
        const sN = new Float32Array(N), sF = new Float32Array(N); for (let i = 0; i < N; i++) { sN[i] = bgShiftPxAt(lut, compD[i]); sF[i] = bgShiftPxAt(lut, farD[i]); }
        const cov = new Uint8Array(N); const R = new Uint8Array(N); const Rpose = [];
        for (const [ex, ey] of poses) { const fx = -ex / exRim, fy = -ey / exRim; cov.fill(0);
            for (let y = 0; y < ph - 1; y++) for (let x = 0; x < pw - 1; x++) { const i = y * pw + x; if (!nearM[i] || !nearM[i + 1] || !nearM[i + pw] || !nearM[i + pw + 1]) { if (nearM[i]) { const xs = Math.round(x + sN[i] * fx), ys = Math.round(y + sN[i] * fy); if (xs >= 0 && ys >= 0 && xs < pw && ys < ph) cov[ys * pw + xs] = 1; } continue; }
                const xs = [x + sN[i] * fx, x + 1 + sN[i + 1] * fx, x + sN[i + pw] * fx, x + 1 + sN[i + pw + 1] * fx], ys = [y + sN[i] * fy, y + sN[i + 1] * fy, y + 1 + sN[i + pw] * fy, y + 1 + sN[i + pw + 1] * fy];
                const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(pw - 1, Math.floor(Math.max(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(ph - 1, Math.floor(Math.max(...ys)));
                for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) cov[cy * pw + cx] = 1; }
            let nR = 0;
            for (let i = 0; i < N; i++) { if (!nearM[i]) continue; const x = i % pw, y = (i / pw) | 0; const xs = Math.round(x + sF[i] * fx), ys = Math.round(y + sF[i] * fy);
                if (xs < 0 || ys < 0 || xs >= pw || ys >= ph) continue; if (!cov[ys * pw + xs]) { if (!R[i]) nR++; R[i] = 1; } }
            Rpose.push(nR); }
        // plug colour (source rows)
        let plug = null, plugFrom = '';
        if (window._qbPlateColor) { plug = window._qbPlateColor; plugFrom = 'plateColor canvas'; }
        else { const rt = new THREE.WebGLRenderTarget(pw, ph, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat, type: THREE.UnsignedByteType });
            const postProcessQuad = postProcessScene.children[0]; const prev = renderer.getRenderTarget(); postProcessQuad.material = copyMaterial; copyMaterial.uniforms.tDiffuse.value = bgColorTarget.texture;
            renderer.setRenderTarget(rt); renderer.setViewport(0, 0, pw, ph); renderer.clear(); renderer.render(postProcessScene, postProcessCamera);
            const buf = new Uint8Array(N * 4); renderer.readRenderTargetPixels(rt, 0, 0, pw, ph, buf); renderer.setRenderTarget(prev); rt.dispose();
            plug = new Uint8ClampedArray(N * 4); for (let y = 0; y < ph; y++) { const s = (ph - 1 - y) * pw * 4, d = y * pw * 4; plug.set(buf.subarray(s, s + pw * 4), d); } plugFrom = 'bgColorTarget'; }
        let srcC = null;   // source colour at plate resolution (the clone scale's reference)
        try { const Lc = mediaLayers[0]; const cImg = (Lc.elements && Lc.elements.color) || Lc.textures.color.image; const cv = document.createElement('canvas'); cv.width = pw; cv.height = ph; const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(cImg, 0, 0, pw, ph); srcC = cx.getImageData(0, 0, pw, ph).data; } catch (e) { srcC = null; }
        // metrics
        const q = (typeof window._qbSrcQuantum === 'number' && window._qbSrcQuantum > 0) ? window._qbSrcQuantum : 1 / 255;
        let nH = 0, nR = 0, nB = 0, nBR = 0, nRnotB = 0, nBnotH = 0, nBHnotR = 0;
        let sDq = 0, sDqAbs = 0, sDs = 0, nFront = 0, nBehind = 0, sCol = 0, sClone = 0, sColR = 0, nColR = 0;
        let sDqR = 0, sDsR = 0;
        const eDepth = new Float32Array(N).fill(NaN), eCol = new Float32Array(N).fill(NaN);
        for (let i = 0; i < N; i++) { const h = nearM[i], r = R[i], b = dis[i];
            if (h) nH++; if (r) nR++; if (b) nB++; if (b && r) nBR++; if (r && !b) nRnotB++; if (b && !h) nBnotH++; if (b && h && !r) nBHnotR++;
            if (r) { const dq = (pS[i] - farD[i]) / q, ds = bgShiftPxAt(lut, pS[i]) - bgShiftPxAt(lut, farD[i]); sDqR += Math.abs(dq); sDsR += Math.abs(ds);
                const c = Math.abs(plug[i * 4] - farC[i * 3]) + Math.abs(plug[i * 4 + 1] - farC[i * 3 + 1]) + Math.abs(plug[i * 4 + 2] - farC[i * 3 + 2]); sColR += c / 3; nColR++;
                if (b) { sDq += dq; sDqAbs += Math.abs(dq); sDs += Math.abs(ds); if (dq > 0.5) nFront++; else if (dq < -0.5) nBehind++; eDepth[i] = dq;
                    sCol += c / 3; eCol[i] = c / 3; if (srcC) sClone += (Math.abs(srcC[i * 4] - farC[i * 3]) + Math.abs(srcC[i * 4 + 1] - farC[i * 3 + 1]) + Math.abs(srcC[i * 4 + 2] - farC[i * 3 + 2])) / 3; } } }
        // maps: depth error (blue = behind truth, red = in front, grey = band outside R, black = not band), colour error (heat)
        const map = (fn) => { const cv = document.createElement('canvas'); cv.width = pw; cv.height = ph; const cx = cv.getContext('2d'); const im = cx.createImageData(pw, ph);
            for (let i = 0; i < N; i++) { const [r, g, b] = fn(i); im.data[i * 4] = r; im.data[i * 4 + 1] = g; im.data[i * 4 + 2] = b; im.data[i * 4 + 3] = 255; } cx.putImageData(im, 0, 0); return cv.toDataURL('image/png'); };
        const scale = 20;   // quanta at full colour
        const depthMap = map((i) => { if (!dis[i]) return R[i] ? [120, 0, 120] : [0, 0, 0]; const e = eDepth[i]; if (isNaN(e)) return nearM[i] ? [60, 60, 60] : [30, 30, 30]; const t = Math.min(1, Math.abs(e) / scale); return e > 0 ? [Math.round(80 + 175 * t), Math.round(80 * (1 - t)), Math.round(80 * (1 - t))] : [Math.round(80 * (1 - t)), Math.round(80 * (1 - t)), Math.round(80 + 175 * t)]; });
        const colMap = map((i) => { if (!dis[i]) return R[i] ? [120, 0, 120] : [0, 0, 0]; const e = eCol[i]; if (isNaN(e)) return [40, 40, 40]; const t = Math.min(1, e / 96); return [Math.round(255 * t), Math.round(200 * (1 - t)), 40]; });
        return { pw, ph, bakeMs, plugFrom, q, poses: poses.length, Rpose: Rpose.slice(0, 8), nH, nR, nB, nBR, nRnotB, nBnotH, nBHnotR, meanDq: sDq / Math.max(1, nBR), meanAbsDq: sDqAbs / Math.max(1, nBR), meanAbsDs: sDs / Math.max(1, nBR), nFront, nBehind,
                 meanAbsDqR: sDqR / Math.max(1, nR), meanAbsDsR: sDsR / Math.max(1, nR), meanCol: sCol / Math.max(1, nBR), meanColR: sColR / Math.max(1, nColR), cloneScale: sClone / Math.max(1, nBR), geo: window._plugGeoStats || null, depthMap, colMap };
    }, { scene: SCENE, truth, poses: POSES, flush: !!process.env.FLUSH, geo: !!process.env.GEO, obs: !!process.env.OBS, gateA: !!process.env.GATEA, boundary: !!process.env.BOUNDARY, nx: process.env.NX ? parseInt(process.env.NX) : 0, flags: (process.env.FLAGS || '').split(',').filter(Boolean) });
    if (res.err) { console.log('ERR ' + res.err); process.exit(1); }
    try { const raw = await page.evaluate(() => { const b64 = (ta) => { const u8 = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength); let s = ''; for (let i = 0; i < u8.length; i += 32768) s += String.fromCharCode.apply(null, u8.subarray(i, i + 32768)); return btoa(s); };
            const sz = window._qbSize, pw = sz.pw, ph = sz.ph, N = pw * ph; const pS = new Float32Array(N); const pF = window._qbPlateF; for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) pS[y * pw + x] = pF[(ph - 1 - y) * pw + x];
            return { band: b64(window._qbDisocc), dQ: b64(window._qbDQ), plate: b64(pS), field: window._geoFarField ? b64(window._geoFarField) : null, obsDepth: window._geoObsDepth ? b64(window._geoObsDepth) : null, obsCount: window._geoObsCount ? b64(window._geoObsCount) : null }; });
        for (const k of ['band', 'dQ', 'plate', 'field', 'obsDepth', 'obsCount']) if (raw[k]) fs.writeFileSync(path.join(OUT, ARM + '_' + k + '.bin'), Buffer.from(raw[k], 'base64'));
    } catch (eR) { console.log('  (raw export failed: ' + eR.message + ')'); }
    fs.writeFileSync(path.join(OUT, ARM + '_deptherr.png'), Buffer.from(res.depthMap.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT, ARM + '_colerr.png'), Buffer.from(res.colMap.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT, ARM + '_metrics.json'), JSON.stringify(Object.assign({}, res, { depthMap: undefined, colMap: undefined }), null, 1));
    const pct = (a, b) => (100 * a / Math.max(1, b)).toFixed(1) + '%';
    console.log(`${SCENE} d${GRADE} [${ARM}${process.env.FLUSH ? ',flush' : ''}] plate ${res.pw}x${res.ph}, bake ${res.bakeMs} ms, quantum 1/${Math.round(1 / res.q)}, plug colour from ${res.plugFrom}`);
    console.log(`   occluder H ${res.nH}; revealable R ${res.nR} (${pct(res.nR, res.nH)} of H; per pose ${res.Rpose.join('/')}); band B ${res.nB}`);
    console.log(`   COVERAGE  B∩R ${res.nBR} (${pct(res.nBR, res.nR)} of R)   R−B ${res.nRnotB} (${pct(res.nRnotB, res.nR)} of R: revealable texels left at the occluder's depth)   B−H ${res.nBnotH} (band outside the occluder)   B∩H−R ${res.nBHnotR} (never revealable, harmless)`);
    console.log(`   HIDDEN DEPTH over B∩R  mean signed ${res.meanDq.toFixed(2)} q, mean |err| ${res.meanAbsDq.toFixed(2)} q = ${res.meanAbsDs.toFixed(2)} rim-shift texels; in front of truth ${res.nFront}, behind ${res.nBehind}   (over all of R: |err| ${res.meanAbsDqR.toFixed(2)} q = ${res.meanAbsDsR.toFixed(2)} texels)`);
    console.log(`   COLOUR over B∩R  mean |plug − truth| ${res.meanCol.toFixed(1)} /255   clone scale (|occluder − truth|) ${res.cloneScale.toFixed(1)}   (over all of R: ${res.meanColR.toFixed(1)})`);
    if (res.geo && res.geo.obs) console.log(`   A246: ${res.geo.obs.samples} samples on ${res.geo.obs.texels} texels, ramp-walked ${res.geo.obs.rampWalked}, self-covered ${res.geo.obs.selfCovered}, ambiguous ${res.geo.obs.ambiguous}, regate ${JSON.stringify(res.geo.obs.regateReveal || null)}`);
    console.log('   maps -> ' + OUT);
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
