// S70 check: faces as Set Scale references, on the app's own bgScaleFindFaces with the real tracker (MediaPipe FaceMesh,
// the CDN build the app loads, served locally from hz_vendor) and a known answer. One face (Vermeer's Milkmaid, the
// bundled batchB/vermeer_color.png) is drawn three times on a synthetic picture whose depth map has a sky strip (d = 0)
// and thirds at d = 0.8 / 0.55 / 0.3:
//   left  (d 0.8)  eyes 60 px apart               true: q proportional to d with the sky at infinity (beta = 0)
//   right (d 0.3)  eyes 60 * 0.3 / 0.8 = 22.5 px  true
//   middle (d 0.55) eyes 60 px                     a "poster": 1.45x too large for its depth
// (a first run with 40 / 15 px found only two faces, the 15 px one below the detector's range, and showed the fit
// silently choosing between sky+left and sky+poster: now reported as AMBIGUOUS; the ambiguous case is re-run below)
// Expected: three faces found, each at its region's depth; the poster left out as off the line; beta / alpha ~ 0 and the
// left/right q ratio 0.8 / 0.3 within the landmark precision.   node harness/face_scale_check.js
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const H = __dirname;
(async () => {
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore', env: Object.assign({}, process.env, { PORT: '8129' }) });
    await new Promise(r => setTimeout(r, 1200));
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    page.on('console', m => { if (/\[S70\]/.test(m.text())) console.log('  ' + m.text().slice(0, 200)); });
    await page.goto('http://localhost:8129/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { if (await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh); } catch (e) { return false; } }).catch(() => false)) break; await new Promise(r => setTimeout(r, 1000)); }
    for (const f of ['@tensorflow/tfjs/dist/tf.min.js', '@tensorflow/tfjs-backend-webgl/dist/tf-backend-webgl.min.js', '@mediapipe/face_mesh/face_mesh.js', '@tensorflow-models/face-landmarks-detection/dist/face-landmarks-detection.min.js'])
        if (!(await page.evaluate((f) => /face-landmarks/.test(f) ? typeof faceLandmarksDetection !== 'undefined' : (/tfjs\/dist/.test(f) ? typeof tf !== 'undefined' && !!tf.setBackend : false), f))) await page.addScriptTag({ url: 'hz_vendor/' + f });
    const res = await page.evaluate(async () => {
        await tf.setBackend('webgl'); window._faceSolutionPath = location.origin + '/hz_vendor/@mediapipe/face_mesh';
        try { localStorage.clear(); } catch (e) {}
        const img = new Image(); img.src = 'batchB/vermeer_color.png'; await img.decode();
        // locate the face in the painting once (the same tile search the app does), to place the copies
        const det = await faceLandmarksDetection.createDetector(faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh, { maxFaces: 1, refineLandmarks: true, runtime: 'mediapipe', solutionPath: window._faceSolutionPath });
        const cv = document.createElement('canvas'), cx = cv.getContext('2d'); let F = null;
        for (const n of [1, 2, 3]) { for (let ty = 0; ty < n && !F; ty++) for (let tx = 0; tx < n && !F; tx++) {
            const tw = img.width / n, th = img.height / n; cv.width = 640; cv.height = Math.round(640 * th / tw); cx.drawImage(img, tx * tw, ty * th, tw, th, 0, 0, cv.width, cv.height);
            const fs = await det.estimateFaces(cv); if (fs.length && fs[0].keypoints[473]) { const k = fs[0].keypoints, f = cv.width / tw, m = bgHeadZMeasure(k);
                F = { x: tx * tw + 0.5 * (k[468].x + k[473].x) / f, y: ty * th + 0.5 * (k[468].y + k[473].y) / f, ipd: m.span / f }; } } if (F) break; }
        det.dispose();
        if (!F) return { error: 'no face in the painting' };
        // the synthetic picture: 2400 x 1000, sky strip on top, thirds at d 0.8 / 0.55 / 0.3
        const W = 2400, Hh = 1000, pic = document.createElement('canvas'); pic.width = W; pic.height = Hh; const pc = pic.getContext('2d');
        pc.fillStyle = '#6b6f73'; pc.fillRect(0, 0, W, Hh); pc.fillStyle = '#9ec3e6'; pc.fillRect(0, 0, W, 60);
        const put = (cxp, cyp, ipdT) => { const s = ipdT / F.ipd, half = 3.5 * F.ipd; pc.drawImage(img, F.x - half, F.y - half, 2 * half, 2 * half, cxp - half * s, cyp - half * s, 2 * half * s, 2 * half * s); };
        put(400, 520, 60); put(1200, 520, 60); put(2000, 520, 60 * 0.3 / 0.8);
        const L = mediaLayers[0]; L.textures.color.image = pic;
        const pw = 1200, ph = 500, dQ = new Float32Array(pw * ph);
        for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) dQ[y * pw + x] = y < 30 ? 0 : (x < pw / 3 ? 0.8 : (x < 2 * pw / 3 ? 0.55 : 0.3));
        window._qbDQ = dQ; window._qbSize = { pw, ph };
        const t0 = performance.now(); const n = await bgScaleFindFaces(); const ms = performance.now() - t0;
        const S = window._sceneScale;
        const faces = S.refs.filter(r => r.kind === 'face').map(r => ({ u: +r.u.toFixed(3), v: +r.v.toFixed(3), d: r.d, lenPx: +r.lenPx.toFixed(2), q: r.q, outlier: !!r.outlier, resid: r.resid === null ? null : +r.resid.toFixed(3) }));
        const byD = (d) => faces.find(f => Math.abs(f.d - d) < 1e-6);
        const l = byD(0.8), r = byD(0.3);
        return { paintingFace: F, found: n, ms: Math.round(ms), faces, alpha: S.alpha, beta: S.beta, betaOverAlpha: S.beta / S.alpha, sky: S.sky,
                 qRatioLR: l && r ? l.q / r.q : null, qRatioWant: 0.8 / 0.3, notes: S.notes, readout: document.getElementById('scaleReadout').innerText,
                 listRows: document.getElementById('scaleRefList').children.length,
                 // the ambiguous case: drop the true right face, leaving sky + left + poster
                 ambiguous: (() => { const rr = S.refs.find(r => r.kind === 'face' && Math.abs(r.d - 0.3) < 1e-6); if (!rr) return 'right face not found';
                     rr.use = false; bgScaleSolve(); const o = { notes: S.notes.slice(), disputed: S.refs.filter(r => r.disputed).map(r => r.d), outliers: S.refs.filter(r => r.outlier).map(r => r.d) }; rr.use = true; bgScaleSolve(); return o; })() };
    });
    console.log(JSON.stringify(res, null, 1));
    fs.writeFileSync(path.join(H, 'out_face_scale_check.json'), JSON.stringify(res, null, 1));
    await browser.close(); srv.kill(); process.exit(res && res.found >= 3 ? 0 : 2);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
