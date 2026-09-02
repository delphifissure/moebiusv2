// A231c WHICH PLATE TEXELS ARE EVER SEEN? The exact plug region, measured
// with the real renderer instead of derived: bake the shipped full backstop,
// swap the plate's colour map for a texel-ID map and the foreground's for
// black, render a grid of eye poses across the cone, decode the IDs of every
// pixel where the plate reaches the screen, and union them. That union IS
// "where disocclusions are possible" — no footprint oracle, all clamps and
// tears included. Reported against the bake's own demand mask, the carve's
// criterion map (from a229_plugaudit on the same image), and the near cores.
//   node harness/a231_visible.js          (troll)
//   IMG=<color>,<depth> TAG=<name> node harness/a231_visible.js
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = __dirname, WT = path.resolve(__dirname, '..');
const TAG = process.env.TAG || 'troll';
const OUT = path.join(__dirname, 'shots', 'a231', TAG);
const Z = 0.199;
// pose grid across the cone (the user's stamped extremes are |x| 0.18, |y| 0.023 at z 0.199)
const POSES = [];
for (let iy = -2; iy <= 2; iy++) for (let ix = -4; ix <= 4; ix++) POSES.push([ix * 0.045, iy * 0.025]);
for (const p of [[0.100, -0.023], [0.141, 0.023], [0.180, 0.008], [-0.141, 0.023]]) POSES.push(p);

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    if (process.env.IMG) {
        const [c, d] = process.env.IMG.split(',');
        fs.copyFileSync(path.resolve(WT, c), path.join(H, 'defaultImgColor.png'));
        fs.copyFileSync(path.resolve(WT, d), path.join(H, 'defaultImgDepth.png'));
    } else {
        fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png'));
        fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
    }
    process.on('exit', () => { try {
        fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png'));
        fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
               '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) {
        const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
        if (ok) break; await new Promise(r2 => setTimeout(r2, 1000));
    }
    const res = await page.evaluate(async (o) => {
        window._rayReproject = true; window._srCapture = true; window._plugCarve = true; window._foldProbe = true;
        bgQuickBake = true; buildBackgroundLayer(); isSweeping = true;
        const dbg = window._qbDbg, msk = window._qbMask, cv = window._carveDbg;
        if (!dbg || !msk || !cv) return { err: 'missing debug' };
        const { pw, ph } = cv; const N = pw * ph;
        const dQ = dbg.d, disocc = msk.disocc, cat = cv.cat, plateF = cv.plateF;
        // the carve is ON for the cat map only; restore the FULL plate geometry so every texel is a candidate
        const plate = bgLayerMesh; if (!plate) return { err: 'no plate mesh' };
        const gQ = plate.geometry;
        if (plate.userData._fullIdx) gQ.setIndex(plate.userData._fullIdx);
        else if (mediaLayers[0].mesh.geometry.userData._fullIndex) gQ.setIndex(new THREE.BufferAttribute(mediaLayers[0].mesh.geometry.userData._fullIndex.slice(), 1));
        // texel-ID map: R = x & 255, G = 16 + (x >> 8) + 4 * (y >> 8), B = y & 255  (G >= 16 marks "plate")
        const id = new Uint8Array(N * 4);
        for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const o4 = (y * pw + x) * 4; id[o4] = x & 255; id[o4 + 1] = 16 + (x >> 8) + 4 * (y >> 8); id[o4 + 2] = y & 255; id[o4 + 3] = 255; }
        const idT = new THREE.DataTexture(id, pw, ph, THREE.RGBAFormat, THREE.UnsignedByteType);
        idT.needsUpdate = true; idT.flipY = false; idT.minFilter = THREE.NearestFilter; idT.magFilter = THREE.NearestFilter; idT.generateMipmaps = false;
        if ('colorSpace' in idT) idT.colorSpace = THREE.NoColorSpace; if ('encoding' in idT) idT.encoding = THREE.LinearEncoding;
        const blk = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType); blk.needsUpdate = true;
        const pm = plate.material.uniforms, fm = mediaLayers[0].mesh.material.uniforms;
        const savedP = pm.map.value, savedF = fm.map.value;
        pm.map.value = idT; fm.map.value = blk;
        // does the ID map's row order match plateF (flipped rows)? The plate samples its map like the FG samples the
        // source image; DataTextures uploaded flipY=false are addressed bottom-up, so texture row r = source row (ph-1-r).
        const vis = new Uint8Array(N); const perPose = [];
        const prevRT = renderer.getRenderTarget();
        const W = pingPongRenderTargetB.width, Hh = pingPongRenderTargetB.height;
        const isFloat = pingPongRenderTargetB.texture.type === THREE.FloatType || pingPongRenderTargetB.texture.type === THREE.HalfFloatType;
        const buf = isFloat ? new Float32Array(W * Hh * 4) : new Uint8Array(W * Hh * 4);
        let bad = 0;
        for (const [x, y] of o.poses) {
            camera.position.set(x, y, o.z); updateCameraAndProjection(); render(); render();
            renderer.setClearColor(new THREE.Color(0, 0, 0), 0.0);
            renderer.setRenderTarget(pingPongRenderTargetB); renderer.clear(); renderer.render(scene, camera);
            renderer.readRenderTargetPixels(pingPongRenderTargetB, 0, 0, W, Hh, buf);
            let n = 0;
            for (let i = 0; i < W * Hh; i++) {
                const o4 = i * 4; const a = isFloat ? buf[o4 + 3] : buf[o4 + 3] / 255; if (a < 0.03) continue;
                const r = isFloat ? Math.round(buf[o4] * 255) : buf[o4], g = isFloat ? Math.round(buf[o4 + 1] * 255) : buf[o4 + 1], b = isFloat ? Math.round(buf[o4 + 2] * 255) : buf[o4 + 2];
                if (g < 16) continue;                     // foreground (black) or nothing
                const gg = g - 16; const tx = r + 256 * (gg & 3), ty = b + 256 * (gg >> 2);
                if (tx >= pw || ty >= ph) { bad++; continue; }
                const row = ph - 1 - ty;                  // texture row -> source row
                vis[row * pw + tx] = 1; n++;
            }
            perPose.push({ x, y, n });
        }
        renderer.setRenderTarget(prevRT);
        pm.map.value = savedP; fm.map.value = savedF;
        // tallies
        const sorted = Float32Array.from(dQ).sort(); const q90 = sorted[Math.floor(0.9 * (N - 1))];
        let nVis = 0, visDem = 0, visNotDem = 0, visCore = 0, nCore = 0, nDem = 0; const visCat = [0, 0, 0, 0], catN = [0, 0, 0, 0];
        for (let y = 0; y < ph; y++) { const sR = y * pw, dR = (ph - 1 - y) * pw;
            for (let x = 0; x < pw; x++) { const i = sR + x; const c = cat[dR + x]; catN[c]++;
                const core = dQ[i] >= q90 && !disocc[i]; if (core) nCore++; if (disocc[i]) nDem++;
                if (!vis[i]) continue; nVis++; visCat[c]++;
                if (disocc[i]) visDem++; else visNotDem++; if (core) visCore++; } }
        const toPng = (fill) => { const c = document.createElement('canvas'); c.width = pw; c.height = ph; const cx = c.getContext('2d'); const im = cx.createImageData(pw, ph);
            for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const o4 = (y * pw + x) * 4; const rgb = fill(y * pw + x); im.data[o4] = rgb[0]; im.data[o4 + 1] = rgb[1]; im.data[o4 + 2] = rgb[2]; im.data[o4 + 3] = 255; }
            cx.putImageData(im, 0, 0); return c.toDataURL('image/png'); };
        const g = (v) => { const k = Math.max(0, Math.min(255, Math.round(v * 255))); return [k, k, k]; };
        return { pw, ph, N, bad, perPose, nVis, visDem, visNotDem, visCore, nCore, nDem, visCat, catN,
                 png: toPng((i) => vis[i] ? (disocc[i] ? [255, 255, 255] : [255, 60, 60]) : (disocc[i] ? [70, 70, 160] : g(dQ[i] * 0.4))) };
    }, { poses: POSES, z: Z });
    if (res.err) { console.log('ERR ' + res.err); process.exit(1); }
    fs.writeFileSync(path.join(OUT, 'ever_visible.png'), Buffer.from(res.png.split(',')[1], 'base64'));
    const pc = (a, b) => (100 * a / Math.max(1, b)).toFixed(1) + '%';
    console.log(TAG + ': plate ' + res.pw + 'x' + res.ph + ', ' + res.perPose.length + ' poses, bad ids ' + res.bad);
    console.log('  plate seen per pose (px): ' + res.perPose.map(p => p.n).join(' '));
    console.log('  EVER-VISIBLE plate texels: ' + res.nVis + ' (' + pc(res.nVis, res.N) + ' of plate)');
    console.log('    inside demand: ' + res.visDem + ' (' + pc(res.visDem, res.nDem) + ' of the demand mask is ever seen)   outside demand: ' + res.visNotDem);
    console.log('    near cores (src>=q90, not demand) ever seen: ' + res.visCore + ' of ' + res.nCore + ' (' + pc(res.visCore, res.nCore) + ')');
    const names = ['dropped', 'demand', 'collar', 'rim'];
    console.log('    by carve criterion: ' + names.map((n, c) => n + ' ' + res.visCat[c] + '/' + res.catN[c] + ' (' + pc(res.visCat[c], res.catN[c]) + ')').join('   '));
    console.log('  map -> ' + path.join(OUT, 'ever_visible.png') + '  (white = seen & demand, red = seen & NOT demand, blue = demand never seen)');
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
