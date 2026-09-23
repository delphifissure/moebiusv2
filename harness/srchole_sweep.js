// S62 in motion: one picture baked twice in the app -- today's defaults, then 'hole depth: source' -- and a yaw sweep
// (-42 -> +42 -> -42 deg, the S59 pose's height) rendered for each; in source mode the SD bundle is exported and linted.
// Frames: <out>/today_NN.png, <out>/source_NN.png; bundle.zip, lint.json, sweep.json.
//   COLOR= DEPTH= TAG= NF=24 node harness/srchole_sweep.js
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const H = __dirname; const OUT = path.join(__dirname, 'shots', 'srchole_sweep', process.env.TAG || 'x'); fs.mkdirSync(OUT, { recursive: true });
const Z = 0.2, T = (deg) => Z * Math.tan(deg * Math.PI / 180);
const POSES = [['yawR42', 0.180, 0.008], ['yawL42', -0.180, 0.008], ['yaw22', T(22.5), 0], ['pitch30', 0, T(30)]];
const WT = path.resolve(__dirname, '..');
(async () => {
    fs.copyFileSync(path.resolve(WT, process.env.COLOR || 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, process.env.DEPTH || 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1500));
    { const r = await fetch('http://localhost:8099/__root').then(x => x.text()).catch(() => ''); if (r !== H) { console.error('ABORT: port 8099 is served from ' + (r.slice(0, 80) || 'nothing') + ', not this tree (' + H + ')'); srv.kill(); process.exit(4); } }
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } }); const logs = [];
    page.on('console', m => { const t = m.text(); if (/\[S62\]|\[S6\] plate bake/.test(t)) logs.push(t.slice(0, 1500)); });
    page.on('pageerror', e => logs.push('PAGEERR ' + e.message.slice(0, 200)));
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
    const NF = parseInt(process.env.NF || '24', 10); const xs = []; for (let k = 0; k < NF; k++) xs.push(-0.180 * Math.cos(2 * Math.PI * k / NF));
    const shot = async (name) => { const b64 = await page.evaluate(() => { updateCameraAndProjection(); render(); updateCameraAndProjection(); render(); return renderer.domElement.toDataURL('image/png').split(',')[1]; }); fs.writeFileSync(path.join(OUT, name), Buffer.from(b64, 'base64')); };
    const rep = {};
    for (const [mode, SEL] of [['today', { bgPlateHoleSel: 'perline', bgPlateRampSel: 'off' }], ['source', { bgPlateHoleSel: 'source', bgPlateRampSel: 'off' }]]) {
        await page.evaluate((SEL) => { try { localStorage.clear(); } catch (e) {} window._bgUserBuiltOnce = false; window._bgQuickBaked = false;   /* a change after the first bake re-bakes by itself: switch the options quietly, then click once */ window._qbSourceHole = null; for (const id in SEL) { const el = document.getElementById(id); if (el) { el.value = SEL[id]; el.dispatchEvent(new Event('change')); } } }, SEL);
        const t0 = Date.now(); await page.evaluate(() => document.getElementById('bgLayerBuildBtn').click());
        await new Promise(r => setTimeout(r, 2000));
        for (let t = 0; t < 1600; t++) { if (await page.evaluate(() => !!window._bgQuickBaked && !!window._qbPlateF && (!window._srcHole || !!window._qbSourceHole))) break; await new Promise(r => setTimeout(r, 500)); }
        rep[mode] = { bakeMs: Date.now() - t0, stats: await page.evaluate(() => window._qbSourceHole || null) };
        for (let k = 0; k < NF; k++) { await page.evaluate((x) => { isSweeping = true; camera.position.set(x, 0.008, 0.2); }, xs[k]); await shot(mode + '_' + String(k).padStart(2, '0') + '.png'); }
        if (mode === 'source') {
            await page.evaluate(() => { isSweeping = true; camera.position.set(0, 0, 0.2); });
            const zb = await page.evaluate(() => { const ra = window.alert; window.alert = () => {}; let href = null; const rc = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { href = this.href; };
                let threw = null; try { exportSDBundle(); } catch (e) { threw = String(e); } HTMLAnchorElement.prototype.click = rc; window.alert = ra; return { threw, b64: href ? href.split(',')[1] : null }; });
            if (zb.b64) { const BZ = path.join(OUT, 'bundle.zip'); fs.writeFileSync(BZ, Buffer.from(zb.b64, 'base64'));
                const lint = require('child_process').spawnSync('python3', [path.join(H, 'atlas_lint.py'), BZ], { encoding: 'utf8' }); fs.writeFileSync(path.join(OUT, 'lint.json'), lint.stdout); rep.lint = lint.stdout.replace(/\s+/g, ' ').slice(0, 700); }
            else rep.bundleError = zb.threw || 'no bundle';
        }
    }
    fs.writeFileSync(path.join(OUT, 'sweep.json'), JSON.stringify(Object.assign(rep, { logs }), null, 1)); console.log(JSON.stringify(rep).slice(0, 2500));
    await browser.close(); srv.kill();
})();
