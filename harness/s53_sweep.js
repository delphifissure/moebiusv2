// S53 / R8 item 1 — RENDER THE ARMS IN MOTION, because the artefact is a motion percept and we have only ever
// measured it on stills.
//
// InpaintFusion (Mori et al., IEEE TVCG 26(10) 2020) S4.1, read first-hand for R8: "SPATIO-TEMPORAL CONSISTENCY
// CANNOT BE JUDGED FROM INDIVIDUAL IMAGES." They ran 55 subjects x 9 scenes x 3 methods, rating stills AND video.
// On stills the three methods score 6/5/5 -- indistinguishable. In motion they separate by 4 to 5 points, and the
// two planar proxies get WORSE while the one with correct depth gets BETTER (Fig.9; Fig.14: "static images do not
// clearly show the advantages of our method ... we strongly recommend readers to watch the results in motion").
//
// Every verdict this project has reached about the band was reached on stills. S51's A/B was two frames and
// concluded "indistinguishable"; S52's three arms were compared at two fixed poses. "Streaky as hell" is what the
// user sees WHILE MOVING. So this renders a continuous sweep through the envelope and harness/s53_metrics.py scores
// it perceptually rather than by pixel difference.
//
// The camera path is identical for every arm, so when only the plate's COLOUR differs (the S52 returns) any
// difference in a frame-to-frame measure is attributable to the content and not to the parallax, which is the
// control that makes a temporal number mean something here.
//
//   FLAGS='{"_farLabel":true}' RET=<png> TAG=... SWEEP=h N=21 node harness/s53_sweep.js
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const H = __dirname;
const RET = process.env.RET || '';
const TAG = process.env.TAG || 'wash';
const OUT = process.env.OUT || path.join(H, 'shots', 's53_sweep', TAG);
const SWEEP = process.env.SWEEP || 'h';          // h: 0 -> +1 horizontal   d: 0 -> (+1,-1) diagonal
const N = parseInt(process.env.N || '21', 10);   // frames, inclusive of rest
const FLAGS = process.env.FLAGS ? JSON.parse(process.env.FLAGS) : {};
// Viewport. The renderer here is SwiftShader on four cores and a frame at the envelope edge costs minutes at
// 912x513, which makes a six-arm sweep a multi-hour job. Every arm renders at the SAME size and the metrics are
// comparisons between arms, so dropping the viewport costs resolution in the absolute numbers and nothing in the
// ordering. Stated rather than silently chosen.
const VW = parseInt(process.env.VW || '608', 10), VH = parseInt(process.env.VH || '342', 10);

