// S67 §6 check: the cut-mapping select (current / A / B / C / Cm) and the shot-lens select. For 24 and 200 mm shots and a
// fixed face offset: eye position, viewing angle, the reprojection reference eye; C's depth remap on the law; and the
// reference eye under a lean (z tracking emulated: a face 20% nearer than its rest capture).   node harness/cutmap_check.js
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const H = __dirname;
(async () => {
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore', env: Object.assign({}, process.env, { PORT: '8127' }) });
    await new Promise(r => setTimeout(r, 1200));
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    await page.goto('http://localhost:8127/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
    const res = await page.evaluate(() => {
        const pz = portalPlaneWorldZ, out = { rows: [], law: {}, lean: {} };
        const sel = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('change')); };
        const eye = (dev) => { latestDetectedFaceX = 0.5 + dev; latestDetectedFaceY = 0.5; updateCameraAndProjection(); return { x: camera.position.x, z: camera.position.z - pz, ref: bgRefEyeZNow() - pz }; };
        // a face at 0.5 m on a 640-px webcam with the device profile's focal length: gives C / Cm their true-window distance
        const faceAt = (ratio) => { const fx = (640 / 2) / Math.tan(bgDeviceFovProfile().hfov * Math.PI / 360); const span0 = fx * IPD_M / 0.5;
            window._headZState = { span: span0 / ratio, span0, ratio, fx, good: 99, frameW: 640 }; };
        for (const withFace of [false, true]) for (const mode of ['current', 'A', 'B', 'C', 'Cm']) for (const f of ['24', '200']) {
            window._headZState = null; window._eyeRestZ = null; if (withFace) faceAt(1);
            sel('cutMapSel', mode); sel('shotLensSel', f);
            const e0 = eye(0), e1 = eye(0.1); const cs = bgCutState();
            out.rows.push({ withFace, mode, f, D: e0.z, ref: e0.ref, Dshot: cs.Dshot, Dtrue: cs.Dtrue, eyeMove: e1.x - e0.x, deg: Math.atan2(Math.abs(e1.x - e0.x), e1.z) * 180 / Math.PI });
        }
        // C's remap on the depth law: the pin plane stays put, the order holds, the far field stays finite
        for (const f of ['24', '200']) { faceAt(1); sel('cutMapSel', 'C'); sel('shotLensSel', f); eye(0);
            const ds = [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1], zC = ds.map(d => volumeZOffForNormDepth(d)); sel('cutMapSel', 'current'); const z0 = ds.map(d => volumeZOffForNormDepth(d));
            out.law[f] = { d: ds, current: z0, C: zC, monotone: zC.every((v, i) => i === 0 || v >= zC[i - 1]) }; }
        // the reference eye under a lean (current mode, z tracking): must stay at the rest distance
        sel('cutMapSel', 'current'); sel('shotLensSel', '0'); faceAt(1.25); window._eyeRestZ = null;
        const el = eye(0); out.lean = { eyeZ: el.z, refZ: el.ref, u_refEye: mediaLayers[0].mesh.material.uniforms.u_refEye.value.z - pz };
        sel('cutMapSel', 'current'); sel('shotLensSel', '0'); window._headZState = null;
        return out;
    });
    for (const r of res.rows) console.log((r.withFace ? 'face ' : 'none ') + r.mode.padEnd(8) + r.f.padStart(4) + ' mm  eye z ' + r.D.toFixed(3) + '  ref ' + r.ref.toFixed(3) + '  (D_shot ' + r.Dshot.toFixed(3) + ', D_true ' + r.Dtrue.toFixed(3) + ')  eye move ' + (100 * r.eyeMove).toFixed(2) + ' cm = ' + r.deg.toFixed(2) + ' deg');
    for (const f in res.law) console.log('law ' + f + ' mm: d ' + res.law[f].d.join(' ') + ' | current ' + res.law[f].current.map(v => v.toFixed(4)).join(' ') + ' | C ' + res.law[f].C.map(v => v.toFixed(4)).join(' ') + ' | monotone ' + res.law[f].monotone);
    console.log('lean 20% nearer (current + z tracking): eye z ' + res.lean.eyeZ.toFixed(3) + ', reference eye ' + res.lean.refZ.toFixed(3) + ', shader u_refEye ' + res.lean.u_refEye.toFixed(3));
    fs.writeFileSync(path.join(H, 'out_cutmap_check.json'), JSON.stringify(res, null, 1));
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
