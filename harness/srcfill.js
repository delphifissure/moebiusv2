// The source-anchored hole in the app (srcfill.py): one bake with the start-up defaults, then the WHOLE plate replaced by
// plateD.f32 (the source depth outside the hole, the membrane inside) and the plate's colour by washD.png (the source
// colour outside the hole, the membrane wash inside), plate 2 hidden. No per-line value reaches the frames except the
// plate mesh's own tear index, which is still the bake's (counted as retear). Shoots the S59 poses.
//   COLOR= DEPTH=<srcfill out>/depthD16.png FILL=<srcfill out dir> TAG= node harness/srcfill.js
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const H = __dirname, WT = path.resolve(__dirname, '..'); const TAG = process.env.TAG || 'ab'; const OUT = path.join(H, 'shots', 'srcfill', TAG); fs.mkdirSync(OUT, { recursive: true });
const Z = 0.2, T = (deg) => Z * Math.tan(deg * Math.PI / 180);
// the rule's poses: decision +-42 deg (x = +-0.180, y = 0.008, the "p45" of every S35/S53 frame), context 22.5 deg yaw, 30 deg pitch
const POSES = [['yawR42', 0.180, 0.008], ['yawL42', -0.180, 0.008], ['yaw22', T(22.5), 0], ['pitch30', 0, T(30)]];
(async () => {
    fs.copyFileSync(path.resolve(WT, process.env.COLOR || 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, process.env.DEPTH || 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1500));
    { const r = await fetch('http://localhost:8099/__root').then(x => x.text()).catch(() => ''); if (r !== H) { console.error('ABORT: port 8099 is served from ' + (r.slice(0, 80) || 'nothing') + ', not this tree (' + H + ')'); srv.kill(); process.exit(4); } }
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
    // the panel options for this render (default: ramps off: the depth given, srcfill's depthD16.png, already has its occlusion edges collapsed)
    const SEL = JSON.parse(process.env.SEL || '{"bgPlateRampSel":"off"}');
    await page.evaluate((SEL) => { try { localStorage.clear(); } catch (e) {} for (const id in SEL) { const el = document.getElementById(id); if (el) { el.value = SEL[id]; el.dispatchEvent(new Event('change')); } } }, SEL);
    await page.evaluate(() => document.getElementById('bgLayerBuildBtn').click());
    for (let t = 0; t < 320; t++) { if (await page.evaluate(() => !!window._bgQuickBaked && !!window._qbPlateF)) break; await new Promise(r => setTimeout(r, 1000)); }
    const plate = fs.readFileSync(path.join(process.env.FILL, 'plateD.f32')).toString('base64');
    const wash = fs.readFileSync(path.join(process.env.FILL, 'washD.png')).toString('base64');
    const info = await page.evaluate(async ([pb64, wb64]) => {
        const dec = (s) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
        const { pw, ph } = window._qbSize; const N = pw * ph; const pd = new Float32Array(dec(pb64).buffer); if (pd.length !== N) return { error: 'plate size ' + pd.length + ' vs ' + N };
        const tex = bgLayerMesh.material.uniforms.displacementMap.value; const data = tex.image.data; const orig = new Float32Array(data);
        // guard: the app's source depth (after its own ramp collapse) against the fill's plate outside the hole
        let dqOut = 0; const dq = window._qbDQ; if (dq) for (let i = 0; i < N; i++) { const e = Math.abs(dq[i] - pd[i]); if (e < 1e-3) continue; dqOut++; }
        for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) data[(ph - 1 - y) * pw + x] = pd[y * pw + x];
        tex.needsUpdate = true;
        // the plate's tears, rebuilt from the NEW plate with the app's own rule (S2b.4: a quad across an edge the rim law
        // does not join is not drawn), on the full grid of the source mesh -- the bake's index was torn on the per-line plate
        let plateTri = null; try {
            const gQ = bgLayerMesh.geometry, gp = mediaLayers[0].mesh.geometry.parameters, vw = gp.widthSegments + 1, vh = gp.heightSegments + 1;
            const sx = (pw - 1) / (vw - 1), sy = (ph - 1) / (vh - 1), ti = (vi) => Math.round(((vi / vw) | 0) * sy) * pw + Math.round((vi % vw) * sx);
            const rl = bgRimLawFor(pw, ph); const out = new Uint32Array((vw - 1) * (vh - 1) * 6); let n = 0, drop = 0;
            const tri = (a, b, c) => { const A = ti(a), B = ti(b), C = ti(c); if (rl.joinedIdx(A, B, pd, pw) && rl.joinedIdx(B, C, pd, pw) && rl.joinedIdx(A, C, pd, pw)) { out[n++] = a; out[n++] = b; out[n++] = c; } else drop++; };
            for (let iy = 0; iy < vh - 1; iy++) for (let ix = 0; ix < vw - 1; ix++) { const a = ix + vw * iy, b = ix + vw * (iy + 1), c = ix + 1 + vw * (iy + 1), d = ix + 1 + vw * iy; tri(a, b, d); tri(b, c, d); }
            const before = gQ.index ? gQ.index.count / 3 : null; gQ.setIndex(new THREE.BufferAttribute(out.slice(0, n), 1)); plateTri = { before, after: n / 3, dropped: drop };
        } catch (e) { plateTri = { error: String(e).slice(0, 200) }; }
        let flipped = 0, pairs = 0; try { const rl = bgRimLawFor(pw, ph);
            for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const i = (ph - 1 - y) * pw + x; for (const j of [x < pw - 1 ? i + 1 : -1, y > 0 ? i + pw : -1]) { if (j < 0) continue; pairs++; if (rl.joined(orig[i], orig[j]) !== rl.joined(data[i], data[j])) flipped++; } } } catch (e) { flipped = -1; }
        const img = new Image(); img.src = 'data:image/png;base64,' + wb64; await img.decode();
        const cv = document.createElement('canvas'); cv.width = pw; cv.height = ph; const c2 = cv.getContext('2d'); c2.drawImage(img, 0, 0); const w = c2.getImageData(0, 0, pw, ph).data;
        const mp = bgLayerMesh.material.uniforms.map; const cx = mp.value.image.getContext('2d'); const id = cx.getImageData(0, 0, pw, ph); id.data.set(w); cx.putImageData(id, 0, 0); mp.value.needsUpdate = true;
        const p2 = bgLayerMesh.userData && bgLayerMesh.userData.plate2; if (p2) p2.visible = false;
        return { pw, ph, plateTri, retear: { pairs, decisionsChanged: flipped }, plate2Hidden: !!p2, ramp: window._qbRampColour ? window._qbRampColour.changed : null, texelsWherePlateDiffersFromAppSource: dqOut };
    }, [plate, wash]);
    console.log('inject ' + JSON.stringify(info)); if (info.error) { console.log('ABORT'); process.exit(2); }
    const shot = async (name) => { const b64 = await page.evaluate(() => { updateCameraAndProjection(); render(); updateCameraAndProjection(); render(); return renderer.domElement.toDataURL('image/png').split(',')[1]; }); fs.writeFileSync(path.join(OUT, name), Buffer.from(b64, 'base64')); };
    for (const [n, x, y] of POSES) { await page.evaluate(([x, y]) => { isSweeping = true; camera.position.set(x, y, 0.2); }, [x, y]); await shot('D_' + n + '.png'); }
    fs.writeFileSync(path.join(OUT, 'render.json'), JSON.stringify(info, null, 1));
    await browser.close(); srv.kill(); console.log('done ' + OUT);
})();
