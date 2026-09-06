// DEPTH LAYER VIEWS (user request, Addendum 189): for one baked arm, at the four reference
// poses (rest / a221 / sheet1 / mirror), the DEPTH of each layer as the depth pass sees it —
// FG only (holes = demand), plug only (FG hidden, plug + margin = supply), and the composite
// (FG over plug; red = still uncovered = a gap with NO depth behind it) — next to the colour
// composite. A fourth depth panel tints the pixels the PLUG wins green so you can read where
// the plug's depth sits (e.g. the side of the troll's face) and judge whether it is plausible.
// Per pose: uncovered pixels total and ENCLOSED (not connected to the frame border = interior).
//   GEO=1 OBS=1 GATEA=1 FLUSH=1 FLAGS=_plugMembrane=1,_plugGuided=1,_fragTear=2,_plugMargin=1 node harness/p0_depthviews.js
//   [IMG=color,depth TAG=name] [MODE=v2] [NOBAKE=1] (NOBAKE: no plug at all — the raw demand)
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = __dirname, WT = path.resolve(__dirname, '..');
const TAG = process.env.TAG || 'troll';
const ARM = process.env.NOBAKE ? 'nobake' : ((process.env.FLAGS ? process.env.FLAGS.replace(/[^A-Za-z0-9]+/g, '') : 'wash') + (process.env.MODE === 'v2' ? '_v2' : '') + (process.env.GEO ? '_geo' : '') + (process.env.OBS ? '_obs' : '') + (process.env.GATEA ? '_gateA' : ''));
const OUT = path.join(__dirname, 'shots', 'depth', TAG);
const POSES = [['rest', 0, 0], ['a221', 0.100, -0.023], ['sheet1', 0.180, 0.008], ['mirror', -0.141, 0.023]];
const Z = 0.199;
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
    page.on('console', m => { const t = m.text(); if (t.includes('A249') || t.includes('A245') || t.includes('A246]') || t.includes('band fill') || m.type() === 'error') console.log('  [page:' + m.type() + '] ' + t.slice(0, 400)); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r2 => setTimeout(r2, 1000)); }
    const res = await page.evaluate(async (o) => {
        window._rayReproject = true; window._plugSweepCapture = true; window._plugCarve = false;
        if (o.flush) window._plateFlushExempt = true;
        if (o.flags) for (const f of o.flags) { const [k, v] = f.split('='); window[k] = (v === undefined) ? true : (isNaN(+v) ? v : +v); }
        const t0 = Date.now();
        if (o.nobake) { /* nothing: the raw FG alone */ }
        else if (o.v2) { bgQuickBake = false; bgMPIFullPlanes = true; bgMPIMode = true; buildBackgroundLayer(); }
        else if (o.geo) window._plugGeoBand({ flush: !!o.flush, observed: !!o.obs, gateAPriori: !!o.gateA });
        else { bgQuickBake = true; buildBackgroundLayer(); }
        isSweeping = true;
        const bakeMs = Date.now() - t0;
        const quad = postProcessScene.children[0];
        const W = screenNormalizedDepthTarget.width, Hh = screenNormalizedDepthTarget.height;
        if (!_dbgExportTarget || _dbgExportTarget.width !== W || _dbgExportTarget.height !== Hh) {
            if (_dbgExportTarget) _dbgExportTarget.dispose();
            _dbgExportTarget = new THREE.WebGLRenderTarget(W, Hh, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat, type: THREE.UnsignedByteType });
        }
        ensureDbgPanelMaterial();
        const depthPanel = () => _renderBufferToCanvas(quad, screenNormalizedDepthTarget.texture, null, 2, W, Hh);   // grey = depth, red = invalid
        const isRed = (d, i) => d[i * 4] > 100 && d[i * 4 + 1] < 40;   // mode 2 paints (0.6,0,0) where a.a < 0.5
        const enclosedCount = (m) => { const seen = new Uint8Array(W * Hh); const st = [];
            const push = (i) => { if (m[i] && !seen[i]) { seen[i] = 1; st.push(i); } };
            for (let x = 0; x < W; x++) { push(x); push((Hh - 1) * W + x); } for (let y = 0; y < Hh; y++) { push(y * W); push(y * W + W - 1); }
            while (st.length) { const i = st.pop(); const x = i % W, y = (i / W) | 0; if (x > 0) push(i - 1); if (x < W - 1) push(i + 1); if (y > 0) push(i - W); if (y < Hh - 1) push(i + W); }
            let n = 0; for (let i = 0; i < W * Hh; i++) if (m[i] && !seen[i]) n++; return n; };
        const shots = {}, stats = [];
        const fgMeshes = mediaLayers.map(Lx => Lx.mesh).filter(Boolean);
        for (const [name, px, py] of o.poses) {
            camera.position.set(px, py, o.z); updateCameraAndProjection(); render(); render();
            const el = renderer.domElement; const cc = document.createElement('canvas'); cc.width = el.width; cc.height = el.height; cc.getContext('2d').drawImage(el, 0, 0);
            shots['composite_' + name] = cc.toDataURL('image/png');
            // FG only
            _depthPassIncludeBG = false; renderNormalizedDepthPass(); const cFG = depthPanel();
            // plug only (FG hidden)
            for (const m of fgMeshes) m.visible = false;
            _depthPassIncludeBG = true; renderNormalizedDepthPass(); const cPlug = depthPanel();
            for (const m of fgMeshes) m.visible = true;
            // composite (FG + plug)
            _depthPassIncludeBG = true; renderNormalizedDepthPass(); const cAll = depthPanel();
            // A257: the composite WITHOUT the object-back layer, to tint where the back wins
            const backM = (typeof bgLayerMesh !== 'undefined' && bgLayerMesh && bgLayerMesh.userData && bgLayerMesh.userData.back) || null; let dNoB = null;
            if (backM) { backM.visible = false; renderNormalizedDepthPass(); dNoB = depthPanel().getContext('2d').getImageData(0, 0, W, Hh).data; backM.visible = true; }
            _depthPassIncludeBG = false; renderNormalizedDepthPass();
            const dFG = cFG.getContext('2d').getImageData(0, 0, W, Hh).data, dPl = cPlug.getContext('2d').getImageData(0, 0, W, Hh).data, dAll = cAll.getContext('2d').getImageData(0, 0, W, Hh).data;
            // who-wins panel: FG grey, plug green-tinted, object back CYAN, nothing red
            const cWho = document.createElement('canvas'); cWho.width = W; cWho.height = Hh; const wx = cWho.getContext('2d'); const wi = wx.createImageData(W, Hh);
            const holeFG = new Uint8Array(W * Hh), holeAll = new Uint8Array(W * Hh); let nFG = 0, nAll = 0, nPlugWins = 0, nBackWins = 0;
            for (let i = 0; i < W * Hh; i++) { const o4 = i * 4;
                const fgV = !isRed(dFG, i), allV = !isRed(dAll, i), plV = !isRed(dPl, i);
                if (!fgV) { holeFG[i] = 1; nFG++; } if (!allV) { holeAll[i] = 1; nAll++; }
                if (!allV) { wi.data[o4] = 200; wi.data[o4 + 1] = 0; wi.data[o4 + 2] = 0; }
                else if (fgV && Math.abs(dAll[o4] - dFG[o4]) <= 1) { wi.data[o4] = dAll[o4]; wi.data[o4 + 1] = dAll[o4]; wi.data[o4 + 2] = dAll[o4]; }
                else if (dNoB && (isRed(dNoB, i) || Math.abs(dAll[o4] - dNoB[o4]) > 1)) { nBackWins++; const g = dAll[o4]; wi.data[o4] = g * 0.3; wi.data[o4 + 1] = Math.min(255, 90 + g * 0.6); wi.data[o4 + 2] = Math.min(255, 120 + g * 0.5); }
                else { nPlugWins++; const g = dAll[o4]; wi.data[o4] = g * 0.35; wi.data[o4 + 1] = Math.min(255, 60 + g); wi.data[o4 + 2] = g * 0.35; if (!plV) { wi.data[o4] = 255; wi.data[o4 + 1] = 0; wi.data[o4 + 2] = 255; } }
                wi.data[o4 + 3] = 255; }
            wx.putImageData(wi, 0, 0);
            stats.push({ pose: name, x: px, y: py, holesFG: nFG, holesFGEnclosed: enclosedCount(holeFG), holesAfter: nAll, holesAfterEnclosed: enclosedCount(holeAll), plugWins: nPlugWins, backWins: nBackWins });
            shots['depthFG_' + name] = cFG.toDataURL('image/png'); shots['depthPlug_' + name] = cPlug.toDataURL('image/png'); shots['depthAll_' + name] = cAll.toDataURL('image/png'); shots['who_' + name] = cWho.toDataURL('image/png');
        }
        camera.position.set(0, 0, o.z); updateCameraAndProjection(); render();
        return { bakeMs, W, Hh, shots, stats };
    }, { poses: POSES, z: Z, flush: !!process.env.FLUSH, geo: !!process.env.GEO, obs: !!process.env.OBS, gateA: !!process.env.GATEA, v2: process.env.MODE === 'v2', nobake: !!process.env.NOBAKE, flags: (process.env.FLAGS || '').split(',').filter(Boolean) });
    for (const k of Object.keys(res.shots)) fs.writeFileSync(path.join(OUT, ARM + '_' + k + '.png'), Buffer.from(res.shots[k].split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT, ARM + '_stats.json'), JSON.stringify(res.stats, null, 1));
    console.log(`${TAG} [${ARM}${process.env.FLUSH ? ',flush' : ''}] bake ${res.bakeMs} ms, depth pass ${res.W}x${res.Hh}`);
    console.log('   pose     x       y       FG holes (enclosed)   after plug (enclosed)   plug wins px');
    for (const s of res.stats) console.log('   ' + s.pose.padEnd(8) + ' ' + String(s.x).padEnd(7) + ' ' + String(s.y).padEnd(7) + ' ' + String(s.holesFG).padStart(8) + ' (' + String(s.holesFGEnclosed).padStart(7) + ')   ' + String(s.holesAfter).padStart(10) + ' (' + String(s.holesAfterEnclosed).padStart(7) + ')   ' + String(s.plugWins).padStart(10) + (s.backWins ? '   back wins ' + s.backWins : ''));
    console.log('   shots -> ' + OUT);
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
