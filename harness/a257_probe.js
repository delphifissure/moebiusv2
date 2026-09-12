// A257 back-layer probe: bake with the given flags and dump the back-layer arrays (back depth, mode,
// central plane, half thickness, BFS distance), the source depth, the a-priori far field and the object ids,
// so the back can be inspected offline (a196 rule: look at the buffer).
//   FLUSH=1 GEO=1 OBS=1 GATEA=1 FLAGS=... OUT=<dir> node harness/a257_probe.js
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = __dirname, WT = path.resolve(__dirname, '..');
const OUT = process.env.OUT || path.join(__dirname, 'shots', 'a257probe', process.env.TAG || 'troll');
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
    page.on('console', m => { const t = m.text(); if (/A25[2-7]\]|A246\]|A244\]|\[S3\]|\[S4\]|\[S5\]|\[S6\]|\[S7\]|\[S9\]|\[S10\]|\[S13\]|despeckle|a89:|\[S2[bc]\]|FAILED|rror/.test(t)) console.log('  [page:log] ' + t.slice(0, 400)); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r2 => setTimeout(r2, 1000)); }
    const meta = await page.evaluate(async (o) => {
        window._rayReproject = true; window._plugSweepCapture = true; window._plugCarve = false;
        if (o.flush) window._plateFlushExempt = true;
        // truthkit scenes carry their own depth mapping (meta.json outer/inner/pn); apply it before the bake
        if (o.depth) { if (o.depth.outer !== undefined) outerVolumeDepth = o.depth.outer; if (o.depth.inner !== undefined) innerVolumeDepth = o.depth.inner; if (o.depth.pn !== undefined) currentNormPortalPlane = o.depth.pn; }
        if (o.flags) for (const f of o.flags) { const [k, v] = f.split('='); window[k] = (v === undefined) ? true : (isNaN(+v) ? v : +v); }
        if (o.envDeg) { bgViewFadeEndDeg = o.envDeg; }   // S6: the horizontal envelope half-angle for the +-30 degree measurement (a top-level let, not a window flag)
        window._plugGeoBand({ flush: !!o.flush, observed: !!o.obs, gateAPriori: !!o.gateA });
        const sz = window._qbSize; return { pw: sz.pw, ph: sz.ph, rimT: (typeof window._geoRimT === 'number') ? window._geoRimT : null, outer: outerVolumeDepth, inner: innerVolumeDepth, pn: currentNormPortalPlane, D: Math.abs(camera.position.z - portalPlaneWorldZ), terrariumWidth, terrariumHeight, cloneCount: (typeof window._qbCloneCount === 'number') ? window._qbCloneCount : null, cloneCountFinal: (typeof window._qbCloneCountFinal === 'number') ? window._qbCloneCountFinal : null, stepPairs: window._geoStepRims ? (window._geoStepRims.length >> 1) : null, ground: window._geoGround || null };
    }, { flush: !!process.env.FLUSH, obs: !!process.env.OBS, gateA: !!process.env.GATEA, flags: process.env.FLAGS ? process.env.FLAGS.split(',') : null, envDeg: process.env.ENV_DEG ? +process.env.ENV_DEG : 0,
         depth: process.env.DEPTH_OUTER ? { outer: +process.env.DEPTH_OUTER, inner: +(process.env.DEPTH_INNER || 0.0001), pn: +(process.env.DEPTH_PN || 0.5) } : null });
    fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(meta));
    const arrays = { backDepth: '_geoBackDepth', backMode: '_geoBackMode', backPlane: '_geoBackPlane', backH: '_geoBackH', backDist: '_geoBackDist', dQ: '_qbDQ', farField: '_geoFarField', objId: '_geoObjId', plateF: '_qbPlateF', disocc: '_qbDisocc', geoClass: '_geoClass', obsDepth: '_geoObsDepth', obsCount: '_geoObsCount', lipDeep: '_geoLipDeep', lipNear: '_geoLipNear', fgTorn: '_qbFgTorn', farKind: '_geoFarKind', farAxis: '_geoFarAxis', skyClass: '_geoSkyClass', plateColor: '_qbPlateColor', farField2: '_geoFarField2', plateF2: '_qbPlateF2', plateColor2: '_qbPlateColor2', carrier: '_qbCarrier', carrier2: '_qbCarrier2', bandPose: '_qbBandPose', bandTier: '_qbBandTier', plateTorn: '_qbPlateTorn', farRimJ: '_geoFarRimJ', farMix: '_geoFarMix', farDisp: '_geoFarDisp', zeLut: '_geoZeLut', farRimW: '_geoFarRimW', farM: '_geoFarM', farCut: '_geoFarCut', farAxV: '_geoFarAxV', farAxS: '_geoFarAxS', farDisp2: '_geoFarDisp2', farRimJ2: '_geoFarRimJ2', farSide2: '_geoFarSide2', groundTex: '_geoGroundTex', groundCol: '_geoGroundCol', platePaint: '_qbPlatePaint', plate2Has: '_qbPlate2Has' };   // C: placeholder classes, plate-2 set   // S6: first-uncover pose fraction per band texel, and the chosen tier   // S5: carriers (plate vertices at far depth) vs disocc (the texture band)   // S3: farKind/farAxis from the plane far side
    for (const [name, key] of Object.entries(arrays)) {
        const b64 = await page.evaluate((k) => { const a = window[k]; if (!a) return null; const u8 = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return { b64: btoa(s), type: a.constructor.name }; }, key);
        if (!b64) { console.log('  missing ' + key); continue; }
        const ext = { Float32Array: 'f32', Uint8Array: 'u8', Uint8ClampedArray: 'u8', Int32Array: 'i32', Int16Array: 'i16', Uint16Array: 'u16' }[b64.type] || 'bin';
        fs.writeFileSync(path.join(OUT, name + '.' + ext), Buffer.from(b64.b64, 'base64')); console.log('  wrote ' + name + '.' + ext);
    }
    // S2b per-pose class maps: POSES="fx:fy,fx:fy" (fractions of the rim); each pose's cell classes + reveal texels
    if (process.env.POSES) {
        for (const ps of process.env.POSES.split(',')) {
            const [fx, fy] = ps.split(':').map(Number);
            const r = await page.evaluate(([fx, fy]) => {
                const D = Math.abs(camera.position.z - portalPlaneWorldZ); const exR = D * Math.tan(bgViewFadeEndDeg * Math.PI / 180);
                const s = window._plugCpuSweep({ poses: [[fx * exR, fy * exR * bgEnvAspect()]], classMap: true, revealDemand: true, farField: window._geoFarField, observe: true });
                let nRev = 0; for (let i = 0; i < s.N; i++) nRev += s.revealTex[i];
                const u8 = s.revealTex; let str = ''; for (let i = 0; i < u8.length; i += 0x8000) str += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
                return { png: s.classMap, holeCells: s.holeCells, revealIn: s.revealIn, revealOut: s.revealOut, nRev, obs: s.obs ? { samples: s.obs.samples, geo: s.obs.geo, self: s.obs.self, out: s.obs.out, ambiguous: s.obs.ambiguous } : null, rev: btoa(str) };
            }, [fx, fy]);
            const tag = 'pose_' + ps.replace(':', '_').replace(/-/g, 'm');
            fs.writeFileSync(path.join(OUT, tag + '.png'), Buffer.from(r.png.split(',')[1], 'base64'));
            fs.writeFileSync(path.join(OUT, tag + '_reveal.u8'), Buffer.from(r.rev, 'base64'));
            console.log('  pose ' + ps + ': hole cells ' + r.holeCells + ', reveal cells in/out ' + r.revealIn + '/' + r.revealOut + ', reveal texels ' + r.nRev + ', obs ' + JSON.stringify(r.obs));
        }
    }
    await browser.close(); srv.kill(); console.log('done ' + OUT);
})();
