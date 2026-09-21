// Sprint 26 / S50 — THE CLIFF TOLERANCE, SWEPT IN THE UNITS THE ARTEFACT APPEARS IN.
//
// S46 built the near-extent rule and swept its tolerance in source quanta on the troll at 45 degrees. The hole area came
// out 2.19 / 2.33 / 2.52 / 2.76 per cent at sixteen / eight / four / two quanta -- "monotone with no knee, so the
// tolerance is a dial between smear and stipple and the screen has to choose". That was the right conclusion with the
// instruments of the day, and it is the reason this sprint exists: a dial with no knee has no defensible default.
//
// Two things have changed since.
//
//   1. S48 put the rule's tolerance in SCREEN PIXELS AT THE RIM (window._plateNearOnlyPx). A quantum is a property of
//      the depth file; a pixel of reveal is a property of what the viewer sees, and the two differ by the relief, which
//      runs 3.2 in the truth kit against 0.1 in the shipped app. A sweep in quanta cannot transfer between pictures. A
//      sweep in pixels can.
//   2. S48's ASSERTION gives the dial a knee criterion it never had. Hole area alone cannot distinguish the two things
//      tightening the rule does -- it removes fake surface (good: the ramp was never there) and it opens cracks between
//      texels that ARE adjacent on the surface (bad: we should have covered those). The assertion separates them
//      mechanically. So the stopping point is not a taste call about smear against stipple:
//
//          TIGHTEN UNTIL THE MARGINAL HOLE STOPS BEING GENUINE AND STARTS BEING A LEAK.
//
//      And it is falsifiable in the other direction too: if tightening grows the BOUNDED GENUINE class rather than
//      converting smear into it, the rule is eating real covering and the whole approach is wrong.
//
// One bake per picture. Nothing in the bake depends on the tolerance -- it is a fragment test evaluated every frame --
// so the arms are re-armed live (window._setPlateNearOnlyPx) and cost a render each rather than a bake each.
//
//   IMG=color,depth TAG=... SKY=1 MARGIN=1 ARMS=off,px0.5,px1,px2,px4,q8,fold POSES="0:0,1:0,1:1,-1:-1" node harness/s50_tolsweep.js
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const { UNPAINTED_FN } = require('./unpainted.js');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = __dirname, WT = path.resolve(__dirname, '..');
const OUT = process.env.OUT || path.join(H, 'shots', 's50_tol', process.env.TAG || 'troll');
const TS = (process.env.T || '1,2,4').split(',').map(Number);

