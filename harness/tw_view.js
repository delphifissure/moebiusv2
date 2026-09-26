// True-window views (2026-09-26): bake one picture and render the wide poses, either under the app's defaults (the
// stylised portal law on the given depth) or under true-window parameters from harness/truewindow.py (TW=<*_tw.json>:
// the law's outer / inner / pn set so the depth file decodes to real distances, the eye at D_ref, the photograph's centre
// of projection). Poses are the same ANGLES in both arms (42 deg at the eye's own distance), before painting.
//   COLOR= DEPTH= TAG= LABEL= [TW=] [APERTURE=1 (S73: the picture is the window, window._pictureAperture)] [ROOT=<private served tree>] [PORT=8232] node harness/tw_view.js
//   -> harness/shots/tw/<TAG>/<LABEL>_<pose>.png, <LABEL>.json
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const H = __dirname, WT = path.resolve(H, '..'), PORT = +(process.env.PORT || 8232), SR = process.env.ROOT || H, LABEL = process.env.LABEL || 'x';
const OUT = path.join(H, 'shots', 'tw', process.env.TAG || 'x'); fs.mkdirSync(OUT, { recursive: true });
const TW = process.env.TW ? JSON.parse(fs.readFileSync(process.env.TW, 'utf8')) : null;
const T42 = Math.tan(42 * Math.PI / 180), T30 = Math.tan(30 * Math.PI / 180);
(async () => {
    fs.copyFileSync(path.resolve(WT, process.env.COLOR), path.join(SR, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, process.env.DEPTH), path.join(SR, 'defaultImgDepth.png'));
    if (SR === H) process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: SR, stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(PORT) }) }); await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } }); const logs = [];
    page.on('pageerror', e => logs.push('PAGEERR ' + e.message.slice(0, 300)));
    await page.goto('http://localhost:' + PORT + '/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { if (await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth && mediaLayers[0]._depth16); } catch (e) { return false; } }).catch(() => false)) break; await new Promise(r => setTimeout(r, 1000)); }
    await page.evaluate((tw) => { try { localStorage.clear(); } catch (e) {} for (const [id, v] of Object.entries(Object.assign({ bgPlateHoleSel: 'source', bgPlateRampSel: 'off' }, tw ? { bgPlateSkySel: tw.skyAtInfinity === false ? 'off' : 'on' } : {}))) { const el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('change')); } } }, TW);   // the true window puts MoGe's sky (d = 0) at infinity
    const Deye = TW ? TW.D_ref : 0.2;
    const applied = await page.evaluate(([tw, D, ap]) => {
        window._pictureAperture = !!ap; if (tw) { outerVolumeDepth = tw.outer; innerVolumeDepth = tw.inner; currentNormPortalPlane = tw.pn; window._skyInf = (tw.skyAtInfinity === false) ? 0 : 1; }
        camera.position.set(0, 0, D); updateCameraAndProjection();
        return { outer: outerVolumeDepth, inner: innerVolumeDepth, pn: currentNormPortalPlane, camZ: camera.position.z, refZ: bgRefEyeZNow() };
    }, [TW, Deye, process.env.APERTURE === '1']);
    const t0 = Date.now(); await page.evaluate(() => document.getElementById('bgLayerBuildBtn').click());
    for (let t = 0; t < 2400; t++) { if (await page.evaluate(() => !!window._bgQuickBaked && !!window._qbPlateF && !!window._qbSourceHole)) break; await new Promise(r => setTimeout(r, 500)); }
    const after = await page.evaluate(() => { const u = mediaLayers[0].mesh.material.uniforms; return { outer: outerVolumeDepth, pn: currentNormPortalPlane, uOuter: u.u_worldOuterVolumeDepth && u.u_worldOuterVolumeDepth.value, uPn: u.u_portalPlaneDepthNorm && u.u_portalPlaneDepthNorm.value, hole: window._qbSourceHole && window._qbSourceHole.hole, sky: bgSkyInfOn() }; });
    const POSES = [['rest', 0, 0.008], ['L42', -Deye * T42, 0.008], ['R42', Deye * T42, 0.008], ['up30', 0, Deye * T30]];
    const grab = async (x, y) => page.evaluate(([x, y, D]) => { isSweeping = true; camera.position.set(x, y, D); updateCameraAndProjection(); render(); updateCameraAndProjection(); render(); isSweeping = false; return renderer.domElement.toDataURL('image/png').split(',')[1]; }, [x, y, Deye]);
    for (const [n, x, y] of POSES) fs.writeFileSync(path.join(OUT, LABEL + '_' + n + '.png'), Buffer.from(await grab(x, y), 'base64'));
    const R = { label: LABEL, tw: TW, applied, after, bakeMs: Date.now() - t0, logs };
    fs.writeFileSync(path.join(OUT, LABEL + '.json'), JSON.stringify(R, null, 1)); console.log(JSON.stringify({ applied, after, bakeMs: R.bakeMs, errors: logs.length }));
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
