// Which layer draws each pixel (2026-09-26, the user on the true-window views: "layers (hard vert / hor boundaries) visible
// without anything behind them, or overlayed with black"). Bakes like tw_view.js, then at each pose renders the full scene
// and the scene with one object hidden at a time; a pixel that changes when an object is hidden is drawn by that object.
// Labels: 1 foreground layer, 2 background plate, 3 margin strips (A245 ring), 4 sky layer, 5 plate 2, 6 step faces, 0 nothing.
//   COLOR= DEPTH= TW= TAG= LABEL= [ROOT=] [PORT=8233] node harness/tw_layers.js
//   -> harness/shots/tw/<TAG>/<LABEL>_layers_<pose>.png (false colour) + <LABEL>_layers.json (per-pose counts, in/out of the picture)
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const H = __dirname, WT = path.resolve(H, '..'), PORT = +(process.env.PORT || 8233), SR = process.env.ROOT || H, LABEL = process.env.LABEL || 'x';
const OUT = path.join(H, 'shots', 'tw', process.env.TAG || 'x'); fs.mkdirSync(OUT, { recursive: true });
const TW = JSON.parse(fs.readFileSync(process.env.TW, 'utf8'));
const T42 = Math.tan(42 * Math.PI / 180), T30 = Math.tan(30 * Math.PI / 180);
(async () => {
    fs.copyFileSync(path.resolve(WT, process.env.COLOR), path.join(SR, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, process.env.DEPTH), path.join(SR, 'defaultImgDepth.png'));
    const srv = spawn('node', ['scratch_server.js'], { cwd: SR, stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(PORT) }) }); await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    await page.goto('http://localhost:' + PORT + '/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { if (await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth && mediaLayers[0]._depth16); } catch (e) { return false; } }).catch(() => false)) break; await new Promise(r => setTimeout(r, 1000)); }
    await page.evaluate((tw) => { try { localStorage.clear(); } catch (e) {} for (const [id, v] of Object.entries({ bgPlateHoleSel: 'source', bgPlateRampSel: 'off', bgPlateSkySel: tw.skyAtInfinity === false ? 'off' : 'on' })) { const el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('change')); } } }, TW);
    const Deye = TW.D_ref;
    await page.evaluate(([tw, D]) => { outerVolumeDepth = tw.outer; innerVolumeDepth = tw.inner; currentNormPortalPlane = tw.pn; window._skyInf = (tw.skyAtInfinity === false) ? 0 : 1; camera.position.set(0, 0, D); updateCameraAndProjection(); }, [TW, Deye]);
    await page.evaluate(() => document.getElementById('bgLayerBuildBtn').click());
    for (let t = 0; t < 2400; t++) { if (await page.evaluate(() => !!window._bgQuickBaked && !!window._qbPlateF && !!window._qbSourceHole)) break; await new Promise(r => setTimeout(r, 500)); }
    const inv = await page.evaluate(() => { const u = bgLayerMesh.userData || {}; window._lyr = [['fg', [mediaLayers[0].mesh]], ['plate', [bgLayerMesh]], ['ring', u.ring || []], ['sky', u.sky ? [u.sky] : []], ['plate2', u.plate2 ? [u.plate2] : []], ['steps', u.steps ? [u.steps] : []]];
        const other = scene.children.filter(o => o.visible && o.isMesh && !window._lyr.some(([, a]) => a.includes(o))).map(o => (o.name || o.type) + ':' + (o.material && o.material.type));
        return { layers: window._lyr.map(([n, a]) => [n, a.length]), otherVisibleMeshes: other, margin: window._qbMargin || null, restClip: bgLayerMesh.material.uniforms.u_restClip && bgLayerMesh.material.uniforms.u_restClip.value.toArray() }; });
    const POSES = [['rest', 0, 0.008], ['L42', -Deye * T42, 0.008], ['R42', Deye * T42, 0.008], ['up30', 0, Deye * T30]];
    const grab = (x, y, hide) => page.evaluate(([x, y, D, hide]) => { const vis = []; if (hide >= 0) for (const m of window._lyr[hide][1]) { vis.push([m, m.visible]); m.visible = false; }
        isSweeping = true; camera.position.set(x, y, D); updateCameraAndProjection(); render(); updateCameraAndProjection(); render(); isSweeping = false;
        const u = renderer.domElement.toDataURL('image/png').split(',')[1]; for (const [m, v] of vis) m.visible = v; return u; }, [x, y, Deye, hide]);
    const R = { label: LABEL, inv, poses: {} };
    const tmp = path.join(OUT, '_lyr'); fs.mkdirSync(tmp, { recursive: true });
    for (const [n, x, y] of POSES) { fs.writeFileSync(path.join(tmp, n + '_full.png'), Buffer.from(await grab(x, y, -1), 'base64'));
        for (let k = 0; k < 6; k++) fs.writeFileSync(path.join(tmp, n + '_no' + k + '.png'), Buffer.from(await grab(x, y, k), 'base64')); }
    fs.writeFileSync(path.join(OUT, LABEL + '_layers.json'), JSON.stringify(R, null, 1)); console.log(JSON.stringify(inv));
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
