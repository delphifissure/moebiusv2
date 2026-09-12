// UI-PATH SHOTS: the user's route, not the flag route. Sets the six plate selects, clicks the real Build button, waits for
// the bake, then shoots at eye offsets IN METRES (what a drag sets: camera.position.x = manualCamDX). Optionally changes one
// select afterwards (the change listener re-bakes) and shoots again.
//   IMG=color,depth TAG=ui_wash OPTS=plane,wash,picture,off,35,off OFFS=0.05:0,0.1:0,0.2:0,0.301:0.068,0.26:0.088 [THEN=fill=mirror] node harness/ui_path.js
const { chromium } = require('playwright-core');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'; const fs = require('fs'), path = require('path'); const { spawn } = require('child_process');
const H = __dirname; const [color, depth] = (process.env.IMG || 'defaultImgColor.png,defaultImgDepth.png').split(',');
for (const [src, dst] of [[color, 'defaultImgColor.png'], [depth, 'defaultImgDepth.png']]) fs.copyFileSync(path.resolve(src), path.join(H, dst));
const OUT = path.join(H, 'shots', 'ui_path', process.env.TAG || 'run'); fs.mkdirSync(OUT, { recursive: true });
(async () => {
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1200));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    page.on('console', m => { const t = m.text(); if (/\[S6\]|\[S7\]|\[S9\]|\[S10\]|\[S13\]|despeckle|\[S14\]|\[S5\]|\[S3\] far side|A245 plug margin|QUICK-BAKE\] (a126|a162|A21[26]|all-viewpoint)|\[S2b\] sweep|failed|rror/.test(t)) console.log('  [page:log] ' + t.slice(0, 260)); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth && window._bakePlate); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r2 => setTimeout(r2, 1000)); }
    const opts = (process.env.OPTS || 'plane,wash,picture,off,35,off').split(',');
    const OFFS = (process.env.OFFS || '0.05:0,0.1:0,0.2:0,0.301:0.068').split(',').map(s => s.split(':').map(Number));
    const bakeViaUI = async (setSel) => {
        await page.evaluate((o) => { const ids = ['bgPlateFarSel', 'bgPlateFillSel', 'bgPlateMarginSel', 'bgPlateFacesSel', 'bgPlateBandSel', 'bgPlateSkySel', 'bgPlateSeamSel', 'bgPlateJoinSel'];   // OPTS may give 6 or 8 (seams, join)
            if (o.opts) ids.forEach((id, i) => { if (o.opts[i] !== undefined && document.getElementById(id)) document.getElementById(id).value = o.opts[i]; });
            window._plugSweepCapture = true; if (o.env) bgViewFadeEndDeg = o.env;
            if (o.flags) for (const f of o.flags) { const [k, v] = f.split('='); window[k] = (v === undefined) ? true : (isNaN(+v) ? v : +v); }   // FLAGS=_plateStretchInner=1: window flags the panel has no select for yet   // ENV=60: bake the geometry to a wider envelope (the fade stays a design choice)
            if (!window._uiBakeWrapped) { const orig = window._plugGeoBand; window._plugGeoBand = function () { const r = orig.apply(this, arguments); window._uiBakeCount = (window._uiBakeCount || 0) + 1; return r; }; window._uiBakeWrapped = true; }
            window._uiBakeTarget = (window._uiBakeCount || 0) + 1;
            if (o.change) { const [k, v] = o.change.split('='); const id = { far: 'bgPlateFarSel', fill: 'bgPlateFillSel', margin: 'bgPlateMarginSel', faces: 'bgPlateFacesSel', band: 'bgPlateBandSel', sky: 'bgPlateSkySel', seams: 'bgPlateSeamSel', join: 'bgPlateJoinSel' }[k]; const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('change')); }
            else document.getElementById('bgLayerBuildBtn').click(); }, setSel);
        const t0 = Date.now(); let done = false; for (let t = 0; t < 600 && !done; t++) { done = await page.evaluate(() => (window._uiBakeCount || 0) >= window._uiBakeTarget).catch(() => false); if (!done) await new Promise(r2 => setTimeout(r2, 1000)); } if (!done) console.log('  BAKE DID NOT COMPLETE (no _plugGeoBand call within 600 s)');
        console.log('  bake via UI done in ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s; selects now: ' + await page.evaluate(() => ['bgPlateFarSel', 'bgPlateFillSel', 'bgPlateMarginSel', 'bgPlateFacesSel', 'bgPlateBandSel', 'bgPlateSkySel'].map(id => JSON.stringify(document.getElementById(id).value)).join(' ')));
    };
    const shoot = async (suffix) => {
        const res = await page.evaluate((offs) => { isSweeping = true; const D = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2; const out = { D, exR: D * Math.tan(bgViewFadeEndDeg * Math.PI / 180), asp: bgEnvAspect(), W: renderer.domElement.width, H: renderer.domElement.height, shots: {} };
            for (const [dx, dy] of offs) { camera.position.set(dx, dy, D); render(); render(); out.shots[dx + ':' + dy] = renderer.domElement.toDataURL('image/png'); }
            camera.position.set(0, 0, D); render(); isSweeping = false; return out; }, OFFS);
        for (const [k, v] of Object.entries(res.shots)) { const f = path.join(OUT, 'off_' + k.replace(':', '_') + suffix + '.png'); fs.writeFileSync(f, Buffer.from(v.split(',')[1], 'base64')); }
        console.log('  meta ' + JSON.stringify({ D: res.D, exR: res.exR, asp: res.asp, W: res.W, H: res.H }) + ' shots ' + Object.keys(res.shots).join(' ') + suffix);
    };
    await bakeViaUI({ opts, env: process.env.ENV ? +process.env.ENV : 0, flags: process.env.FLAGS ? process.env.FLAGS.split(',') : null }); await shoot('');
    if (process.env.THEN) { await bakeViaUI({ change: process.env.THEN, env: process.env.ENV ? +process.env.ENV : 0, flags: process.env.FLAGS ? process.env.FLAGS.split(',') : null }); await shoot('_then'); }
    await browser.close(); srv.kill(); console.log('UI PATH DONE'); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
