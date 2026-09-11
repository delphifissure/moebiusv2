// S2c sky-parallax shot: bake the given scene with the given flags, then render the whole scene from a few
// off-axis eyes and write the window images, so the sky's displacement can be measured against the closed
// form (-e for the plane at infinity; e*outer/(D+outer) for the volume's far end).
//   IMG=color,depth DEPTH_OUTER=.. DEPTH_INNER=.. DEPTH_PN=.. TAG=S15sky FLAGS=_tearLaw=rim,_skyInf=1 POSES=0:0,0.1:0,0:0.1 node harness/s2c_skyshot.js
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = __dirname, WT = path.resolve(__dirname, '..');
const OUT = process.env.OUT || path.join(__dirname, 'shots', 's2c_skyshot', process.env.TAG || 'shot');
(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    if (process.env.IMG) { const [c, d] = process.env.IMG.split(','); fs.copyFileSync(path.resolve(WT, c), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, d), path.join(H, 'defaultImgDepth.png')); }
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    page.on('console', m => { const t = m.text(); if (/\[S2[bc]\]|\[S3\]|\[S4\]|\[S5\]|\[S6\]|\[S7\]|\[S9\]|A245 plug margin|QUICK-BAKE\] A21[26]|FAILED|rror/.test(t)) console.log('  [page:log] ' + t.slice(0, 300)); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r2 => setTimeout(r2, 1000)); }
    const POSES = (process.env.POSES || '0:0,0.1:0,0:0.1').split(',').map(s => s.split(':').map(Number));
    const res = await page.evaluate(async (o) => {
        window._rayReproject = true; window._plugSweepCapture = true; window._plugCarve = false;
        if (o.flush) window._plateFlushExempt = true;
        if (o.depth) { outerVolumeDepth = o.depth.outer; innerVolumeDepth = o.depth.inner; currentNormPortalPlane = o.depth.pn; }
        if (o.flags) for (const f of o.flags) { const [k, v] = f.split('='); window[k] = (v === undefined) ? true : (isNaN(+v) ? v : +v); }
        if (o.envDeg) { bgViewFadeEndDeg = o.envDeg; }   // S6: the horizontal envelope half-angle for the +-30 degree measurement (a top-level let, not a window flag)
        if (o.geo) window._plugGeoBand({ flush: !!o.flush, observed: true, gateAPriori: true }); else { bgQuickBake = true; buildBackgroundLayer(); }
        // the canonical shot (a150/a169/a105 harnesses): isSweeping hands camera.position to us, the main canvas is the window
        isSweeping = true;
        // HIDE=plate,fg,sky,ring: leave layers out of the shot (which mesh draws what)
        if (o.hide) { const L0 = mediaLayers[0];
            if (o.hide.includes('fg') && L0 && L0.mesh) L0.mesh.visible = false;
            if (o.hide.includes('plate') && typeof bgLayerMesh !== 'undefined' && bgLayerMesh) bgLayerMesh.visible = false;
            if (o.hide.includes('sky') && bgLayerMesh && bgLayerMesh.userData && bgLayerMesh.userData.sky) bgLayerMesh.userData.sky.visible = false;
            if (o.hide.includes('steps') && bgLayerMesh && bgLayerMesh.userData && bgLayerMesh.userData.steps) bgLayerMesh.userData.steps.visible = false;
            if (o.hide.includes('plate2') && bgLayerMesh && bgLayerMesh.userData && bgLayerMesh.userData.plate2) bgLayerMesh.userData.plate2.visible = false;
            if (o.hide.includes('ring') && bgLayerMesh && bgLayerMesh.userData && bgLayerMesh.userData.ring) for (const m of bgLayerMesh.userData.ring) m.visible = false; }
        const D = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2, exR = D * Math.tan(bgViewFadeEndDeg * Math.PI / 180), asp = bgEnvAspect();
        const out = { meta: { D, exR, asp, terrariumWidth, terrariumHeight, outer: outerVolumeDepth, inner: innerVolumeDepth, pn: currentNormPortalPlane, W: renderer.domElement.width, H: renderer.domElement.height, sky: window._skyInf ? bgSkyZ() : null }, shots: {} };
        for (const [fx, fy] of o.poses) {
            camera.position.set(fx * exR, fy * exR * asp, D); render(); render();
            out.shots[fx + ':' + fy] = renderer.domElement.toDataURL('image/png');
        }
        camera.position.set(0, 0, D); render();
        return out;
    }, { poses: POSES, flush: !!process.env.FLUSH, geo: !!process.env.GEO, envDeg: process.env.ENV_DEG ? +process.env.ENV_DEG : 0, hide: process.env.HIDE ? process.env.HIDE.split(',') : null, flags: process.env.FLAGS ? process.env.FLAGS.split(',') : null,
         depth: process.env.DEPTH_OUTER ? { outer: +process.env.DEPTH_OUTER, inner: +(process.env.DEPTH_INNER || 0.0001), pn: +(process.env.DEPTH_PN || 0.5) } : null });
    fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(res.meta));
    for (const [k, v] of Object.entries(res.shots)) { const f = path.join(OUT, 'pose_' + k.replace(':', '_').replace(/-/g, 'm') + '.png'); fs.writeFileSync(f, Buffer.from(v.split(',')[1], 'base64')); console.log('wrote ' + f); }
    console.log('meta ' + JSON.stringify(res.meta));
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
