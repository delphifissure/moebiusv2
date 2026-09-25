// S71: the "Find objects" button, headless, end to end: start harness/paint_server.py, load the app, press Find objects
// (window.findObjects) with no plate baked, and check it (1) bakes, (2) posts the picture, (3) gets masks back, (4) keeps
// them by the depth rule and sets the object map; plus the refusals (no server; unknown method).
//   [METHOD=owl_sam|gdino_sam|birefnet|sam3] [COLOR=… DEPTH_PNG=…] [PORT=8098] [PPORT=8766] node harness/find_objects_check.js
// Output: harness/shots/find_objects/<method>_ids.png (picture | kept objects, one colour each), <method>_check.json
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const H = __dirname, WT = path.resolve(H, '..'), PORT = +(process.env.PORT || 8098), PPORT = +(process.env.PPORT || 8766), METHOD = process.env.METHOD || 'owl_sam';
const OUT = path.join(H, 'shots', 'find_objects'); fs.mkdirSync(OUT, { recursive: true });
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
    page.on('console', m => { const t = m.text(); if (/\[S71\]|PAGEERR/.test(t)) logs.push(t.slice(0, 300)); });
    page.on('pageerror', e => logs.push('PAGEERR ' + e.message.slice(0, 300)));
    let crashed = false; page.on('crash', () => { crashed = true; console.log('PAGE CRASHED'); });
    page.on('console', m => { if (/\[S71\]|\[S28\]/.test(m.text())) console.log('  page: ' + m.text().slice(0, 200)); });
    await page.goto('http://localhost:' + PORT + '/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { if (await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth && mediaLayers[0]._depth16); } catch (e) { return false; } }).catch(() => false)) break; await sleep(1000); }
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} const el = document.getElementById('bgPlateHoleSel'); if (el) { el.value = 'source'; el.dispatchEvent(new Event('change')); } });
    const R = { method: METHOD, refusals: {} };
    R.refusals.noServer = await page.evaluate(async () => { const r = await window.findObjects({ base: 'http://localhost:1' }); return { result: r, status: document.getElementById('findStatus').textContent, baked: !!window._bgQuickBaked }; });
    R.refusals.badMethod = await page.evaluate(async (p) => { const r = await fetch('http://localhost:' + p + '/segment?method=nope', { method: 'POST', body: new Uint8Array([137, 80, 78, 71]) }); return { status: r.status, body: await r.json() }; }, PPORT);
    // watchdog: if the page stops answering for 90 s, pause its JavaScript and print where it is
    const cdp = await page.context().newCDPSession(page); await cdp.send('Debugger.enable'); let lastAns = Date.now(), dumped = 0;
    cdp.on('Debugger.paused', async (ev) => { console.log('PAUSED STACK:\n' + ev.callFrames.slice(0, 12).map(f => '  ' + (f.functionName || '(anon)') + ' ' + f.url.split('/').pop() + ':' + (f.location.lineNumber + 1)).join('\n')); await cdp.send('Debugger.resume').catch(() => {}); });
    const dog = setInterval(() => { if (Date.now() - lastAns > 90e3 && dumped < 3) { dumped++; lastAns = Date.now(); cdp.send('Debugger.pause').catch(e => console.log('pause failed ' + e.message)); } }, 10e3);
    const t0 = Date.now();
    const P = page.evaluate(async ([pp, m]) => { document.getElementById('paintServerUrl').value = 'http://localhost:' + pp; document.getElementById('findMethodSel').value = m; return await window.findObjects(); }, [PPORT, METHOD]);
    const seen = [];
    for (;;) { const s = await page.evaluate(() => ({ st: document.getElementById('findStatus').textContent, busy: !!window._findBusy })).catch(() => null);
        if (crashed || Date.now() - t0 > 3 * 3600e3) { R.aborted = crashed ? 'page crashed' : 'timeout 3 h'; break; }
        if (s) { const k = s.st.replace(/\d+ s.*/, ''); if (!seen.length || seen[seen.length - 1] !== k) seen.push(k); if (!s.busy) break; }
        if (s) lastAns = Date.now();
        await sleep(1500); }
    clearInterval(dog);
    R.result = R.aborted ? null : await P; R.seconds = (Date.now() - t0) / 1000; R.statusSequence = seen;
    // the object map as set: picture | ids (one colour per kept object)
    const png = await page.evaluate(() => {
        const { pw, ph } = window._qbSize, ids = window._extObj && window._extObj.ids; if (!ids || ids.length !== pw * ph) return null;
        const cv = document.createElement('canvas'); cv.width = 2 * pw; cv.height = ph; const g = cv.getContext('2d');
        g.drawImage(mediaLayers[0].textures.color.image, 0, 0, pw, ph); g.drawImage(mediaLayers[0].textures.color.image, pw, 0, pw, ph);
        const im = g.getImageData(pw, 0, pw, ph), hue = (k) => [(k * 97) % 200 + 55, (k * 57) % 200 + 55, (k * 151) % 200 + 55];
        for (let i = 0; i < pw * ph; i++) { const k = ids[i]; if (!k) { for (let c = 0; c < 3; c++) im.data[4 * i + c] *= 0.35; continue; } const h = hue(k); for (let c = 0; c < 3; c++) im.data[4 * i + c] = 0.4 * im.data[4 * i + c] + 0.6 * h[c]; }
        g.putImageData(im, pw, 0); return cv.toDataURL('image/png').split(',')[1];
    });
    if (png) fs.writeFileSync(path.join(OUT, METHOD + '_ids.png'), Buffer.from(png, 'base64'));
    R.gotIds = !!png; R.logs = logs; R.serverLog = plog.split('\n').slice(-8);
    fs.writeFileSync(path.join(OUT, METHOD + '_check.json'), JSON.stringify(R, null, 1));
    console.log(JSON.stringify({ noServer: R.refusals.noServer.status.slice(0, 90), noServerBaked: R.refusals.noServer.baked, badMethod: R.refusals.badMethod, seconds: R.seconds, result: R.result, gotIds: R.gotIds, statusSequence: seen }));
    await browser.close(); done(R.result && R.result.kept > 0 ? 0 : 2);
})().catch(e => { console.error(e); process.exit(1); });
