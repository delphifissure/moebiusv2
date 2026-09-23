// S59 follow-ons, run AFTER the A/B renders (they share port 8099).
//  1. LIVE_PASS §10 D: today's app exactly as a user sees it (start-up defaults, its own wash, plate 2 visible) at the
//     A/B's poses, to set against the A/B frames' membrane wash.
//  2. Where the bake's time goes: a CPU profile of Build (Chrome DevTools Protocol), top functions by self time, and the
//     bake's wall time.
//   COLOR= DEPTH= TAG= PROFILE=1 node harness/bake_today.js
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const H = __dirname, WT = path.resolve(__dirname, '..'); const TAG = process.env.TAG || 'troll'; const OUT = path.join(H, 'shots', 'sheet_ab', 'today_' + TAG); fs.mkdirSync(OUT, { recursive: true });
const Z = 0.2, T = (deg) => Z * Math.tan(deg * Math.PI / 180);
const POSES = [['yawR42', 0.180, 0.008], ['yawL42', -0.180, 0.008], ['yaw22', T(22.5), 0], ['pitch30', 0, T(30)]];
(async () => {
    fs.copyFileSync(path.resolve(WT, process.env.COLOR || 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, process.env.DEPTH || 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1500));
    { const r = await fetch('http://localhost:8099/__root').then(x => x.text()).catch(() => ''); if (r !== H) { console.error('ABORT: port 8099 is served from ' + (r.slice(0, 80) || 'nothing') + ', not this tree (' + H + ')'); srv.kill(); process.exit(4); } }
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
    let cdp = null; if (process.env.PROFILE) { cdp = await page.context().newCDPSession(page); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }); await cdp.send('Profiler.start'); }
    const t0 = Date.now();
    await page.evaluate(() => document.getElementById('bgLayerBuildBtn').click());
    for (let t = 0; t < 640; t++) { if (await page.evaluate(() => !!window._bgQuickBaked && !!window._qbPlateF)) break; await new Promise(r => setTimeout(r, 500)); }
    const bakeMs = Date.now() - t0; console.log('bake wall ms ' + bakeMs);
    if (cdp) {
        const { profile } = await cdp.send('Profiler.stop'); const self = new Map(); const byId = new Map(profile.nodes.map(n => [n.id, n]));
        const dt = profile.timeDeltas; const cnt = new Map(); for (let i = 0; i < profile.samples.length; i++) cnt.set(profile.samples[i], (cnt.get(profile.samples[i]) || 0) + (dt[i] || 0));
        for (const [id, us] of cnt) { const n = byId.get(id); const cf = n.callFrame; const k = (cf.functionName || '(anon)') + ' ' + path.basename(cf.url || '') + ':' + (cf.lineNumber + 1); self.set(k, (self.get(k) || 0) + us); }
        const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, us]) => ({ fn: k, ms: Math.round(us / 1000) }));
        fs.writeFileSync(path.join(OUT, 'profile_top.json'), JSON.stringify({ bakeMs, top }, null, 1)); console.log(JSON.stringify(top.slice(0, 12)));
    }
    // the SD bundle as the app exports it (captured, not downloaded), for the SD premise test (task #66): S52 found the
    // Sprint 25 plane_color_occluder_removed.png + the band mask the best contract (PACO arm A)
    const zb = await page.evaluate(() => {
        const realAlert = window.alert; window.alert = () => {}; let href = null; const realClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () { href = this.href; };
        let threw = null; try { exportSDBundle(); } catch (e) { threw = String(e); }
        HTMLAnchorElement.prototype.click = realClick; window.alert = realAlert; return { threw, b64: href ? href.split(',')[1] : null };
    });
    if (zb.b64) { fs.writeFileSync(path.join(OUT, 'bundle.zip'), Buffer.from(zb.b64, 'base64')); console.log('bundle ' + Math.round(zb.b64.length * 0.75 / 1024) + ' KB'); }
    else console.log('bundle NONE ' + zb.threw);
    const shot = async (name) => { const b64 = await page.evaluate(() => { updateCameraAndProjection(); render(); updateCameraAndProjection(); render(); return renderer.domElement.toDataURL('image/png').split(',')[1]; }); fs.writeFileSync(path.join(OUT, name), Buffer.from(b64, 'base64')); };
    for (const [n, x, y] of POSES) { await page.evaluate(([x, y]) => { isSweeping = true; camera.position.set(x, y, 0.2); }, [x, y]); await shot('today_' + n + '.png'); }
    await browser.close(); srv.kill(); console.log('done ' + OUT);
})();
