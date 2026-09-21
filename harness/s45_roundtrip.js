// Sprint 25 — THE ROUND TRIP: bundle out, return in, on the live plate.
//
// Until now the hand-off was one-way for depth. This drives the whole loop headlessly on the shipped plane recipe:
//
//   1. bake with whatever the panel ships, then exportSDBundle() with the download intercepted -> the zip is decoded and
//      the Sprint 25 / S48 files are checked for presence, size and bit depth;
//   2. a RETURN IS SYNTHESISED from the bake's own band depth. There is no ground truth for a photograph's hidden
//      surfaces, so the thing under test here is the CONTRACT AND THE PLUMBING, not a model: take the baked band depth as
//      the target, corrupt it the way a model's output is corrupt (a constant bias plus per-texel noise), and hand the
//      corrupted values back. A contract that cannot recover a field it was handed a noisy copy of cannot recover one it
//      was handed a guess;
//   3. the three contract forms are applied in turn to a fresh bake each -- absolute only, gradient only, and the screened
//      combination the kit measurement chose -- and each is scored against the target over the band and at the seam;
//   4. the colour path is checked to write inside the inpaint mask and nowhere else.
//
//   IMG=color,depth TAG=... SKY=1 SIGMA=0.04 BIAS=0.02 OUT=<dir> node harness/s45_roundtrip.js
'use strict';
const { chromium } = require('playwright-core');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = __dirname, WT = path.resolve(__dirname, '..');
const OUT = process.env.OUT || path.join(H, 'shots', 's45_rt', process.env.TAG || 'troll');
const SIGMA = +(process.env.SIGMA || 0.04), BIAS = +(process.env.BIAS || 0.02);

