// S35: render the offline sheet far field THROUGH THE APP. Builds the per-line plate as the app does, then overwrites the
// plate's displacement texture on the band with a far field from research/s35/sheets.py (farField_stop.f32, source rows,
// normalised depth) and shoots the poses. Colour stays the app's own fill; only the geometry changes.
//   FIELD=<farField_stop.f32> COLOR= DEPTH= POSES=p45,user26 TAG=<name> node harness/sheet_render.js
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const H = __dirname, WT = path.resolve(__dirname, '..'); const TAG = process.env.TAG || 'sheet'; const OUT = path.join(H, 'shots', 'sheetrender', TAG); fs.mkdirSync(OUT, { recursive: true });
const POSES_ALL = [['user45', 0.220, 0.043], ['user26', -0.097, 0.023], ['p27', 0.100, 0], ['p45', 0.180, 0.008], ['p56', 0.30, 0.07], ['rest', 0, 0]];
const POSES = process.env.POSES ? POSES_ALL.filter(p => process.env.POSES.split(',').includes(p[0])) : POSES_ALL;
(async () => {
    fs.copyFileSync(path.resolve(WT, process.env.COLOR || 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, process.env.DEPTH || 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
    // FLAGS=_visStep=1,... : window flags set before the bake, as streak_class.js does (starwatcher needs _visStep=1: S10c's gate)
    if (process.env.FLAGS) await page.evaluate((f) => { for (const kv of f.split(',')) { const [k, v] = kv.split('='); window[k] = Number(v); } }, process.env.FLAGS);
    await page.evaluate(() => document.getElementById('bgLayerBuildBtn').click());
    for (let t = 0; t < 320; t++) { if (await page.evaluate(() => !!window._bgQuickBaked && !!window._qbPlateF)) break; await new Promise(r => setTimeout(r, 1000)); }
    const shot = async (name) => { const b64 = await page.evaluate(() => { updateCameraAndProjection(); render(); updateCameraAndProjection(); render(); return renderer.domElement.toDataURL('image/png').split(',')[1]; }); fs.writeFileSync(path.join(OUT, name), Buffer.from(b64, 'base64')); };
    const doPoses = async (suffix) => { for (const [n, x, y] of POSES) { await page.evaluate(([x, y]) => { isSweeping = true; camera.position.set(x, y, 0.2); }, [x, y]); await shot('live_' + n + suffix + '.png'); } };
    await doPoses('_perline');
    // inject the sheet far field into the plate's displacement texture (band texels only; plateF rows are flipped)
    if (process.env.FIELD) {
        const buf = fs.readFileSync(process.env.FIELD); const b64 = buf.toString('base64');
        const info = await page.evaluate((b64) => {
            const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); const ff = new Float32Array(u8.buffer);
            const { pw, ph } = window._qbSize; const N = pw * ph; if (ff.length !== N) return { error: 'size ' + ff.length + ' vs ' + N };
            const dis = window._qbDisocc; const tex = bgLayerMesh.material.uniforms.displacementMap.value; const data = tex.image.data; let n = 0;
            for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const i = y * pw + x; if (!dis[i]) continue; data[(ph - 1 - y) * pw + x] = ff[i]; n++; }
            tex.needsUpdate = true;
            const p2 = bgLayerMesh.userData && bgLayerMesh.userData.plate2; if (p2) p2.visible = false;   // plate 2 is the per-line law's second layer; not the sheets'
            return { replaced: n };
        }, b64);
        console.log('inject: ' + JSON.stringify(info));
        await doPoses('_sheets');
    }
    // S35 §25: inject the sheets' own COLOUR too (color_stop.png from sheets.py --color: the source with every band texel
    // replaced by its owning sheet's continued colour). Without this the shot shows the per-line wash over sheet geometry.
    if (process.env.COLORPNG) {
        const b64c = fs.readFileSync(process.env.COLORPNG).toString('base64');
        const info2 = await page.evaluate(async (b64) => {
            const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
            const { pw, ph } = window._qbSize; if (img.width !== pw || img.height !== ph) return { error: 'size ' + img.width + 'x' + img.height + ' vs ' + pw + 'x' + ph };
            const cv = document.createElement('canvas'); cv.width = pw; cv.height = ph; cv.getContext('2d').drawImage(img, 0, 0);
            const tex = new THREE.CanvasTexture(cv); tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
            const old = bgLayerMesh.material.uniforms.map.value; if (old && 'colorSpace' in old && 'colorSpace' in tex) tex.colorSpace = old.colorSpace;
            bgLayerMesh.material.uniforms.map.value = tex; bgLayerMesh.material.needsUpdate = true;
            return { replacedColor: pw * ph };
        }, b64c);
        console.log('injectColor: ' + JSON.stringify(info2));
        await doPoses('_sheetcolor');
    }
    await browser.close(); srv.kill(); console.log('done ' + OUT);
})();
