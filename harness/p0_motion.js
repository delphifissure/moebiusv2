// PHASE 0.2 MOTION PATH INSTRUMENT (Addendum 184). A 60-frame figure-of-eight through the
// cone (x = A sin t, y = B sin 2t; A = sheet1's x, B = the eight poses' vertical extent)
// after one bake of the flagged stack. Per frame: uncovered pixels (holes) and enclosed
// holes, plug-seen pixels, and — for the per-fragment tear — the FOLD SWITCHES: texels whose
// torn state (fold point below the shader's pose fraction) differs from the previous frame.
// Switches per frame are what the eye sees as pops; the total of distinct switching texels
// is the tear's footprint over the path. Composite PNGs at four frames.
//   [GEO=1] [OBS=1] [FLUSH=1] [FLAGS=...] [IMG=color,depth TAG=name] node harness/p0_motion.js
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = __dirname, WT = path.resolve(__dirname, '..');
const TAG = process.env.TAG || 'troll';
const ARM = (process.env.FLAGS ? process.env.FLAGS.replace(/[^A-Za-z0-9]+/g, '') : 'wash') + (process.env.GEO ? '_geo' : '') + (process.env.OBS ? '_obs' : '') + (process.env.BOUNDARY ? '_bnd' : '');
const OUT = path.join(__dirname, 'shots', 'p0motion', TAG);
const NF = parseInt(process.env.NF || '60'), A = 0.180, B = 0.03, Z = 0.199;
(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    if (process.env.IMG) { const [c, d] = process.env.IMG.split(','); fs.copyFileSync(path.resolve(WT, c), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, d), path.join(H, 'defaultImgDepth.png')); }
    else { fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); }
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    page.on('console', m => { const t = m.text(); if (t.includes('A244f]') || t.includes('A246]') || t.includes('A241b') || m.type() === 'error') console.log('  [page:' + m.type() + '] ' + t.slice(0, 400)); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r2 => setTimeout(r2, 1000)); }
    const res = await page.evaluate(async (o) => {
        window._rayReproject = true; window._plugSweepCapture = true; window._plugCarve = false;
        if (o.flush) window._plateFlushExempt = true;
        if (o.flags) for (const f of o.flags) { const [k, v] = f.split('='); window[k] = (v === undefined) ? true : (isNaN(+v) ? v : +v); }
        const t0 = Date.now();
        if (o.geo) window._plugGeoBand({ flush: !!o.flush, nx: o.nx || undefined, observed: !!o.obs, boundary: !!o.boundary });
        else { bgQuickBake = true; buildBackgroundLayer(); }
        isSweeping = true;
        const bakeMs = Date.now() - t0;
        const countAlpha = (below) => {
            const prevRT = renderer.getRenderTarget(); const prevCC = new THREE.Color(); renderer.getClearColor(prevCC); const prevCA = renderer.getClearAlpha();
            renderer.setClearColor(new THREE.Color(0, 0, 0), 0.0); renderer.setRenderTarget(pingPongRenderTargetB); renderer.clear(); renderer.render(scene, camera);
            const W = pingPongRenderTargetB.width, Hh = pingPongRenderTargetB.height;
            const isFloat = pingPongRenderTargetB.texture.type === THREE.FloatType || pingPongRenderTargetB.texture.type === THREE.HalfFloatType;
            const buf = isFloat ? new Float32Array(W * Hh * 4) : new Uint8Array(W * Hh * 4);
            renderer.readRenderTargetPixels(pingPongRenderTargetB, 0, 0, W, Hh, buf); renderer.setRenderTarget(prevRT); renderer.setClearColor(prevCC, prevCA);
            const thr = isFloat ? 0.03 : 8; let n = 0; const mask = new Uint8Array(W * Hh);
            for (let i = 0; i < W * Hh; i++) { const a = buf[i * 4 + 3]; const hit = below ? (a < thr) : (a >= thr); if (hit) { n++; mask[i] = 1; } }
            return { n, mask, W, Hh }; };
        const enclosed = (holes) => { const W = holes.W, Hh = holes.Hh, m = holes.mask, seen = new Uint8Array(W * Hh); const st = [];
            const push = (i) => { if (m[i] && !seen[i]) { seen[i] = 1; st.push(i); } };
            for (let x = 0; x < W; x++) { push(x); push((Hh - 1) * W + x); } for (let y = 0; y < Hh; y++) { push(y * W); push(y * W + W - 1); }
            while (st.length) { const i = st.pop(); const x = i % W, y = (i / W) | 0; if (x > 0) push(i - 1); if (x < W - 1) push(i + 1); if (y > 0) push(i - W); if (y < Hh - 1) push(i + W); }
            let n = 0; for (let i = 0; i < W * Hh; i++) if (m[i] && !seen[i]) n++; return n; };
        const setVis = (pred, v) => { const out = []; scene.traverse((m) => { if (m.isMesh && pred(m) && m.visible !== v) { out.push(m); m.visible = v; } }); return out; };
        const isPlug = (m) => { const u = m.material && m.material.uniforms; return !!(u && u.u_isBackgroundLayer && u.u_isBackgroundLayer.value && !m.userData.v2Plane); };
        const L = mediaLayers[0]; const foldTex = window._qbFoldTex || null; const N = foldTex ? foldTex.length : 0;
        let prevTorn = foldTex ? new Uint8Array(N) : null; const everSwitched = foldTex ? new Uint8Array(N) : null;
        const frames = []; const shots = {};
        for (let k = 0; k < o.nf; k++) {
            const t = 2 * Math.PI * k / o.nf; const x = o.A * Math.sin(t), y = o.B * Math.sin(2 * t);
            camera.position.set(x, y, o.z); updateCameraAndProjection(); render(); render();
            const holes = countAlpha(true); const holesIn = enclosed(holes);
            const hidP = setVis(isPlug, false); const noPlug = countAlpha(true); for (const m of hidP) m.visible = true;
            let pf = 0, switches = 0, tornNow = 0;
            if (foldTex) { pf = L.mesh.material.uniforms.u_poseFrac.value;
                for (let i = 0; i < N; i++) { const tn = foldTex[i] < pf ? 1 : 0; if (tn !== prevTorn[i]) { if (k > 0) switches++; everSwitched[i] = 1; } prevTorn[i] = tn; tornNow += tn; } }
            frames.push({ k, x: +x.toFixed(4), y: +y.toFixed(4), pf: +pf.toFixed(3), holes: holes.n, enclosed: holesIn, plugSeen: noPlug.n - holes.n, torn: tornNow, switches });
            if (k % Math.round(o.nf / 4) === 0) { updateCameraAndProjection(); render(); const el = renderer.domElement; const cv = document.createElement('canvas'); cv.width = el.width; cv.height = el.height; cv.getContext('2d').drawImage(el, 0, 0); shots['f' + String(k).padStart(2, '0')] = cv.toDataURL('image/png'); }
        }
        let nEver = 0; if (everSwitched) for (let i = 0; i < N; i++) nEver += everSwitched[i];
        return { bakeMs, frames, everSwitched: nEver, N, shots, geo: window._plugGeoStats || null };
    }, { nf: NF, A, B, z: Z, flush: !!process.env.FLUSH, geo: !!process.env.GEO, obs: !!process.env.OBS, boundary: !!process.env.BOUNDARY, nx: process.env.NX ? parseInt(process.env.NX) : 0, flags: (process.env.FLAGS || '').split(',').filter(Boolean) });
    for (const k of Object.keys(res.shots)) fs.writeFileSync(path.join(OUT, ARM + '_' + k + '.png'), Buffer.from(res.shots[k].split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT, ARM + '_frames.json'), JSON.stringify(Object.assign({}, res, { shots: undefined }), null, 1));
    const f = res.frames; const mx = (key) => Math.max(...f.map(r => r[key])); const mean = (key) => f.reduce((a, r) => a + r[key], 0) / f.length;
    console.log(`${TAG} [${ARM}${process.env.FLUSH ? ',flush' : ''}] bake ${res.bakeMs} ms; ${NF}-frame figure-8 (A ${A}, B ${B})`);
    console.log(`   holes per frame: max ${mx('holes')}, mean ${mean('holes').toFixed(1)};  ENCLOSED holes: max ${mx('enclosed')}, frames with any ${f.filter(r => r.enclosed > 0).length};  plugSeen: max ${mx('plugSeen')}, mean ${mean('plugSeen').toFixed(0)}`);
    console.log(`   fold switches per frame: max ${mx('switches')}, mean ${mean('switches').toFixed(0)} texels;  torn at the widest pose ${mx('torn')};  distinct texels that ever switch ${res.everSwitched} (${(100 * res.everSwitched / Math.max(1, res.N)).toFixed(1)}% of the plate)`);
    console.log('   frame  x       y       pf     holes  encl  plugSeen  torn    switches');
    for (const r of f) if (r.k % 5 === 0) console.log('   ' + String(r.k).padStart(5) + '  ' + String(r.x).padEnd(7) + ' ' + String(r.y).padEnd(7) + ' ' + String(r.pf).padEnd(6) + ' ' + String(r.holes).padStart(5) + ' ' + String(r.enclosed).padStart(5) + ' ' + String(r.plugSeen).padStart(9) + ' ' + String(r.torn).padStart(7) + ' ' + String(r.switches).padStart(9));
    console.log('   shots -> ' + OUT);
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
