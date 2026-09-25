// S64 / task 93: sweep poses uniform in ANGLE (window._poseByAngle) against today's grid uniform in eye offset.
// (1) identity: flag off, bgPoseAxis(u) === u on every grid coordinate (the sweeps' poses are unchanged, bit for bit);
//     flag on, atan(frac * tan A) / A === u (the poses are evenly spaced in angle).
// (2) on a quick bake of the default picture, the CPU sweep (_plugCpuSweep) at the default 17x5 grid, both spacings,
//     scored against a dense angle-uniform reference, split by the angle at which the reference first sees each texel;
//     at the webcam envelope (45/30) and at the design target (80/80; S64 -- 90 itself is unbounded in offset).
//   node harness/pose_angle_check.js
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = __dirname, WT = path.resolve(__dirname, '..');
const DENSE = (process.env.DENSE || '49,13').split(',').map(Number);
(async () => {
    fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r2 => setTimeout(r2, 1000)); }
    const res = await page.evaluate(async (o) => {
        const out = { identity: {}, env: [] };
        // (1) identity
        let offExact = 0, onMaxErr = 0, n = 0;
        for (const NX of [5, 17, 81]) for (let i = 0; i < NX; i++) { const u = 2 * i / (NX - 1) - 1; n++;
            window._poseByAngle = false; if (bgPoseAxis(u, false) === u && bgPoseAxis(u, true) === u) offExact++;
            window._poseByAngle = true;
            for (const v of [false, true]) { const A = (v ? bgViewFadeEndDegV : bgViewFadeEndDeg) * Math.PI / 180;
                onMaxErr = Math.max(onMaxErr, Math.abs(Math.atan(bgPoseAxis(u, v) * Math.tan(A)) / A - u)); } }
        window._poseByAngle = false;
        out.identity = { coords: n, offExact, onMaxErrU: onMaxErr };
        // (2) bake
        window._rayReproject = true; window._plateFlushExempt = true; window._plugSweepCapture = true; window._plugCarve = false;
        bgQuickBake = true; buildBackgroundLayer(); isSweeping = true;
        camera.position.set(0, 0, 0.199); updateCameraAndProjection();
        const D = Math.abs(camera.position.z - ((typeof portalPlaneWorldZ === 'number') ? portalPlaneWorldZ : 0));
        const H0 = bgViewFadeEndDeg, V0 = bgViewFadeEndDegV;
        for (const [eh, ev] of [[45, 30], [80, 80]]) {
            bgViewFadeEndDeg = eh; bgViewFadeEndDegV = ev; if (typeof _bgRimLaw !== 'undefined') _bgRimLaw = null;
            const sc = 2;
            const run = (opts) => { const t0 = Date.now(); const r = window._plugCpuSweep(Object.assign({ scale: sc, sign: -1 }, opts)); return { seen: r.seen.slice(), n: r.nSeen, ms: Date.now() - t0, poses: r.poses }; };
            // dense reference, uniform in angle, nested by max angle so each texel gets the ring it is first seen in
            const [NXd, NYd] = o.dense, A = eh * Math.PI / 180, B = ev * Math.PI / 180;
            const all = []; for (let iy = 0; iy < NYd; iy++) for (let ix = 0; ix < NXd; ix++) { const tx = A * (2 * ix / (NXd - 1) - 1), ty = B * (2 * iy / (NYd - 1) - 1);
                all.push({ p: [D * Math.tan(tx), D * Math.tan(ty)], ang: Math.max(Math.abs(tx), Math.abs(ty)) * 180 / Math.PI }); }
            const rings = eh > 60 ? [15, 30, 45, 60, eh] : [15, 30, eh];
            const first = new Float32Array(window._qbSize.pw * window._qbSize.ph).fill(Infinity); let denseMs = 0, denseN = 0;
            for (const a of rings) { const r = run({ poses: all.filter(q => q.ang <= a + 1e-6).map(q => q.p) }); denseMs += r.ms;
                for (let i = 0; i < r.seen.length; i++) if (r.seen[i] && first[i] === Infinity) first[i] = a; denseN = r.n; }
            const e = { env: [eh, ev], D, dense: { grid: [NXd, NYd], seen: denseN, ms: denseMs }, arms: [] };
            for (const byAngle of [false, true]) { window._poseByAngle = byAngle;
                const r = run({}); window._poseByAngle = false;
                const ringRec = rings.map((a, k) => { const lo = k ? rings[k - 1] : 0; let num = 0, den = 0;
                    for (let i = 0; i < first.length; i++) if (first[i] === a) { den++; if (r.seen[i]) num++; } return { deg: [lo, a], ref: den, recall: den ? num / den : null }; });
                let inRef = 0, outRef = 0; for (let i = 0; i < first.length; i++) if (r.seen[i]) { if (first[i] < Infinity) inRef++; else outRef++; }
                e.arms.push({ byAngle, poses: r.poses, seen: r.n, ms: r.ms, recall: inRef / Math.max(1, denseN), outsideRef: outRef, rings: ringRec });
            }
            out.env.push(e);
        }
        bgViewFadeEndDeg = H0; bgViewFadeEndDegV = V0;
        return out;
    }, { dense: DENSE });
    console.log(JSON.stringify(res, null, 1));
    fs.writeFileSync(path.join(H, 'out_pose_angle_check.json'), JSON.stringify(res, null, 1));
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
