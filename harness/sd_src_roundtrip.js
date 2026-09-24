// S62 §11: the SD stage on the source-mode bundle, end to end in the app. Two modes, one picture per run:
//   MODE=export  bake in source mode, exportSDBundle() with the download intercepted -> <out>/bundle.zip
//   MODE=view    bake again, render the wide poses (before), import <out>/return/return_band_*.png through the app's own
//                _importPlaneReturnFiles (the "Import plane return" button's path), render the same poses (after)
// Between the two: python3 harness/sd_return.py <out>/bundle.zip <out>/return [--depth]
//   COLOR= DEPTH= TAG= MODE=export|view [PORT=8099] [MB=<variant moebius.js>] [SEL=...] node harness/sd_src_roundtrip.js
// Output: harness/shots/sd_src/<TAG>/{bundle.zip, before_<pose>.png, after_<pose>.png, view.json}
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const H = __dirname, PORT = +(process.env.PORT || 8099), MODE = process.env.MODE || 'export';
const OUT = path.join(H, 'shots', 'sd_src', process.env.TAG || 'x'); fs.mkdirSync(OUT, { recursive: true });
const WT = path.resolve(H, '..');
// the wide poses: head at the envelope's horizontal edge (the S59 L42/R42, eye 0.2 m from the window), the corners, pitch
const POSES = [['rest', 0, 0.008], ['L42', -0.18, 0.008], ['R42', 0.18, 0.008], ['LU', -0.18, 0.1], ['RD', 0.18, -0.1], ['up30', 0, 0.115]];
(async () => {
    fs.copyFileSync(path.resolve(WT, process.env.COLOR || 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, process.env.DEPTH || 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); } catch (e) {} });
    let PAGE = 'scratch_moebius.html';
    if (process.env.MB) { fs.mkdirSync(path.join(H, '_var'), { recursive: true }); const tag = (process.env.TAG || 'x').replace(/[^\w-]/g, '_'); fs.copyFileSync(path.resolve(process.env.MB), path.join(H, '_var', 'mb_' + tag + '.js'));
        fs.writeFileSync(path.join(H, '_var_' + tag + '.html'), fs.readFileSync(path.join(H, PAGE), 'utf8').replace('src="moebius.js"', 'src="_var/mb_' + tag + '.js"')); PAGE = '_var_' + tag + '.html'; }
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(PORT) }) }); await new Promise(r => setTimeout(r, 1500));
    { const r = await fetch('http://localhost:' + PORT + '/__root').then(x => x.text()).catch(() => ''); if (r !== H) { console.error('ABORT: port ' + PORT + ' is served from ' + (r.slice(0, 80) || 'nothing') + ', not this tree (' + H + ')'); srv.kill(); process.exit(4); } }
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage({ viewport: { width: 1368, height: 770 } }); const logs = [];
    page.on('console', m => { const t = m.text(); if (/\[S62\]|\[Sprint 25\]|SD-BUNDLE|return/i.test(t)) logs.push(t.slice(0, 400)); });
    page.on('pageerror', e => logs.push('PAGEERR ' + e.message.slice(0, 300)));
    await page.goto('http://localhost:' + PORT + '/' + PAGE, { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth && mediaLayers[0]._depth16); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
    await page.evaluate((sel) => {
        try { localStorage.clear(); } catch (e) {}
        for (const [id, v] of Object.entries(Object.assign({ bgPlateHoleSel: 'source', bgPlateRampSel: 'off' }, sel))) { const el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('change')); } }
    }, JSON.parse(process.env.SEL || '{}'));
    const t0 = Date.now(); await page.evaluate(() => document.getElementById('bgLayerBuildBtn').click());
    for (let t = 0; t < 2400; t++) { if (await page.evaluate(() => !!window._bgQuickBaked && !!window._qbPlateF && !!window._qbSourceHole)) break; await new Promise(r => setTimeout(r, 500)); }
    const bakeMs = Date.now() - t0; const stats = await page.evaluate(() => window._qbSourceHole);
    const grab = async (x, y) => page.evaluate(([x, y]) => { isSweeping = true; camera.position.set(x, y, 0.2); updateCameraAndProjection(); render(); updateCameraAndProjection(); render(); return renderer.domElement.toDataURL('image/png').split(',')[1]; }, [x, y]);
    if (MODE === 'export') {
        const zb = await page.evaluate(async () => {
            let href = null; const rc = HTMLAnchorElement.prototype.click, ra = window.alert; HTMLAnchorElement.prototype.click = function () { href = this.href; }; window.alert = () => {};
            let threw = null; try { await exportSDBundle(); } catch (e) { threw = String(e); }
            for (let t = 0; t < 600 && !href; t++) await new Promise(r => setTimeout(r, 100));
            HTMLAnchorElement.prototype.click = rc; window.alert = ra; return { threw, b64: href && href.startsWith('data:') ? href.split(',')[1] : null, blob: href && href.startsWith('blob:') ? href : null };
        });
        let bytes = zb.b64 ? Buffer.from(zb.b64, 'base64') : null;
        if (!bytes && zb.blob) bytes = Buffer.from(await page.evaluate(async (u) => { const b = await (await fetch(u)).arrayBuffer(); let s = ''; const a = new Uint8Array(b); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); }, zb.blob), 'base64');
        if (!bytes) { console.error('no bundle: ' + (zb.threw || 'no download')); process.exit(2); }
        fs.writeFileSync(path.join(OUT, 'bundle.zip'), bytes);
        fs.writeFileSync(path.join(OUT, 'export.json'), JSON.stringify({ bakeMs, stats, bytes: bytes.length, logs }, null, 1));
        console.log(JSON.stringify({ bundle: path.join(OUT, 'bundle.zip'), bytes: bytes.length, hole: stats && stats.hole, bakeMs }));
    } else {
        for (const [n, x, y] of POSES) fs.writeFileSync(path.join(OUT, 'before_' + n + '.png'), Buffer.from(await grab(x, y), 'base64'));
        const RD = path.join(OUT, 'return'); const files = fs.readdirSync(RD).filter(f => /^return_band_.*\.png$/.test(f)).map(f => [f, fs.readFileSync(path.join(RD, f)).toString('base64')]);
        const st = await page.evaluate(async (files) => {
            const F = files.map(([n, b]) => { const s = atob(b), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return new File([a], n, { type: 'image/png' }); });
            const r = await window._importPlaneReturnFiles(F); return r ? JSON.parse(JSON.stringify(r, (k, v) => (v && v.length > 64 && typeof v !== 'string') ? '[array]' : v)) : null;
        }, files);
        for (const [n, x, y] of POSES) fs.writeFileSync(path.join(OUT, 'after_' + n + '.png'), Buffer.from(await grab(x, y), 'base64'));
        fs.writeFileSync(path.join(OUT, 'view.json'), JSON.stringify({ bakeMs, stats, imported: files.map(f => f[0]), importReport: st, logs }, null, 1));
        console.log(JSON.stringify({ imported: files.map(f => f[0]), band: st && st.band, bakeMs }));
    }
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
