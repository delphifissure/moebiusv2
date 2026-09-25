// S67 §6 check: window._headByAngle. For shots at 24 / 45 / 85 / 200 mm (full-frame equivalents, setShotLens) and a
// fixed face offset, the virtual eye's viewing angle atan(x / D) must be the same in every shot with the flag on (the
// head gain is D_shot / D_rest) and differs with it off (constant metres); flag on without a shot is identical to off.
//   node harness/headbyangle_check.js
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'; const H = __dirname;
(async () => {
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore', env: Object.assign({}, process.env, { PORT: '8124' }) });
    await new Promise(r => setTimeout(r, 1200));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    await page.goto('http://localhost:8124/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r2 => setTimeout(r2, 1000)); }
    const res = await page.evaluate(() => {
        const pz = portalPlaneWorldZ, out = [];
        const eye = () => { updateCameraAndProjection(); return { x: camera.position.x, z: camera.position.z - pz }; };
        const at = (dev) => { latestDetectedFaceX = 0.5 + dev; latestDetectedFaceY = 0.5; return eye(); };
        for (const flag of [false, true]) for (const f of [null, 24, 45, 85, 200]) {
            window._headByAngle = flag; window.setShotLens(f ? 2 * Math.atan(18 / f) * 180 / Math.PI : null);
            // setShotLens places the eye at the shot's distance in both arms (the dolly's D(f)); only the head gain differs
            const e0 = at(0), rows = [];
            for (const dev of [0.05, 0.1, 0.2]) { const e = at(dev); rows.push({ dev, dx: e.x - e0.x, D: e.z, deg: Math.atan2(Math.abs(e.x - e0.x), e.z) * 180 / Math.PI }); }
            out.push({ flag, f, D: e0.z, rows });
        }
        window._headByAngle = false; window.setShotLens(null);
        return out;
    });
    for (const r of res) console.log((r.flag ? 'on ' : 'off') + ' ' + String(r.f || 'rest').padEnd(5) + ' D ' + r.D.toFixed(3) + ' m   ' + r.rows.map(q => 'dev ' + q.dev + ': eye ' + (100 * q.dx).toFixed(2) + ' cm, ' + q.deg.toFixed(2) + ' deg').join(' | '));
    require('fs').writeFileSync(path.join(H, 'out_headbyangle_check.json'), JSON.stringify(res, null, 1));
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
