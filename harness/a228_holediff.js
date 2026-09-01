// A228b WHERE are the carve's extra holes? Hole masks for both arms at the
// two worst poses, XOR'd (red = carve-only hole, blue = default-only, green =
// both), saved as PNG + the carve composite with the extra holes circled by
// their bounding boxes printed. a196 rule: look at the buffer.
//   node harness/a228_holediff.js
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = path.resolve(__dirname, '..'), H = __dirname;
const OUT = path.join(__dirname, 'shots', 'a228');
const POSES = [['mirror', -0.141, 0.023], ['sheet1', 0.180, 0.008]];
const Z = 0.199;

(async () => {
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
               '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const masks = {};
    for (const carve of [false, true]) {
        const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
        await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
        for (let t = 0; t < 45; t++) {
            const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
            if (ok) break; await new Promise(r2 => setTimeout(r2, 1000));
        }
        const res = await page.evaluate(async (o) => {
            window._rayReproject = true;
            if (o.carve) window._plugCarve = true;
            bgQuickBake = true; buildBackgroundLayer(); isSweeping = true;
            const out = {};
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
                const thr = isFloat ? 0.03 : 8;
                const m = new Uint8Array(W * Hh);
                for (let i = 0; i < W * Hh; i++) m[i] = buf[i * 4 + 3] < thr ? 1 : 0;
                // base64, not a JSON array of 468k numbers (page.evaluate serialization)
                let b64 = ''; for (let i = 0; i < m.length; i += 32768) b64 += String.fromCharCode.apply(null, m.subarray(i, i + 32768));
                out[name] = { W, Hh, m: btoa(b64) };
            }
            return out;
        }, { carve, poses: POSES, z: Z });
        masks[carve ? 'C' : 'D'] = res;
        await page.close();
    }
    // XOR maps + bounding boxes of carve-only holes (connected components, 4-conn)
    const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load' }).catch(() => {});
    for (const [name] of POSES) {
        const D = masks.D[name], C = masks.C[name];
        const W = D.W, Hh = D.Hh;
        D.m = Buffer.from(D.m, 'base64'); C.m = Buffer.from(C.m, 'base64');
        const png = await page.evaluate(({ dm, cm, W, Hh }) => {
            const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
            const cx = cv.getContext('2d'); const im = cx.createImageData(W, Hh);
            for (let i = 0; i < W * Hh; i++) {
                const o = i * 4, d = dm[i], c = cm[i];
                im.data[o] = c && !d ? 255 : 0; im.data[o + 1] = c && d ? 140 : 0; im.data[o + 2] = d && !c ? 255 : 0; im.data[o + 3] = 255;
            }
            cx.putImageData(im, 0, 0);
            // flip upright
            const cv2 = document.createElement('canvas'); cv2.width = W; cv2.height = Hh;
            const c2 = cv2.getContext('2d'); c2.translate(0, Hh); c2.scale(1, -1); c2.drawImage(cv, 0, 0);
            return cv2.toDataURL('image/png');
        }, { dm: Array.from(D.m), cm: Array.from(C.m), W, Hh });
        fs.writeFileSync(path.join(OUT, 'holediff_' + name + '.png'), Buffer.from(png.split(',')[1], 'base64'));
        // components of carve-only holes
        const only = new Uint8Array(W * Hh); let n = 0;
        for (let i = 0; i < W * Hh; i++) if (C.m[i] && !D.m[i]) { only[i] = 1; n++; }
        const seen = new Uint8Array(W * Hh); const comps = [];
        for (let i = 0; i < W * Hh; i++) {
            if (!only[i] || seen[i]) continue;
            let x0 = W, x1 = 0, y0 = Hh, y1 = 0, cnt = 0; const st = [i]; seen[i] = 1;
            while (st.length) { const k = st.pop(); cnt++; const x = k % W, y = (k / W) | 0;
                if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
                for (const nb of [k - 1, k + 1, k - W, k + W]) if (nb >= 0 && nb < W * Hh && only[nb] && !seen[nb]) { seen[nb] = 1; st.push(nb); } }
            comps.push({ cnt, x0, x1, y0: Hh - 1 - y1, y1: Hh - 1 - y0 }); // upright y
        }
        comps.sort((a, b) => b.cnt - a.cnt);
        console.log(name + ': carve-only holes ' + n + ' px in ' + comps.length + ' components; largest: ' +
            comps.slice(0, 6).map(c => c.cnt + 'px@(' + c.x0 + '-' + c.x1 + ',' + c.y0 + '-' + c.y1 + ')').join('  '));
    }
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
