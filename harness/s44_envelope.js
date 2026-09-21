// S44 / Sprint 24: THE REST-VERSUS-ENVELOPE DIFFERENCE.
//
// R7 read twenty papers looking for an evaluation built for a viewer like ours and found exactly one. InpaintFusion's user
// study collected three numbers, not one: a rating of a STILL, a rating of the same scene IN MOTION, and their DIFFERENCE.
// Their planar baselines rated 5/10 as stills and 2-3/10 in motion (delta -1 and -2) while their own method rated 6 and 7
// (delta +1) -- the static score alone would have ranked the methods almost identically and missed the entire effect.
//
// This project has never measured that axis. Every instrument scores the bake (the kit band, the hole counts) or the rest
// frame; nothing scores what happens to the picture as the head moves through the envelope, which is the only thing the
// product is for. This is the machine analogue:
//
//   placeholder %   the share of the frame whose colour was INVENTED by the bake, read off the S17 check view
//                   (cyan/blue = band, teal = carrier wash, magenta = plate 2, orange = beyond the frame).
//                   At rest it should be ~0: the viewer is looking at the picture. It grows with the head.
//   dark %          the share that is near-black -- holes, plus the letterbox, which does not move.
//
// Both are reported at rest, at each envelope pose, and AS THE DIFFERENCE FROM REST. The difference is the number that
// matters and it is also the clean one: the letterbox and any constant framing cancel out of it exactly.
//
//   IMG=color,depth TAG=... POSES="0:0,0.5:0,1:0,0:1,1:1" SKY=1 OUT=<dir> node harness/s44_envelope.js
'use strict';
//
// S48 ADDS THE UNPAINTED-PIXEL ASSERTION to the same pass (harness/unpainted.js). "dark %" above sums two different
// failures — cracks the renderer should have spanned, and reveals the fill stage owes content — and no instrument in this
// project has ever separated them. The assertion does it mechanically: an unpainted run at most T pixels long with
// painted pixels at both ends is a gap we should have covered; anything wider is a genuine disocclusion.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const { UNPAINTED_FN } = require('./unpainted.js');
const TS = (process.env.T || '1,2,4').split(',').map(Number);
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = __dirname, WT = path.resolve(__dirname, '..');
const OUT = process.env.OUT || path.join(H, 'shots', 's44_env', process.env.TAG || 'troll');

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    if (process.env.IMG) { const [c, d] = process.env.IMG.split(','); fs.copyFileSync(path.resolve(WT, c), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, d), path.join(H, 'defaultImgDepth.png')); }
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const unpaintedSrc = UNPAINTED_FN;
    const browser = await chromium.launch({ executablePath: CHROME, headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    page.on('console', m => { const t = m.text(); if (/\[S6\] plate|\[S44\]|FAILED|rror/.test(t)) console.log('  [page:log] ' + t.slice(0, 260)); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r2 => setTimeout(r2, 1000)); }

    // Bake with WHATEVER THE PANEL SHIPS. That is the point of this instrument: it measures the defaults a new user gets,
    // not an arm. Only sky is a per-picture choice, so only sky is overridden.
    const meta = await page.evaluate(async (o) => {
        window._rayReproject = true; window._depthContractUI = false;   // no banner in the frames
        if (o.depth) { if (o.depth.outer !== undefined) outerVolumeDepth = o.depth.outer; if (o.depth.inner !== undefined) innerVolumeDepth = o.depth.inner; if (o.depth.pn !== undefined) currentNormPortalPlane = o.depth.pn; }
        if (o.sky) { const el = document.getElementById('bgPlateSkySel'); if (el) el.value = 'on'; }
        if (o.sel) for (const k in o.sel) { const el = document.getElementById(k); if (el) el.value = o.sel[k]; }
        if (window._applyPlateOptions) window._applyPlateOptions();
        if (o.flags) for (const f of o.flags) { const [k, v] = f.split('='); window[k] = (v === undefined) ? true : (isNaN(+v) ? v : +v); }
        window._plugObjectRule = false; window._plugExtent = null; window._geoLipSeed = false; window._plugBack = false; window._plateFlushExempt = true;
        const modeSel3 = document.getElementById('bgModeSel'); if (modeSel3) modeSel3.value = 'quick'; bgQuickBake = true; window._bgBakeMode = 'quick';
        const t0 = Date.now(); window._plugGeoBand({ flush: true, observed: true, gateAPriori: true }); window._bgUserBuiltOnce = true;
        return { bakeMs: Date.now() - t0, opts: window._bgPlateOptions, ceilCut: window._ceilCut, despeckle: window._despeckleLines,
                 envDeg: bgViewFadeEndDeg, cloneCount: window._qbCloneCount, contract: window._bgDepthContract ? window._bgDepthContract.warn.length : null };
    }, { sky: !!process.env.SKY, flags: process.env.FLAGS ? process.env.FLAGS.split(',') : null,
         sel: process.env.SEL ? Object.fromEntries(process.env.SEL.split(',').map(z => z.split('='))) : null, depth: process.env.DEPTH_OUTER ? { outer: +process.env.DEPTH_OUTER, inner: +(process.env.DEPTH_INNER || 0.0001), pn: +(process.env.DEPTH_PN || 0.5) } : null });
    console.log('bake ' + meta.bakeMs + ' ms, defaults ' + JSON.stringify(meta.opts) + ', ceilCut ' + meta.ceilCut + ', despeckle ' + meta.despeckle +
                ', envelope ' + meta.envDeg + ' deg, clones ' + meta.cloneCount + ', depth-contract warnings ' + meta.contract);

    const poses = (process.env.POSES || '0:0,0.5:0,1:0,0:1,1:1,-1:-1').split(',').map(s => s.split(':').map(Number));
    // EVERY COUNT IS TAKEN INSIDE THE REST-POSE CONTENT RECTANGLE. The letterbox (a153/a168) is 53% of this canvas and it
    // takes the browser background colour, which the SD check view also changes -- the first run of this instrument reported
    // 53% placeholder at rest and was measuring the frame around the picture. The rect is the bounding box of everything
    // that is not letterbox in the rest frame, computed once, and it is printed so it can be checked.
    let RECT = null;
    const shot = async (fx, fy, mode) => {
        const r = await page.evaluate(async ([fx, fy, mode, rect, unpaintedSrc, TS]) => {
            const chk = document.getElementById('sdRegionsChk');
            const want = mode === 'sd';
            if (chk && chk.checked !== want) { chk.checked = want; chk.dispatchEvent(new Event('change')); }
            if (typeof updateVolumeGuidesVisibility === 'function') updateVolumeGuidesVisibility(false);
            isSweeping = true;
            const D = Math.abs(camera.position.z - portalPlaneWorldZ); const exR = D * Math.tan(bgViewFadeEndDeg * Math.PI / 180);
            camera.position.x = fx * exR; camera.position.y = fy * exR * bgEnvAspect();
            updateCameraAndProjection(); render(); updateCameraAndProjection(); render();
            const W = renderer.domElement.width, Hh = renderer.domElement.height;
            const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
            const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
            const d = cx.getImageData(0, 0, W, Hh).data;
            let x0 = 0, y0 = 0, x1 = W - 1, y1 = Hh - 1;
            if (rect) { x0 = rect[0]; y0 = rect[1]; x1 = rect[2]; y1 = rect[3]; }
            else {   // first call, rest + plain: find the content rect as the bbox of non-letterbox pixels
                x0 = W; y0 = Hh; x1 = -1; y1 = -1;
                for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
                    const i = y * W + x, R = d[i*4], G = d[i*4+1], B = d[i*4+2];
                    if (R < 24 && G < 24 && B < 24) continue;
                    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
                }
                if (x1 < x0) { x0 = 0; y0 = 0; x1 = W - 1; y1 = Hh - 1; }
            }
            const area = Math.max(1, (x1 - x0 + 1) * (y1 - y0 + 1));
            let placeholder = 0, dark = 0, stretched = 0;
            for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
                const i = y * W + x;
                const R = d[i*4], G = d[i*4+1], B = d[i*4+2];
                if (R < 24 && G < 24 && B < 24) { dark++; continue; }
                // the S17a fold-alpha check view paints every stretched-past-the-fold plate pixel pure magenta
                if (mode === 'plain' && R > 230 && B > 230 && G < 60) { stretched++; continue; }
                if (mode !== 'sd') continue;
                // the S17 placeholder tints: cyan/blue (band), teal (carrier wash), magenta (plate 2), orange (beyond the frame)
                if ((R > 150 && G > 60 && G < 170 && B < 90) ||            // orange
                    (B > 150 && G > 120 && R < 120) ||                     // cyan
                    (R > 150 && B > 150 && G < 120) ||                     // magenta
                    (B > 130 && G < 120 && R < 120) ||                     // blue
                    (G > 120 && B > 100 && R < 90 && G > B)) placeholder++; // teal
            }
            // S48: the unpainted-pixel assertion, on the plain frame (the SD check view repaints holes, so it cannot be
            // asked this question). The leak map is drawn over a dimmed copy of the frame and returned as its own PNG.
            let unp = null, unpPng = null;
            if (mode === 'plain') {
                const fn = eval('(' + unpaintedSrc + ')');
                const u = fn(d, W, Hh, [x0, y0, x1, y1], TS, 24);
                unp = { area: u.area, hole: u.hole, T: u.T, leak: u.leak, genuine: u.genuine, unbounded: u.unbounded };
                if (u.hole) {
                    const cv2 = document.createElement('canvas'); cv2.width = u.rectW; cv2.height = u.rectH;
                    const c2 = cv2.getContext('2d'); const id2 = c2.createImageData(u.rectW, u.rectH); const dd = id2.data;
                    for (let y = 0; y < u.rectH; y++) for (let x = 0; x < u.rectW; x++) {
                        const p = y * u.rectW + x, s = ((y + y0) * W + (x + x0)) * 4;
                        const m = u.leakMask[p];
                        if (m === 3) { dd[p * 4] = 255; dd[p * 4 + 1] = 40; dd[p * 4 + 2] = 40; }          // leaks at the tightest T: red
                        else if (m === 2) { dd[p * 4] = 255; dd[p * 4 + 1] = 190; dd[p * 4 + 2] = 40; }    // leaks only at a larger T: amber
                        else if (m === 1) { dd[p * 4] = 40; dd[p * 4 + 1] = 120; dd[p * 4 + 2] = 255; }    // genuine disocclusion (bounded): blue
                        else if (m === 4) { dd[p * 4] = 70; dd[p * 4 + 1] = 70; dd[p * 4 + 2] = 90; }      // unbounded: beyond the frame, not a disocclusion
                        else { dd[p * 4] = d[s] * 0.3; dd[p * 4 + 1] = d[s + 1] * 0.3; dd[p * 4 + 2] = d[s + 2] * 0.3; }
                        dd[p * 4 + 3] = 255;
                    }
                    c2.putImageData(id2, 0, 0); unpPng = cv2.toDataURL('image/png');
                }
            }
            isSweeping = false;
            return { W, Hh, rect: [x0, y0, x1, y1], area, placeholder: 100 * placeholder / area, dark: 100 * dark / area, stretched: 100 * stretched / area, png: cv.toDataURL('image/png'), unp, unpPng };
        }, [fx, fy, mode, RECT, unpaintedSrc, TS]);
        if (!RECT) { RECT = r.rect; console.log('  content rect ' + JSON.stringify(RECT) + ' = ' + r.area + ' px of ' + (r.W * r.Hh) + ' (' + (100 * r.area / (r.W * r.Hh)).toFixed(1) + '% of the canvas); everything below is measured inside it'); }
        const stem = mode + '_' + String(fx).replace('-', 'm') + '_' + String(fy).replace('-', 'm');
        fs.writeFileSync(path.join(OUT, stem + '.png'), Buffer.from(r.png.split(',')[1], 'base64'));
        if (r.unpPng) fs.writeFileSync(path.join(OUT, 'leak_' + stem + '.png'), Buffer.from(r.unpPng.split(',')[1], 'base64'));
        return r;
    };

    const rows = [];
    for (const [fx, fy] of poses) {
        const plain = await shot(fx, fy, 'plain');
        const sd = await shot(fx, fy, 'sd');
        const deg = { h: +(Math.atan(Math.abs(fx) * Math.tan(meta.envDeg * Math.PI / 180)) * 180 / Math.PI).toFixed(1) };
        rows.push({ fx, fy, degH: deg.h, placeholder: +sd.placeholder.toFixed(3), dark: +plain.dark.toFixed(3), stretched: +plain.stretched.toFixed(3), unp: plain.unp });
    }
    const rest = rows[0];
    console.log('\n  pose (fx:fy)   h deg |  placeholder %   d from rest |     dark %   d from rest');
    for (const r of rows) {
        console.log('  ' + String(r.fx + ':' + r.fy).padEnd(13) + String(r.degH).padStart(6) +
                    ' | ' + r.placeholder.toFixed(3).padStart(13) + (r.placeholder - rest.placeholder >= 0 ? '   +' : '   ') + (r.placeholder - rest.placeholder).toFixed(3).padStart(9) +
                    ' | ' + r.dark.toFixed(3).padStart(10) + (r.dark - rest.dark >= 0 ? '   +' : '   ') + (r.dark - rest.dark).toFixed(3).padStart(9) +
                    ' | stretched ' + r.stretched.toFixed(3).padStart(8));
    }
    const worst = rows.reduce((a, b) => (b.placeholder > a.placeholder ? b : a), rows[0]);
    console.log('\n  REST-TO-ENVELOPE DIFFERENCE: placeholder +' + (worst.placeholder - rest.placeholder).toFixed(3) +
                ' points (rest ' + rest.placeholder.toFixed(3) + ' -> ' + worst.placeholder.toFixed(3) + ' at ' + worst.fx + ':' + worst.fy + '), ' +
                'dark ' + (worst.dark - rest.dark >= 0 ? '+' : '') + (worst.dark - rest.dark).toFixed(3) + ' points.');
    if (rest.placeholder > 0.5) console.log('  NOTE: ' + rest.placeholder.toFixed(2) + '% of the REST frame is placeholder. At rest the viewer should be looking at the picture.');
    // S48: the unpainted set split into what we should have covered and what is genuinely revealed
    console.log('\n  THE UNPAINTED-PIXEL ASSERTION (S48): an unpainted run of at most T px with painted pixels at BOTH ends is');
    console.log('  a gap we should have covered; wider is a genuine disocclusion. "dark %" above is the sum of the two.');
    console.log('  "unbounded" reaches the rectangle edge on both axes: beyond the frame, not a disocclusion at all.');
    console.log('  pose (fx:fy)   unpainted %   unbounded | ' + TS.map(t => ('leak T=' + t).padStart(16)).join(' | '));
    for (const r of rows) {
        if (!r.unp) continue;
        const u = r.unp, bounded = Math.max(1, u.hole - (u.unbounded || 0));
        console.log('  ' + String(r.fx + ':' + r.fy).padEnd(13) + (100 * u.hole / u.area).toFixed(3).padStart(11) +
            (100 * (u.unbounded || 0) / Math.max(1, u.hole)).toFixed(1).padStart(11) + '% | ' +
            TS.map((t, k) => (u.hole ? (100 * u.leak[k] / bounded).toFixed(1) + '% of bounded' : '        —   ').padStart(16)).join(' | ') +
            '   (' + TS.map((t, k) => u.leak[k]).join(' / ') + ' px)');
    }
    fs.writeFileSync(path.join(OUT, 'envelope.json'), JSON.stringify({ meta, rows }, null, 1));
    console.log('  -> ' + OUT);
    await browser.close(); try { srv.kill(); } catch (e) {}
})();
