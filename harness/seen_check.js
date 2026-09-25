// S70 item 4: the source-anchored hole's SEEN step, sampled vs exact. One bake in source mode, then bgSourceHole is
// solved again on the bake's own inputs (window._qbSrcHoleArgs) three ways:
//   poses  the 32 poses alone (8 directions x 4 magnitudes)                   -- equals the bake's own result under window._seenMode = 'poses'
//   dense  DIRS x MAGS poses uniform in angle over the pose square (default 64 x 16 = 1024)
//   exact  the 32 poses plus the emergence test (bgSeenEmergence): every texel it adds is verified at its own pose
// Reported per arm: the seen set before the majority smoothing (dem) and the kept hole after it; recall of each against
// dense, and what exact adds beyond dense.
//   COLOR= DEPTH= TAG= [PORT=8131] [DIRS=64 MAGS=16] node harness/seen_check.js      -> harness/shots/seen/<TAG>.json
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const H = __dirname, WT = path.resolve(H, '..'), PORT = +(process.env.PORT || 8131), TAG = process.env.TAG || 'x';
const OUT = path.join(H, 'shots', 'seen'); fs.mkdirSync(OUT, { recursive: true });
(async () => {
    fs.copyFileSync(path.resolve(WT, process.env.COLOR || 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, process.env.DEPTH || 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(PORT) }) }); await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    await page.goto('http://localhost:' + PORT + '/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { if (await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth && mediaLayers[0]._depth16); } catch (e) { return false; } }).catch(() => false)) break; await new Promise(r => setTimeout(r, 1000)); }
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} const el = document.getElementById('bgPlateHoleSel'); if (el) { el.value = 'source'; el.dispatchEvent(new Event('change')); } document.getElementById('bgLayerBuildBtn').click(); });
    for (let t = 0; t < 2400; t++) { if (await page.evaluate(() => !!window._bgQuickBaked && !!window._qbSourceHole && !window._qbSourceHoleBusy && !!window._qbSrcHoleArgs)) break; await new Promise(r => setTimeout(r, 500)); }
    const R = await page.evaluate(([dirs, mags]) => {
        const o = window._qbSrcHoleArgs, N = o.pw * o.ph, out = { pw: o.pw, ph: o.ph, arms: {} }, sets = {};
        for (const [arm, extra] of [['poses', { seenMode: 'poses' }], ['dense', { seenMode: 'dense', seenDirs: dirs, seenMags: mags }], ['exact', { seenMode: 'exact' }]]) {
            const t0 = performance.now(); const r = bgSourceHole(Object.assign({}, o, extra, { seenReport: true })); const ms = performance.now() - t0;
            const st = r.stats, cnt = (a) => { let n = 0; for (let i = 0; i < N; i++) if (a[i]) n++; return n; };
            // dem restricted to candidates (dem marks triangle vertices, some outside the candidate set)
            const dem = new Uint8Array(N); for (let i = 0; i < N; i++) dem[i] = st.seenDem[i] && st.seenCand0[i] ? 1 : 0;
            sets[arm] = { dem, hole: r.hole };
            out.arms[arm] = { candidates: cnt(st.seenCand0), seen: cnt(dem), hole: cnt(r.hole), seenStats: { poses: st.seen.poses, ms: st.seen.ms }, exact: st.seenExact || null, msTotal: Math.round(ms) };
        }
        const inter = (a, b) => { let n = 0; for (let i = 0; i < N; i++) if (a[i] && b[i]) n++; return n; };
        const minus = (a, b) => { let n = 0; for (let i = 0; i < N; i++) if (a[i] && !b[i]) n++; return n; };
        for (const arm of ['poses', 'exact']) {
            const A = out.arms[arm], D = out.arms.dense;
            A.seenRecallVsDense = inter(sets[arm].dem, sets.dense.dem) / Math.max(1, D.seen);
            A.seenBeyondDense = minus(sets[arm].dem, sets.dense.dem);
            A.holeRecallVsDense = inter(sets[arm].hole, sets.dense.hole) / Math.max(1, D.hole);
            A.holeBeyondDense = minus(sets[arm].hole, sets.dense.hole);
        }
        // identity: the 'poses' arm re-solved must equal the bake's own hole
        const bh = window._qbSrcHole || null; if (bh && bh.length === N) out.posesEqualsBake = minus(sets.poses.hole, bh) + minus(bh, sets.poses.hole);
        // a picture of the differences: grey = seen by poses, green = dense adds, magenta = exact adds (beyond poses)
        const cv = document.createElement('canvas'); cv.width = o.pw; cv.height = o.ph; const cx = cv.getContext('2d'), im = cx.createImageData(o.pw, o.ph);
        for (let i = 0; i < N; i++) { let c = [0, 0, 0]; if (sets.poses.dem[i]) c = [110, 110, 110]; else if (sets.exact.dem[i] && sets.dense.dem[i]) c = [255, 255, 255]; else if (sets.dense.dem[i]) c = [0, 220, 0]; else if (sets.exact.dem[i]) c = [255, 0, 255];
            im.data[4 * i] = c[0]; im.data[4 * i + 1] = c[1]; im.data[4 * i + 2] = c[2]; im.data[4 * i + 3] = 255; }
        cx.putImageData(im, 0, 0); out.png = cv.toDataURL('image/png').split(',')[1];
        return out;
    }, [+(process.env.DIRS || 64), +(process.env.MAGS || 16)]);
    fs.writeFileSync(path.join(OUT, TAG + '_diff.png'), Buffer.from(R.png, 'base64')); delete R.png;
    fs.writeFileSync(path.join(OUT, TAG + '.json'), JSON.stringify(R, null, 1));
    console.log(TAG, JSON.stringify(R));
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
