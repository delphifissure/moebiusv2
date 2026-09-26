// The depth law on a real photograph: the same picture baked and viewed under the stylised portal law (the default:
// smoothstep in normalised disparity, 2 cm behind the glass to 4 cm in front, the portal at d = 0.5) and under the S69
// metric law (distance proportional to 1 / disparity, the shift fixed by the sky at infinity, the nearest content on the
// glass). Same poses as sd_src_roundtrip.js. Before painting (the bake's own wash), so only the law differs.
//   COLOR= DEPTH= TAG= [PORT=8231] [ROOT=<private served tree>] node harness/law_compare.js   -> harness/shots/law/<TAG>/{portal,metric}_<pose>.png, law.json
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const H = __dirname, WT = path.resolve(H, '..'), PORT = +(process.env.PORT || 8231);
const SR = process.env.ROOT || H;   // the served tree: ROOT= a private copy so a run beside the art chain cannot swap its picture
const OUT = path.join(H, 'shots', 'law', process.env.TAG || 'x'); fs.mkdirSync(OUT, { recursive: true });
const POSES = [['rest', 0, 0.008], ['L42', -0.18, 0.008], ['R42', 0.18, 0.008], ['up30', 0, 0.115]];
(async () => {
    fs.copyFileSync(path.resolve(WT, process.env.COLOR), path.join(SR, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, process.env.DEPTH), path.join(SR, 'defaultImgDepth.png'));
    if (SR === H) process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: SR, stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(PORT) }) }); await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    await page.goto('http://localhost:' + PORT + '/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { if (await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth && mediaLayers[0]._depth16); } catch (e) { return false; } }).catch(() => false)) break; await new Promise(r => setTimeout(r, 1000)); }
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} for (const [id, v] of Object.entries({ bgPlateHoleSel: 'source', bgPlateRampSel: 'off' })) { const el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('change')); } } });
    const bake = async () => { await page.evaluate(() => { window._bgQuickBaked = false; window._qbSourceHole = null; document.getElementById('bgLayerBuildBtn').click(); });
        for (let t = 0; t < 2400; t++) { if (await page.evaluate(() => !!window._bgQuickBaked && !!window._qbPlateF && !!window._qbSourceHole)) break; await new Promise(r => setTimeout(r, 500)); } };
    const grab = async (x, y) => page.evaluate(([x, y]) => { isSweeping = true; camera.position.set(x, y, 0.2); updateCameraAndProjection(); render(); updateCameraAndProjection(); render(); isSweeping = false; return renderer.domElement.toDataURL('image/png').split(',')[1]; }, [x, y]);
    const R = {};
    await bake(); for (const [n, x, y] of POSES) fs.writeFileSync(path.join(OUT, 'portal_' + n + '.png'), Buffer.from(await grab(x, y), 'base64'));
    R.portal = await page.evaluate(() => ({ hole: window._qbSourceHole && window._qbSourceHole.hole }));
    // the metric law: 1/Z = a d + b; the sky (the 0.2th percentile of d) is infinity, so b = -a d_sky; the nearest content (99.5th percentile) is on the glass
    R.metric = await page.evaluate(() => {
        const dQ = window._qbDQ, s = Float32Array.from(dQ).sort(), q = (f) => s[Math.min(s.length - 1, Math.floor(f * s.length))];
        const dSky = q(0.002), dNear = q(0.995);
        window._cutMap = 'Cm'; window._sceneScale = { status: 'ok', key: bgSceneKey(), alpha: 1, beta: -dSky, pn: dNear, D: dollyRestDistance };
        return { dSky, dNear, D: dollyRestDistance, on: bgMetricLawOn() };
    });
    await bake(); R.metric.on2 = await page.evaluate(() => bgMetricLawOn()); R.metric.hole = await page.evaluate(() => window._qbSourceHole && window._qbSourceHole.hole);
    for (const [n, x, y] of POSES) fs.writeFileSync(path.join(OUT, 'metric_' + n + '.png'), Buffer.from(await grab(x, y), 'base64'));
    fs.writeFileSync(path.join(OUT, 'law.json'), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R));
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
