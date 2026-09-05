// Composite shots of the MAIN page (moebius.html) as loaded — the real-time default, no bake —
// at the harness poses. ROOT=<repo root to serve> PORT=<port> OUT=<dir> node harness/p0_mainshot.js
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const ROOT = process.env.ROOT || path.resolve(__dirname, '..'), PORT = process.env.PORT || '8098', OUT = process.env.OUT || path.join(__dirname, 'shots', 'main', 'now');
const POSES = [['rest', 0, 0], ['sheet1', 0.180, 0.008], ['mirror', -0.141, 0.023]];
(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const srv = spawn('python3', ['-m', 'http.server', PORT, '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    page.on('console', m => { const t = m.text(); if (t.includes('BG-') || m.type() === 'error') console.log('  [page:' + m.type() + '] ' + t.slice(0, 200)); });
    await page.goto('http://127.0.0.1:' + PORT + '/' + (process.env.PAGE || 'moebius.html'), { waitUntil: 'load', timeout: 120000 }).catch(e => console.log('goto: ' + e.message.slice(0, 120)));
    for (let t = 0; t < 90; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r2 => setTimeout(r2, 1000)); }
    await new Promise(r => setTimeout(r, parseInt(process.env.SETTLE || '20000')));
    const res = await page.evaluate(async (o) => {
        const out = { mode: { quick: (typeof bgQuickBake !== 'undefined') ? bgQuickBake : null, mpi: (typeof bgMPIMode !== 'undefined') ? bgMPIMode : null, full: (typeof bgMPIFullPlanes !== 'undefined') ? bgMPIFullPlanes : null, bgMesh: !!(typeof bgLayerMesh !== 'undefined' && bgLayerMesh), sel: (document.getElementById('bgModeSel') || {}).value }, shots: {} };
        for (const [name, x, y] of o.poses) { camera.position.set(x, y, o.z); updateCameraAndProjection(); render(); render(); const el = renderer.domElement; const cv = document.createElement('canvas'); cv.width = el.width; cv.height = el.height; cv.getContext('2d').drawImage(el, 0, 0); out.shots[name] = cv.toDataURL('image/png'); }
        // and the whole page (what the user sees, CSS included)
        return out;
    }, { poses: POSES, z: 0.199 });
    console.log('mode ' + JSON.stringify(res.mode));
    for (const k of Object.keys(res.shots)) fs.writeFileSync(path.join(OUT, 'main_' + k + '.png'), Buffer.from(res.shots[k].split(',')[1], 'base64'));
    await page.evaluate(() => { camera.position.set(0.180, 0.008, 0.199); updateCameraAndProjection(); render(); });
    await page.screenshot({ path: path.join(OUT, 'page_sheet1.png') });
    console.log('shots -> ' + OUT);
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
