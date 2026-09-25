// S67 §7 check: the head-Z estimator (bgHeadZMeasure, taken verbatim from moebius.js) on the real tracker (MediaPipe
// FaceMesh, refineLandmarks on, the CDN build the app loads) over synthetic frames: one face drawn at known scales s.
// Distance is 1/s, so span/s and iris/s must be constant; and bgHeadZUpdate's ratio after a rest capture at s=1 must
// read 1/s. Face: Vermeer's Milkmaid (a painting; the bundled batchB/vermeer_color.png).   node harness/headz_check.js
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = __dirname; const SRC = fs.readFileSync(path.join(H, '..', 'moebius.js'), 'utf8');
const grab = (name) => { const i = SRC.indexOf('function ' + name + '('); let d = 0, j = SRC.indexOf('{', i);
    for (let k = j; k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); } } };
(async () => {
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore', env: Object.assign({}, process.env, { PORT: '8123' }) });
    await new Promise(r => setTimeout(r, 1200));
    const px = process.env.HTTPS_PROXY || process.env.https_proxy;
    const browser = await chromium.launch({ executablePath: CHROME, headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true }); const page = await ctx.newPage();
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200))); page.on('requestfailed', r => console.log('  [REQFAIL] ' + r.url().slice(0, 120) + ' ' + (r.failure() && r.failure().errorText))); page.on('response', r => { if (r.status() >= 400) console.log('  [HTTP ' + r.status() + '] ' + r.url().slice(0, 120)); });
    await page.goto('http://localhost:8123/headz_test.html', { waitUntil: 'load', timeout: 120000 });
    const res = await page.evaluate(async (fn) => {
        eval(fn.measure + ';window.bgHeadZMeasure=bgHeadZMeasure;');
        await tf.setBackend('webgl');
        const det = await faceLandmarksDetection.createDetector(faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh,
            { maxFaces: 1, refineLandmarks: true, runtime: 'mediapipe', solutionPath: location.origin + '/hz_vendor/@mediapipe/face_mesh' });
        const img = new Image(); img.src = 'batchB/vermeer_color.png'; await img.decode();
        // find the face: the whole picture, then 2x2 and 3x3 tiles each drawn 640 px wide (a small face is missed whole)
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, hit = false;
        for (const n of [1, 2, 3]) { for (let ty = 0; ty < n && !hit; ty++) for (let tx = 0; tx < n && !hit; tx++) {
            const tw = img.naturalWidth / n, th = img.naturalHeight / n, sc = 640 / tw; const c = document.createElement('canvas'); c.width = 640; c.height = Math.round(th * sc);
            c.getContext('2d').drawImage(img, tx * tw, ty * th, tw, th, 0, 0, c.width, c.height);
            const f0 = await det.estimateFaces(c, { flipHorizontal: false });
            if (f0.length) { hit = true; for (const k of f0[0].keypoints) { const X = tx * tw + k.x / sc, Y = ty * th + k.y / sc; x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y); } } }
            if (hit) break; }
        if (!hit) return { err: 'no face found' };
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, fw = x1 - x0;
        const W = 640, Hh = 480, rows = [];
        // the face drawn at s * (160 px wide) centred in a 640x480 frame: a webcam-like face size range
        for (const s of [0.6, 0.7, 0.8, 0.9, 1.0, 1.15, 1.3, 1.5, 1.75, 2.0]) {
            const k = s * 160 / fw; const c = document.createElement('canvas'); c.width = W; c.height = Hh; const g = c.getContext('2d');
            g.fillStyle = '#777'; g.fillRect(0, 0, W, Hh); g.setTransform(k, 0, 0, k, W / 2 - cx * k, Hh / 2 - cy * k); g.drawImage(img, 0, 0);
            const f = await det.estimateFaces(c, { flipHorizontal: false });
            if (!f.length) { rows.push({ s, found: false }); continue; }
            const m = bgHeadZMeasure(f[0].keypoints); const K = f[0].keypoints; rows.push({ s, found: true, n: K.length, span: m.span, span2d: Math.hypot(K[468].x - K[473].x, K[468].y - K[473].y), iris: m.iris });
        }
        return { faceW: fw, rows };
    }, { measure: grab('bgHeadZMeasure') });
    if (res.err) { console.log('ERR', res.err); } else {
        const ok = res.rows.filter(r => r.found), ref = ok.find(r => r.s === 1) || ok[0];
        console.log('face width in the picture ' + res.faceW.toFixed(0) + ' px; keypoints ' + (ok[0] && ok[0].n));
        console.log('  s     span px  span/s   d/d0 est  true   err%   | 2-D span err% | iris px  iris/s  d/d0 est  err%');
        for (const r of res.rows) {
            if (!r.found) { console.log('  ' + r.s.toFixed(2) + '  no face'); continue; }
            const dr = ref.span / r.span, di = (r.iris && ref.iris) ? ref.iris / r.iris : null, t = ref.s / r.s;
            console.log('  ' + r.s.toFixed(2) + '  ' + r.span.toFixed(1).padStart(7) + '  ' + (r.span / r.s).toFixed(1).padStart(6) + '   ' + dr.toFixed(3) + '     ' + t.toFixed(3) + '  ' + (100 * (dr / t - 1)).toFixed(1).padStart(5) +
                '   | ' + (100 * ((ref.span2d / r.span2d) / t - 1)).toFixed(1).padStart(6) + '        | ' + (r.iris ? r.iris.toFixed(2).padStart(6) + '  ' + (r.iris / r.s).toFixed(2).padStart(6) + '  ' + di.toFixed(3) + '    ' + (100 * (di / t - 1)).toFixed(1).padStart(5) : ' none'));
        }
        fs.writeFileSync(path.join(H, 'out_headz_check.json'), JSON.stringify(res, null, 1));
    }
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
