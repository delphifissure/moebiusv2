// Task 95 items 2-3: (2) does the plane bake's band depend on the sweep grid's density? The per-line bake (the panel
// default) builds its band from a 17x5 CPU sweep; bake it at 17x5 (offset-spaced and angle-spaced), 33x9 and 65x17, and
// compare each band with the densest. (3) what a bake at an 80 x 80 envelope does (the S64 design target short of 90):
// time, margin, band, errors -- every D*tan(fadeEnd) site at work.
//   node harness/envelope_bake_check.js           (default picture; ARMS='[...]' JSON to choose arms, OUTJSON=file)
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = __dirname, WT = path.resolve(__dirname, '..');
const ARMS = process.env.ARMS ? JSON.parse(process.env.ARMS) : [
    { tag: '45x30 17x5 offset', env: [45, 30], nx: 17, ny: 5, byAngle: false },
    { tag: '45x30 17x5 angle', env: [45, 30], nx: 17, ny: 5, byAngle: true },
    { tag: '45x30 33x9 offset', env: [45, 30], nx: 33, ny: 9, byAngle: false },
    { tag: '45x30 65x17 offset', env: [45, 30], nx: 65, ny: 17, byAngle: false, ref: true },
    { tag: '80x80 17x5 angle', env: [80, 80], nx: 17, ny: 5, byAngle: true },
    { tag: '80x80 33x9 angle', env: [80, 80], nx: 33, ny: 9, byAngle: true, ref: true },
];
(async () => {
    fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=6000'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    const logs = [];
    page.on('pageerror', e => { logs.push('PAGEERR ' + e.message.slice(0, 200)); console.log('  [PAGEERR] ' + e.message.slice(0, 200)); });
    page.on('console', m => { const t = m.text(); if (/A245 plug margin|failed|rror|NaN|Infinity/.test(t)) { logs.push(t.slice(0, 300)); console.log('  [page] ' + t.slice(0, 300)); } });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r2 => setTimeout(r2, 1000)); }
    const bands = {}; const out = [];
    for (const a of ARMS) {
        const r = await page.evaluate(async (a) => {
            window._rayReproject = true;
            const sel = { bgPlateFarSel: 'plane', bgPlateFillSel: 'wash', bgPlateMarginSel: 'picture', bgPlateFacesSel: 'off', bgPlateBandSel: '35', bgPlateSkySel: 'off', bgPlateSeamSel: 'stretched', bgPlateJoinSel: 'off', bgPlateHoleSel: 'perline' };   // the per-line band is what this measures (source became the panel default)
            for (const id in sel) { const el = document.getElementById(id); if (el) el.value = sel[id]; }
            if (window._applyPlateOptions) window._applyPlateOptions();
            window._plugObjectRule = false; window._plugExtent = null; window._geoLipSeed = false; window._plugBack = false; window._plateFlushExempt = true;
            const m3 = document.getElementById('bgModeSel'); if (m3) m3.value = 'quick'; bgQuickBake = true; window._bgBakeMode = 'quick';
            bgViewFadeEndDeg = a.env[0]; bgViewFadeEndDegV = a.env[1]; if (typeof _bgRimLaw !== 'undefined') _bgRimLaw = null;
            window._poseByAngle = a.byAngle; window._bandSweep = a.sweep || null;
            camera.position.set(0, 0, 0.2); updateCameraAndProjection();
            const t0 = Date.now(); let err = null;
            try { window._plugGeoBand({ flush: true, observed: true, gateAPriori: true, nx: a.nx, ny: a.ny }); } catch (e) { err = String(e && e.stack || e).slice(0, 400); }
            const ms = Date.now() - t0; window._poseByAngle = false; window._bandSweep = null;
            const dis = window._qbDisocc; let n = 0; const idx = [];
            if (dis) for (let i = 0; i < dis.length; i++) if (dis[i]) { n++; idx.push(i); }
            const sz = window._qbSize;
            return { ms, err, band: n, sweepStats: a.sweep ? window._bandSweepStats : null, N: sz ? sz.pw * sz.ph : 0, margin: window._qbMargin || null, idx,
                     mem: (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null) };
        }, a);
        bands[a.tag] = new Set(r.idx); delete r.idx;
        const row = Object.assign({ tag: a.tag }, r); out.push(row);
        console.log(a.tag.padEnd(22), r.sweepStats ? JSON.stringify(r.sweepStats) : '', 'bake', (r.ms / 1000).toFixed(1) + 's', 'band', r.band, '(' + (100 * r.band / Math.max(1, r.N)).toFixed(2) + '% of plate)', 'margin', JSON.stringify(r.margin), 'heap', r.mem, 'MB', r.err ? 'ERR ' + r.err : '');
    }
    for (const env of ['45x30', '80x80']) {
        const ref = ARMS.find(a => a.ref && a.tag.startsWith(env)); if (!ref) continue; const R = bands[ref.tag];
        for (const a of ARMS.filter(x => x.tag.startsWith(env) && !x.ref)) { const B = bands[a.tag]; let inter = 0; for (const i of B) if (R.has(i)) inter++;
            const row = out.find(o => o.tag === a.tag); row.vsRef = { ref: ref.tag, recall: inter / Math.max(1, R.size), precision: inter / Math.max(1, B.size), onlyHere: B.size - inter, onlyRef: R.size - inter };
            console.log('  ' + a.tag + ' vs ' + ref.tag + ': recall ' + (100 * row.vsRef.recall).toFixed(2) + '%, precision ' + (100 * row.vsRef.precision).toFixed(2) + '%, only here ' + row.vsRef.onlyHere + ', only in ref ' + row.vsRef.onlyRef); }
    }
    fs.writeFileSync(path.join(H, process.env.OUTJSON || 'out_envelope_bake_check.json'), JSON.stringify({ arms: out, logs }, null, 1));
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
