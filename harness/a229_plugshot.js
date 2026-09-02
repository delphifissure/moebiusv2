// A229 plug-only shots: what the carved plug layer LOOKS like (FG hidden),
// default arm (full backstop) vs carve arm (window._plugCarve = true), at
// rest and at the sheet-1 pose. Composite alpha is drawn over magenta so the
// kept region reads unambiguously.
//   node harness/a229_plugshot.js
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = __dirname;
const OUT = path.join(__dirname, 'shots', 'a229');
const POSES = [['rest', 0, 0], ['sheet1', 0.180, 0.008]];
const Z = 0.199;

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
               '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    for (const carve of [false, true]) {
        const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
        page.on('console', m => { const t = m.text(); if (t.includes('a217') || t.includes('A229')) console.log('  [page] ' + t.slice(0, 160)); });
        await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
        for (let t = 0; t < 45; t++) {
            const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
            if (ok) break; await new Promise(r2 => setTimeout(r2, 1000));
        }
        const res = await page.evaluate(async (o) => {
            window._rayReproject = true;
            if (o.carve) window._plugCarve = true;
            if (o.fs) window._frontStop = true;          // A230 arm (FS=1)
            if (o.scan) window._vpScan = true;           // a80 scan (SCAN=1)
            bgQuickBake = true; buildBackgroundLayer(); isSweeping = true;
            const out = {};
            for (const L of mediaLayers) if (L.mesh) L.mesh.visible = false;
            for (const [name, x, y] of o.poses) {
                camera.position.set(x, y, o.z); updateCameraAndProjection(); render(); render();
                const prevRT = renderer.getRenderTarget();
                renderer.setClearColor(new THREE.Color(0, 0, 0), 0.0);
                renderer.setRenderTarget(pingPongRenderTargetB); renderer.clear(); renderer.render(scene, camera);
                const W = pingPongRenderTargetB.width, Hh = pingPongRenderTargetB.height;
                const isFloat = pingPongRenderTargetB.texture.type === THREE.FloatType || pingPongRenderTargetB.texture.type === THREE.HalfFloatType;
                const buf = isFloat ? new Float32Array(W * Hh * 4) : new Uint8Array(W * Hh * 4);
                renderer.readRenderTargetPixels(pingPongRenderTargetB, 0, 0, W, Hh, buf);
                renderer.setRenderTarget(prevRT);
                const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
                const cx = cv.getContext('2d'); const im = cx.createImageData(W, Hh);
                const sc = isFloat ? 255 : 1, thr = isFloat ? 0.03 : 8;
                for (let i = 0; i < W * Hh; i++) {
                    const o4 = i * 4, a = buf[o4 + 3];
                    if (a < thr) { im.data[o4] = 255; im.data[o4 + 1] = 0; im.data[o4 + 2] = 255; }
                    else { im.data[o4] = Math.min(255, buf[o4] * sc); im.data[o4 + 1] = Math.min(255, buf[o4 + 1] * sc); im.data[o4 + 2] = Math.min(255, buf[o4 + 2] * sc); }
                    im.data[o4 + 3] = 255;
                }
                cx.putImageData(im, 0, 0);
                const cv2 = document.createElement('canvas'); cv2.width = W; cv2.height = Hh;
                const c2 = cv2.getContext('2d'); c2.translate(0, Hh); c2.scale(1, -1); c2.drawImage(cv, 0, 0);
                out[name] = cv2.toDataURL('image/png');
            }
            for (const L of mediaLayers) if (L.mesh) L.mesh.visible = true;
            return out;
        }, { carve, poses: POSES, z: Z, fs: !!process.env.FS, scan: !!process.env.SCAN });
        for (const [name] of POSES) {
            const f = path.join(OUT, (carve ? 'carve' : 'default') + (process.env.FS ? '_fs' : '') + (process.env.SCAN ? '_scan' : '') + '_plugonly_' + name + '.png');
            fs.writeFileSync(f, Buffer.from(res[name].split(',')[1], 'base64'));
            console.log('wrote ' + f);
        }
        await page.close();
    }
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