// The path. Frame 0 is always rest, so every arm starts from the same picture and the curve reads as "how fast does
// this degrade as the viewer moves", which is the question the envelope poses.
function pathOf(kind, n) {
    const out = [];
    for (let k = 0; k < n; k++) {
        const t = k / (n - 1);
        if (kind === 'd') out.push([t, -t]);
        else out.push([t, 0]);
    }
    return out;
}

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    // DEPTH/COLOR swap, as harness/s51_label.js does it: the page reads defaultImg*.png from the harness directory,
    // so an alternative depth map (R8 item 4's 2x run) becomes just another arm of this same instrument, measured
    // the same way. Restored on exit so the next arm starts from the shipped pair.
    const WT2 = path.resolve(H, '..');
    if (process.env.DEPTH) fs.copyFileSync(path.resolve(WT2, process.env.DEPTH), path.join(H, 'defaultImgDepth.png'));
    if (process.env.COLOR) fs.copyFileSync(path.resolve(WT2, process.env.COLOR), path.join(H, 'defaultImgColor.png'));
    if (process.env.DEPTH || process.env.COLOR) {
        console.log('source swap: depth=' + (process.env.DEPTH || 'shipped') + ' colour=' + (process.env.COLOR || 'shipped'));
        process.on('exit', () => { try {
            fs.copyFileSync(path.join(WT2, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
            fs.copyFileSync(path.join(WT2, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png'));
        } catch (e) {} });
    }
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: VW, height: VH } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 220)));
    page.on('console', m => { const t = m.text(); if (/\[S51\]|\[Sprint 25\]|\[S52\]|FAILED/.test(t)) console.log('  [page] ' + t.slice(0, 260)); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }

    const meta = await page.evaluate(async (FLAGS) => {
        window._rayReproject = true; window._depthContractUI = false;
        if (window._applyPlateOptions) window._applyPlateOptions();
        window._plugObjectRule = false; window._plugExtent = null; window._geoLipSeed = false; window._plugBack = false; window._plateFlushExempt = true;
        for (const k in FLAGS) window[k] = FLAGS[k];          // the arm, set BEFORE the bake so the geometry is the arm's
        const ms = document.getElementById('bgModeSel'); if (ms) ms.value = 'quick'; bgQuickBake = true; window._bgBakeMode = 'quick';
        const t0 = Date.now(); window._plugGeoBand({ flush: true, observed: true, gateAPriori: true }); window._bgUserBuiltOnce = true;
        return { bakeMs: Date.now() - t0, size: window._qbSize, flags: Object.keys(FLAGS).map(k => k + '=' + window[k]).join(' ') };
    }, FLAGS);
    console.log('bake ' + meta.bakeMs + ' ms, plate ' + meta.size.pw + 'x' + meta.size.ph + (meta.flags ? ('  [' + meta.flags + ']') : ''));

    let reimport = null;
    if (RET) {
        const b64 = fs.readFileSync(path.resolve(RET)).toString('base64');
        reimport = await page.evaluate(async (b64) => {
            const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
            const pw = window._qbSize.pw, ph = window._qbSize.ph;
            const cv = document.createElement('canvas'); cv.width = pw; cv.height = ph;
            cv.getContext('2d').drawImage(img, 0, 0, pw, ph);
            return window._importPlaneReturn({ color: cv.getContext('2d').getImageData(0, 0, pw, ph).data });
        }, b64);
        console.log('reimport: ' + JSON.stringify(reimport && reimport.colour) + '  band ' + (reimport && reimport.band));
    } else console.log('no RET: the plate as baked');

    const poses = pathOf(SWEEP, N);
    const frames = [];
    for (let k = 0; k < poses.length; k++) {
        const [fx, fy] = poses[k];
        const png = await page.evaluate(async ([fx, fy]) => {
            if (typeof updateVolumeGuidesVisibility === 'function') updateVolumeGuidesVisibility(false);
            isSweeping = true;
            const D = Math.abs(camera.position.z - portalPlaneWorldZ), exR = D * Math.tan(bgViewFadeEndDeg * Math.PI / 180);
            camera.position.x = fx * exR; camera.position.y = fy * exR * bgEnvAspect();
            updateCameraAndProjection(); render(); updateCameraAndProjection(); render();
            const W = renderer.domElement.width, Hh = renderer.domElement.height;
            const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
            cv.getContext('2d').drawImage(renderer.domElement, 0, 0, W, Hh);
            isSweeping = false; return cv.toDataURL('image/png');
        }, [fx, fy]);
        const f = path.join(OUT, 'f' + String(k).padStart(3, '0') + '.png');
        fs.writeFileSync(f, Buffer.from(png.split(',')[1], 'base64'));
        frames.push({ k, fx, fy, file: path.basename(f) });
    }
    fs.writeFileSync(path.join(OUT, 'sweep.json'), JSON.stringify({
        tag: TAG, sweep: SWEEP, n: N, ret: RET || null, flags: FLAGS, plate: meta.size,
        bakeMs: meta.bakeMs, reimport, frames }, null, 1));
    console.log('-> ' + OUT + '  (' + frames.length + ' frames)');
    await browser.close(); try { srv.kill(); } catch (e) {}
})();
