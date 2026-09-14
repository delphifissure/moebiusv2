// S27: the FILE import path, headless — bakes S9 as the panel does, fetches harness/objlayers_demo/S9/obj_*.png as File
// objects (colour RGBA, visible mask, 16-bit depth PNG) and runs window._importObjectLayerFiles on them, i.e. exactly what the
// 'Import object layers (S27)' button does after the picker; shoots fx 0.6 with and without the layers and reports the
// per-layer stats and how many pixels changed. Serial on port 8099.   node harness/objl_filetest.js
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'; const H = __dirname, WT = path.resolve(__dirname, '..');
const OUT = path.join(H, 'shots', 'objlayers', 'S9_filetest'); const DEMO = path.join(H, 'objlayers_demo', 'S9');
const meta = JSON.parse(fs.readFileSync(path.join(H, 'truthkit', 'out', 'S9', 'meta.json'), 'utf8'));
(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    fs.copyFileSync(path.join(DEMO, 'S9_color.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(DEMO, 'S9_depth16.png'), path.join(H, 'defaultImgDepth.png'));
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    page.on('console', m => { const t = m.text(); if (/\[S27\]|FAILED|rror/.test(t)) console.log('  [page] ' + t.slice(0, 300)); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
    await page.evaluate(async (o) => {
        window._rayReproject = true; outerVolumeDepth = o.outer; innerVolumeDepth = o.inner; currentNormPortalPlane = o.pn;
        const sel = { bgPlateFarSel: 'plane', bgPlateFillSel: 'wash', bgPlateMarginSel: 'picture', bgPlateFacesSel: 'off', bgPlateBandSel: '35', bgPlateSkySel: 'off', bgPlateStretchSel: 'inner', bgPlateRulesSel: 'cur' };
        for (const id in sel) { const el = document.getElementById(id); if (el) el.value = sel[id]; }
        if (window._applyPlateOptions) window._applyPlateOptions();
        window._tearLaw = 'rim'; window._farRule = 'plane'; window._plugObjectRule = false; window._plugExtent = null; window._geoLipSeed = false; window._plugBack = false; window._plateFlushExempt = true;
        const modeSel3 = document.getElementById('bgModeSel'); if (modeSel3) modeSel3.value = 'quick'; bgQuickBake = true; window._bgBakeMode = 'quick';
        window._plugGeoBand({ flush: true, observed: true, gateAPriori: true }); window._bgUserBuiltOnce = true;
    }, { outer: meta.outer, inner: meta.inner, pn: meta.pn });
    const shot = async (name) => { const r = await page.evaluate(async () => { isSweeping = true; const D = Math.abs(camera.position.z - portalPlaneWorldZ); const exR = D * Math.tan(bgViewFadeEndDeg * Math.PI / 180); camera.position.x = 0.6 * exR; camera.position.y = 0;
        updateCameraAndProjection(); render(); updateCameraAndProjection(); render(); const W = renderer.domElement.width, Hh = renderer.domElement.height; const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh; cv.getContext('2d').drawImage(renderer.domElement, 0, 0, W, Hh); isSweeping = false; return cv.toDataURL('image/png'); });
        fs.writeFileSync(path.join(OUT, name), Buffer.from(r.split(',')[1], 'base64')); };
    await shot('none_0.6_0.png');
    const st = await page.evaluate(async () => {
        const names = ['obj_1_color.png', 'obj_1_visible.png', 'obj_1_depth16.png', 'obj_2_color.png', 'obj_2_visible.png', 'obj_2_depth16.png', 'obj_3_color.png', 'obj_3_visible.png', 'obj_3_depth16.png'];
        const files = []; for (const n of names) { const b = await (await fetch('/objlayers_demo/S9/' + n)).blob(); files.push(new File([b], n, { type: 'image/png' })); }
        // the 16-bit decoder against the raw values: obj_2_depth16 max should be 17949/65535
        const g = await _png16Decode(new Uint8Array(await files[5].arrayBuffer())); let mx = 0; for (let i = 0; i < g.data.length; i++) if (g.data[i] > mx) mx = g.data[i];
        const t0 = performance.now(); const st = await window._importObjectLayerFiles(files); return { st, png16: { w: g.w, h: g.h, max: g.max, dataMax: mx }, ms: Math.round(performance.now() - t0) };
    });
    console.log('file import: ' + JSON.stringify(st));
    await shot('files_0.6_0.png');
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(st, null, 1));
    await browser.close(); srv.kill(); console.log('done ' + OUT);
})();
