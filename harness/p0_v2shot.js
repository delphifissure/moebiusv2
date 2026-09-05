// Composite shots of the app's DEFAULT path (v2: bgMPIMode, no quick bake) at the harness poses,
// for the side-by-side with the quick-bake arms. Loads the page, lets the load-time build finish,
// renders rest / sheet1 / mirror and saves the on-screen frame.  node harness/p0_v2shot.js
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = __dirname, WT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'shots', 'v2', (process.env.TAG || 'troll') + (process.env.SUFFIX || ''));
const POSES = [['rest', 0, 0], ['sheet1', 0.180, 0.008], ['mirror', -0.141, 0.023], ['a221', 0.100, -0.023]];
(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    if (process.env.HDIR) { /* another tree's harness dir serves its own default image */ } else if (process.env.IMG) { const [c, d] = process.env.IMG.split(','); fs.copyFileSync(path.resolve(WT, c), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, d), path.join(H, 'defaultImgDepth.png')); }
    else { fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); }
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: process.env.HDIR || H, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    page.on('console', m => { const t = m.text(); if (t.includes('BG-BUILD') || t.includes('MPI') || t.includes('QUICK') || t.includes('wash') || t.includes('V2') || m.type() === 'error' || m.type() === 'warning') console.log('  [page:' + m.type() + '] ' + t.slice(0, 300)); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 60; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth && (typeof bgLayerMesh !== 'undefined' && bgLayerMesh)); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r2 => setTimeout(r2, 1000)); }
    await new Promise(r => setTimeout(r, parseInt(process.env.SETTLE || '30000')));   // let the load-time background build settle
    const res = await page.evaluate(async (o) => {
        const out = { mode: { quick: (typeof bgQuickBake !== 'undefined') ? bgQuickBake : null, mpi: (typeof bgMPIMode !== 'undefined') ? bgMPIMode : null, full: (typeof bgMPIFullPlanes !== 'undefined') ? bgMPIFullPlanes : null }, shots: {} };
        if (o.build) { bgQuickBake = false; bgMPIFullPlanes = true; bgMPIMode = true; const tB = Date.now(); try { buildBackgroundLayer(); } catch (e) { console.error('[BG-BUILD] ' + e.message); } console.log('[V2-BUILD] ' + (Date.now() - tB) + 'ms'); }
        isSweeping = true;   // the app's render loop owns camera.position unless a sweep is running
        const info = { bgMesh: !!(typeof bgLayerMesh !== 'undefined' && bgLayerMesh), bgVisible: (typeof bgLayerMesh !== 'undefined' && bgLayerMesh) ? bgLayerMesh.visible : null, meshes: [] };
        scene.traverse((m) => { if (m.isMesh) info.meshes.push({ name: m.name || (m.userData && m.userData.v2Plane ? 'v2Plane' : ''), vis: m.visible, bg: !!(m.material && m.material.uniforms && m.material.uniforms.u_isBackgroundLayer && m.material.uniforms.u_isBackgroundLayer.value) }); });
        out.info = info;
        for (const [name, x, y] of o.poses) { camera.position.set(x, y, o.z); updateCameraAndProjection(); render(); render(); const el = renderer.domElement; const cv = document.createElement('canvas'); cv.width = el.width; cv.height = el.height; cv.getContext('2d').drawImage(el, 0, 0); out.shots[name] = cv.toDataURL('image/png'); }
        return out;
    }, { poses: POSES, z: 0.199, build: !!process.env.BUILD });
    console.log('mode ' + JSON.stringify(res.mode)); console.log('info ' + JSON.stringify(res.info).slice(0, 600));
    for (const k of Object.keys(res.shots)) fs.writeFileSync(path.join(OUT, 'v2_' + k + '.png'), Buffer.from(res.shots[k].split(',')[1], 'base64'));
    console.log('shots -> ' + OUT);
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
