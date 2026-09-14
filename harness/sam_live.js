// S29: SAM 2.1 in the browser, headless. Bake the photograph as the panel does, start the live click mode (onnxruntime-web
// and the ONNX files served locally from harness/vendor/{ort,sam2}; WASM provider — headless has no WebGPU), check the
// screen <-> source mapping by colour, replay the offline clicks (S28 §2) through the same path a user click takes
// (pointerdown at the screen position of each source pixel), keep the objects, and compare the resulting id map with the
// offline script's plane_object_ids_sam.png (per-object IoU). Shots after the first click, after each accept, and at 0.6.
//   IMG=defaultImgColor.png,depth_da3mono16.png TAG=troll REF=harness/shots/objlayers/view_troll_v2 node harness/sam_live.js
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'; const H = __dirname, WT = path.resolve(__dirname, '..');
const TAG = process.env.TAG || 'troll'; const OUT = path.join(H, 'shots', 'samlive', TAG); const REF = process.env.REF ? path.resolve(WT, process.env.REF) : null;
const CLICKS = (process.env.CLICKS || '300,190+300,350+250,650+330,800;470,700+455,500').split(';').map(o => o.split('+').map(p => p.split(',').map(Number)));
(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    if (process.env.IMG) { const [c, d] = process.env.IMG.split(','); fs.copyFileSync(path.resolve(WT, c), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, d), path.join(H, 'defaultImgDepth.png')); }
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    await page.addInitScript(() => { window._ortBase = '/vendor/ort/'; window._sam2Base = '/vendor/sam2/'; window._sam2EP = 'wasm'; });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    page.on('console', m => { const t = m.text(); if (/\[S29\]|\[S28\]|FAILED|rror/.test(t) && !/NotFoundError/.test(t)) console.log('  [page] ' + t.slice(0, 300)); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
    await page.evaluate(async () => {
        window._rayReproject = true;
        const sel = { bgPlateFarSel: 'plane', bgPlateFillSel: 'wash', bgPlateMarginSel: 'picture', bgPlateFacesSel: 'off', bgPlateBandSel: '35', bgPlateSkySel: 'off', bgPlateStretchSel: 'inner', bgPlateRulesSel: 'cur' };
        for (const id in sel) { const el = document.getElementById(id); if (el) el.value = sel[id]; }
        if (window._applyPlateOptions) window._applyPlateOptions();
        window._tearLaw = 'rim'; window._farRule = 'plane'; window._plugObjectRule = false; window._plugExtent = null; window._geoLipSeed = false; window._plugBack = false; window._plateFlushExempt = true;
        const modeSel3 = document.getElementById('bgModeSel'); if (modeSel3) modeSel3.value = 'quick'; bgQuickBake = true; window._bgBakeMode = 'quick';
        window._plugGeoBand({ flush: true, observed: true, gateAPriori: true }); window._bgUserBuiltOnce = true;
    });
    const snap = async () => page.evaluate(() => { updateCameraAndProjection(); render(); updateCameraAndProjection(); render(); const W = renderer.domElement.width, Hh = renderer.domElement.height; const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh; cv.getContext('2d').drawImage(renderer.domElement, 0, 0, W, Hh); return cv.toDataURL('image/png'); });
    const shot = async (name) => fs.writeFileSync(path.join(OUT, name), Buffer.from((await snap()).split(',')[1], 'base64'));
    const t0 = Date.now(); await page.evaluate(() => window._samLive.start()); console.log('start + load + encode: ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s; ' + await page.evaluate(() => window._samLive.state.status) + ' ep=' + await page.evaluate(() => window._samLive.state.ep));
    if (!await page.evaluate(() => window._samLive.state.active)) { console.log('click mode did not start'); await browser.close(); srv.kill(); process.exit(1); }
    // mapping check: the rendered colour at srcToScreen(p) against the source colour at p, for 400 random source pixels; and against a shuffled pairing
    const mapchk = await page.evaluate(() => { updateCameraAndProjection(); render(); const W = renderer.domElement.width, Hh = renderer.domElement.height; const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh; const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh); const scr = cx.getImageData(0, 0, W, Hh).data;
        const sz = window._qbSize; const L0 = mediaLayers[0]; const img = (L0.elements && L0.elements.color) || L0.textures.color.image; const sc = document.createElement('canvas'); sc.width = sz.pw; sc.height = sz.ph; const scx = sc.getContext('2d'); scx.drawImage(img, 0, 0, sz.pw, sz.ph); const src = scx.getImageData(0, 0, sz.pw, sz.ph).data;
        const r = renderer.domElement.getBoundingClientRect(); const pts = []; let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
        for (let k = 0; k < 400; k++) { const x = 8 + rnd() * (sz.pw - 16), y = 8 + rnd() * (sz.ph - 16); const s = window._samLive.srcToScreen(x, y); const sx = Math.round((s.clientX - r.left) / r.width * W), sy = Math.round((s.clientY - r.top) / r.height * Hh); if (sx < 0 || sy < 0 || sx >= W || sy >= Hh) continue;
            const i = ((y | 0) * sz.pw + (x | 0)) * 4, j = (sy * W + sx) * 4; pts.push({ src: [src[i], src[i + 1], src[i + 2]], scr: [scr[j], scr[j + 1], scr[j + 2]] }); }
        const err = (a, b) => (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3; const e1 = pts.map(p => err(p.src, p.scr)).sort((a, b) => a - b); const e2 = pts.map((p, k) => err(p.src, pts[(k + 97) % pts.length].scr)).sort((a, b) => a - b);
        const back = pts.length ? window._samLive.screenToSrc(window._samLive.srcToScreen(123.4, 456.7).clientX, window._samLive.srcToScreen(123.4, 456.7).clientY) : null;
        return { n: pts.length, medianErrMapped: e1[e1.length >> 1], medianErrShuffled: e2[e2.length >> 1], roundTrip: back }; });
    console.log('mapping check ' + JSON.stringify(mapchk));
    const results = [];
    for (let o = 0; o < CLICKS.length; o++) {
        for (let c = 0; c < CLICKS[o].length; c++) { const [x, y] = CLICKS[o][c]; const s = await page.evaluate(([x, y]) => window._samLive.srcToScreen(x, y), [x, y]);
            const t1 = Date.now(); await page.mouse.click(s.clientX, s.clientY); await page.waitForFunction(() => !window._samLive.state.busy && window._samLive.state.cands, null, { timeout: 120000 });
            const st = await page.evaluate(() => ({ clicks: window._samLive.state.clicks.length, cands: window._samLive.state.cands.map(q => ({ area: q.area, iou: +q.iou.toFixed(3) })), ms: +window._samLive.state.cands.ms.toFixed(0) }));
            console.log('object ' + (o + 1) + ' click ' + (c + 1) + ' at (' + x + ',' + y + ') -> screen (' + s.clientX.toFixed(1) + ',' + s.clientY.toFixed(1) + '): ' + JSON.stringify(st) + ' wall ' + (Date.now() - t1) + ' ms');
            if (o === 0 && c === 0) await shot('after_first_click.png'); }
        const kept = await page.evaluate(() => window._samLive.accept()); console.log('kept ' + JSON.stringify(kept)); results.push(kept); await shot('after_accept_' + (o + 1) + '.png');
    }
    const cmp = await page.evaluate(async (ref) => { const ids = window._extObj.ids; const sz = window._qbSize; let refIds = null; if (ref) { const png = new File([await (await fetch(ref)).blob()], 'ref.png', { type: 'image/png' }); const r = await _pngToRgba(png, sz.pw, sz.ph); refIds = new Uint8Array(sz.pw * sz.ph); for (let i = 0; i < refIds.length; i++) refIds[i] = r[i * 4]; }
        const out = { objects: window._extObj.objects.map(o => ({ id: o.id, footprintPx: o.footprintPx, bandPx: o.bandPx })), iouVsOffline: [] };
        if (refIds) for (const o of window._extObj.objects) { let inter = 0, uni = 0; for (let i = 0; i < ids.length; i++) { const a = ids[i] === o.id, b = refIds[i] === o.id; if (a && b) inter++; if (a || b) uni++; } out.iouVsOffline.push({ id: o.id, iou: +(inter / Math.max(1, uni)).toFixed(3) }); }
        return out; }, REF ? '/shots/objlayers/' + path.basename(REF) + '/plane_object_ids_sam.png' : null);
    console.log('object map ' + JSON.stringify(cmp));
    console.log('guide visible after clicks (must be false): ' + await page.evaluate(() => !!(typeof portalPlaneGuide !== 'undefined' && portalPlaneGuide && portalPlaneGuide.visible)) + '; manual offset ' + await page.evaluate(() => manualCamDX.toFixed(4) + ',' + manualCamDY.toFixed(4)));
    await page.evaluate(() => window._samLive.stop()); await page.evaluate(() => window._objectHighlight(1));
    await page.evaluate(() => { isSweeping = true; const D = Math.abs(camera.position.z - portalPlaneWorldZ); const exR = D * Math.tan(bgViewFadeEndDeg * Math.PI / 180); camera.position.x = 0.6 * exR; camera.position.y = 0; }); await shot('hl1_0.6_0.png');
    fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ mapchk, results, cmp, encMs: await page.evaluate(() => window._samLive.state.encMs), ep: await page.evaluate(() => window._samLive.state.ep) }, null, 1));
    await browser.close(); srv.kill(); console.log('done ' + OUT);
})();