// The arms. 'off' is the shipped default (seams stretched: every ramp kept, which is the streak S46 was reported for).
// 'fold' is the other pre-existing all-or-nothing answer (u_plateFold = 1: every ramp discarded). 'q8' is S46's own
// tolerance in quanta, carried so the pixel form is compared against the thing it is meant to replace rather than only
// against the extremes.
const ARM_DEFS = {
    off:     { px: 0, q: 0, fold: 0, label: 'off (shipped: every ramp kept)' },
    'px0.5': { px: 0.5, q: 0, fold: 0, label: 'reveal <= 0.5 screen px' },
    px1:     { px: 1, q: 0, fold: 0, label: 'reveal <= 1 screen px' },
    px2:     { px: 2, q: 0, fold: 0, label: 'reveal <= 2 screen px' },
    px4:     { px: 4, q: 0, fold: 0, label: 'reveal <= 4 screen px' },
    q8:      { px: 0, q: 8, fold: 0, label: 'S46: 8 source quanta' },
    q2:      { px: 0, q: 2, fold: 0, label: 'S46: 2 source quanta' },
    fold:    { px: 0, q: 0, fold: 1, label: 'every ramp discarded (u_plateFold = 1)' },
};
const ARMS = (process.env.ARMS || 'off,px0.5,px1,px2,px4,q8,fold').split(',').filter(a => ARM_DEFS[a]);

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    if (process.env.IMG) { const [c, d] = process.env.IMG.split(','); fs.copyFileSync(path.resolve(WT, c), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, d), path.join(H, 'defaultImgDepth.png')); }
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 220)));
    page.on('console', m => { const t = m.text(); if (/\[S48\]|\[S50\]|\[S6\] plate|FAILED|rror/.test(t)) console.log('  [page] ' + t.slice(0, 260)); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r2 => setTimeout(r2, 1000)); }

    const meta = await page.evaluate(async (o) => {
        window._rayReproject = true; window._depthContractUI = false;
        if (o.sky) { const el = document.getElementById('bgPlateSkySel'); if (el) el.value = 'on'; }
        if (o.margin) { const el = document.getElementById('bgPlateMarginSel'); if (el) el.value = el.querySelector('option[value="picture"]') ? 'picture' : 'on'; }
        if (window._applyPlateOptions) window._applyPlateOptions();
        if (o.flags) for (const f of o.flags) { const [k, v] = f.split('='); window[k] = (v === undefined) ? true : (isNaN(+v) ? v : +v); }
        window._plugObjectRule = false; window._plugExtent = null; window._geoLipSeed = false; window._plugBack = false; window._plateFlushExempt = true;
        const ms = document.getElementById('bgModeSel'); if (ms) ms.value = 'quick'; bgQuickBake = true; window._bgBakeMode = 'quick';
        const t0 = Date.now(); window._plugGeoBand({ flush: true, observed: true, gateAPriori: true }); window._bgUserBuiltOnce = true;
        const law = window._revealLaw ? window._revealLaw(window._qbSize.pw, window._qbSize.ph) : null;
        return { bakeMs: Date.now() - t0, opts: window._bgPlateOptions, envDeg: bgViewFadeEndDeg, size: window._qbSize,
                 quantum: window._qbSrcQuantum, clones: window._qbCloneCount,
                 screenPxPerTexel: law ? (law.pxPerWorldScreen / law.pxPerWorldTexel) : null,
                 hasPlate2: !!(bgLayerMesh.userData && bgLayerMesh.userData.plate2), hasSteps: !!(bgLayerMesh.userData && bgLayerMesh.userData.steps) };
    }, { sky: !!process.env.SKY, margin: !!process.env.MARGIN, flags: process.env.FLAGS ? process.env.FLAGS.split(',') : null });
    console.log('bake ' + meta.bakeMs + ' ms, ' + JSON.stringify(meta.opts) + ', plate ' + meta.size.pw + 'x' + meta.size.ph +
                ', quantum ' + (meta.quantum || 0).toFixed(6) + ', 1 plate texel = ' + (meta.screenPxPerTexel || 0).toFixed(4) + ' screen px' +
                ', plate2 ' + meta.hasPlate2 + ', steps ' + meta.hasSteps + ', clones ' + meta.clones);
    // One quantum is worth this many screen pixels of reveal at the median cliff -- the number that says why a sweep in
    // quanta could never transfer between pictures. Printed, not used.
    const poses = (process.env.POSES || '0:0,1:0,1:1,-1:-1').split(',').map(s => s.split(':').map(Number));

    let RECT = null; const BASE = {};
    const shot = async (fx, fy, arm, mode) => {
        const r = await page.evaluate(async ([fx, fy, armDef, mode, rect, unpaintedSrc, TS]) => {
            // arm the rule LIVE: nothing baked depends on it
            if (window._setPlateNearOnlyPx) window._setPlateNearOnlyPx(armDef.px);
            const ud = bgLayerMesh.userData || {};
            // u_plateFold ALONE IS INERT. The plate's fold path is gated on u_fragTear > 0.5 and needs the rest of the
            // A241 stretch law with it (the app arms four uniforms together at bake time, Sprint 17a). The first run of
            // this sweep set only u_plateFold and the fold arm returned numbers IDENTICAL to off at every pose -- which
            // is the a134 lesson this codebase already carries: an A/B arm must diverge downstream of the flag before
            // its numbers are read. The assertion below enforces it rather than trusting this comment.
            const sz0 = window._qbSize, la0 = sz0.pw / sz0.ph, fa0 = terrariumWidth / terrariumHeight;
            const layerWf0 = (la0 > fa0) ? 1.0 : (la0 / fa0);
            const plateScrPx0 = Math.max(1, renderer.domElement.width * layerWf0);
            for (const m of [bgLayerMesh].concat(ud.plate2 ? [ud.plate2] : [], ud.ring || [])) {
                const u = m.material && m.material.uniforms; if (!u) continue;
                if (u.u_plateNearOnly) u.u_plateNearOnly.value = armDef.q ? armDef.q * (window._qbSrcQuantum || 1 / 255) : 0.0;
                if (u.u_plateFold) u.u_plateFold.value = armDef.fold || 0.0;
                if (armDef.fold) {
                    if (u.u_fragTear) u.u_fragTear.value = 1.0;
                    if (u.u_fragTearGate) u.u_fragTearGate.value = 0.0;
                    if (u.u_fragTearFactor) u.u_fragTearFactor.value = 2.0;
                    if (u.u_texelsPerPxRest) u.u_texelsPerPxRest.value = sz0.pw / plateScrPx0;
                } else if (u.u_fragTear && !window._fragTear) u.u_fragTear.value = 0.0;
            }
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
            else { x0 = W; y0 = Hh; x1 = -1; y1 = -1;
                for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
                    const i = y * W + x; if (d[i*4] < 24 && d[i*4+1] < 24 && d[i*4+2] < 24) continue;
                    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
                if (x1 < x0) { x0 = 0; y0 = 0; x1 = W - 1; y1 = Hh - 1; } }
            const area = Math.max(1, (x1 - x0 + 1) * (y1 - y0 + 1));
            let placeholder = 0, dark = 0;
            for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
                const i = y * W + x, R = d[i*4], G = d[i*4+1], B = d[i*4+2];
                if (R < 24 && G < 24 && B < 24) { dark++; continue; }
                if (mode !== 'sd') continue;
                if ((R > 150 && G > 60 && G < 170 && B < 90) || (B > 150 && G > 120 && R < 120) ||
                    (R > 150 && B > 150 && G < 120) || (B > 130 && G < 120 && R < 120) ||
                    (G > 120 && B > 100 && R < 90 && G > B)) placeholder++;
            }
            let unp = null, unpPng = null;
            if (mode === 'plain') {
                const fn = eval('(' + unpaintedSrc + ')');
                const u = fn(d, W, Hh, [x0, y0, x1, y1], TS, 24);
                unp = { area: u.area, hole: u.hole, T: u.T, leak: u.leak, genuine: u.genuine, unbounded: u.unbounded };
                if (u.hole) {
                    const cv2 = document.createElement('canvas'); cv2.width = u.rectW; cv2.height = u.rectH;
                    const c2 = cv2.getContext('2d'); const id2 = c2.createImageData(u.rectW, u.rectH); const dd = id2.data;
                    for (let y = 0; y < u.rectH; y++) for (let x = 0; x < u.rectW; x++) {
                        const p = y * u.rectW + x, s = ((y + y0) * W + (x + x0)) * 4, m = u.leakMask[p];
                        if (m === 3) { dd[p*4] = 255; dd[p*4+1] = 40; dd[p*4+2] = 40; }
                        else if (m === 2) { dd[p*4] = 255; dd[p*4+1] = 190; dd[p*4+2] = 40; }
                        else if (m === 1) { dd[p*4] = 40; dd[p*4+1] = 120; dd[p*4+2] = 255; }
                        else if (m === 4) { dd[p*4] = 70; dd[p*4+1] = 70; dd[p*4+2] = 90; }
                        else { dd[p*4] = d[s]*0.3; dd[p*4+1] = d[s+1]*0.3; dd[p*4+2] = d[s+2]*0.3; }
                        dd[p*4+3] = 255; }
                    c2.putImageData(id2, 0, 0); unpPng = cv2.toDataURL('image/png');
                }
            }
            isSweeping = false;
            return { W, Hh, rect: [x0,y0,x1,y1], area, placeholder: 100*placeholder/area, dark: 100*dark/area, png: cv.toDataURL('image/png'), unp, unpPng };
        }, [fx, fy, ARM_DEFS[arm], mode, RECT, UNPAINTED_FN, TS]);
        if (!RECT) { RECT = r.rect; console.log('  content rect ' + JSON.stringify(RECT) + ' = ' + r.area + ' px (' + (100*r.area/(r.W*r.Hh)).toFixed(1) + '% of the canvas)'); }
        // A134: AN ARM THAT DID NOT DIVERGE IS NOT A RESULT. The fold arm silently matched `off` byte for byte on the
        // first run because it was armed with one uniform instead of four; nothing in the numbers looked wrong. Every
        // non-off arm is now compared against off's frame at the same pose and mode, and a match is reported loudly.
        const key = mode + '_' + fx + '_' + fy;
        if (arm === 'off') BASE[key] = r.png;
        else if (BASE[key] && BASE[key] === r.png)
            console.log('  !! ARM DID NOT DIVERGE: ' + arm + ' at ' + fx + ':' + fy + ' (' + mode + ') renders IDENTICALLY to off. ' +
                        'Its row below is not a measurement of the arm. Check the uniforms it needs.');
        const stem = arm + '_' + mode + '_' + String(fx).replace('-', 'm') + '_' + String(fy).replace('-', 'm');
        fs.writeFileSync(path.join(OUT, stem + '.png'), Buffer.from(r.png.split(',')[1], 'base64'));
        if (r.unpPng) fs.writeFileSync(path.join(OUT, 'leak_' + stem + '.png'), Buffer.from(r.unpPng.split(',')[1], 'base64'));
        return r;
    };

    // A render is ~80 s on SwiftShader, so the SD check view (which only supplies the placeholder column) is taken for a
    // named subset of arms rather than all of them. The assertion split is the score; placeholder is context.
    const SDARMS = (process.env.SD || 'off').split(',');
    const rows = [];
    for (const arm of ARMS) for (const [fx, fy] of poses) {
        const plain = await shot(fx, fy, arm, 'plain');
        const sd = SDARMS.includes(arm) ? await shot(fx, fy, arm, 'sd') : { placeholder: NaN };
        const u = plain.unp, bounded = Math.max(0, u.hole - (u.unbounded || 0));
        rows.push({ arm, fx, fy, placeholder: +sd.placeholder.toFixed(3), dark: +plain.dark.toFixed(3),
                    holePct: +(100*u.hole/u.area).toFixed(4), unbounded: u.unbounded, bounded,
                    boundedPct: +(100*bounded/u.area).toFixed(4),
                    leak: u.leak, genuine: u.genuine, T: u.T, area: u.area });
        console.log('  ' + arm.padEnd(6) + ' ' + String(fx + ':' + fy).padEnd(7) +
                    ' placeholder ' + (isNaN(sd.placeholder) ? '    -  ' : sd.placeholder.toFixed(3).padStart(7)) + '%  hole ' + (100*u.hole/u.area).toFixed(3).padStart(7) +
                    '%  bounded ' + (100*bounded/u.area).toFixed(4).padStart(8) + '%  leak(T=' + u.T.join('/') + ') ' + u.leak.join(' / '));
    }

    // ---- the tables ----
    const byPose = {}; for (const r of rows) (byPose[r.fx + ':' + r.fy] = byPose[r.fx + ':' + r.fy] || []).push(r);
    console.log('\n  THE SWEEP. Every figure is a share of the rest-pose content rectangle, except leak/genuine which are');
    console.log('  COUNTS of unpainted pixels. "bounded" excludes the beyond-frame class, so it is the hole that is really');
    console.log('  a hole. The stopping rule: tighten while the marginal hole is GENUINE; stop when it becomes LEAK.');
    for (const p of Object.keys(byPose)) {
        console.log('\n  pose ' + p);
        console.log('    ' + 'arm'.padEnd(7) + 'placeholder%   hole%  bounded%   unbnd  ' + TS.map(t => ('leak T=' + t).padStart(10)).join('') + '   ' + TS.map(t => ('genuine T=' + t).padStart(13)).join(''));
        const base = byPose[p].find(r => r.arm === 'off');
        for (const r of byPose[p]) {
            console.log('    ' + r.arm.padEnd(7) + (isNaN(r.placeholder) ? '       -   ' : r.placeholder.toFixed(3).padStart(11)) + r.holePct.toFixed(3).padStart(8) +
                        r.boundedPct.toFixed(4).padStart(10) + String(r.unbounded).padStart(8) + '  ' +
                        TS.map((t, k) => String(r.leak[k]).padStart(10)).join('') + '   ' +
                        TS.map((t, k) => String(r.genuine[k] - (r.unbounded || 0)).padStart(13)).join('') +
                        (base && r.arm !== 'off' ? '   (vs off: bounded ' + (r.bounded - base.bounded >= 0 ? '+' : '') + (r.bounded - base.bounded) +
                         ' px, of which leak ' + (r.leak[0] - base.leak[0] >= 0 ? '+' : '') + (r.leak[0] - base.leak[0]) + ')' : ''));
        }
    }
    fs.writeFileSync(path.join(OUT, 'sweep.json'), JSON.stringify({ meta, arms: ARMS, poses, rows }, null, 1));
    console.log('\n  -> ' + OUT);
    await browser.close(); try { srv.kill(); } catch (e) {}
})();
