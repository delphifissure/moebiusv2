// A257f diagnostic: bake the troll with backs and report the back mesh's geometry (index count vs the plug's), all A257 console lines.
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'; const H = __dirname, WT = path.resolve(__dirname, '..');
(async () => {
    fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 300)));
    page.on('console', m => { const t = m.text(); if (/A257|A253\]/.test(t) || m.type() === 'warning' || m.type() === 'error') console.log('  [page:' + m.type() + '] ' + t.slice(0, 400)); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r2 => setTimeout(r2, 1000)); }
    const res = await page.evaluate(async () => {
        window._rayReproject = true; window._plugSweepCapture = true; window._plugCarve = false; window._plateFlushExempt = true;
        for (const k of ['_plugMembrane', '_plugGuided', '_plugMargin', '_plugObjectRule', '_geoLipSeed', '_plugBack']) window[k] = 1; window._fragTear = 2;
        window._plugGeoBand({ flush: true, observed: true, gateAPriori: true });
        const b = bgLayerMesh && bgLayerMesh.userData && bgLayerMesh.userData.back; const gq = bgLayerMesh.geometry, gb = b && b.geometry;
        return { plugIndex: gq.index ? gq.index.count : -1, plugVerts: gq.attributes.position.count, plugParams: gq.parameters, backIndex: gb ? (gb.index ? gb.index.count : -1) : 'no back', backVerts: gb ? gb.attributes.position.count : -1, sameGeom: gb === gq, backTear: b ? b.material.uniforms.u_backTear.value : null, fragTear: b ? b.material.uniforms.u_fragTear.value : null };
    });
    console.log(JSON.stringify(res)); await browser.close(); srv.kill();
})();
