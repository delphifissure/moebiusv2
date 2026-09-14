// S28: the object map from SAM 2.1 in the app, and the live highlight — bake (photo by default, or S=<kit scene>), set the
// external object map from <dir>/plane_object_ids_sam.png + objects_sam.json (IDS=dir), save the Object view, then shots of
// window._objectHighlight(sel) for SEL="0,1" at POSES="0:0,0.6:0" (plus the plain frame at each pose).
//   IMG=defaultImgColor.png,depth_da3mono16.png TAG=troll IDS=harness/shots/objlayers/view_troll SEL=0,1 node harness/objl_hl.js
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'; const H = __dirname, WT = path.resolve(__dirname, '..');
const S = process.env.S || null; const TAG = process.env.TAG || S || 'photo'; const OUT = path.join(H, 'shots', 'objlayers', 'hl_' + TAG); const IDS = process.env.IDS ? path.resolve(WT, process.env.IDS) : null;
const SEL = (process.env.SEL || '0,1').split(',').map(Number); const POSES = (process.env.POSES || '0:0,0.6:0,1:0').split(',').map(s => s.split(':').map(Number));
const meta = S ? JSON.parse(fs.readFileSync(path.join(H, 'truthkit', 'out', S, 'meta.json'), 'utf8')) : null;
(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    if (S) { fs.copyFileSync(path.join(H, 'truthkit', 'out', S, 'rest_rgb.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(H, 'truthkit', 'out', S, 'rest_depth16.png'), path.join(H, 'defaultImgDepth.png')); }
    else if (process.env.IMG) { const [c, d] = process.env.IMG.split(','); fs.copyFileSync(path.resolve(WT, c), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, d), path.join(H, 'defaultImgDepth.png')); }
    if (IDS) { fs.mkdirSync(path.join(H, 'objlayers_demo', '_ids'), { recursive: true }); for (const f of ['plane_object_ids_sam.png', 'objects_sam.json']) fs.copyFileSync(path.join(IDS, f), path.join(H, 'objlayers_demo', '_ids', f)); }
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    page.on('console', m => { const t = m.text(); if (/\[S27\]|\[S28\]|FAILED|rror/.test(t)) console.log('  [page] ' + t.slice(0, 300)); });
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
    if (IDS) {
        const st = await page.evaluate(async () => {
            const png = new File([await (await fetch('/objlayers_demo/_ids/plane_object_ids_sam.png')).blob()], 'plane_object_ids_sam.png', { type: 'image/png' });
            const j = await (await fetch('/objlayers_demo/_ids/objects_sam.json')).json();
            const pw = window._qbSize.pw, ph = window._qbSize.ph; const r = await _pngToRgba(png, pw, ph); const ids = new Uint8Array(pw * ph); for (let i = 0; i < ids.length; i++) ids[i] = r[i * 4];
            const e = window._setObjectIds(ids, j.objects, 'SAM 2.1 (' + j.model + ')'); return e ? e.objects.slice(0, 8) : null; });
        console.log('object map set: ' + JSON.stringify(st));
    }
    const DEMO = S ? path.join(H, 'objlayers_demo', S) : null;   // LAYERS=1: import the kit scene's completed layers first (S27 demo set), so the selected object's hidden part is in the picture
    if (process.env.LAYERS && DEMO && fs.existsSync(DEMO)) {
        const names = fs.readdirSync(DEMO).filter(f => /^obj_\d+_(color|visible)\.png$/.test(f));
        const st = await page.evaluate(async ([names, S]) => { const files = []; for (const n of names) { const b = await (await fetch('/objlayers_demo/' + S + '/' + n)).blob(); files.push(new File([b], n, { type: 'image/png' })); } return window._importObjectLayerFiles(files); }, [names, S]);
        console.log('imported ' + (st ? st.length : 0) + ' layers');
    }
    const view = await page.evaluate(() => { const v = window._objectView({ noDownload: true, quiet: true }); return v ? { png: v.canvas.toDataURL('image/png'), counts: v.counts } : null; });
    if (view) { fs.writeFileSync(path.join(OUT, 'object_view.png'), Buffer.from(view.png.split(',')[1], 'base64')); console.log('object view ' + JSON.stringify(view.counts)); }
    const shot = async (fx, fy, name) => { const r = await page.evaluate(async ([fx, fy]) => { isSweeping = true; const D = Math.abs(camera.position.z - portalPlaneWorldZ); const exR = D * Math.tan(bgViewFadeEndDeg * Math.PI / 180); camera.position.x = fx * exR; camera.position.y = fy * exR * bgEnvAspect();
        updateCameraAndProjection(); render(); updateCameraAndProjection(); render(); const W = renderer.domElement.width, Hh = renderer.domElement.height; const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh; cv.getContext('2d').drawImage(renderer.domElement, 0, 0, W, Hh); isSweeping = false; return cv.toDataURL('image/png'); }, [fx, fy]);
        fs.writeFileSync(path.join(OUT, name), Buffer.from(r.split(',')[1], 'base64')); };
    const ptag = (fx, fy) => String(fx).replace('-', 'm') + '_' + String(fy).replace('-', 'm');
    for (const [fx, fy] of POSES) await shot(fx, fy, 'plain_' + ptag(fx, fy) + '.png');
    for (const sel of SEL) { const st = await page.evaluate((s) => window._objectHighlight(s), sel); console.log('highlight ' + sel + ': ' + JSON.stringify(st));
        for (const [fx, fy] of POSES) await shot(fx, fy, 'hl' + sel + '_' + ptag(fx, fy) + '.png'); }
    await page.evaluate(() => window._objectHighlight(-1));
    await browser.close(); srv.kill(); console.log('done ' + OUT);
})();
