// S71 §4 check: renderQuilt draws cols x rows views, left to right from the bottom-left tile; neighbouring views differ a
// little, the ends differ most (parallax grows with the angle); the camera is restored afterwards.
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const H = __dirname, PORT = 8136;
(async () => {
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(PORT) }) }); await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    await page.goto('http://localhost:' + PORT + '/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { if (await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false)) break; await new Promise(r => setTimeout(r, 1000)); }
    await new Promise(r => setTimeout(r, 3000));
    const R = await page.evaluate(() => {
        const before = camera.position.toArray();
        const cols = 5, rows = 2, tw = 200, th = 150, cv = window.renderQuilt({ cols, rows, coneDeg: 40, tileW: tw, tileH: th });
        const cx = cv.getContext('2d'), tiles = [];
        for (let k = 0; k < cols * rows; k++) { const col = k % cols, row = rows - 1 - Math.floor(k / cols); tiles.push(cx.getImageData(col * tw, row * th, tw, th).data); }
        const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 4) s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); return s / (a.length / 4) / 3; };
        const vsFirst = tiles.map(t => +diff(t, tiles[0]).toFixed(2)), neighbour = tiles.slice(1).map((t, i) => +diff(t, tiles[i]).toFixed(2));
        return { size: [cv.width, cv.height], vsFirst, neighbour, restored: JSON.stringify(camera.position.toArray()) === JSON.stringify(before), png: cv.toDataURL('image/png').split(',')[1] };
    });
    fs.mkdirSync(path.join(H, 'shots', 'quilt'), { recursive: true }); fs.writeFileSync(path.join(H, 'shots', 'quilt', 'quilt_qs5x2.png'), Buffer.from(R.png, 'base64')); delete R.png;
    console.log(JSON.stringify(R));
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
