// A236 VALIDATE THE CPU SWEEP against the renderer sweep, same plate, same
// poses. Bake (flush-exempt, sweep capture on), run the renderer's texel-ID
// sweep at the a231 pose set, run the CPU warp sweep at the same poses and
// the renderer's own sampling ratio, both ray signs; report sizes, overlap,
// recall of the renderer's seen set, and the CPU cost. Then time the CPU
// sweep at a dense 81x5 grid at full resolution.
//   node harness/a236_cpusweep.js        IMG=..,.. TAG=.. for other scenes
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = __dirname, WT = path.resolve(__dirname, '..');
const TAG = process.env.TAG || 'troll';
const Z = 0.199;
const POSES = [];
for (let iy = -2; iy <= 2; iy++) for (let ix = -4; ix <= 4; ix++) POSES.push([ix * 0.045, iy * 0.025]);
for (const p of [[0.100, -0.023], [0.141, 0.023], [0.180, 0.008], [-0.141, 0.023]]) POSES.push(p);

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
        camera.position.set(0, 0, o.z); updateCameraAndProjection();
        const g = window._plugVisibilitySweep({ poses: o.poses });
        if (!g) return { err: 'gpu sweep unavailable' };
        const out = { pw: g.pw, ph: g.ph, N: g.N, gpuSeen: g.nSeen, minif: g.minif, bad: g.bad, arms: [] };
        for (const sign of [-1, 1]) {
            const c = window._plugCpuSweep({ poses: o.poses, scale: g.minif, sign });
            let inter = 0; for (let i = 0; i < g.N; i++) if (g.seen[i] && c.seen[i]) inter++;
            out.arms.push({ sign, cpuSeen: c.nSeen, inter, ms: c.ms, holeCells: c.holeCells });
        }
        const best = out.arms[0].inter >= out.arms[1].inter ? out.arms[0] : out.arms[1];
        const t0 = Date.now(); const dense = window._plugCpuSweep({ nx: 81, ny: 5, scale: 1, sign: best.sign });
        out.dense = { poses: dense.poses, seen: dense.nSeen, ms: Date.now() - t0 };
        const d4 = window._plugCpuSweep({ nx: 81, ny: 5, scale: g.minif, sign: best.sign });
        out.dense4 = { poses: d4.poses, seen: d4.nSeen, ms: d4.ms };
        return out;
    }, { poses: POSES, z: Z });
    if (res.err) { console.log('ERR ' + res.err); process.exit(1); }
    const pc = (a, b) => (100 * a / Math.max(1, b)).toFixed(1) + '%';
    console.log(TAG + ': plate ' + res.pw + 'x' + res.ph + ', renderer sweep ' + POSES.length + ' poses at 1:' + res.minif + ': seen ' + res.gpuSeen + ' (' + pc(res.gpuSeen, res.N) + '), bad ids ' + res.bad);
    for (const a of res.arms) console.log('  CPU sweep sign ' + a.sign + ': seen ' + a.cpuSeen + ' (' + pc(a.cpuSeen, res.N) + '), overlap ' + a.inter +
        ' = recall of renderer set ' + pc(a.inter, res.gpuSeen) + ', precision ' + pc(a.inter, a.cpuSeen) + ', ' + a.ms + ' ms, hole cells ' + a.holeCells);
    console.log('  CPU dense 81x5 at 1:1: seen ' + res.dense.seen + ' (' + pc(res.dense.seen, res.N) + ') in ' + res.dense.ms + ' ms;  at 1:' + res.minif + ': seen ' + res.dense4.seen + ' (' + pc(res.dense4.seen, res.N) + ') in ' + res.dense4.ms + ' ms');
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
