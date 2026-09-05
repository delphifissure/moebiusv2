// PHASE 0 ROW PROBE (the FG pass's classes along one row at +-half-rim poses)
// PHASE 0 PROBE (per-direction lip observations against truth; built on p0_truth.js's staging)
// PHASE 0.1 TRUTH METRICS (Addendum 184). Stages a synthetic scene from p0_synth.js, bakes
// the flagged stack, and scores the plug against the KNOWN hidden layer in texel space:
//   R  = the true revealable set: far-layer texels under the occluder that some pose of the
//        cone exposes (the true two-layer scene warped by the app's own shift law, quad-filled
//        like the CPU sweep; the near layer is the TRUE occluder at its true depth)
//   B  = the app's band (window._qbDisocc), H = the occluder's footprint at rest
//   coverage: |R|, |B∩R| (revealable texels the plug fills), |R−B| (revealable texels the plug
//             leaves at the occluder's depth: a hole or a clone at some pose)
//   hidden depth: over B∩R, plate depth − true far depth, in source quanta (1/255 for the 8-bit
//             grade, 1/65535 for 16-bit) and in rim-shift texels (the unit the screen sees)
//   colour: over B∩R, mean |plug − true far colour| per channel (0..255), beside the CLONE scale
//             (mean |occluder colour − true far colour| over the same texels) — a plug scoring
//             near the clone scale is a clone; near 0 is the truth
// Error maps (depth, colour) are written as PNGs. Screenshots come from a242_ghost.js / a228_carve.js
// with IMG= pointing at the same files.
//   SCENE=figure|screen|pole GRADE=16|8 [GEO=1] [OBS=1] [BOUNDARY=1] [FLUSH=1] [FLAGS=...] node harness/p0_truth.js
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = __dirname, WT = path.resolve(__dirname, '..');
const SCENE = process.env.SCENE || 'figure', GRADE = process.env.GRADE || '16';
const ARM = (process.env.FLAGS ? process.env.FLAGS.replace(/[^A-Za-z0-9]+/g, '') : 'wash') + (process.env.GEO ? '_geo' : '') + (process.env.OBS ? '_obs' : '') + (process.env.GATEA ? '_gateA' : '') + (process.env.BOUNDARY ? '_bnd' : '');
const OUT = path.join(__dirname, 'shots', 'p0', SCENE + '_d' + GRADE);
const POSES = [[0, 0], [0.100, -0.023], [0.141, 0.023], [0.180, 0.008], [-0.141, 0.023], [0.06, 0.012], [-0.09, -0.02], [0.16, -0.03]];   // the eight of a228_carve
(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const truth = JSON.parse(fs.readFileSync(path.join(H, 'synth', SCENE + '_truth.json'), 'utf8'));
    fs.copyFileSync(path.join(H, 'synth', truth.files.color), path.join(H, 'defaultImgColor.png'));
    fs.copyFileSync(path.join(H, 'synth', GRADE === '8' ? truth.files.depth8 : truth.files.depth16), path.join(H, 'defaultImgDepth.png'));
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    page.on('console', m => { const t = m.text(); if (t.includes('A244') || t.includes('A246') || t.includes('A242') || t.includes('A99') || t.includes('a89') || t.includes('A241b') || m.type() === 'error') console.log('  [page:' + m.type() + '] ' + t.slice(0, 600)); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r2 => setTimeout(r2, 1000)); }
    const res = await page.evaluate(async (o) => {
        window._rayReproject = true; window._plugSweepCapture = true; window._plugCarve = false; window._plateFlushExempt = true;
        if (o.flags) for (const f of o.flags) { const [k, v] = f.split('='); window[k] = (v === undefined) ? true : (isNaN(+v) ? v : +v); }
        window._plugGeoBand({ flush: true, observed: true, gateAPriori: true });
        const sz = window._qbSize, pw = sz.pw, ph = sz.ph; const dQ = window._qbDQ;
        const _pz = (typeof portalPlaneWorldZ === 'number') ? portalPlaneWorldZ : 0; const D = Math.max(1e-3, Math.abs(camera.position.z - _pz));
        const exRim = D * Math.tan(((typeof bgViewFadeEndDeg === 'number') ? bgViewFadeEndDeg : 45) * Math.PI / 180);
        const row = o.row < 0 ? (ph / 2) | 0 : o.row;
        const s = window._plugCpuSweep({ revealDemand: true, farField: window._geoFarField, observe: true, poses: [[0.5 * exRim, 0], [-0.5 * exRim, 0]], rowDump: row });
        const out = [];
        for (const d of s.rowDumps) {
            // run-length classes along the row: F(far-corner depth) for FG, . for uncovered
            const runs = []; let x = 0; while (x < d.own.length) { const cls = d.own[x] === -2 ? 'FG' : (d.own[x] === -1 ? 'gap' : 'plate'); let x0 = x; let dmin = 9, dmax = -9; while (x < d.own.length && (d.own[x] === -2 ? 'FG' : (d.own[x] === -1 ? 'gap' : 'plate')) === cls) { if (cls === 'FG') { dmin = Math.min(dmin, d.far[x]); dmax = Math.max(dmax, d.z[x]); } x++; }
                runs.push({ cls, x0, x1: x - 1, dmin: cls === 'FG' ? +dmin.toFixed(4) : null, dmax: cls === 'FG' ? +dmax.toFixed(4) : null }); }
            out.push({ fx: d.fx, fy: d.fy, y: d.y, runs: runs.filter(r => r.cls !== 'FG' || (r.x1 - r.x0) < 60 || r.dmax > 0.5).slice(0, 40), nRuns: runs.length });
        }
        // source row: the occluder's columns
        const occ = []; for (let x = 0; x < pw; x++) if (dQ[row * pw + x] > 0.6) occ.push(x);
        return { pw, ph, row, occ: occ.length ? [occ[0], occ[occ.length - 1]] : null, dumps: out, exRim, torn: s.perPoseTear };
    }, { flags: (process.env.FLAGS || '').split(',').filter(Boolean), row: parseInt(process.env.ROW || '-1') });
    console.log(SCENE + ' d' + GRADE + ' row ' + res.row + ': occluder columns ' + JSON.stringify(res.occ) + ', per-pose tear ' + res.torn);
    for (const d of res.dumps) { console.log('  pose fx=' + d.fx.toFixed(2) + ' (' + d.nRuns + ' runs; FG runs longer than 60 cells omitted unless near):');
        for (const r of d.runs) console.log('    ' + r.cls.padEnd(5) + ' x ' + String(r.x0).padStart(5) + '..' + String(r.x1).padEnd(5) + (r.cls === 'FG' ? ' far-corner d ' + r.dmin + ' .. z ' + r.dmax : '')); }
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
