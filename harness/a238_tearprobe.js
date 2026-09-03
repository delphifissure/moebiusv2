// A238 WHAT DOES THE PLUG HOLD INSIDE THE FOREGROUND'S OWN TEARS? For every
// texel the A212 pre-tear removes from the rendered foreground (a glancing
// self-occlusion gap or a silhouette fold), classify the plate under it:
//   clone      |plateF - dQ| <= 2 source quanta   (the near surface again; a126
//              then ramps it across the gap = a stretched sliver)
//   continued  plate farther than the source by more than that (the far side)
// and whether an a62 front (fold or object) claimed it. Also the same for the
// demand band. Bake only, no sweep: ~1 min per scene.
//   node harness/a238_tearprobe.js        IMG=..,.. TAG=.. FLUSH=1
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = __dirname, WT = path.resolve(__dirname, '..');
const TAG = process.env.TAG || 'troll';
(async () => {
    if (process.env.IMG) { const [c, d] = process.env.IMG.split(','); fs.copyFileSync(path.resolve(WT, c), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, d), path.join(H, 'defaultImgDepth.png')); }
    else { fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); }
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); } catch (e) {} });
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true,
        args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 200)));
    page.on('console', m => { const t = m.text(); if (/A212 FG pre-tear|fold tear|a162 cross|A238/.test(t)) console.log('  [page] ' + t.replace(/\s+/g, ' ').slice(0, 200)); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r2 => setTimeout(r2, 1000)); }
    const res = await page.evaluate(async (o) => {
        window._rayReproject = true; window._plugSweepCapture = true; window._srCapture = true; window._foldProbe = true; window._plugCarve = false;
        if (o.flush) window._plateFlushExempt = true;
        if (o.flags) for (const f of o.flags) { const [k, v] = f.split('='); window[k] = (v === undefined) ? true : (isNaN(+v) ? v : +v); }
        bgQuickBake = true; buildBackgroundLayer(); isSweeping = true;
        const sz = window._qbSize, dQ = window._qbDQ, pF = window._qbPlateF, torn = window._qbFgTorn, dis = window._qbDisocc, fp = window._fpData;
        if (!sz || !dQ || !pF || !torn || !dis) return { err: 'missing capture ' + [!!sz, !!dQ, !!pF, !!torn, !!dis] };
        const pw = sz.pw, ph = sz.ph, N = pw * ph;
        const q = 2 * ((typeof window._qbSrcQuantum === 'number' && window._qbSrcQuantum > 0) ? window._qbSrcQuantum : 1 / 255);
        const acc = () => ({ n: 0, clone: 0, cont: 0, nearer: 0, claimed: 0, fold: 0, sumDrop: 0 });
        const T = acc(), TnotD = acc(), Dm = acc();
        const add = (a, i, f) => { a.n++; const dd = pF[f] - dQ[i]; if (Math.abs(dd) <= q) a.clone++; else if (dd < 0) { a.cont++; a.sumDrop += -dd; } else a.nearer++;
            if (fp && fp.claimedF && fp.claimedF[i]) { a.claimed++; if (fp.foldF && fp.foldF[i]) a.fold++; } };
        for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const i = y * pw + x, f = (ph - 1 - y) * pw + x;
            if (torn[i]) { add(T, i, f); if (!dis[i]) add(TnotD, i, f); }
            if (dis[i]) add(Dm, i, f); }
        return { pw, ph, N, T, TnotD, Dm, tornN: T.n, disN: Dm.n };
    }, { flush: !!process.env.FLUSH, flags: (process.env.FLAGS || '').split(',').filter(Boolean) });
    if (res.err) { console.log('ERR ' + res.err); process.exit(1); }
    const pc = (a, b) => (100 * a / Math.max(1, b)).toFixed(1) + '%';
    const line = (name, a) => console.log('  ' + name.padEnd(30) + 'n=' + String(a.n).padStart(8) + '  clone ' + pc(a.clone, a.n).padStart(6) + '  far-continued ' + pc(a.cont, a.n).padStart(6) +
        ' (mean drop ' + (a.cont ? (a.sumDrop / a.cont).toFixed(3) : '-') + ')  plate NEARER ' + pc(a.nearer, a.n).padStart(6) + '  a62-claimed ' + pc(a.claimed, a.n).padStart(6) + ' (fold ' + pc(a.fold, a.n) + ')');
    console.log(TAG + (process.env.FLUSH ? ' [flush]' : '') + (process.env.FLAGS ? ' [' + process.env.FLAGS + ']' : '') + ': plate ' + res.pw + 'x' + res.ph + '; FG-torn texels ' + res.tornN + ' (' + pc(res.tornN, res.N) + '), demand ' + res.disN + ' (' + pc(res.disN, res.N) + ')');
    line('torn (all)', res.T); line('torn, outside demand', res.TnotD); line('demand band', res.Dm);
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
