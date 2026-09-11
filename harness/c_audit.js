// C audit (SD hand-off): plane bake exactly as the S6 panel's Build does, then (1) the SD Bundle export captured to disk,
// (2) the SD-regions view at several poses (tinted-pixel counts + frames), and (3) when the build has it, the
// placeholder-only view (u_sdPaintOnly) at the same poses so tint == placeholder can be checked pixel for pixel.
//   IMG=color,depth TAG=... FLAGS=k=v,... POSES="0:0,0.6:0,1:-0.5" OUT=<dir> node harness/c_audit.js
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = __dirname, WT = path.resolve(__dirname, '..');
const OUT = process.env.OUT || path.join(__dirname, 'shots', 'c_audit', process.env.TAG || 'troll');
(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    if (process.env.IMG) { const [c, d] = process.env.IMG.split(','); fs.copyFileSync(path.resolve(WT, c), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, d), path.join(H, 'defaultImgDepth.png')); }
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    page.on('console', m => { const t = m.text(); if (/SD-BUNDLE|SD-REGIONS|\[S6\] plate|\[S4\]|\[S2c\]|\[S5\] wash|\[C\]|FAILED|rror/.test(t)) console.log('  [page:log] ' + t.slice(0, 300)); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r2 => setTimeout(r2, 1000)); }
    const meta = await page.evaluate(async (o) => {
        window._rayReproject = true;
        if (o.depth) { if (o.depth.outer !== undefined) outerVolumeDepth = o.depth.outer; if (o.depth.inner !== undefined) innerVolumeDepth = o.depth.inner; if (o.depth.pn !== undefined) currentNormPortalPlane = o.depth.pn; }
        // the panel's plane recipe (bakePlate): selects -> flags, then the geometric bake
        const sel = { bgPlateFarSel: 'plane', bgPlateFillSel: 'wash', bgPlateMarginSel: 'picture', bgPlateFacesSel: 'off', bgPlateBandSel: o.tier || '35', bgPlateSkySel: o.sky ? 'on' : 'off', bgPlateSeamSel: 'stretched', bgPlateJoinSel: 'off' };
        for (const id in sel) { const el = document.getElementById(id); if (el) el.value = sel[id]; }
        if (window._applyPlateOptions) window._applyPlateOptions();
        if (o.flags) for (const f of o.flags) { const [k, v] = f.split('='); window[k] = (v === undefined) ? true : (isNaN(+v) ? v : +v); }
        window._plugObjectRule = false; window._plugExtent = null; window._geoLipSeed = false; window._plugBack = false; window._plateFlushExempt = true;
        const modeSel3 = document.getElementById('bgModeSel'); if (modeSel3) modeSel3.value = 'quick'; bgQuickBake = true; window._bgBakeMode = 'quick';
        const t0 = Date.now(); window._plugGeoBand({ flush: true, observed: true, gateAPriori: true }); window._bgUserBuiltOnce = true;
        const sz = window._qbSize;
        return { pw: sz && sz.pw, ph: sz && sz.ph, bakeMs: Date.now() - t0, opts: window._bgPlateOptions, farRule: window._farRule, tearLaw: window._tearLaw, skyInf: window._skyInf, plate2: !!(bgLayerMesh && bgLayerMesh.userData.plate2), sky: !!(bgLayerMesh && bgLayerMesh.userData.sky), steps: !!(bgLayerMesh && bgLayerMesh.userData.steps), ring: !!(bgLayerMesh && bgLayerMesh.userData.ring), cloneCount: window._qbCloneCount, dirExport: !!(typeof bgDirectionalExport !== 'undefined' && bgDirectionalExport), extExport: !!(typeof bgExtendExport !== 'undefined' && bgExtendExport), build: MOEBIUS_BUILD };
    }, { flags: process.env.FLAGS ? process.env.FLAGS.split(',') : null, sky: !!process.env.SKY, tier: process.env.TIER,
         depth: process.env.DEPTH_OUTER ? { outer: +process.env.DEPTH_OUTER, inner: +(process.env.DEPTH_INNER || 0.0001), pn: +(process.env.DEPTH_PN || 0.5) } : null });
    console.log('bake: ' + JSON.stringify(meta));
    fs.writeFileSync(path.join(OUT, 'bake.json'), JSON.stringify(meta, null, 1));
    // (1) the bundle, captured instead of downloaded
    const zb = await page.evaluate(() => {
        const alerts = []; const realAlert = window.alert; window.alert = (m) => alerts.push(String(m));
        let href = null, name = null; const realClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () { href = this.href; name = this.download; };
        let threw = null; try { exportSDBundle(); } catch (e) { threw = String(e && e.stack || e); }
        HTMLAnchorElement.prototype.click = realClick; window.alert = realAlert;
        return { alerts, threw, name, b64: href ? href.split(',')[1] : null };
    });
    if (zb.b64) { fs.writeFileSync(path.join(OUT, 'bundle.zip'), Buffer.from(zb.b64, 'base64')); console.log('bundle: ' + zb.name + ' ' + Math.round(zb.b64.length * 3 / 4 / 1024) + ' KB'); }
    else console.log('bundle: NONE  alerts=' + JSON.stringify(zb.alerts) + ' threw=' + zb.threw);
    // (2)+(3) the views
    const poses = (process.env.POSES || '0:0,0.6:0,1:-0.5').split(',').map(s => s.split(':').map(Number));
    const shot = async (fx, fy, mode) => {
        const r = await page.evaluate(async ([fx, fy, mode]) => {
            const chk = document.getElementById('sdRegionsChk');
            const want = mode !== 'plain';
            if (chk && chk.checked !== want) { chk.checked = want; chk.dispatchEvent(new Event('change')); }
            window._sdPaintOnlyView = (mode === 'paint');
            if (typeof window._applySdPaintOnly === 'function') window._applySdPaintOnly(mode === 'paint');
            if (typeof updateVolumeGuidesVisibility === 'function') updateVolumeGuidesVisibility(false);
            isSweeping = true;
            const D = Math.abs(camera.position.z - portalPlaneWorldZ); const exR = D * Math.tan(bgViewFadeEndDeg * Math.PI / 180);
            camera.position.x = fx * exR; camera.position.y = fy * exR * bgEnvAspect();
            updateCameraAndProjection(); render(); updateCameraAndProjection(); render();
            const W = renderer.domElement.width, Hh = renderer.domElement.height;
            const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
            const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
            const d = cx.getImageData(0, 0, W, Hh).data;
            const n = { orange: 0, cyan: 0, blue: 0, teal: 0, magenta: 0, white: 0, black: 0, other: 0 };
            for (let i = 0; i < W * Hh; i++) {
                const R = d[i*4], G = d[i*4+1], B = d[i*4+2];
                if (mode === 'paint') { if (R > 200 && G > 200 && B > 200) n.white++; else if (R < 40 && G < 40 && B < 40) n.black++; else n.other++; continue; }
                if (R > 150 && G > 60 && G < 170 && B < 90) n.orange++;
                else if (B > 150 && G > 120 && R < 120) n.cyan++;
                else if (R > 150 && B > 150 && G < 120) n.magenta++;
                else if (B > 130 && G < 120 && R < 120) n.blue++;
                else if (G > 120 && B > 100 && R < 90 && G > B) n.teal++;
                else n.other++;
            }
            isSweeping = false;
            return { W, Hh, n, png: cv.toDataURL('image/png') };
        }, [fx, fy, mode]);
        const tag = mode + '_' + String(fx).replace('-', 'm') + '_' + String(fy).replace('-', 'm');
        fs.writeFileSync(path.join(OUT, tag + '.png'), Buffer.from(r.png.split(',')[1], 'base64'));
        const tot = r.W * r.Hh; const pct = {}; for (const k in r.n) pct[k] = +(100 * r.n[k] / tot).toFixed(2);
        console.log('  ' + tag + ': ' + JSON.stringify(pct));
        return pct;
    };
    const res = {};
    for (const [fx, fy] of poses) { res['plain_' + fx + '_' + fy] = await shot(fx, fy, 'plain'); res['sd_' + fx + '_' + fy] = await shot(fx, fy, 'sd'); if (process.env.PAINT) res['paint_' + fx + '_' + fy] = await shot(fx, fy, 'paint'); }
    fs.writeFileSync(path.join(OUT, 'views.json'), JSON.stringify(res, null, 1));
    // DUMP=1: the bake's arrays (the a257 list) so the bundle can be checked against the same bake, file by file
    if (process.env.DUMP) {
        const arrays = { dQ: '_qbDQ', plateF: '_qbPlateF', disocc: '_qbDisocc', carrier: '_qbCarrier', carrier2: '_qbCarrier2', plateColor: '_qbPlateColor', plateF2: '_qbPlateF2', plateColor2: '_qbPlateColor2', plate2Has: '_qbPlate2Has', platePaint: '_qbPlatePaint', bandPose: '_qbBandPose', bandTier: '_qbBandTier', plateTorn: '_qbPlateTorn', skyColor: '_qbSkyColor', farField: '_geoFarField', farField2: '_geoFarField2' };
        for (const [name, key] of Object.entries(arrays)) {
            const b64 = await page.evaluate((k) => { const a = window[k]; if (!a) return null; const u8 = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return { b64: btoa(s), type: a.constructor.name }; }, key);
            if (!b64) { console.log('  missing ' + key); continue; }
            const ext = { Float32Array: 'f32', Uint8Array: 'u8', Uint8ClampedArray: 'u8', Int32Array: 'i32', Int16Array: 'i16', Uint16Array: 'u16' }[b64.type] || 'bin';
            fs.writeFileSync(path.join(OUT, name + '.' + ext), Buffer.from(b64.b64, 'base64'));
        }
        const extra = await page.evaluate(() => ({ skyQ: bgSkyQ(), skyOn: bgSkyInfOn(), margin: window._qbMargin || null, plugMargin: window._plugMargin || 0, tierDeg: window._bandTierDeg || 0, cloneCount: window._qbCloneCount }));
        fs.writeFileSync(path.join(OUT, 'dump.json'), JSON.stringify(extra));
        console.log('  dumped arrays + dump.json');
    }
    await browser.close(); srv.kill(); console.log('done ' + OUT);
})();
