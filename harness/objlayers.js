// S27 object layers: plane bake of a kit scene exactly as the S6 panel builds it, the object export (plane_object_ids +
// meta.plane_objects) dumped, the truth's completed object layers built for those ids (truthkit/obj_layers_from_truth.py),
// then imported through window._importObjectLayersFromData under three arms — none / cont (front continued) / truth (the
// truth's own depth supplied, aligned on the visible front) — and shot at the a257 poses. Per shot: uncovered pixels inside
// the picture rectangle (alpha 0) and, when truthkit/truth_view.py renders the truth at the same eye, the mean colour error
// against it. Serial on port 8099 like every harness.
//   S=S15 [POSES="0:0,0.6:0,1:-0.5,-1:0.5"] [ARMS=none,cont,truth] [OUT=dir] node harness/objlayers.js
'use strict';
const { chromium } = require('playwright-core');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = __dirname, WT = path.resolve(__dirname, '..'); const TK = path.join(H, 'truthkit');
const S = process.env.S || 'S15'; const OUT = process.env.OUT || path.join(H, 'shots', 'objlayers', S);
const ARMS = (process.env.ARMS || 'none,cont,truth').split(',');
const meta = JSON.parse(fs.readFileSync(path.join(TK, 'out', S, 'meta.json'), 'utf8'));
(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    fs.copyFileSync(path.join(TK, 'out', S, 'rest_rgb.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(TK, 'out', S, 'rest_depth16.png'), path.join(H, 'defaultImgDepth.png'));
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    page.on('console', m => { const t = m.text(); if (/\[S27|\[S4\]|\[S6\] plate|FAILED|rror/.test(t)) console.log('  [page] ' + t.slice(0, 400)); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
    const sky = (S === 'S15' || S === 'S32');
    const bake = await page.evaluate(async (o) => {
        window._rayReproject = true; outerVolumeDepth = o.outer; innerVolumeDepth = o.inner; currentNormPortalPlane = o.pn;
        const sel = { bgPlateFarSel: 'plane', bgPlateFillSel: 'wash', bgPlateMarginSel: 'picture', bgPlateFacesSel: 'off', bgPlateBandSel: '35', bgPlateSkySel: o.sky ? 'on' : 'off', bgPlateStretchSel: 'inner', bgPlateRulesSel: 'cur' };
        for (const id in sel) { const el = document.getElementById(id); if (el) el.value = sel[id]; }
        if (window._applyPlateOptions) window._applyPlateOptions();
        window._tearLaw = 'rim'; window._farRule = 'plane'; if (o.sky) window._skyInf = 1;
        window._plugObjectRule = false; window._plugExtent = null; window._geoLipSeed = false; window._plugBack = false; window._plateFlushExempt = true;
        const modeSel3 = document.getElementById('bgModeSel'); if (modeSel3) modeSel3.value = 'quick'; bgQuickBake = true; window._bgBakeMode = 'quick';
        const t0 = Date.now(); window._plugGeoBand({ flush: true, observed: true, gateAPriori: true }); window._bgUserBuiltOnce = true;
        const ob = _planeObjects(true); const sz = window._qbSize;
        const u8 = ob.ids; let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        return { pw: sz.pw, ph: sz.ph, bakeMs: Date.now() - t0, objects: ob.objects, overflow: window._qbObjOverflow, idsB64: btoa(s), opts: window._bgPlateOptions };
    }, { outer: meta.outer, inner: meta.inner, pn: meta.pn, sky });
    fs.writeFileSync(path.join(OUT, 'objIds.u8'), Buffer.from(bake.idsB64, 'base64')); fs.writeFileSync(path.join(OUT, 'objects.json'), JSON.stringify(bake.objects, null, 1));
    console.log('bake ' + S + ': ' + bake.pw + 'x' + bake.ph + ' in ' + bake.bakeMs + ' ms; objects ' + bake.objects.length + ' (overflow ' + bake.overflow + '); largest ' + JSON.stringify(bake.objects.slice(0, 4)));
    // the truth's completed layers for these objects
    const rep = JSON.parse(execFileSync('python3', [path.join(TK, 'obj_layers_from_truth.py'), S, OUT], { encoding: 'utf8' }).trim().split('\n').pop());
    console.log('truth layers: ' + rep.map(r => r.name + '#' + r.layerId + ' (' + r.appIds.length + ' app objs, layer ' + r.layerPx + ' px, hidden ' + r.hiddenPx + ')').join('; '));
    const b64 = (f) => fs.readFileSync(path.join(OUT, f)).toString('base64');
    const layers = rep.map(r => ({ id: r.layerId, rgba: b64('obj_' + r.layerId + '_color.rgba'), vis: b64('obj_' + r.layerId + '_vis.u8'), depth: b64('obj_' + r.layerId + '_depth.f32') }));
    const poses = (process.env.POSES || '0:0,0.6:0,1:-0.5,-1:0.5').split(',').map(s => s.split(':').map(Number));
    const results = {};
    for (const arm of ARMS) {
        const st = await page.evaluate(([arm, layers]) => {
            window._clearObjectLayers();
            if (arm === 'none') return [];
            const dec = (s) => { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
            const entries = layers.map(L => { const rgba = new Uint8ClampedArray(dec(L.rgba).buffer); const vis = dec(L.vis); const d = dec(L.depth); const depth = arm === 'truth' ? new Float32Array(d.buffer, d.byteOffset, d.byteLength / 4) : null; return { id: L.id, rgba, vis, depth }; });
            return window._importObjectLayersFromData(entries);
        }, [arm, layers]);
        console.log('arm ' + arm + ': ' + JSON.stringify(st));
        results[arm] = { layers: st, shots: {} };
        for (const [fx, fy] of poses) {
            const r = await page.evaluate(async ([fx, fy]) => {
                if (typeof updateVolumeGuidesVisibility === 'function') updateVolumeGuidesVisibility(false);
                isSweeping = true;
                const D = Math.abs(camera.position.z - portalPlaneWorldZ); const exR = D * Math.tan(bgViewFadeEndDeg * Math.PI / 180);
                camera.position.x = fx * exR; camera.position.y = fy * exR * bgEnvAspect();
                const tA = performance.now(); updateCameraAndProjection(); render(); const tB = performance.now(); updateCameraAndProjection(); render(); const tC = performance.now();
                console.log('[S27-time] render1 ' + (tB - tA).toFixed(0) + ' ms, render2 ' + (tC - tB).toFixed(0) + ' ms');
                const W = renderer.domElement.width, Hh = renderer.domElement.height;
                const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh; const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
                isSweeping = false; return { W, Hh, png: cv.toDataURL('image/png') };
            }, [fx, fy]);
            const tag = arm + '_' + String(fx).replace('-', 'm') + '_' + String(fy).replace('-', 'm');
            fs.writeFileSync(path.join(OUT, tag + '.png'), Buffer.from(r.png.split(',')[1], 'base64'));
            results[arm].shots[fx + ':' + fy] = tag + '.png';
        }
    }
    // the truth's own views at the same eyes
    for (const [fx, fy] of poses) { const f = path.join(OUT, 'truth_' + String(fx).replace('-', 'm') + '_' + String(fy).replace('-', 'm') + '.png'); if (!fs.existsSync(f)) { try { execFileSync('python3', [path.join(TK, 'truth_view.py'), S, String(fx), String(fy), f], { stdio: 'ignore' }); } catch (e) { console.log('  truth view failed ' + fx + ',' + fy); } } }
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ scene: S, meta, bake: { pw: bake.pw, ph: bake.ph, objects: bake.objects, overflow: bake.overflow }, truthLayers: rep, poses, results }, null, 1));
    await browser.close(); srv.kill(); console.log('done ' + OUT);
})();
