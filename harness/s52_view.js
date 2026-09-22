// Sprint 28 / S52 — THE INPAINT REIMPORTED AND VIEWED THROUGH THE ENVELOPE.
//
// harness/s52_inpaint.py puts real content in the band at the plate grid. This is the half that matters: the content
// goes back onto the LIVE plate through the Sprint 25 return path (window._importPlaneReturn, colour on the inpaint
// mask and nowhere else), and the picture is rendered at the poses the artefact appears at.
//
// The wash is the control. Everything the project has measured about "streaky" -- S47's two thirds, S50's class
// decomposition, S51's invisible geometry fix -- says the band's colour is the dominant visible defect, and this is the
// first time it is replaced by content rather than by a rim-window mean.
//
//   RET=<png> TAG=... POSES="0:0,1:0,-1:-1" node harness/s52_view.js
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const H = __dirname, WT = path.resolve(__dirname, '..');
const RET = process.env.RET;
const TAG = process.env.TAG || (RET ? path.basename(RET, '.png') : 'wash');
const OUT = process.env.OUT || path.join(H, 'shots', 's52_view', TAG);

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 220)));
    page.on('console', m => { const t = m.text(); if (/\[Sprint 25\]|\[S52\]|FAILED/.test(t)) console.log('  [page] ' + t.slice(0, 300)); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }

    const meta = await page.evaluate(async () => {
        window._rayReproject = true; window._depthContractUI = false;
        if (window._applyPlateOptions) window._applyPlateOptions();
        window._plugObjectRule = false; window._plugExtent = null; window._geoLipSeed = false; window._plugBack = false; window._plateFlushExempt = true;
        const ms = document.getElementById('bgModeSel'); if (ms) ms.value = 'quick'; bgQuickBake = true; window._bgBakeMode = 'quick';
        const t0 = Date.now(); window._plugGeoBand({ flush: true, observed: true, gateAPriori: true }); window._bgUserBuiltOnce = true;
        return { bakeMs: Date.now() - t0, size: window._qbSize };
    });
    console.log('bake ' + meta.bakeMs + ' ms, plate ' + meta.size.pw + 'x' + meta.size.ph);

    if (RET) {
        const b64 = fs.readFileSync(path.resolve(RET)).toString('base64');
        const st = await page.evaluate(async (b64) => {
            const img = new Image(); img.src = 'data:image/png;base64,' + b64;
            await img.decode();
            const pw = window._qbSize.pw, ph = window._qbSize.ph;
            if (img.width !== pw || img.height !== ph) console.warn('[S52] return is ' + img.width + 'x' + img.height + ', plate is ' + pw + 'x' + ph);
            const cv = document.createElement('canvas'); cv.width = pw; cv.height = ph;
            const cx = cv.getContext('2d'); cx.drawImage(img, 0, 0, pw, ph);
            const d = cx.getImageData(0, 0, pw, ph).data;
            return window._importPlaneReturn({ color: d });
        }, b64);
        console.log('reimport: ' + JSON.stringify(st && st.colour) + '  band ' + (st && st.band));
    } else console.log('no RET: rendering the WASH (the control)');

    const poses = (process.env.POSES || '0:0,1:0,-1:-1').split(',').map(s => s.split(':').map(Number));
    for (const [fx, fy] of poses) {
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
        const f = path.join(OUT, String(fx).replace('-', 'm') + '_' + String(fy).replace('-', 'm') + '.png');
        fs.writeFileSync(f, Buffer.from(png.split(',')[1], 'base64'));
        console.log('  pose ' + fx + ':' + fy + ' -> ' + path.basename(f));
    }
    console.log('-> ' + OUT);
    await browser.close(); try { srv.kill(); } catch (e) {}
})();
