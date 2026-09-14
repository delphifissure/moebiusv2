// S27 object view, headless: bake (a kit scene S=… with its depth law, or the default photograph), save the object view
// before and — for a kit scene with demo layers in harness/objlayers_demo/<S> — after importing the completed layers.
//   S=S9 node harness/objl_view.js      IMG=defaultImgColor.png,depth_da3mono16.png TAG=troll node harness/objl_view.js
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'; const H = __dirname, WT = path.resolve(__dirname, '..');
const S = process.env.S || null; const TAG = process.env.TAG || S || 'photo'; const OUT = path.join(H, 'shots', 'objlayers', 'view_' + TAG); const DEMO = S ? path.join(H, 'objlayers_demo', S) : null;
const meta = S ? JSON.parse(fs.readFileSync(path.join(H, 'truthkit', 'out', S, 'meta.json'), 'utf8')) : null;
(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    if (S) { fs.copyFileSync(path.join(H, 'truthkit', 'out', S, 'rest_rgb.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(H, 'truthkit', 'out', S, 'rest_depth16.png'), path.join(H, 'defaultImgDepth.png')); }
    else if (process.env.IMG) { const [c, d] = process.env.IMG.split(','); fs.copyFileSync(path.resolve(WT, c), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, d), path.join(H, 'defaultImgDepth.png')); }
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    page.on('console', m => { const t = m.text(); if (/\[S27\]|\[S5\] self|FAILED|rror/.test(t)) console.log('  [page] ' + t.slice(0, 300)); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
    const sky = S ? (S === 'S15' || S === 'S32') : !!process.env.SKY;
    await page.evaluate(async (o) => {
        window._rayReproject = true; if (o.depth) { outerVolumeDepth = o.depth.outer; innerVolumeDepth = o.depth.inner; currentNormPortalPlane = o.depth.pn; }
        const sel = { bgPlateFarSel: 'plane', bgPlateFillSel: 'wash', bgPlateMarginSel: 'picture', bgPlateFacesSel: 'off', bgPlateBandSel: '35', bgPlateSkySel: o.sky ? 'on' : 'off', bgPlateStretchSel: 'inner', bgPlateRulesSel: 'cur' };
        for (const id in sel) { const el = document.getElementById(id); if (el) el.value = sel[id]; }
        if (window._applyPlateOptions) window._applyPlateOptions();
        window._tearLaw = 'rim'; window._farRule = 'plane'; if (o.sky) window._skyInf = 1; window._plugObjectRule = false; window._plugExtent = null; window._geoLipSeed = false; window._plugBack = false; window._plateFlushExempt = true;
        const modeSel3 = document.getElementById('bgModeSel'); if (modeSel3) modeSel3.value = 'quick'; bgQuickBake = true; window._bgBakeMode = 'quick';
        window._plugGeoBand({ flush: true, observed: true, gateAPriori: true }); window._bgUserBuiltOnce = true;
    }, { depth: meta ? { outer: meta.outer, inner: meta.inner, pn: meta.pn } : null, sky });
    const view = async (name) => { const r = await page.evaluate(() => { const v = window._objectView({ noDownload: true, quiet: true }); return v ? { png: v.canvas.toDataURL('image/png'), counts: v.counts } : null; });
        if (!r) { console.log('no view'); return; } fs.writeFileSync(path.join(OUT, name), Buffer.from(r.png.split(',')[1], 'base64')); console.log(name + ' ' + JSON.stringify(r.counts)); };
    // the object export for external segmenters: ids, boxes, and the source picture at the plate grid
    { const ex = await page.evaluate(() => { const ob = _planeObjects(false); const sz = window._qbSize; const u8 = ob.ids; let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        const L0 = mediaLayers[0]; const img = L0 && ((L0.elements && L0.elements.color) || (L0.textures && L0.textures.color && L0.textures.color.image)); const cv = document.createElement('canvas'); cv.width = sz.pw; cv.height = sz.ph; cv.getContext('2d').drawImage(img, 0, 0, sz.pw, sz.ph);
        return { pw: sz.pw, ph: sz.ph, objects: ob.objects, idsB64: btoa(s), src: cv.toDataURL('image/png'), depth: { outer: outerVolumeDepth, inner: innerVolumeDepth, pn: currentNormPortalPlane } }; });
      fs.writeFileSync(path.join(OUT, 'objIds.u8'), Buffer.from(ex.idsB64, 'base64')); fs.writeFileSync(path.join(OUT, 'objects.json'), JSON.stringify({ pw: ex.pw, ph: ex.ph, depth: ex.depth, objects: ex.objects }, null, 1)); fs.writeFileSync(path.join(OUT, 'source_plate.png'), Buffer.from(ex.src.split(',')[1], 'base64')); }
    await view('view_before.png');
    if (DEMO && fs.existsSync(DEMO)) {
        const names = fs.readdirSync(DEMO).filter(f => /^obj_\d+_(color|visible|depth16)\.png$/.test(f));
        const st = await page.evaluate(async ([names, S]) => { const files = []; for (const n of names) { const b = await (await fetch('/objlayers_demo/' + S + '/' + n)).blob(); files.push(new File([b], n, { type: 'image/png' })); } return window._importObjectLayerFiles(files); }, [names, S]);
        console.log('imported ' + (st ? st.length : 0) + ' layers'); await view('view_after_import.png');
    }
    await browser.close(); srv.kill(); console.log('done ' + OUT);
})();