const BAKE = async (page, o) => page.evaluate(async (o) => {
    window._rayReproject = true; window._depthContractUI = false;
    if (o.sky) { const el = document.getElementById('bgPlateSkySel'); if (el) el.value = 'on'; }
    if (window._applyPlateOptions) window._applyPlateOptions();
    if (o.flags) for (const f of o.flags) { const [k, v] = f.split('='); window[k] = (v === undefined) ? true : (isNaN(+v) ? v : +v); }
    window._plugObjectRule = false; window._plugExtent = null; window._geoLipSeed = false; window._plugBack = false; window._plateFlushExempt = true;
    const ms = document.getElementById('bgModeSel'); if (ms) ms.value = 'quick'; bgQuickBake = true; window._bgBakeMode = 'quick';
    const t0 = Date.now(); window._plugGeoBand({ flush: true, observed: true, gateAPriori: true }); window._bgUserBuiltOnce = true;
    return { bakeMs: Date.now() - t0, size: window._qbSize, band: window._qbDisocc ? window._qbDisocc.reduce((a, b) => a + (b ? 1 : 0), 0) : 0,
             paint: window._qbPlatePaint ? window._qbPlatePaint.reduce((a, b) => a + (b ? 1 : 0), 0) : 0 };
}, o);

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
    page.on('console', m => { const t = m.text(); if (/\[Sprint 25\]|\[S48\]|\[SD-BUNDLE\]|FAILED|rror/.test(t)) console.log('  [page] ' + t.slice(0, 300)); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r2 => setTimeout(r2, 1000)); }

    const opts = { sky: !!process.env.SKY, flags: process.env.FLAGS ? process.env.FLAGS.split(',') : null };
    const bake = await BAKE(page, opts);
    console.log('bake ' + bake.bakeMs + ' ms, ' + JSON.stringify(bake.size) + ', band ' + bake.band + ', inpaint mask ' + bake.paint);

    // ---- 1. the bundle ----
    const b64 = await page.evaluate(async () => {
        let url = null; const orig = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () { if (this.href && this.href.startsWith('data:')) url = this.href; else return orig.call(this); };
        try { exportSDBundle(); } finally { HTMLAnchorElement.prototype.click = orig; }
        for (let i = 0; i < 200 && !url; i++) await new Promise(r => setTimeout(r, 100));
        return url ? url.split(',')[1] : null;
    });
    if (!b64) { console.log('  BUNDLE: export produced no download'); }
    else {
        const zp = path.join(OUT, 'bundle.zip'); fs.writeFileSync(zp, Buffer.from(b64, 'base64'));
        const py = `
import zipfile, json, struct, sys
z = zipfile.ZipFile(${JSON.stringify(zp)})
names = sorted(z.namelist())
meta = json.loads(z.read('meta.json')) if 'meta.json' in names else {}
want = ['plane_reveal_px.png', 'plane_mask_context.png', 'plane_color_occluder_removed.png']
print('  bundle: %d files' % len(names))
for n in names:
    if not n.endswith('.png'):
        print('    %-40s %8d' % (n, z.getinfo(n).file_size)); continue
    b = z.read(n); bd = b[24]; ct = b[25]
    w, h = struct.unpack('>II', b[16:24])
    print('    %-40s %8d  %dx%d  %d-bit  type %d %s' % (n, len(b), w, h, bd, ct, '<-- NEW' if n in want else ''))
miss = [w for w in want if w not in names]
print('  MISSING: %s' % (miss if miss else 'none'))
p = meta.get('plane', {})
print('  meta.plane.reveal  = %s' % json.dumps(p.get('reveal'), indent=1)[:900])
print('  meta.plane.context = %s' % json.dumps(p.get('context')))
print('  meta.plane.returnContract keys = %s' % list((p.get('returnContract') or {}).keys()))
`;
        fs.writeFileSync(path.join(OUT, 'check.py'), py);
        try { console.log(execFileSync('python3', [path.join(OUT, 'check.py')], { encoding: 'utf8' })); }
        catch (e) { console.log('  bundle check failed: ' + e.message.slice(0, 300)); }
    }

    // ---- 2-3. the return, three forms ----
    const forms = [['absolute', { abs: true, grad: false }], ['gradient', { abs: false, grad: true }], ['both', { abs: true, grad: true }]];
    const results = [];
    for (const [name, f] of forms) {
        await BAKE(page, opts);   // a fresh bake each time: the reimport mutates the plate in place
        const r = await page.evaluate(async ([f, SIGMA, BIAS]) => {
            const sz = window._qbSize, pw = sz.pw, ph = sz.ph, N = pw * ph;
            const pF = window._qbPlateF, paint = window._qbPlatePaint, dis = window._qbDisocc;
            const flip = (i) => { const x = i % pw; return (ph - 1 - ((i - x) / pw)) * pw + x; };
            const mask = paint || dis; const band = new Uint8Array(N); let nB = 0;
            for (let i = 0; i < N; i++) if (mask[i]) { band[i] = 1; nB++; }
            // the target: the bake's own band depth, in source rows
            const tgt = new Float32Array(N); for (let i = 0; i < N; i++) tgt[i] = pF[flip(i)];
            // a deterministic corruption, so two runs are comparable
            let s = 12345; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s / 0x7fffffff) * 2 - 1; };
            const ret = new Float32Array(N); for (let i = 0; i < N; i++) ret[i] = tgt[i] + BIAS + SIGMA * rnd();
            // gradients of the SAME corrupted field, with their own independent noise -- which is the whole reason the
            // combination wins: a value measurement and a gradient measurement of one field carry independent error
            const gx = new Float32Array(N), gy = new Float32Array(N);
            for (let i = 0; i < N; i++) { const x = i % pw, y = (i - x) / pw;
                gx[i] = (x < pw - 1 ? tgt[i + 1] - tgt[i] : 0) + SIGMA * rnd() * 0.5;
                gy[i] = (y < ph - 1 ? tgt[i + pw] - tgt[i] : 0) + SIGMA * rnd() * 0.5; }
            const colour = new Uint8ClampedArray(4 * N); for (let i = 0; i < N; i++) { colour[i * 4] = 17; colour[i * 4 + 1] = 200; colour[i * 4 + 2] = 91; colour[i * 4 + 3] = 255; }
            const before = window._qbPlateColor ? window._qbPlateColor.slice() : null;
            const st = window._importPlaneReturn({ depth: f.abs ? ret : null, gx: f.grad ? gx : null, gy: f.grad ? gy : null,
                                                   color: colour, lam: f.abs && f.grad ? 1 : 0 });
            // score against the target over the band
            let se = 0, ae = 0, mx = 0;
            for (let i = 0; i < N; i++) if (band[i]) { const e = pF[flip(i)] - tgt[i]; se += e * e; ae += Math.abs(e); if (Math.abs(e) > mx) mx = Math.abs(e); }
            // the raw return's own error, for the ratio that says what the contract bought
            let rse = 0; for (let i = 0; i < N; i++) if (band[i]) { const e = ret[i] - tgt[i]; rse += e * e; }
            // colour: written inside the mask and NOWHERE else
            let inside = 0, outside = 0;
            if (before && window._qbPlateColor) for (let i = 0; i < N; i++) {
                const ch = (window._qbPlateColor[i * 4] !== before[i * 4]) || (window._qbPlateColor[i * 4 + 1] !== before[i * 4 + 1]) || (window._qbPlateColor[i * 4 + 2] !== before[i * 4 + 2]);
                if (ch) { if (band[i]) inside++; else outside++; } }
            return { st, nB, rmse: Math.sqrt(se / nB), mae: ae / nB, maxAbs: mx, rawRmse: Math.sqrt(rse / nB), colourInside: inside, colourOutside: outside };
        }, [f, SIGMA, BIAS]);
        results.push([name, r]);
        console.log('\n  form ' + name + ': ' + JSON.stringify(r.st.solve) + (r.st.shift ? ' shift ' + JSON.stringify(r.st.shift) : ''));
        console.log('    band RMSE in d ' + r.rmse.toFixed(5) + ' (the raw return was ' + r.rawRmse.toFixed(5) + ', so the contract is ' +
                    (r.rawRmse / Math.max(r.rmse, 1e-9)).toFixed(2) + 'x better), MAE ' + r.mae.toFixed(5) + ', max ' + r.maxAbs.toFixed(4));
        console.log('    seam ' + JSON.stringify(r.st.seam) + '   retear ' + JSON.stringify(r.st.retear));
        console.log('    colour written: ' + r.colourInside + ' inside the mask, ' + r.colourOutside + ' outside (must be 0)');
    }

    console.log('\n  THE CONTRACT, ON THIS PICTURE (bias ' + BIAS + ', sigma ' + SIGMA + ' in d; lower is better)');
    console.log('  ' + 'form'.padEnd(10) + 'band RMSE   vs raw   seam max |d|');
    for (const [n, r] of results) console.log('  ' + n.padEnd(10) + r.rmse.toFixed(5).padStart(9) + '   ' + (r.rawRmse / Math.max(r.rmse, 1e-9)).toFixed(2).padStart(5) + 'x   ' + String(r.st.seam.maxAbsD).padStart(12));
    fs.writeFileSync(path.join(OUT, 'roundtrip.json'), JSON.stringify({ bake, sigma: SIGMA, bias: BIAS, results }, null, 1));
    console.log('  -> ' + OUT);
    await browser.close(); try { srv.kill(); } catch (e) {}
})();
