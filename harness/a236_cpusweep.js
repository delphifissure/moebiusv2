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
        // AREA comparison: a sampled sweep marks ONE texel per screen cell, and the two
        // instruments pick different texels inside the same covered cell. Dilate each set
        // by the sampling stride (box radius = minif texels) and ask what fraction of the
        // other set's texels fall inside: that is agreement on covered AREA.
        const dil = (m, r) => { const pw = g.pw, ph = g.ph, out = new Uint8Array(g.N);
            const row = new Uint8Array(g.N);
            for (let y = 0; y < ph; y++) { let cnt = 0; const base = y * pw;
                for (let x = -r; x < pw; x++) { if (x + r < pw && m[base + x + r]) cnt++; if (x - r - 1 >= 0 && m[base + x - r - 1]) cnt--; if (x >= 0 && cnt > 0) row[base + x] = 1; } }
            for (let x = 0; x < pw; x++) { let cnt = 0;
                for (let y = -r; y < ph; y++) { if (y + r < ph && row[(y + r) * pw + x]) cnt++; if (y - r - 1 >= 0 && row[(y - r - 1) * pw + x]) cnt--; if (y >= 0 && cnt > 0) out[y * pw + x] = 1; } }
            return out; };
        const gD = dil(g.seen, g.minif); let gArea = 0; for (let i = 0; i < g.N; i++) gArea += gD[i];
        out.gpuArea = gArea;
        for (const tornMode of ['none', 'a212', 'a160', 'both']) {
            const sign = -1;
            const c = window._plugCpuSweep({ poses: o.poses, scale: g.minif, sign, tornMode });
            let inter = 0; for (let i = 0; i < g.N; i++) if (g.seen[i] && c.seen[i]) inter++;
            const cD = dil(c.seen, g.minif); let cArea = 0, gInC = 0, cInG = 0, areaInter = 0;
            for (let i = 0; i < g.N; i++) { if (cD[i]) cArea++; if (g.seen[i] && cD[i]) gInC++; if (c.seen[i] && gD[i]) cInG++; if (cD[i] && gD[i]) areaInter++; }
            out.arms.push({ sign, tornMode, cpuSeen: c.nSeen, inter, ms: c.ms, holeCells: c.holeCells, cArea, gInC, cInG, areaInter });
        }
        const best = out.arms.slice().sort((a, b) => (b.areaInter / (b.cArea + gArea - b.areaInter)) - (a.areaInter / (a.cArea + gArea - a.areaInter)))[0];
        const t0 = Date.now(); const dense = window._plugCpuSweep({ nx: 81, ny: 5, scale: 1, sign: best.sign, tornMode: best.tornMode });
        out.dense = { poses: dense.poses, seen: dense.nSeen, ms: Date.now() - t0 };
        const d4 = window._plugCpuSweep({ nx: 81, ny: 5, scale: g.minif, sign: best.sign, tornMode: best.tornMode }); out.bestMode = best.tornMode;
        out.dense4 = { poses: d4.poses, seen: d4.nSeen, ms: d4.ms };
        return out;
    }, { poses: POSES, z: Z });
    if (res.err) { console.log('ERR ' + res.err); process.exit(1); }
    const pc = (a, b) => (100 * a / Math.max(1, b)).toFixed(1) + '%';
    console.log(TAG + ': plate ' + res.pw + 'x' + res.ph + ', renderer sweep ' + POSES.length + ' poses at 1:' + res.minif + ': seen ' + res.gpuSeen + ' (' + pc(res.gpuSeen, res.N) + '), bad ids ' + res.bad);
    console.log('  renderer set dilated by the stride: area ' + res.gpuArea + ' texels (' + pc(res.gpuArea, res.N) + ')');
    for (const a of res.arms) console.log('  CPU sweep torn=' + a.tornMode + ': seen ' + a.cpuSeen + ' (' + pc(a.cpuSeen, res.N) + '), texel overlap ' + a.inter +
        ' (recall ' + pc(a.inter, res.gpuSeen) + ', precision ' + pc(a.inter, a.cpuSeen) + '); AREA: cpu ' + a.cArea + ' (' + pc(a.cArea, res.N) + '), renderer texels inside cpu area ' + pc(a.gInC, res.gpuSeen) +
        ', cpu texels inside renderer area ' + pc(a.cInG, a.cpuSeen) + ', area IoU ' + pc(a.areaInter, a.cArea + res.gpuArea - a.areaInter) + '; ' + a.ms + ' ms');
    console.log('  CPU dense 81x5 (torn=' + res.bestMode + ') at 1:1: seen ' + res.dense.seen + ' (' + pc(res.dense.seen, res.N) + ') in ' + res.dense.ms + ' ms;  at 1:' + res.minif + ': seen ' + res.dense4.seen + ' (' + pc(res.dense4.seen, res.N) + ') in ' + res.dense4.ms + ' ms');
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
