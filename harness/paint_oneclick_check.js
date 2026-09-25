// S70: the one-click Paint holes path, headless, end to end: start harness/paint_server.py, load the app, press
// "Paint holes" (window.paintHoles) with no plate baked, and check it (1) bakes, (2) posts the bundle, (3) imports the
// return, and (4) the view changes only where the band is; plus the refusals (no server; bad painter).
//   [PAINTER=lama] [DEPTH=0] [COLOR=… DEPTH_PNG=…] [PORT=8097] [PPORT=8765] node harness/paint_oneclick_check.js
// Output: harness/shots/paint_oneclick/{before,after}_L42.png, check.json
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const H = __dirname, WT = path.resolve(H, '..'), PORT = +(process.env.PORT || 8097), PPORT = +(process.env.PPORT || 8765);
const OUT = path.join(H, 'shots', 'paint_oneclick'); fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
    if (process.env.COLOR) { fs.copyFileSync(path.resolve(WT, process.env.COLOR), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, process.env.DEPTH_PNG), path.join(H, 'defaultImgDepth.png'));
        process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); } catch (e) {} }); }
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(PORT) }) });
    const ps = spawn('python3', [path.join(H, 'paint_server.py'), '--port', String(PPORT)], { cwd: WT, stdio: ['ignore', 'pipe', 'pipe'] });
    let plog = ''; ps.stdout.on('data', d => plog += d); ps.stderr.on('data', d => plog += d);
    const done = (code) => { try { srv.kill(); ps.kill(); } catch (e) {} process.exit(code); };
    await sleep(2000);
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } }); const logs = [];
    page.on('console', m => { const t = m.text(); if (/\[S70\]|SD-BUNDLE|Sprint 25|PAGEERR/.test(t)) logs.push(t.slice(0, 300)); });
    page.on('pageerror', e => logs.push('PAGEERR ' + e.message.slice(0, 300)));
    await page.goto('http://localhost:' + PORT + '/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { if (await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth && mediaLayers[0]._depth16); } catch (e) { return false; } }).catch(() => false)) break; await sleep(1000); }
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} for (const [id, v] of Object.entries({ bgPlateHoleSel: 'source' })) { const el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('change')); } } });
    const R = { refusals: {} };
    // refusal 1: nothing listening
    R.refusals.noServer = await page.evaluate(async () => { const r = await window.paintHoles({ base: 'http://localhost:1' }); return { result: r, status: document.getElementById('paintStatus').textContent, baked: !!window._bgQuickBaked }; });
    // refusal 2: a painter the server does not know
    R.refusals.badPainter = await page.evaluate(async (p) => { const r = await fetch('http://localhost:' + p + '/paint?painter=nope', { method: 'POST', body: new Uint8Array([80, 75, 3, 4]) }); return { status: r.status, body: await r.json() }; }, PPORT);
    const grab = async (x, y) => page.evaluate(([x, y]) => { isSweeping = true; camera.position.set(x, y, 0.2); updateCameraAndProjection(); render(); updateCameraAndProjection(); render(); isSweeping = false; return renderer.domElement.toDataURL('image/png').split(',')[1]; }, [x, y]);
    const t0 = Date.now();
    const P = page.evaluate(async ([pp, painter, depth]) => {
        document.getElementById('paintServerUrl').value = 'http://localhost:' + pp;
        document.getElementById('paintPainterSel').value = painter;
        document.getElementById('paintDepthChk').checked = depth;
        const r = await window.paintHoles(); return r ? JSON.parse(JSON.stringify(r, (k, v) => (v && v.length > 64 && typeof v !== 'string') ? '[array]' : v)) : { failed: document.getElementById('paintStatus').textContent };
    }, [PPORT, process.env.PAINTER || 'lama', process.env.DEPTH !== '0']);
    // watch the status line while it runs; grab the "before" once the bake is in and the import has not happened
    const seen = []; let before = null;
    for (;;) {
        const s = await page.evaluate(() => ({ st: document.getElementById('paintStatus').textContent, baked: !!window._bgQuickBaked && !!window._qbPlateF, ret: !!window._qbReturnStat, busy: !!window._paintBusy })).catch(() => null);
        if (s) { if (!seen.length || seen[seen.length - 1] !== s.st.replace(/\d+ s.*/, '')) seen.push(s.st.replace(/\d+ s.*/, ''));
                 if (!before && s.baked && !s.ret && /painting|queued/.test(s.st)) before = await grab(-0.18, 0.008); if (!s.busy) break; }
        await sleep(1500);
    }
    R.result = await P; R.seconds = (Date.now() - t0) / 1000; R.statusSequence = seen;
    const after = await grab(-0.18, 0.008);
    if (before) fs.writeFileSync(path.join(OUT, 'before_L42.png'), Buffer.from(before, 'base64'));
    fs.writeFileSync(path.join(OUT, 'after_L42.png'), Buffer.from(after, 'base64'));
    R.gotBefore = !!before; R.logs = logs; R.serverLog = plog.split('\n').slice(-8);
    fs.writeFileSync(path.join(OUT, 'check.json'), JSON.stringify(R, null, 1));
    console.log(JSON.stringify({ noServer: R.refusals.noServer.status.slice(0, 90), noServerBaked: R.refusals.noServer.baked, badPainter: R.refusals.badPainter, seconds: R.seconds, band: R.result && R.result.report && R.result.report.band, files: R.result && R.result.files, failed: R.result && R.result.failed, statusSequence: seen }));
    await browser.close(); done(R.result && R.result.report ? 0 : 2);
})().catch(e => { console.error(e); process.exit(1); });
