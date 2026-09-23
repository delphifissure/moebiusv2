// S60/S61 branch check, run from EITHER tree's harness (each serves its own ../moebius.js). Bakes the troll with the
// start-up defaults (RAMPS=off) or with the ramp select set (RAMPS=safe|strong) and shoots the A/B poses; the default
// frames of main and the branch must be BYTE-IDENTICAL (the rule-5 removals and the default-off select change nothing).
//   RAMPS=off TAG=main node harness/branch_check.js
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const H = __dirname; const OUT = path.join('/home/user/moebiusv2/harness/shots/sheet_ab', 'branch_' + (process.env.TAG || 'x')); fs.mkdirSync(OUT, { recursive: true });
const Z = 0.2, T = (deg) => Z * Math.tan(deg * Math.PI / 180);
const POSES = [['rest', 0, 0], ['yawR42', 0.180, 0.008], ['yawL42', -0.180, 0.008], ['pitch30', 0, T(30)]];
(async () => {
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } }); const logs = [];
    page.on('console', m => { const t = m.text(); if (/\[S61\]|\[S6\] plate bake/.test(t)) logs.push(t.slice(0, 400)); });
    page.on('pageerror', e => logs.push('PAGEERR ' + e.message.slice(0, 200)));
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
    const R = process.env.RAMPS || 'off';
    await page.evaluate((R) => { try { localStorage.clear(); } catch (e) {} const el = document.getElementById('bgPlateRampSel'); if (el) { el.value = R; el.dispatchEvent(new Event('change')); } return !!el; }, R);
    await page.evaluate(() => document.getElementById('bgLayerBuildBtn').click());
    for (let t = 0; t < 640; t++) { if (await page.evaluate(() => !!window._bgQuickBaked && !!window._qbPlateF)) break; await new Promise(r => setTimeout(r, 500)); }
    const info = await page.evaluate(() => ({ ramp: window._qbRampColour || null, dq: (() => { const d = window._qbDQ; let s = 0; for (let i = 0; i < d.length; i += 97) s += d[i]; return s; })() }));
    const shot = async (name) => { const b64 = await page.evaluate(() => { updateCameraAndProjection(); render(); updateCameraAndProjection(); render(); return renderer.domElement.toDataURL('image/png').split(',')[1]; }); fs.writeFileSync(path.join(OUT, name), Buffer.from(b64, 'base64')); };
    for (const [n, x, y] of POSES) { await page.evaluate(([x, y]) => { isSweeping = true; camera.position.set(x, y, 0.2); }, [x, y]); await shot(n + '.png'); }
    fs.writeFileSync(path.join(OUT, 'info.json'), JSON.stringify({ ramps: R, info, logs }, null, 1)); console.log(JSON.stringify({ ramps: R, info, logs: logs.slice(0, 4) }));
    await browser.close(); srv.kill();
})();
