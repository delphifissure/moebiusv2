// fourd/splat_shots.js — splat-portal invariant harness + screenshots.
//
// Invariants (all through the FIXED portal rect, so window coords == screen
// coords and portal-plane content is pinned by construction):
//   I1 DEPTH-ORDERED PARALLAX: sweeping the eye dev -0.4 -> +0.4, the CYAN
//      marker (behind the subject) and the MAGENTA marker (in front) must
//      shift in OPPOSITE screen directions, and the subject (red shirt,
//      centroid at the portal plane) must shift far less than either.
//   I2 4D PLAYBACK: frame 0 vs frame 12 of the walk cycle must differ in
//      a meaningful pixel count (limbs swing), same eye.
// Shots: eye grid x {frame 0, 6, 12} -> fourd/shots/splat_*.png
//   node fourd/splat_shots.js
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const ROOT = path.join(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots');

(async () => {
    fs.mkdirSync(SHOTS, { recursive: true });
    const srv = spawn('node', [path.join(__dirname, 'server.js')], { stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1200));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
               '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    await page.goto('http://localhost:8098/fourd/splat.html?nosweep=1&frame=0', { waitUntil: 'load', timeout: 60000 });
    for (let t = 0; t < 30; t++) {
        const ok = await page.evaluate(() => !!window._fourdReady).catch(() => false);
        if (ok) break; await new Promise(r => setTimeout(r, 500));
    }

    const measure = async (devX, devY, frame) => await page.evaluate(async (o) => {
        window._fourd.setFrame(o.frame);
        window._fourd.setDeviation(o.devX, o.devY);
        window._fourd.forceRender();
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const gl = window._fourd.renderer.domElement;
        const cv = document.createElement('canvas'); cv.width = gl.width; cv.height = gl.height;
        const cx = cv.getContext('2d'); cx.drawImage(gl, 0, 0);
        const d = cx.getImageData(0, 0, cv.width, cv.height).data;
        const cls = { magenta: [0, 0], cyan: [0, 0], shirt: [0, 0] }; // [sumX, n]
        let lit = 0;
        for (let y = 0; y < cv.height; y += 2) for (let x = 0; x < cv.width; x += 2) {
            const i = (y * cv.width + x) * 4;
            const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
            if (r + g + b > 0.15) lit++;
            if (r > 0.5 && b > 0.5 && g < 0.35) { cls.magenta[0] += x; cls.magenta[1]++; }
            else if (g > 0.5 && b > 0.5 && r < 0.35) { cls.cyan[0] += x; cls.cyan[1]++; }
            else if (r > 0.45 && g < 0.3 && b < 0.3) { cls.shirt[0] += x; cls.shirt[1]++; }
        }
        const cen = (k) => cls[k][1] ? cls[k][0] / cls[k][1] : NaN;
        return { magenta: cen('magenta'), cyan: cen('cyan'), shirt: cen('shirt'),
                 nM: cls.magenta[1], nC: cls.cyan[1], nS: cls.shirt[1], lit };
    }, { devX, devY, frame });

    // ---- I1: depth-ordered parallax ----
    const L = await measure(-0.4, 0, 0);
    const R = await measure(+0.4, 0, 0);
    const dM = R.magenta - L.magenta, dC = R.cyan - L.cyan, dS = R.shirt - L.shirt;
    console.log('I1 counts  L: mag=' + L.nM + ' cyan=' + L.nC + ' shirt=' + L.nS + ' lit=' + L.lit);
    console.log('I1 shifts (dev -0.4 -> +0.4): magenta=' + dM.toFixed(1) + 'px  cyan=' + dC.toFixed(1) +
        'px  shirt(plane)=' + dS.toFixed(1) + 'px');
    const i1a = isFinite(dM) && isFinite(dC) && Math.sign(dM) !== Math.sign(dC) && Math.abs(dC) > 2;
    const i1b = isFinite(dS) && Math.abs(dS) < Math.min(Math.abs(dM), Math.abs(dC));
    console.log('I1 ' + ((i1a && i1b) ? 'PASS' : 'FAIL') +
        ' (opposite signs: ' + i1a + ', plane-pinned subject smallest: ' + i1b + ')');

    // ---- I2: 4D playback changes pixels ----
    // frames 0 and 6 = quarter cycle apart (sin swing 0 -> 1); 0 vs 12 are
    // the SAME pose (sin 0 = sin pi = 0) — the first run compared those and
    // proved only that identical poses render identically.
    const A = await page.evaluate(async () => {
        window._fourd.setFrame(0); window._fourd.forceRender();
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const gl = window._fourd.renderer.domElement;
        const cv = document.createElement('canvas'); cv.width = gl.width; cv.height = gl.height;
        const cx = cv.getContext('2d'); cx.drawImage(gl, 0, 0);
        return Array.from(cx.getImageData(0, 0, cv.width, cv.height).data.filter((_, i) => i % 16 === 0));
    });
    const B = await page.evaluate(async () => {
        window._fourd.setFrame(6); window._fourd.forceRender();
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const gl = window._fourd.renderer.domElement;
        const cv = document.createElement('canvas'); cv.width = gl.width; cv.height = gl.height;
        const cx = cv.getContext('2d'); cx.drawImage(gl, 0, 0);
        return Array.from(cx.getImageData(0, 0, cv.width, cv.height).data.filter((_, i) => i % 16 === 0));
    });
    let diff = 0;
    for (let i = 0; i < Math.min(A.length, B.length); i++) if (Math.abs(A[i] - B[i]) > 24) diff++;
    const i2 = diff > A.length * 0.005;
    console.log('I2 frame0 vs frame6: ' + diff + ' of ' + A.length + ' sampled bytes changed — ' + (i2 ? 'PASS' : 'FAIL'));

    // ---- shots ----
    const eyes = [[-0.4, 0], [0, 0], [0.4, 0], [0, 0.3]];
    for (const [ex, ey] of eyes) for (const fr of [0, 6, 12]) {
        await measure(ex, ey, fr);
        await page.screenshot({ path: path.join(SHOTS,
            'splat_e' + ex.toFixed(1) + '_' + ey.toFixed(1) + '_f' + String(fr).padStart(2, '0') + '.png') });
    }
    console.log('shots -> ' + SHOTS);
    await browser.close(); srv.kill();
    process.exit((i1a && i1b && i2) ? 0 : 1);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
