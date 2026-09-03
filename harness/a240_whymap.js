// A240 WHY DOES NO FRONT REACH THE CLONE TEXELS IN THE GLANCING GAPS? Per
// texel of the torn-outside-demand CLONE set: was it ever visited by a front,
// and what refused it (1 ground gate, 2 fold proud-gate, 3 object claim,
// 4 lost takes(), 5 prominence bound); distance to the nearest fold/cliff
// seed; local source step. Map PNG (texture space, upright) + composite crops
// at the sheet-1 pose around the densest cluster (screengrabs).
//   FLUSH=1 FLAGS=_seedRevealPx=1.4142,_foldClaimPx=1.4142 node harness/a240_whymap.js
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = __dirname, WT = path.resolve(__dirname, '..');
const TAG = process.env.TAG || 'troll';
const OUT = path.join(__dirname, 'shots', 'a240', TAG);
(async () => {
    fs.mkdirSync(OUT, { recursive: true });
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
        window._rayReproject = true; window._plugSweepCapture = true; window._srCapture = true; window._foldProbe = true; window._plugCarve = false;
        if (o.flush) window._plateFlushExempt = true;
        if (o.flags) for (const f of o.flags) { const [k, v] = f.split('='); window[k] = (v === undefined) ? true : (isNaN(+v) ? v : +v); }
        bgQuickBake = true; buildBackgroundLayer(); isSweeping = true;
        const sz = window._qbSize, dQ = window._qbDQ, pF = window._qbPlateF, torn = window._qbFgTorn, dis = window._qbDisocc, fp = window._fpData, seed = window._fpSeed;
        if (!sz || !dQ || !pF || !torn || !dis || !fp || !fp.refuseF) return { err: 'missing capture' };
        const pw = sz.pw, ph = sz.ph, N = pw * ph;
        const q = 2 * ((typeof window._qbSrcQuantum === 'number' && window._qbSrcQuantum > 0) ? window._qbSrcQuantum : 1 / 255);
        // seeds: fpSeed.seen is the seed field before propagation (source rows)
        const seedM = seed && seed.seen ? seed.seen : null;
        // distance to nearest seed (BFS, 4-conn)
        const dist = new Int32Array(N).fill(-1); const qb = new Int32Array(N); let qh = 0, qt = 0;
        if (seedM) { for (let i = 0; i < N; i++) if (seedM[i]) { dist[i] = 0; qb[qt++] = i; }
            while (qh < qt) { const i = qb[qh++]; const x = i % pw, y = (i / pw) | 0, d = dist[i] + 1;
                if (x > 0 && dist[i - 1] < 0) { dist[i - 1] = d; qb[qt++] = i - 1; } if (x < pw - 1 && dist[i + 1] < 0) { dist[i + 1] = d; qb[qt++] = i + 1; }
                if (y > 0 && dist[i - pw] < 0) { dist[i - pw] = d; qb[qt++] = i - pw; } if (y < ph - 1 && dist[i + pw] < 0) { dist[i + pw] = d; qb[qt++] = i + pw; } } }
        const cat = new Uint8Array(N);   // 0 other, 1 clone-unvisited, 2 clone-refused-ground, 3 clone-refused-proud, 4 clone-refused-claim, 5 clone-lost-takes, 6 clone-prominence, 7 clone-claimed-shallow, 8 clone-budget-dead-nearby, 9 continued (torn outside demand)
        const cnt = new Int32Array(10); const seedDist = []; const steps = [];
        let nTOD = 0, nClone = 0, nearLip = 0, farLip = 0, flat = 0;
        for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const i = y * pw + x, f = (ph - 1 - y) * pw + x;
            if (!torn[i] || dis[i]) continue; nTOD++;
            const dd = pF[f] - dQ[i];
            if (Math.abs(dd) > q) { cat[i] = 9; cnt[9]++; continue; }
            nClone++;
            let c;
            if (fp.claimedF[i]) c = 7;
            else if (!fp.visitF[i]) c = (fp.budDeadF && (fp.budDeadF[i] || (x > 0 && fp.budDeadF[i - 1]) || (x < pw - 1 && fp.budDeadF[i + 1]) || (y > 0 && fp.budDeadF[i - pw]) || (y < ph - 1 && fp.budDeadF[i + pw]))) ? 8 : 1;
            else { const r = fp.refuseF[i]; c = r === 1 ? 2 : r === 2 ? 3 : r === 3 ? 4 : r === 4 ? 5 : r === 5 ? 6 : 1; }
            cat[i] = c; cnt[c]++;
            // which side of its local step is this texel? A clone at the FAR lip is the surface itself (correct);
            // a clone at the NEAR lip is the near surface standing in for the far side (wrong).
            { let mn = dQ[i], mx = dQ[i]; for (const nb of [x > 0 ? i - 1 : -1, x < pw - 1 ? i + 1 : -1, y > 0 ? i - pw : -1, y < ph - 1 ? i + pw : -1]) if (nb >= 0) { if (dQ[nb] < mn) mn = dQ[nb]; if (dQ[nb] > mx) mx = dQ[nb]; }
              if (dQ[i] - mn > q) nearLip++; else if (mx - dQ[i] > q) farLip++; else flat++; }
            if (dist[i] >= 0) seedDist.push(dist[i]);
            // local source step: max |dQ - neighbour|
            let st = 0; for (const nb of [x > 0 ? i - 1 : -1, x < pw - 1 ? i + 1 : -1, y > 0 ? i - pw : -1, y < ph - 1 ? i + pw : -1]) if (nb >= 0) st = Math.max(st, Math.abs(dQ[nb] - dQ[i]));
            steps.push(st);
        }
        seedDist.sort((a, b) => a - b); steps.sort((a, b) => a - b);
        const med = (a) => a.length ? a[a.length >> 1] : -1, p90 = (a) => a.length ? a[Math.floor(0.9 * (a.length - 1))] : -1;
        // ground share among clones
        let gClone = 0; for (let i = 0; i < N; i++) if (cat[i] >= 1 && cat[i] <= 8 && fp.ground && fp.ground[i]) gClone++;
        // densest cluster of clone texels (32x32 blocks) for the crop
        const BS = 32, bw = Math.ceil(pw / BS), bh = Math.ceil(ph / BS); const blk = new Int32Array(bw * bh);
        for (let i = 0; i < N; i++) if (cat[i] >= 1 && cat[i] <= 8) blk[((i / pw | 0) / BS | 0) * bw + ((i % pw) / BS | 0)]++;
        let best = 0; for (let b = 1; b < blk.length; b++) if (blk[b] > blk[best]) best = b;
        const bx = (best % bw) * BS, by = ((best / bw) | 0) * BS;
        // map png (upright): clone categories coloured over dim source depth
        const c = document.createElement('canvas'); c.width = pw; c.height = ph; const cx = c.getContext('2d'); const im = cx.createImageData(pw, ph);
        const COL = { 0: null, 1: [255, 0, 255], 2: [255, 80, 0], 3: [255, 200, 0], 4: [0, 200, 255], 5: [120, 120, 255], 6: [0, 255, 120], 7: [255, 255, 255], 8: [255, 0, 0], 9: [40, 40, 120] };
        for (let i = 0; i < N; i++) { const o4 = i * 4; const col = COL[cat[i]]; if (col) { im.data[o4] = col[0]; im.data[o4 + 1] = col[1]; im.data[o4 + 2] = col[2]; } else { const g = Math.round(dQ[i] * 90); im.data[o4] = g; im.data[o4 + 1] = g; im.data[o4 + 2] = g; } im.data[o4 + 3] = 255; }
        cx.putImageData(im, 0, 0);
        // composite crops at the sheet-1 pose around the cluster (screen space: plate rect at rest measured with FG hidden)
        const L = mediaLayers[0];
        const grab = () => { const el = renderer.domElement; const cv = document.createElement('canvas'); cv.width = el.width; cv.height = el.height; cv.getContext('2d').drawImage(el, 0, 0); return cv; };
        camera.position.set(0.18, 0.008, 0.199); updateCameraAndProjection(); render(); render();
        const compS1 = grab().toDataURL('image/png');
        camera.position.set(0, 0, 0.199); updateCameraAndProjection(); render(); render();
        const compRest = grab().toDataURL('image/png');
        L.mesh.visible = false; render(); const plugRest = grab().toDataURL('image/png'); L.mesh.visible = true; render();
        return { pw, ph, N, nTOD, nClone, nearLip, farLip, flat, cnt: Array.from(cnt), gClone, seedMed: med(seedDist), seedP90: p90(seedDist), stepMed: med(steps), stepP90: p90(steps), q,
                 cluster: { bx, by, n: blk[best] }, map: c.toDataURL('image/png'), compS1, compRest, plugRest,
                 groundPct: fp.ground ? 100 * fp.ground.reduce((a, b) => a + b, 0) / N : -1 };
    }, { flush: !!process.env.FLUSH, flags: (process.env.FLAGS || '').split(',').filter(Boolean) });
    if (res.err) { console.log('ERR ' + res.err); process.exit(1); }
    const w = (n, d) => fs.writeFileSync(path.join(OUT, n), Buffer.from(d.split(',')[1], 'base64'));
    w('whymap.png', res.map); w('comp_sheet1.png', res.compS1); w('comp_rest.png', res.compRest); w('plug_rest.png', res.plugRest);
    const pc = (a, b) => (100 * a / Math.max(1, b)).toFixed(1) + '%';
    const names = ['', 'never visited by any front', 'refused: ground gate (object front)', 'refused: fold proud-gate', 'refused: object claim (bid not below source)', 'lost takes() to another front', 'refused: prominence bound', 'claimed but shallow (bid within 2 quanta)', 'never visited, a front died on budget next to it', '(far-continued)'];
    console.log(TAG + ' [' + (process.env.FLAGS || 'default') + (process.env.FLUSH ? ',flush' : '') + ']: torn-outside-demand ' + res.nTOD + ', clones ' + res.nClone + ' (' + pc(res.nClone, res.nTOD) + '); a62 ground ' + res.groundPct.toFixed(1) + '% of plate; clones on ground ' + pc(res.gClone, res.nClone));
    for (let c = 1; c <= 8; c++) if (res.cnt[c]) console.log('   ' + names[c].padEnd(52) + String(res.cnt[c]).padStart(7) + '  ' + pc(res.cnt[c], res.nClone));
    console.log('   side of the local step: NEAR lip (wrong clone) ' + res.nearLip + ' (' + pc(res.nearLip, res.nClone) + '), FAR lip (the surface itself, correct) ' + res.farLip + ' (' + pc(res.farLip, res.nClone) + '), flat ' + res.flat);
    console.log('   distance to nearest seed: median ' + res.seedMed + ' texels, p90 ' + res.seedP90 + ';  local source step: median ' + res.stepMed.toFixed(4) + ', p90 ' + res.stepP90.toFixed(4) + ' (2 quanta = ' + res.q.toFixed(4) + ')');
    console.log('   densest clone cluster: ' + res.cluster.n + ' texels in the 32x32 block at (' + res.cluster.bx + ',' + res.cluster.by + ')  -> ' + OUT);
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
