// A244 CPU-sweep check: after one quick bake (flush plate), run the CPU sweep with the hole
// inversion and report hole cells (in/out of the plate), seen texels, and time — the quad
// fill must bring "holes" down from the span artefact (8.3M cells on the troll) to the true
// reveal deficit. NX/NY override the pose grid.
//   FLUSH=1 node harness/a244_cpucheck.js
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = __dirname;
(async () => {
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r2 => setTimeout(r2, 1000)); }
    const res = await page.evaluate(async (o) => {
        window._rayReproject = true; window._plugSweepCapture = true; window._plugCarve = false;
        if (o.flush) window._plateFlushExempt = true;
        bgQuickBake = true; buildBackgroundLayer(); isSweeping = true;
        const s = window._plugCpuSweep({ holeDemand: true, nx: o.nx, ny: o.ny });
        if (!s) return { err: 'no sweep' };
        const N = s.N; let nHoleTex = 0; for (let i = 0; i < N; i++) nHoleTex += s.holeTex[i];
        let nBand = 0; const dis = window._qbDisocc; for (let i = 0; i < N; i++) nBand += dis[i];
        // holes by pose class: rerun single poses at the rim (x only) and at rest to see where holes live
        const rest = window._plugCpuSweep({ holeDemand: true, poses: [[0, 0]] });
        const rimX = window._plugCpuSweep({ holeDemand: true, poses: [[s.exRim, 0]] });
        const rimXY = window._plugCpuSweep({ holeDemand: true, poses: [[s.exRim, s.exRim * 0.5625]] });
        const mid = window._plugCpuSweep({ holeDemand: true, poses: [[0.5 * s.exRim, 0.28 * s.exRim]], classMap: true });
        const midX = window._plugCpuSweep({ holeDemand: true, poses: [[0.5 * s.exRim, 0]], classMap: true });
        return { pw: s.pw, ph: s.ph, poses: s.poses, cells: s.pw * s.ph * s.poses, holeCells: s.holeCells, holeIn: s.holeIn, holeOut: s.holeOut, holeTex: nHoleTex, seen: s.nSeen, band: nBand, ms: s.ms,
                 rest: { holes: rest.holeCells, inn: rest.holeIn, out: rest.holeOut, seen: rest.nSeen }, rimX: { holes: rimX.holeCells, inn: rimX.holeIn, out: rimX.holeOut, seen: rimX.nSeen }, rimXY: { holes: rimXY.holeCells, inn: rimXY.holeIn, out: rimXY.holeOut, seen: rimXY.nSeen },
                 mid: { holes: mid.holeCells, inn: mid.holeIn, out: mid.holeOut, seen: mid.nSeen, png: mid.classMap }, midX: { holes: midX.holeCells, inn: midX.holeIn, out: midX.holeOut, seen: midX.nSeen, png: midX.classMap } };
    }, { flush: !!process.env.FLUSH, nx: process.env.NX ? +process.env.NX : 17, ny: process.env.NY ? +process.env.NY : 5 });
    if (res.err) { console.log('ERR ' + res.err); process.exit(1); }
    console.log(`plate ${res.pw}x${res.ph}, ${res.poses} poses (${res.cells} cells): hole cells ${res.holeCells} (${(100 * res.holeCells / res.cells).toFixed(2)}%) = in-plate ${res.holeIn} + out-of-plate ${res.holeOut}; hole texels ${res.holeTex}; seen ${res.seen}; band ${res.band}; ${res.ms} ms`);
    console.log(`   rest pose: holes ${res.rest.holes} (in ${res.rest.inn}, out ${res.rest.out}), seen ${res.rest.seen}`);
    console.log(`   rim pose (x): holes ${res.rimX.holes} (in ${res.rimX.inn}, out ${res.rimX.out}), seen ${res.rimX.seen}`);
    console.log(`   rim pose (x,y): holes ${res.rimXY.holes} (in ${res.rimXY.inn}, out ${res.rimXY.out}), seen ${res.rimXY.seen}`);
    console.log(`   mid pose (0.5x, 0.28y): holes ${res.mid.holes} (in ${res.mid.inn}, out ${res.mid.out}), seen ${res.mid.seen}`);
    console.log(`   mid pose (0.5x, 0): holes ${res.midX.holes} (in ${res.midX.inn}, out ${res.midX.out}), seen ${res.midX.seen}`);
    const fs = require('fs'); fs.mkdirSync(path.join(H, 'shots', 'a242', 'troll'), { recursive: true });
    fs.writeFileSync(path.join(H, 'shots', 'a242', 'troll', 'cpu_classmap_mid.png'), Buffer.from(res.mid.png.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(H, 'shots', 'a242', 'troll', 'cpu_classmap_midx.png'), Buffer.from(res.midX.png.split(',')[1], 'base64'));
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
