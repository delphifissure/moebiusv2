// S62 live: the app's own source-anchored hole (panel 'hole depth: source'): bake, the app's stats, the S59 poses, and the
// plate as rendered against srcfill.py's plate for the same picture.
//   COLOR= DEPTH= FILL=<srcfill out dir> TAG= node harness/srchole_live.js
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const H = __dirname; const OUT = path.join(__dirname, 'shots', 'srchole_live', process.env.TAG || 'x'); fs.mkdirSync(OUT, { recursive: true });
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
    const SEL = JSON.parse(process.env.SEL || '{"bgPlateHoleSel":"source","bgPlateRampSel":"off"}');
    await page.evaluate((SEL) => { try { localStorage.clear(); } catch (e) {} for (const id in SEL) { const el = document.getElementById(id); if (el) { el.value = SEL[id]; el.dispatchEvent(new Event('change')); } } }, SEL);
    const t0 = Date.now(); await page.evaluate(() => document.getElementById('bgLayerBuildBtn').click());
    for (let t = 0; t < 1200; t++) { if (await page.evaluate(() => !!window._bgQuickBaked && !!window._qbPlateF && (!window._srcHole || !!window._qbSourceHole))) break; await new Promise(r => setTimeout(r, 500)); }
    const bakeMs = Date.now() - t0;
    const info = await page.evaluate(() => {
        const { pw, ph } = window._qbSize, N = pw * ph, data = bgLayerMesh.material.uniforms.displacementMap.value.image.data;
        const src = new Float32Array(N); for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) src[y * pw + x] = data[(ph - 1 - y) * pw + x];
        let s = ''; const u8 = new Uint8Array(src.buffer); for (let k = 0; k < u8.length; k += 32768) s += String.fromCharCode.apply(null, u8.subarray(k, k + 32768));
        let hs = ''; const h = window._qbSrcHole ? Uint8Array.from(window._qbSrcHole) : new Uint8Array(N); for (let k = 0; k < h.length; k += 32768) hs += String.fromCharCode.apply(null, h.subarray(k, k + 32768));
        return { pw, ph, stats: window._qbSourceHole || null, plate: btoa(s), hole: btoa(hs) };
    });
    fs.writeFileSync(path.join(OUT, 'plate.f32'), Buffer.from(info.plate, 'base64')); fs.writeFileSync(path.join(OUT, 'hole.u8'), Buffer.from(info.hole, 'base64'));
    const shot = async (name) => { const b64 = await page.evaluate(() => { updateCameraAndProjection(); render(); updateCameraAndProjection(); render(); return renderer.domElement.toDataURL('image/png').split(',')[1]; }); fs.writeFileSync(path.join(OUT, name), Buffer.from(b64, 'base64')); };
    for (const [n, x, y] of POSES) { await page.evaluate(([x, y]) => { isSweeping = true; camera.position.set(x, y, 0.2); }, [x, y]); await shot('S_' + n + '.png'); }
    let cmp = null;
    if (process.env.FILL && fs.existsSync(path.join(process.env.FILL, 'plateD.f32'))) {
        const f32 = (p) => { const x = fs.readFileSync(p); return new Float32Array(x.buffer, x.byteOffset, x.byteLength / 4); };
        const A = f32(path.join(OUT, 'plate.f32')), P = f32(path.join(process.env.FILL, 'plateD.f32')), hA = fs.readFileSync(path.join(OUT, 'hole.u8')), hP = fs.readFileSync(path.join(process.env.FILL, 'hole.u8'));
        const step = info.stats ? info.stats.step : 1e-3; let big = 0, hd = 0; for (let i = 0; i < A.length; i++) { if (Math.abs(A[i] - P[i]) > step) big++; if (!!hA[i] !== !!hP[i]) hd++; }
        cmp = { plateTexelsOverOneStepFromPython: big, holeTexelsDiffering: hd };
    }
    const rep = { bakeMs, stats: info.stats, vsPython: cmp, logs }; fs.writeFileSync(path.join(OUT, 'live.json'), JSON.stringify(rep, null, 1)); console.log(JSON.stringify({ bakeMs, stats: info.stats, vsPython: cmp }).slice(0, 1500));
    await browser.close(); srv.kill();
})();
