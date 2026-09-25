// S69 check: the rebuilt Set Scale on a synthetic disparity field with a known answer (left half d = 0.8, right half
// d = 0.3; references generated from alpha = 0.2, beta = 0.02 portal units per metre). node harness/scale_check.js
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const H = __dirname;
(async () => {
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore', env: Object.assign({}, process.env, { PORT: '8128' }) });
    await new Promise(r => setTimeout(r, 1200));
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    await page.goto('http://localhost:8128/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
    const res = await page.evaluate(() => {
        const out = {}; const pw = 400, ph = 300, dQ = new Float32Array(pw * ph);
        for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) dQ[y * pw + x] = x < pw / 2 ? 0.8 : 0.3;
        window._qbDQ = dQ; window._qbSize = { pw, ph };
        const scalarBefore = document.getElementById('facetrackingScalarSlider')?.value;
        const rect = canvasElement.getBoundingClientRect(), L = mediaLayers[0], lw = L.mesh.geometry.parameters.width, lh = L.mesh.geometry.parameters.height;
        // a canvas point for a source pixel (inverse of bgScaleSrcSample)
        const at = (px, py) => { const su = px / pw, sv = py / ph; const xw = (su - 0.5) * lw, yw = (0.5 - sv) * lh;
            return { clientX: rect.left + (xw / terrariumWidth + 0.5) * rect.width, clientY: rect.top + (0.5 - yw / terrariumHeight) * rect.height }; };
        const aT = 0.2, bT = 0.02, ref = (x0, y0, x1, y1, d) => { const lenPx = Math.hypot(x1 - x0, y1 - y0), s = lenPx * lw / pw, q = aT * d + bT;
            document.getElementById('scaleLen').value = (s / q).toString();
            document.getElementById('setScaleButton').click(); handleCanvasClickForScale(at(x0, y0)); handleCanvasClickForScale(at(x1, y1)); };
        window._sceneScale = { refs: [] };
        ref(40, 100, 140, 100, 0.8);                  // one reference, no sky
        out.one = { alpha: window._sceneScale.alpha, beta: window._sceneScale.beta, notes: window._sceneScale.notes.slice() };
        ref(250, 50, 250, 250, 0.3);                  // a second, vertical, at another depth
        out.two = { alpha: window._sceneScale.alpha, beta: window._sceneScale.beta, residuals: window._sceneScale.residuals, notes: window._sceneScale.notes.slice(), m: window._sceneScale.m, D: window._sceneScale.D, Dsrc: window._sceneScale.Dsrc, Zs: window._sceneScale.Zs, lensDexpected: lw * 50 / 36 };
        // conflict: a far reference claiming to be LARGER per metre than the near one
        window._sceneScale = { refs: [] }; document.getElementById('scaleLen').value = '0.1'; document.getElementById('setScaleButton').click(); handleCanvasClickForScale(at(250, 100)); handleCanvasClickForScale(at(350, 100));
        document.getElementById('scaleLen').value = '10'; document.getElementById('setScaleButton').click(); handleCanvasClickForScale(at(40, 100)); handleCanvasClickForScale(at(140, 100));
        out.conflict = window._sceneScale.notes.slice();
        // the metric law under Cm with the two-reference solve
        window._sceneScale = { refs: [] }; ref(40, 100, 140, 100, 0.8); ref(250, 50, 250, 250, 0.3);
        const lawBefore = [0, 0.3, 0.5, 0.8, 1].map(d => volumeZOffForNormDepth(d));
        window._cutMap = 'Cm'; const law = [0, 0.1, 0.3, 0.5, 0.8, 1].map(d => volumeZOffForNormDepth(d)); window._cutMap = 'current';
        out.law = { pn: currentNormPortalPlane, current: lawBefore, Cm: law, monotone: law.every((v, i) => !i || v >= law[i - 1]) };
        out.scalarUnchanged = document.getElementById('facetrackingScalarSlider')?.value === scalarBefore;
        out.readout = document.getElementById('scaleReadout').innerText;
        return out;
    });
    console.log(JSON.stringify(res, null, 1));
    fs.writeFileSync(path.join(H, 'out_scale_check.json'), JSON.stringify(res, null, 1));
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
