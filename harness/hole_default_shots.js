// The panel's Build with its defaults, per-line vs source hole depth (S62; source is now the default): the default
// picture at rest and at off-axis poses, screenshots of the canvas.   PORT=8125 node harness/hole_default_shots.js
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const H = __dirname, PORT = process.env.PORT || '8125', OUT = process.env.OUT || path.join(H, 'shots', 'hole_default'); fs.mkdirSync(OUT, { recursive: true });
const Z = 0.2, T = (d) => Z * Math.tan(d * Math.PI / 180);
const POSES = (process.env.POSES || 'rest,L30,R30,L42up,R42down').split(',').map(k => ({ rest: ['rest', 0, 0], L30: ['L30', -T(30), 0], R30: ['R30', T(30), 0], L42up: ['L42up', -T(42), T(15)], R42down: ['R42down', T(42), -T(15)] })[k]);
(async () => {
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore', env: Object.assign({}, process.env, { PORT }) });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const res = {};
    for (const hole of (process.env.ARMS || 'perline,source').split(',')) {
        const page = await browser.newPage({ viewport: { width: 912, height: 513 } }); const logs = [];
        page.on('console', m => { const t = m.text(); if (/\[S62\] source-anchored hole|\[S6\] plate bake|failed/.test(t)) logs.push(t.slice(0, 300)); });
        page.on('pageerror', e => logs.push('PAGEERR ' + e.message.slice(0, 200)));
        await page.goto('http://localhost:' + PORT + '/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
        for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
        const dflt = await page.evaluate(() => document.getElementById('bgPlateHoleSel').value);
        const t0 = Date.now();
        await page.evaluate((hole) => { window._rayReproject = true; document.getElementById('bgPlateHoleSel').value = hole; window._bakePlate(); }, hole);
        for (let t = 0; t < 600; t++) { const done = await page.evaluate(() => !!window._bgUserBuiltOnce && !window._qbSourceHoleBusy).catch(() => false); if (done) break; await new Promise(r => setTimeout(r, 1000)); }
        await page.evaluate(() => window._qbSourceHoleBusy ? window._qbSourceHoleBusy : null).catch(() => null);
        const secs = (Date.now() - t0) / 1000; res[hole] = { panelDefault: dflt, bakeSecs: secs, logs };
        for (const [tag, x, y] of POSES) {
            const b64 = await page.evaluate(([x, y]) => { isSweeping = true; camera.position.set(x, y, 0.2); updateCameraAndProjection(); render(); updateCameraAndProjection(); render();
                return renderer.domElement.toDataURL('image/png').split(',')[1]; }, [x, y]);
            fs.writeFileSync(path.join(OUT, hole + '_' + tag + '.png'), Buffer.from(b64, 'base64'));
        }
        console.log(hole + ': panel default was "' + dflt + '", bake ' + secs.toFixed(0) + ' s; ' + logs.join(' | ').slice(0, 400));
        await page.close();
    }
    fs.writeFileSync(path.join(OUT, 'hole_default.json'), JSON.stringify(res, null, 1));
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
