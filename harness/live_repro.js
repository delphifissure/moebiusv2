// Reproduce the user's live sheets of 2026-09-15 headlessly: the app's start-up defaults, the Build button, the user's two
// camera poses, the live frame and the app's own debug contact sheet. DEPTH=<file> picks the depth map (the repo's 8-bit
// defaultImgDepth.png, or depth_da3mono16.png). Output harness/shots/liverepro/<TAG>/.
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const H = __dirname, WT = path.resolve(__dirname, '..'); const TAG = process.env.TAG || 'default'; const OUT = path.join(H, 'shots', 'liverepro', TAG); fs.mkdirSync(OUT, { recursive: true });
const POSES = [['user45', 0.220, 0.043], ['user26', -0.097, 0.023], ['rest', 0, 0]];
(async () => {
    fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, process.env.DEPTH || 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } }); const logs = [];
    page.on('console', m => { const t = m.text(); if (/\[S6\]|\[S2b\] rim law: t|A245|\[QUICK-BAKE\] (band|plate|A2)|depth (8|16)-bit|16-bit|quantum|\[A160/.test(t)) logs.push(t.slice(0, 220)); });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
    console.log('defaults: ' + await page.evaluate(() => JSON.stringify(window._bgPlateOptions)) + ' quantum=' + await page.evaluate(() => window._qbSrcQuantum) + ' grid=' + await page.evaluate(() => window._qbSrcGrid));
    await page.evaluate(() => document.getElementById('bgLayerBuildBtn').click());
    for (let t = 0; t < 320; t++) { if (await page.evaluate(() => !!window._bgQuickBaked && !!window._qbPlateF)) break; await new Promise(r => setTimeout(r, 1000)); }
    console.log('baked=' + await page.evaluate(() => !!window._bgQuickBaked) + ' quantum=' + await page.evaluate(() => window._qbSrcQuantum) + ' clones=' + await page.evaluate(() => window._qbCloneCount));
    const shot = async (name) => { const r = await page.evaluate(() => { updateCameraAndProjection(); render(); updateCameraAndProjection(); render(); const W = renderer.domElement.width, Hh = renderer.domElement.height; const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh; cv.getContext('2d').drawImage(renderer.domElement, 0, 0, W, Hh); return cv.toDataURL('image/png'); }); fs.writeFileSync(path.join(OUT, name), Buffer.from(r.split(',')[1], 'base64')); };
    for (const [n, x, y] of POSES) { await page.evaluate(([x, y]) => { isSweeping = true; camera.position.set(x, y, 0.2); }, [x, y]); await shot('live_' + n + '.png');
        // holes: black or backdrop pixels inside the picture's rest rectangle are not distinguishable here; count pure black inside the frame
        const blk = await page.evaluate(() => { const W = renderer.domElement.width, Hh = renderer.domElement.height; const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh; const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh); const d = cx.getImageData(0, 0, W, Hh).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 8 && d[i + 1] < 8 && d[i + 2] < 8) n++; return n; });
        console.log('pose ' + n + ' (' + x + ',' + y + '): black px ' + blk); }
    // the app's own contact sheet at the user's 26.5 deg pose (anchor download intercepted)
    await page.evaluate(() => { isSweeping = true; camera.position.set(-0.097, 0.023, 0.2); updateCameraAndProjection(); render(); window.__dl = []; HTMLAnchorElement.prototype.click = function () { window.__dl.push({ name: this.download, href: this.href }); }; });
    await page.evaluate(() => exportDebugContactSheet()); await new Promise(r => setTimeout(r, 4000));
    const dl = await page.evaluate(() => window.__dl); for (const d of dl) if (d.href.startsWith('data:image')) fs.writeFileSync(path.join(OUT, 'contact_sheet_user26.png'), Buffer.from(d.href.split(',')[1], 'base64'));
    console.log('sheet files: ' + dl.map(d => d.name).join(', '));
    console.log(logs.slice(0, 12).join('\n'));
    await browser.close(); srv.kill(); console.log('done ' + OUT);
})();
