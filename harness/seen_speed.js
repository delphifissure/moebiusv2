// S70: time the emergence test (bgSeenEmergence) on one bake; optionally compare against a saved result for identity.
//   COLOR= DEPTH= TAG= [PORT=8134] [SAVE=1] node harness/seen_speed.js   -> harness/shots/seen/<TAG>_speed.json (+ _dem.bin with SAVE)
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const H = __dirname, WT = path.resolve(H, '..'), PORT = +(process.env.PORT || 8134), TAG = process.env.TAG || 'x', OUT = path.join(H, 'shots', 'seen');
(async () => {
    fs.copyFileSync(path.resolve(WT, process.env.COLOR || 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, process.env.DEPTH || 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(PORT) }) }); await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    await page.goto('http://localhost:' + PORT + '/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { if (await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth && mediaLayers[0]._depth16); } catch (e) { return false; } }).catch(() => false)) break; await new Promise(r => setTimeout(r, 1000)); }
    await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} const el = document.getElementById('bgPlateHoleSel'); el.value = 'source'; el.dispatchEvent(new Event('change')); document.getElementById('bgLayerBuildBtn').click(); });
    for (let t = 0; t < 2400; t++) { if (await page.evaluate(() => !!window._bgQuickBaked && !!window._qbSourceHole && !window._qbSourceHoleBusy && !!window._qbSrcHoleArgs)) break; await new Promise(r => setTimeout(r, 500)); }
    const R = await page.evaluate((coarse) => {
        const o = window._qbSrcHoleArgs, N = o.pw * o.ph, t0 = performance.now();
        const r = bgSourceHole(Object.assign({}, o, { seenMode: 'exact', seenReport: true, seenCoarse: coarse })); const ms = performance.now() - t0;
        const dem = r.stats.seenDem, cand = r.stats.seenCand0; const d = new Uint8Array(N); let n = 0; for (let i = 0; i < N; i++) { d[i] = dem[i] && cand[i] ? 1 : 0; n += d[i]; }
        let s = ''; for (let i = 0; i < N; i += 0x8000) s += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000));
        return { exact: r.stats.seenExact, seen: n, holeTexels: (() => { let k = 0; for (let i = 0; i < N; i++) k += r.hole[i] ? 1 : 0; return k; })(), msTotal: Math.round(ms), dem: btoa(s) };
    }, +(process.env.COARSE || 4));
    const dem = Buffer.from(R.dem, 'base64'); delete R.dem;
    const ref = path.join(OUT, TAG + '_dem_ref.bin');
    if (process.env.SAVE) fs.writeFileSync(ref, dem);
    else if (fs.existsSync(ref)) { const a = fs.readFileSync(ref); let onlyNew = 0, onlyRef = 0; for (let i = 0; i < a.length; i++) { if (dem[i] && !a[i]) onlyNew++; if (a[i] && !dem[i]) onlyRef++; } R.vsRef = { onlyNew, onlyRef }; }
    fs.writeFileSync(path.join(OUT, TAG + '_c' + (process.env.COARSE || 4) + '_speed.json'), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R));
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
