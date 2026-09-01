// A228c INTERIOR holes. The a228_carve "holes" number turned out to be
// dominated by the pillarbox: the plate is narrower than the 16:9 frame, so
// ~53% of the render target is uncovered at rest in BOTH arms. This splits
// the hole mask into frame-edge-connected components (pillarbox + plate
// silhouette) and interior components (true disocclusion holes inside the
// plate), per arm, per pose. a196 rule: look at the buffer, not the sum.
//   node harness/a228_interior.js
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = __dirname;
const POSES = [['rest', 0, 0], ['a221', 0.100, -0.023], ['sheet2', 0.141, 0.023], ['sheet1', 0.180, 0.008], ['mirror', -0.141, 0.023]];
const Z = 0.199;

function split(m, W, Hh) {
    const seen = new Uint8Array(W * Hh); let edge = 0, inner = 0; const innerComps = [];
    for (let i = 0; i < W * Hh; i++) {
        if (!m[i] || seen[i]) continue;
        let cnt = 0, touches = false, x0 = W, x1 = 0, y0 = Hh, y1 = 0; const st = [i]; seen[i] = 1;
        while (st.length) {
            const k = st.pop(); cnt++; const x = k % W, y = (k / W) | 0;
            if (x === 0 || x === W - 1 || y === 0 || y === Hh - 1) touches = true;
            if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
            for (const nb of [k - 1, k + 1, k - W, k + W]) if (nb >= 0 && nb < W * Hh && m[nb] && !seen[nb]) { seen[nb] = 1; st.push(nb); }
        }
        if (touches) edge += cnt; else { inner += cnt; innerComps.push({ cnt, x0, x1, y0: Hh - 1 - y1, y1: Hh - 1 - y0 }); }
    }
    innerComps.sort((a, b) => b.cnt - a.cnt);
    return { edge, inner, innerComps };
}

(async () => {
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
               '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const rows = {};
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
                let b64 = ''; for (let i = 0; i < m.length; i += 32768) b64 += String.fromCharCode.apply(null, m.subarray(i, i + 32768));
                out[name] = { W, Hh, m: btoa(b64) };
            }
            return out;
        }, { carve, poses: POSES, z: Z });
        const tag = carve ? 'C' : 'D';
        rows[tag] = {};
        for (const [name] of POSES) {
            const r = res[name]; const m = Buffer.from(r.m, 'base64');
            const s = split(m, r.W, r.Hh);
            rows[tag][name] = s;
            console.log(tag + ' ' + name.padEnd(7) + ' total=' + String(s.edge + s.inner).padStart(6) +
                '  edgeConnected=' + String(s.edge).padStart(6) + '  INTERIOR=' + String(s.inner).padStart(5) +
                ' in ' + s.innerComps.length + ' comps; largest: ' +
                s.innerComps.slice(0, 4).map(c => c.cnt + 'px@(' + c.x0 + '-' + c.x1 + ',' + c.y0 + '-' + c.y1 + ')').join('  '));
        }
        await page.close();
    }
    console.log('---- interior holes, carve vs default:');
    for (const [name] of POSES) {
        const d = rows.D[name], c = rows.C[name];
        console.log('  ' + name.padEnd(7) + ' interior D=' + d.inner + '  C=' + c.inner + '  delta=' + (c.inner - d.inner >= 0 ? '+' : '') + (c.inner - d.inner) +
            '   edge-connected D=' + d.edge + '  C=' + c.edge + '  delta=' + (c.edge - d.edge >= 0 ? '+' : '') + (c.edge - d.edge));
    }
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
