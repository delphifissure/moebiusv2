// fourd/moebius_splat_test.js — A223 splat-layer integration tests.
//
//   T1 ISOLATION: with a splat layer LOADED, the baked 2.5D pipeline's gap
//      set must be BIT-IDENTICAL to the shipped reference (99907 px / 3769
//      boundary at the a221 pose) — splats are composite-only, invisible to
//      the depth pass, footprint pass, and gap captures. This is end-to-end:
//      if the splat leaked into renderNormalizedDepthPass, runFGSubtraction
//      would seed differently and the numbers would move.
//   T2 COMPOSITE: the splat IS visible in the final frame (pixel delta
//      between splat-visible and splat-hidden composites at an off-axis
//      pose), i.e. hiding it from analysis did not hide it from the user.
//   T3 SPZ: a v2 .spz generated here (gzip, verified section order) parses
//      to the same splat count and positions as its source data (writer/
//      reader self-consistency; full conformance still wants a reference
//      file from a real exporter).
//   node fourd/moebius_splat_test.js
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const zlib = require('zlib');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const ROOT = path.join(__dirname, '..'), H = path.join(ROOT, 'harness');
const SHOTS = path.join(__dirname, 'shots');
const POSE = { x: 0.100, y: -0.023, z: 0.200 };

function makeSpzV2(points) { // points: [{p:[3], s:[3] linear, q:[w,x,y,z], c:[r,g,b,a] 0..1}]
    const n = points.length, fracBits = 12;
    const head = Buffer.alloc(16);
    head.writeUInt32LE(0x5053474e, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(n, 8);
    head[12] = 0; head[13] = fracBits; head[14] = 0; head[15] = 0;
    const pos = Buffer.alloc(n * 9), alpha = Buffer.alloc(n), color = Buffer.alloc(n * 3),
          scale = Buffer.alloc(n * 3), rot = Buffer.alloc(n * 3);
    points.forEach((pt, i) => {
        for (let a = 0; a < 3; a++) {
            const f = Math.round(pt.p[a] * (1 << fracBits)) & 0xffffff;
            pos[(i * 3 + a) * 3] = f & 0xff; pos[(i * 3 + a) * 3 + 1] = (f >> 8) & 0xff; pos[(i * 3 + a) * 3 + 2] = (f >> 16) & 0xff;
        }
        alpha[i] = Math.round(pt.c[3] * 255);
        for (let a = 0; a < 3; a++) {
            // inverse of color = 0.5 + SH_C0 * ((byte/255 - 0.5) / 0.15)
            const fdc = (pt.c[a] - 0.5) / 0.28209479177387814;
            color[i * 3 + a] = Math.max(0, Math.min(255, Math.round((fdc * 0.15 + 0.5) * 255)));
        }
        for (let a = 0; a < 3; a++)
            scale[i * 3 + a] = Math.max(0, Math.min(255, Math.round((Math.log(pt.s[a]) + 10) * 16)));
        rot[i * 3] = Math.round((pt.q[1] + 1) * 127.5);     // x
        rot[i * 3 + 1] = Math.round((pt.q[2] + 1) * 127.5); // y
        rot[i * 3 + 2] = Math.round((pt.q[3] + 1) * 127.5); // z (w reconstructed)
    });
    return zlib.gzipSync(Buffer.concat([head, pos, alpha, color, scale, rot]));
}

(async () => {
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png'));
    fs.copyFileSync(path.join(ROOT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
    fs.copyFileSync(path.join(__dirname, 'assets', 'frame_00.splat'), path.join(H, 'test_frame00.splat'));
    fs.writeFileSync(path.join(H, 'test_v2.spz'), makeSpzV2([
        { p: [0, 0, 0], s: [0.05, 0.05, 0.05], q: [1, 0, 0, 0], c: [1, 0.2, 0.1, 0.9] },
        { p: [0.25, 0.125, -0.5], s: [0.02, 0.04, 0.02], q: [1, 0, 0, 0], c: [0.1, 0.9, 0.2, 0.8] },
    ]));
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
               '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    page.on('console', m => { const t = m.text();
        if (t.includes('A223') || t.includes('[PAGEERR]')) console.log('  [page] ' + t.slice(0, 140)); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) {
        const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
        if (ok) break; await new Promise(r => setTimeout(r, 1000));
    }

    // T3 first (cheap): spz round-trip
    const t3 = await page.evaluate(async () => {
        const buf = await (await fetch('test_v2.spz')).arrayBuffer();
        const fr = await FourDSplats.parseSpz(buf);
        return { n: fr.n, p0: Array.from(fr.center.slice(0, 3)), p1: Array.from(fr.center.slice(3, 6)),
                 a0: fr.color[3] };
    });
    const t3ok = t3.n === 2 && Math.abs(t3.p1[0] - 0.25) < 0.001 && Math.abs(t3.p1[2] + 0.5) < 0.001
        && Math.abs(t3.a0 - 0.9) < 0.01;
    console.log('T3 spz v2 round-trip: n=' + t3.n + ' p1=[' + t3.p1.map(v => v.toFixed(3)) + '] a0=' +
        t3.a0.toFixed(2) + ' — ' + (t3ok ? 'PASS' : 'FAIL'));

    // load the real splat layer
    const nSplats = await page.evaluate(async () => {
        const buf = await (await fetch('test_frame00.splat')).arrayBuffer();
        const entry = await window._addSplatLayerFromBuffer(buf, 'test_frame00.splat');
        return entry.cloud.frame().n;
    });
    console.log('splat layer loaded: ' + nSplats + ' splats');

    // T1: baked gap set with the splat present (a221 recipe + splat hide,
    // mirroring the sheet's updated loop)
    const r = await page.evaluate(async (pose) => {
        window._rayReproject = true;
        bgQuickBake = true; buildBackgroundLayer();
        isSweeping = true;
        camera.position.set(pose.x, pose.y, pose.z);
        updateCameraAndProjection(); render(); render();
        renderNormalizedDepthPass();
        const thrR = parseFloat(document.getElementById('fgSubThresholdSlider')?.value || '0.05');
        try { runFGSubtraction(pingPongRenderTargetB?.texture || null, true, thrR); } catch (e) {}
        const hidden = [];
        scene.traverse((m) => {
            if (!m.isMesh || !m.visible) return;
            if (m.userData && m.userData.isSplatLayer) { hidden.push(m); m.visible = false; return; }
            const u = m.material && m.material.uniforms;
            if (u && u.u_isBackgroundLayer && u.u_isBackgroundLayer.value && !m.userData.v2Plane) { hidden.push(m); m.visible = false; }
        });
        for (const un of ['u_useDepthGrad','u_useSobel','u_useLuma','u_useChroma','u_useCrease','u_useCurvature','u_useUVStretch','u_useGrazingAngle','u_useEdgeMask'])
            setAllLayerUniforms(un, false);
        const prevRT = renderer.getRenderTarget();
        renderer.setClearColor(new THREE.Color(0, 0, 0), 0.0);
        renderer.setRenderTarget(pingPongRenderTargetB); renderer.clear();
        renderer.render(scene, camera);
        const W = pingPongRenderTargetB.width, Hh = pingPongRenderTargetB.height;
        const isFloat = pingPongRenderTargetB.texture.type === THREE.FloatType || pingPongRenderTargetB.texture.type === THREE.HalfFloatType;
        const buf = isFloat ? new Float32Array(W * Hh * 4) : new Uint8Array(W * Hh * 4);
        renderer.readRenderTargetPixels(pingPongRenderTargetB, 0, 0, W, Hh, buf);
        renderer.setRenderTarget(prevRT);
        for (const m of hidden) m.visible = true;
        const thr = isFloat ? 0.03 : 8;
        let n = 0, border = 0;
        const mask = new Uint8Array(W * Hh);
        for (let i = 0; i < W * Hh; i++) mask[i] = buf[i * 4 + 3] < thr ? 1 : 0;
        for (let y = 1; y < Hh - 1; y++) for (let x = 1; x < W - 1; x++) {
            const i = y * W + x; if (!mask[i]) continue; n++;
            if (!mask[i - 1] || !mask[i + 1] || !mask[i - W] || !mask[i + W]) border++;
        }
        return { n, border };
    }, POSE);
    const t1ok = r.n === 99907 && r.border === 3769;
    console.log('T1 isolation: baked gap px=' + r.n + ' boundary=' + r.border +
        ' (reference 99907/3769) — ' + (t1ok ? 'PASS' : 'FAIL'));

    // T2: splat visible in the composite (pixel delta on/off, on screen)
    const t2 = await page.evaluate(async () => {
        const grab = async () => {
            updateCameraAndProjection(); render();
            await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
            const cv = document.createElement('canvas');
            const el = renderer.domElement; cv.width = el.width; cv.height = el.height;
            const cx = cv.getContext('2d'); cx.drawImage(el, 0, 0);
            return cx.getImageData(0, 0, cv.width, cv.height).data;
        };
        const A = await grab();
        for (const sl of splatLayers) sl.mesh.visible = false;
        const B = await grab();
        for (const sl of splatLayers) sl.mesh.visible = true;
        let diff = 0;
        for (let i = 0; i < A.length; i += 16) if (Math.abs(A[i] - B[i]) > 20) diff++;
        return { diff, total: (A.length / 16) | 0 };
    });
    const t2ok = t2.diff > t2.total * 0.01;
    console.log('T2 composite: ' + t2.diff + ' of ' + t2.total + ' samples differ splat on/off — ' + (t2ok ? 'PASS' : 'FAIL'));

    // T4: 4D sequence layer (A224) — multi-buffer import, manual frame
    // stepping changes the composite, playback clock live
    for (const f of ['frame_00', 'frame_06']) {
        fs.copyFileSync(path.join(__dirname, 'assets', f + '.splat'), path.join(H, 'test_' + f + '.splat'));
    }
    const t4 = await page.evaluate(async () => {
        const parts = [];
        for (const f of ['test_frame_00.splat', 'test_frame_06.splat'])
            parts.push({ buffer: await (await fetch(f)).arrayBuffer(), name: f });
        const entry = await window._addSplatLayerFromBuffer(parts, 'seq-test');
        const grab = async () => {
            updateCameraAndProjection(); render();
            await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
            const cv = document.createElement('canvas');
            const el = renderer.domElement; cv.width = el.width; cv.height = el.height;
            const cx = cv.getContext('2d'); cx.drawImage(el, 0, 0);
            return cx.getImageData(0, 0, cv.width, cv.height).data;
        };
        entry.setFrame(0); const A = await grab();
        entry.setFrame(1); const B = await grab();
        let diff = 0;
        for (let i = 0; i < A.length; i += 16) if (Math.abs(A[i] - B[i]) > 20) diff++;
        // cleanup so the final shot shows the single-splat scene
        scene.remove(entry.mesh); splatLayers.pop();
        return { nFrames: entry.cloud.frames.length, playingDefault: entry.playing === false ? 'stopped-by-setFrame' : 'playing', diff, total: (A.length / 16) | 0 };
    });
    const t4ok = t4.nFrames === 2 && t4.diff > t4.total * 0.001;
    console.log('T4 sequence: frames=' + t4.nFrames + ' frame0 vs frame1 diff=' + t4.diff + '/' + t4.total +
        ' — ' + (t4ok ? 'PASS' : 'FAIL'));

    // in-page grab, not page.screenshot — the SwiftShader deferred-render
    // bill stalls the CDP screenshot after heavy offscreen work (a158)
    const png = await page.evaluate(async () => {
        updateCameraAndProjection(); render();
        await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
        const cv = document.createElement('canvas');
        const el = renderer.domElement; cv.width = el.width; cv.height = el.height;
        cv.getContext('2d').drawImage(el, 0, 0);
        return cv.toDataURL('image/png');
    });
    fs.writeFileSync(path.join(SHOTS, 'moebius_with_splat.png'), Buffer.from(png.split(',')[1], 'base64'));
    console.log('shot -> ' + SHOTS + '/moebius_with_splat.png');
    await browser.close(); srv.kill();
    process.exit((t1ok && t2ok && t3ok && t4ok) ? 0 : 1);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
