// End to end in one command: bake (with any panel options) -> SD bundle -> atlas_lint -> sd_return.py (SD 1.5 inpaint +
// depth ControlNet on the S52 contract) -> the app's own Import plane return (the same function the button calls) ->
// frames at the A/B poses, before and after the return. The page stays open while SD runs.
//   COLOR= DEPTH= TAG= SEL='{"bgPlateHoleSel":"plain"}' STEPS=20 LONG=768 DEPTHBACK=1 node harness/e2e.js
'use strict';
const { chromium } = require('playwright-core'); const { spawn, spawnSync } = require('child_process'); const fs = require('fs'); const path = require('path');
const H = __dirname, WT = path.resolve(__dirname, '..'); const TAG = process.env.TAG || 'e2e'; const OUT = path.join(H, 'shots', 'e2e', TAG); fs.mkdirSync(OUT, { recursive: true });
const Z = 0.2, T = (deg) => Z * Math.tan(deg * Math.PI / 180);
const POSES = [['yawR42', 0.180, 0.008], ['yawL42', -0.180, 0.008], ['yaw22', T(22.5), 0], ['pitch30', 0, T(30)]];
const log = (...a) => { const s = a.join(' '); console.log(s); fs.appendFileSync(path.join(OUT, 'e2e.log'), s + '\n'); };
(async () => {
    fs.copyFileSync(path.resolve(WT, process.env.COLOR || 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, process.env.DEPTH || 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1500));
    { const r = await fetch('http://localhost:8099/__root').then(x => x.text()).catch(() => ''); if (r !== H) { console.error('ABORT: port 8099 is served from ' + (r.slice(0, 80) || 'nothing') + ', not this tree (' + H + ')'); srv.kill(); process.exit(4); } }
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('console', m => { const t = m.text(); if (/\[S61\]|\[Sprint 25\]|\[S6\] plate bake/.test(t)) log('  page:', t.slice(0, 500)); });
    page.on('pageerror', e => log('  PAGEERR', e.message.slice(0, 200)));
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
    const SEL = JSON.parse(process.env.SEL || '{}');
    await page.evaluate((SEL) => { try { localStorage.clear(); } catch (e) {} for (const id in SEL) { const el = document.getElementById(id); if (el) { el.value = SEL[id]; el.dispatchEvent(new Event('change')); } } }, SEL);
    const t0 = Date.now(); await page.evaluate(() => document.getElementById('bgLayerBuildBtn').click());
    for (let t = 0; t < 640; t++) { if (await page.evaluate(() => !!window._bgQuickBaked && !!window._qbPlateF)) break; await new Promise(r => setTimeout(r, 500)); }
    log('bake', Date.now() - t0, 'ms', JSON.stringify(SEL));
    const shot = async (name) => { const b64 = await page.evaluate(() => { updateCameraAndProjection(); render(); updateCameraAndProjection(); render(); return renderer.domElement.toDataURL('image/png').split(',')[1]; }); fs.writeFileSync(path.join(OUT, name), Buffer.from(b64, 'base64')); };
    const shoot = async (suffix) => { for (const [n, x, y] of POSES) { await page.evaluate(([x, y]) => { isSweeping = true; camera.position.set(x, y, 0.2); }, [x, y]); await shot(n + '_' + suffix + '.png'); } };
    await shoot('atlas');
    // the bundle, captured
    const zb = await page.evaluate(() => { const ra = window.alert; window.alert = () => {}; let href = null; const rc = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { href = this.href; };
        let threw = null; try { exportSDBundle(); } catch (e) { threw = String(e); } HTMLAnchorElement.prototype.click = rc; window.alert = ra; return { threw, b64: href ? href.split(',')[1] : null }; });
    if (!zb.b64) { log('ABORT: no bundle', zb.threw); process.exit(2); }
    const BZ = path.join(OUT, 'bundle.zip'); fs.writeFileSync(BZ, Buffer.from(zb.b64, 'base64')); log('bundle', Math.round(zb.b64.length * 0.75 / 1024), 'KB');
    const lint = spawnSync('python3', [path.join(H, 'atlas_lint.py'), BZ], { encoding: 'utf8' }); fs.writeFileSync(path.join(OUT, 'lint.json'), lint.stdout); log('lint', lint.stdout.replace(/\s+/g, ' ').slice(0, 600));
    // SD, with the page kept open
    const RET = path.join(OUT, 'return'); const args = [path.join(H, 'sd_return.py'), BZ, RET, '--steps', process.env.STEPS || '20', '--long', process.env.LONG || '768'];
    if (process.env.DEPTHBACK) args.push('--depth');
    const t1 = Date.now(); const sd = spawnSync('python3', args, { encoding: 'utf8', maxBuffer: 64 << 20 }); log('sd_return', Date.now() - t1, 'ms', (sd.stdout || '').trim().split('\n').pop().slice(0, 500), sd.status !== 0 ? ('ERR ' + (sd.stderr || '').slice(-400)) : '');
    if (sd.status !== 0) { await browser.close(); srv.kill(); process.exit(3); }
    // the app's own import, fed the files the way the button feeds them
    const files = fs.readdirSync(RET).filter(f => /^return_band_(color|depth16|gradx16|grady16)\.png$/.test(f)).map(f => ({ name: f, b64: fs.readFileSync(path.join(RET, f)).toString('base64') }));
    const st = await page.evaluate(async (files) => {
        const fl = files.map(({ name, b64 }) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new File([u], name, { type: 'image/png' }); });
        const s = await window._importPlaneReturnFiles(fl); return s ? JSON.parse(JSON.stringify(s)) : null;
    }, files);
    log('import', JSON.stringify(st).slice(0, 800)); fs.writeFileSync(path.join(OUT, 'import.json'), JSON.stringify(st, null, 1));
    await shoot('sd');
    await browser.close(); srv.kill(); log('done', OUT);
})();
