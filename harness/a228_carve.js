// A228 CARVE RE-TEST on the FIXED instrument + backdrop-exclusion check.
//
// The a217 carve (plug geometry limited to the demand region + parallax
// collar) was rolled back in a219 on "a ton of holes" that a220c later traced
// largely to the sheet export hiding a layer per export. It was never
// re-tested after that fix. Two arms, fresh page each (a134/a158 idioms):
//   D  default  — full seamless backstop (shipped a219)
//   C  carve    — window._plugCarve = true before the bake
// At the user's own stamped poses (z 0.199): rest, (0.100,-0.023),
// (0.141,0.023) [sheet 2], (0.180,0.008) [sheet 1, 0.90x rim], and the
// mirror (-0.141,0.023). Per pose:
//   holes     = pixels NOTHING covers in the full composite (alpha < thr,
//               all layers visible). The two arms share the FG, so the
//               difference is exactly the holes the carve fails to fill.
//   plugOnly  = plug footprint with the FG hidden (the "sheet vs islands"
//               number the user cares about).
//   plugSeen  = pixels where the plug actually reaches the screen in the
//               composite (composite vs composite-with-plug-hidden).
// Plus H: with SD-regions ON, the sheet-style gap capture must return the
// SAME hole count as with it off (the A228 backdrop exclusion).
// Composite PNGs per arm/pose -> scratchpad for the user's live pass.
//   node harness/a228_carve.js
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = path.resolve(__dirname, '..'), H = __dirname;
const OUT = path.join(__dirname, 'shots', 'a228');
const POSES = [['rest', 0, 0], ['a221', 0.100, -0.023], ['sheet2', 0.141, 0.023], ['sheet1', 0.180, 0.008], ['mirror', -0.141, 0.023]];
const Z = 0.199;

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png'));
    fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
               '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });

    const newPage = async () => {
        const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
        page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
        page.on('console', m => { const t = m.text(); if (t.includes('a217') || t.includes('A212 FG pre-tear')) console.log('  [page] ' + t.slice(0, 150)); });
        await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
        for (let t = 0; t < 45; t++) {
            const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
            if (ok) break; await new Promise(r2 => setTimeout(r2, 1000));
        }
        return page;
    };

    const runArm = async (tag, carve) => {
        const page = await newPage();
        const res = await page.evaluate(async (o) => {
            window._rayReproject = true;
            if (o.carve) window._plugCarve = true;
            if (o.fs) window._frontStop = true;          // A230 arm (FS=1 in the environment)
            if (o.scan) window._vpScan = true;           // a80 viewpoint scan (SCAN=1)
            bgQuickBake = true; buildBackgroundLayer();
            isSweeping = true;
            const countAlpha = (below) => {
                const prevRT = renderer.getRenderTarget();
                const prevCC = new THREE.Color(); renderer.getClearColor(prevCC); const prevCA = renderer.getClearAlpha();
                renderer.setClearColor(new THREE.Color(0, 0, 0), 0.0);
                renderer.setRenderTarget(pingPongRenderTargetB); renderer.clear();
                renderer.render(scene, camera);
                const W = pingPongRenderTargetB.width, Hh = pingPongRenderTargetB.height;
                const isFloat = pingPongRenderTargetB.texture.type === THREE.FloatType || pingPongRenderTargetB.texture.type === THREE.HalfFloatType;
                const buf = isFloat ? new Float32Array(W * Hh * 4) : new Uint8Array(W * Hh * 4);
                renderer.readRenderTargetPixels(pingPongRenderTargetB, 0, 0, W, Hh, buf);
                renderer.setRenderTarget(prevRT); renderer.setClearColor(prevCC, prevCA);
                const thr = isFloat ? 0.03 : 8;
                let n = 0;
                const mask = new Uint8Array(W * Hh);
                for (let i = 0; i < W * Hh; i++) { const a = buf[i * 4 + 3]; const hit = below ? (a < thr) : (a >= thr); if (hit) { n++; mask[i] = 1; } }
                return { n, mask, W, Hh };
            };
            const setVis = (pred, v) => { const out = []; scene.traverse((m) => { if (m.isMesh && pred(m) && m.visible !== v) { out.push(m); m.visible = v; } }); return out; };
            const isPlug = (m) => { const u = m.material && m.material.uniforms; return !!(u && u.u_isBackgroundLayer && u.u_isBackgroundLayer.value && !m.userData.v2Plane); };
            const isFG = (m) => mediaLayers.some(L => L.mesh === m);
            const out = [];
            for (const [name, x, y] of o.poses) {
                camera.position.set(x, y, o.z);
                updateCameraAndProjection(); render(); render();
                // holes: nothing covers (all visible)
                const holes = countAlpha(true);
                // plug-only footprint: FG hidden
                const hidF = setVis(isFG, false);
                const plugOnly = countAlpha(false);
                for (const m of hidF) m.visible = true;
                // plug seen in composite: composite vs plug-hidden composite (uncovered delta)
                const hidP = setVis(isPlug, false);
                const noPlug = countAlpha(true);
                for (const m of hidP) m.visible = true;
                // composite PNG (on-screen render)
                updateCameraAndProjection(); render();
                const el = renderer.domElement;
                const cv = document.createElement('canvas'); cv.width = el.width; cv.height = el.height;
                cv.getContext('2d').drawImage(el, 0, 0);
                out.push({ name, holes: holes.n, plugOnly: plugOnly.n, plugSeen: noPlug.n - holes.n,
                           total: holes.W * holes.Hh, png: cv.toDataURL('image/png') });
            }
            return out;
        }, { carve, poses: POSES, z: Z, fs: !!process.env.FS, scan: !!process.env.SCAN });
        for (const r of res) {
            fs.writeFileSync(path.join(OUT, tag + (process.env.FS ? '_fs' : '') + (process.env.SCAN ? '_scan' : '') + '_' + r.name + '.png'), Buffer.from(r.png.split(',')[1], 'base64'));
            console.log(tag + ' ' + r.name.padEnd(7) + ' holes=' + String(r.holes).padStart(6) +
                '  plugOnly=' + String(r.plugOnly).padStart(7) + ' (' + (100 * r.plugOnly / r.total).toFixed(1) + '% of frame)' +
                '  plugSeen=' + String(r.plugSeen).padStart(6));
        }
        await page.close();
        return res;
    };

    const D = await runArm('D-default', false);
    const C = await runArm('C-carve  ', true);
    console.log('---- carve vs default (holes delta = holes the carve leaves open; negative = fewer):');
    let worst = 0;
    for (let i = 0; i < POSES.length; i++) {
        const d = C[i].holes - D[i].holes; worst = Math.max(worst, d);
        console.log('  ' + POSES[i][0].padEnd(7) + ' holes delta ' + (d >= 0 ? '+' : '') + d +
            '   plugOnly ' + D[i].plugOnly + ' -> ' + C[i].plugOnly + ' (' + (100 * C[i].plugOnly / Math.max(1, D[i].plugOnly)).toFixed(1) + '% of the sheet)');
    }
    console.log('  worst extra holes: ' + worst + ' px' + (worst === 0 ? '  — carve is hole-free at every pose' : ''));

    // H: backdrop exclusion — SD-regions on must not change the gap capture
    {
        const page = await newPage();
        const r = await page.evaluate(async (o) => {
            window._rayReproject = true; bgQuickBake = true; buildBackgroundLayer(); isSweeping = true;
            camera.position.set(o.x, o.y, o.z); updateCameraAndProjection(); render(); render();
            const capture = () => {
                const hidden = [];
                scene.traverse((m) => {
                    if (!m.isMesh || !m.visible) return;
                    if (m.userData && (m.userData.isSplatLayer || m.userData.analysisHidden)) { hidden.push(m); m.visible = false; return; }
                    const u = m.material && m.material.uniforms;
                    if (u && u.u_isBackgroundLayer && u.u_isBackgroundLayer.value && !m.userData.v2Plane) { hidden.push(m); m.visible = false; }
                });
                const prevRT = renderer.getRenderTarget();
                renderer.setClearColor(new THREE.Color(0, 0, 0), 0.0);
                renderer.setRenderTarget(pingPongRenderTargetB); renderer.clear(); renderer.render(scene, camera);
                const W = pingPongRenderTargetB.width, Hh = pingPongRenderTargetB.height;
                const isFloat = pingPongRenderTargetB.texture.type === THREE.FloatType || pingPongRenderTargetB.texture.type === THREE.HalfFloatType;
                const buf = isFloat ? new Float32Array(W * Hh * 4) : new Uint8Array(W * Hh * 4);
                renderer.readRenderTargetPixels(pingPongRenderTargetB, 0, 0, W, Hh, buf);
                renderer.setRenderTarget(prevRT);
                for (const m of hidden) m.visible = true;
                const thr = isFloat ? 0.03 : 8; let n = 0;
                for (let i = 0; i < W * Hh; i++) if (buf[i * 4 + 3] < thr) n++;
                return n;
            };
            const off = capture();
            const chk = document.getElementById('sdRegionsChk');
            if (chk) { chk.checked = true; chk.dispatchEvent(new Event('change')); }
            updateCameraAndProjection(); render(); render();   // lets the backdrop get created
            const backdropExists = !!(typeof bgSDDemandMesh !== 'undefined' && bgSDDemandMesh && bgSDDemandMesh.visible);
            const on = capture();
            if (chk) { chk.checked = false; chk.dispatchEvent(new Event('change')); }
            return { off, on, backdropExists };
        }, { x: 0.141, y: 0.023, z: Z });
        console.log('H  gap capture holes: sdRegions off=' + r.off + '  on=' + r.on + '  backdrop present=' + r.backdropExists +
            '  — ' + (r.off === r.on ? 'PASS (backdrop excluded)' : 'FAIL'));
        await page.close();
    }
    console.log('shots -> ' + OUT);
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
