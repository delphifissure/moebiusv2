// A237 DENSE REGION MEASUREMENT WITH THE CPU SWEEP (validated A236). Per
// scene: bake the flush-exempt plate once, then CPU-sweep at 9/17/33/81 poses
// across x 5 rows at full texel resolution. Reports the seen set (reveals vs
// pinholes), its growth with grid density (does the union converge?), the
// region with the a62 pad, and the mean in-frame hole cells per pose.
//   node harness/a237_cpuregion.js            IMG=..,.. TAG=.. for other scenes
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = __dirname, WT = path.resolve(__dirname, '..');
const TAG = process.env.TAG || 'troll';
const NXS = (process.env.NXS || '9,17,33,81').split(',').map(Number);
const THETAS = (process.env.THETAS || '').split(',').filter(Boolean).map(Number);   // cone half-angles (deg) to sweep instead of the fade-end cone
(async () => {
    if (process.env.IMG) { const [c, d] = process.env.IMG.split(','); fs.copyFileSync(path.resolve(WT, c), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, d), path.join(H, 'defaultImgDepth.png')); }
    else { fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); }
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r2 => setTimeout(r2, 1000)); }
    const res = await page.evaluate(async (o) => {
        window._rayReproject = true; window._plateFlushExempt = true; window._plugSweepCapture = true; window._plugCarve = false;
        bgQuickBake = true; buildBackgroundLayer(); isSweeping = true;
        camera.position.set(0, 0, 0.199); updateCameraAndProjection();
        const sz = window._qbSize; const pw = sz.pw, ph = sz.ph, N = pw * ph; const torn = window._qbTorn;
        const rows = [];
        const D = Math.abs(camera.position.z - ((typeof portalPlaneWorldZ === 'number') ? portalPlaneWorldZ : 0));
        const asp = terrariumHeight / terrariumWidth;
        const jobs = o.thetas.length ? o.thetas.map(th => ({ nx: o.nxs[0], theta: th })) : o.nxs.map(nx => ({ nx, theta: null }));
        for (const job of jobs) {
            const nx = job.nx; let poses;
            if (job.theta !== null) { const ex = D * Math.tan(job.theta * Math.PI / 180); poses = []; for (let iy = 0; iy < 5; iy++) for (let ix = 0; ix < nx; ix++) poses.push([ex * (2 * ix / (nx - 1) - 1), ex * asp * (2 * iy / 4 - 1)]); }
            const c = window._plugCpuSweep({ nx, ny: 5, scale: 1, poses });
            let rev = 0, pin = 0; for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const i = y * pw + x; if (!c.seen[i]) continue; if (torn && torn[(ph - 1 - y) * pw + x]) pin++; else rev++; }
            // region with the a62 pad (6 texels) around reveals, none around pinholes (Addendum 175)
            const dist = new Int32Array(N).fill(0x3fffffff); for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const i = y * pw + x; if (c.seen[i] && !(torn && torn[(ph - 1 - y) * pw + x])) dist[i] = 0; }
            for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const i = y * pw + x; let v = dist[i]; if (x > 0 && dist[i - 1] + 5 < v) v = dist[i - 1] + 5; if (y > 0) { if (dist[i - pw] + 5 < v) v = dist[i - pw] + 5; if (x > 0 && dist[i - pw - 1] + 7 < v) v = dist[i - pw - 1] + 7; if (x < pw - 1 && dist[i - pw + 1] + 7 < v) v = dist[i - pw + 1] + 7; } dist[i] = v; }
            for (let y = ph - 1; y >= 0; y--) for (let x = pw - 1; x >= 0; x--) { const i = y * pw + x; let v = dist[i]; if (x < pw - 1 && dist[i + 1] + 5 < v) v = dist[i + 1] + 5; if (y < ph - 1) { if (dist[i + pw] + 5 < v) v = dist[i + pw] + 5; if (x < pw - 1 && dist[i + pw + 1] + 7 < v) v = dist[i + pw + 1] + 7; if (x > 0 && dist[i + pw - 1] + 7 < v) v = dist[i + pw - 1] + 7; } dist[i] = v; }
            let reg = 0; for (let i = 0; i < N; i++) if (dist[i] <= 30 || c.seen[i]) reg++;
            rows.push({ nx, theta: job.theta, poses: c.poses, seen: c.nSeen, rev, pin, region: reg, holePerPose: Math.round(c.holeCells / c.poses), ms: c.ms });
        }
        return { pw, ph, N, rows };
    }, { nxs: NXS, thetas: THETAS });
    const pc = (a, b) => (100 * a / Math.max(1, b)).toFixed(1) + '%';
    console.log(TAG + ': plate ' + res.pw + 'x' + res.ph + ' (flush-exempt plate, CPU sweep, 1:1, torn=a212)');
    for (const r of res.rows) console.log('  ' + (r.theta !== null ? ('cone +/-' + r.theta + 'deg, ') : '') + String(r.nx).padStart(2) + 'x5 (' + r.poses + ' poses): seen ' + pc(r.seen, res.N) + ' = reveals ' + pc(r.rev, res.N) + ' + pinholes ' + pc(r.pin, res.N) +
        '; region (+6 pad on reveals) ' + pc(r.region, res.N) + '; in-frame hole cells/pose ' + r.holePerPose + '; ' + r.ms + ' ms');
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
