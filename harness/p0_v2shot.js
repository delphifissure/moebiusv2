// Composite shots of the app's DEFAULT path (v2: bgMPIMode, no quick bake) at the harness poses,
// for the side-by-side with the quick-bake arms. Loads the page, lets the load-time build finish,
// renders rest / sheet1 / mirror and saves the on-screen frame.  node harness/p0_v2shot.js
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = __dirname, WT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'shots', 'v2', (process.env.TAG || 'troll') + (process.env.SUFFIX || ''));
const POSES = [['rest', 0, 0], ['sheet1', 0.180, 0.008], ['mirror', -0.141, 0.023], ['a221', 0.100, -0.023]];
(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    if (process.env.HDIR) { /* another tree's harness dir serves its own default image */ } else if (process.env.IMG) { const [c, d] = process.env.IMG.split(','); fs.copyFileSync(path.resolve(WT, c), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, d), path.join(H, 'defaultImgDepth.png')); }
    else { fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); }
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: process.env.HDIR || H, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    page.on('console', m => { const t = m.text(); if (process.env.ALLLOG && !/RUNG-|Content Security|BUILD\] FG|404|Face Mesh|willReadFrequently/.test(t)) console.log('  [all:' + m.type() + '] ' + t.slice(0, 160)); else if (t.includes('BG-BUILD') || t.includes('MPI') || t.includes('QUICK') || t.includes('wash') || t.includes('V2') || m.type() === 'error' || m.type() === 'warning') console.log('  [page:' + m.type() + '] ' + t.slice(0, 300)); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 60; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth && (typeof bgLayerMesh !== 'undefined' && bgLayerMesh)); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r2 => setTimeout(r2, 1000)); }
    await new Promise(r => setTimeout(r, parseInt(process.env.SETTLE || '30000')));   // let the load-time background build settle
    const res = await page.evaluate(async (o) => {
        const out = { mode: { quick: (typeof bgQuickBake !== 'undefined') ? bgQuickBake : null, mpi: (typeof bgMPIMode !== 'undefined') ? bgMPIMode : null, full: (typeof bgMPIFullPlanes !== 'undefined') ? bgMPIFullPlanes : null }, shots: {} };
        if (o.ray !== null) window._rayReproject = o.ray;
        if (o.inpaint) { try { useInpainting = true; debugView = 'final'; const dv = document.getElementById('debugViewSelect'); if (dv) dv.value = 'final'; const cb = document.getElementById('inpaintingToggle'); if (cb) cb.checked = true; } catch (e) { console.error('inpaint toggle: ' + e.message); } }
        if (o.build) { bgQuickBake = false; bgMPIFullPlanes = true; bgMPIMode = true; const tB = Date.now(); try { buildBackgroundLayer(); } catch (e) { console.error('[BG-BUILD] ' + e.message); } console.log('[V2-BUILD] ' + (Date.now() - tB) + 'ms'); }
        isSweeping = !o.nosweep;   // the app's render loop owns camera.position unless a sweep is running (NOSWEEP=1: leave it false for the capture)
        const Lm = mediaLayers[0], um = Lm.mesh.material.uniforms;
        const diag = { rayReproject: (typeof bgRayReproject !== 'undefined') ? bgRayReproject : null, rayNow: (typeof _rayReprojectNow === 'function') ? _rayReprojectNow() : null, bandCutUvRate: um.u_bandCutUvRate ? um.u_bandCutUvRate.value : null, fragTear: um.u_fragTear ? um.u_fragTear.value : null, indexLen: Lm.mesh.geometry.index ? Lm.mesh.geometry.index.count : null, fullIndex: Lm.mesh.geometry.userData._fullIndex ? Lm.mesh.geometry.userData._fullIndex.length : null, transparent: Lm.mesh.material.transparent, clearAlpha: renderer.getClearAlpha() };
        diag.useInpainting = (typeof useInpainting !== 'undefined') ? useInpainting : null; diag.method = (typeof currentInpaintingMethod !== 'undefined') ? currentInpaintingMethod : null; diag.staticAtlas = (typeof useStaticInfillAtlas !== 'undefined') ? useStaticInfillAtlas : null; diag.pyr = (typeof pullPyramidTargets !== 'undefined') ? pullPyramidTargets.length : null; diag.finalMat = !!(typeof finalCompositeMaterial !== 'undefined' && finalCompositeMaterial); diag.accum = (typeof isAccumulatingGaps !== 'undefined') ? isAccumulatingGaps : null; diag.clearing = (typeof isClearing !== 'undefined') ? isClearing : null; diag.sweeping = isSweeping; diag.quickBaked = !!window._bgQuickBaked; diag.debugView = (typeof debugView !== 'undefined') ? debugView : null; diag.pxScale = um.u_pxScale ? um.u_pxScale.value : null; diag.armedW = (typeof bgBandCutArmedW !== 'undefined') ? bgBandCutArmedW : null;
        diag.nullTex = Object.keys(um).filter(k => um[k] && um[k].value === null && /map|tex|Tex|Map/.test(k));
        if (o.fixpx && um.u_pxScale) { um.u_pxScale.value = 1; window._pxScaleLock = true; }
        out.diag = diag;
        const info = { bgMesh: !!(typeof bgLayerMesh !== 'undefined' && bgLayerMesh), bgVisible: (typeof bgLayerMesh !== 'undefined' && bgLayerMesh) ? bgLayerMesh.visible : null, meshes: [] };
        scene.traverse((m) => { if (m.isMesh) info.meshes.push({ name: m.name || (m.userData && m.userData.v2Plane ? 'v2Plane' : ''), vis: m.visible, bg: !!(m.material && m.material.uniforms && m.material.uniforms.u_isBackgroundLayer && m.material.uniforms.u_isBackgroundLayer.value) }); });
        out.info = info;
        out.framePath = null;
        for (const [name, x, y] of o.poses) { camera.position.set(x, y, o.z); updateCameraAndProjection(); render(); render(); out.framePath = window._framePath || null;
            if (o.finaltex && typeof finalInpaintedTextureTarget !== 'undefined' && finalInpaintedTextureTarget) {   // the pipeline's final composite, read straight from its target (no compositor needed)
                const T = finalInpaintedTextureTarget, W = T.width, Hh = T.height; const isF = T.texture.type === THREE.FloatType || T.texture.type === THREE.HalfFloatType;
                const buf = isF ? new Float32Array(W * Hh * 4) : new Uint8Array(W * Hh * 4); renderer.readRenderTargetPixels(T, 0, 0, W, Hh, buf);
                const cv2 = document.createElement('canvas'); cv2.width = W; cv2.height = Hh; const c2 = cv2.getContext('2d'); const im = c2.createImageData(W, Hh);
                for (let yy = 0; yy < Hh; yy++) for (let xx = 0; xx < W; xx++) { const si = ((Hh - 1 - yy) * W + xx) * 4, di = (yy * W + xx) * 4; for (let k = 0; k < 4; k++) im.data[di + k] = isF ? Math.max(0, Math.min(255, Math.round(buf[si + k] * 255))) : buf[si + k]; }
                c2.putImageData(im, 0, 0); out.shots['final_' + name] = cv2.toDataURL('image/png'); }
            if (o.finaltex && name === 'sheet1') {
                const dumpT = (T, key) => { if (!T || !T.texture) return; const W = T.width, Hh = T.height; const isF = T.texture.type === THREE.FloatType || T.texture.type === THREE.HalfFloatType; const buf = isF ? new Float32Array(W * Hh * 4) : new Uint8Array(W * Hh * 4); renderer.readRenderTargetPixels(T, 0, 0, W, Hh, buf);
                    const cv2 = document.createElement('canvas'); cv2.width = W; cv2.height = Hh; const c2 = cv2.getContext('2d'); const im = c2.createImageData(W, Hh); let nz = 0;
                    for (let yy = 0; yy < Hh; yy++) for (let xx = 0; xx < W; xx++) { const si = ((Hh - 1 - yy) * W + xx) * 4, di = (yy * W + xx) * 4; for (let k = 0; k < 4; k++) im.data[di + k] = isF ? Math.max(0, Math.min(255, Math.round(buf[si + k] * 255))) : buf[si + k]; if (im.data[di + 3] > 8) nz++; }
                    c2.putImageData(im, 0, 0); out.shots['stage_' + key] = cv2.toDataURL('image/png'); out['n_' + key] = nz; };
                dumpT(typeof pullPyramidTargets !== 'undefined' && pullPyramidTargets[0] ? pullPyramidTargets[0] : null, 'pull0'); dumpT(typeof pushPyramidTargets !== 'undefined' && pushPyramidTargets[0] ? pushPyramidTargets[0] : null, 'push0'); dumpT(typeof screenNormalizedDepthTarget !== 'undefined' ? screenNormalizedDepthTarget : null, 'normDepth'); out.edgeMaskTex = !!(typeof finalEdgeMaskTexture !== 'undefined' && finalEdgeMaskTexture); out.cleanColor = !!(typeof cleanColorTexture !== 'undefined' && cleanColorTexture);
                dumpT(typeof layerMaskTarget !== 'undefined' ? layerMaskTarget : null, 'layerMask'); dumpT(typeof bgInpaintedTarget !== 'undefined' ? bgInpaintedTarget : null, 'bgInpainted'); dumpT(typeof fgInpaintedTarget !== 'undefined' ? fgInpaintedTarget : null, 'fgInpainted'); dumpT(typeof pingPongRenderTargetB !== 'undefined' ? pingPongRenderTargetB : null, 'sceneB');
                out.split = (typeof currentInpaintingSplitDepthNorm !== 'undefined') ? currentInpaintingSplitDepthNorm : null; out.maskUsesAlpha = (typeof maskUsesAlpha !== 'undefined') ? maskUsesAlpha : null; out.maxLevels = (typeof maxPyramidLevels !== 'undefined') ? maxPyramidLevels : null; }
            const el = renderer.domElement; const cv = document.createElement('canvas'); cv.width = el.width; cv.height = el.height; cv.getContext('2d').drawImage(el, 0, 0); out.shots[name] = cv.toDataURL('image/png'); }
        return out;
    }, { poses: POSES, z: 0.199, build: !!process.env.BUILD, ray: process.env.RAY === undefined ? null : process.env.RAY === '1', fixpx: !!process.env.FIXPX, inpaint: !!process.env.INPAINT, nosweep: !!process.env.NOSWEEP, finaltex: !!process.env.FINALTEX });
    if (process.env.SHOT) { const canvasSel = await page.evaluate(() => { const el = renderer.domElement; if (!el.id) el.id = '_harnessCanvas'; return '#' + el.id; });
        for (const [name, x, y] of POSES) { await page.evaluate((p) => { camera.position.set(p[0], p[1], p[2]); updateCameraAndProjection(); render(); }, [x, y, 0.199]); await new Promise(r => setTimeout(r, 400));
            const bb = await page.evaluate((sel) => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }, canvasSel);
            await page.screenshot({ path: path.join(OUT, 'shot_' + name + '.png'), clip: { x: Math.max(0, bb.x), y: Math.max(0, bb.y), width: Math.min(bb.width, 912 - Math.max(0, bb.x)), height: Math.min(bb.height, 513 - Math.max(0, bb.y)) }, timeout: 20000 }); } }
    console.log('mode ' + JSON.stringify(res.mode) + ' framePath ' + res.framePath + ' split ' + res.split + ' maskUsesAlpha ' + res.maskUsesAlpha + ' maxLevels ' + res.maxLevels + ' nz layerMask ' + res.n_layerMask + ' bg ' + res.n_bgInpainted + ' fg ' + res.n_fgInpainted + ' sceneB ' + res.n_sceneB + ' pull0 ' + res.n_pull0 + ' push0 ' + res.n_push0 + ' normDepth ' + res.n_normDepth + ' edgeMaskTex ' + res.edgeMaskTex + ' cleanColor ' + res.cleanColor); console.log('diag ' + JSON.stringify(res.diag)); console.log('info ' + JSON.stringify(res.info).slice(0, 600));
    for (const k of Object.keys(res.shots)) fs.writeFileSync(path.join(OUT, 'v2_' + k + '.png'), Buffer.from(res.shots[k].split(',')[1], 'base64'));
    console.log('shots -> ' + OUT);
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
