// A242 TEETH PROBE: where do the row-wise steps in the band's outline come from? After a
// quick bake (flush plate, fold probe on), scan the band mask (disocc, source rows) row by
// row: each band run's left/right end is compared with the median end of the two rows above
// and below; an end that departs by more than RWD texels is a TOOTH. Counts, the biggest
// cluster, and per-tooth attribution: is the tooth row's extra reach claimed by a front
// (claimedF), torn foreground (fgTorn), rim demand, or hole demand; what refused the
// neighbouring rows there (refuseF). Writes a texture-space crop PNG around the densest
// cluster: band = green, teeth = red, torn FG = blue tint, source dimmed.
//   FLUSH=1 node harness/a242_teeth.js
'use strict';
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = __dirname, WT = path.resolve(__dirname, '..');
const TAG = process.env.TAG || 'troll';
const OUT = path.join(__dirname, 'shots', 'a242', TAG);
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
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r2 => setTimeout(r2, 1000)); }
    const res = await page.evaluate(async (o) => {
        window._rayReproject = true; window._plugSweepCapture = true; window._foldProbe = true; window._plugCarve = false;
        if (o.flush) window._plateFlushExempt = true;
        if (o.flags) for (const f of o.flags) { const [k, v] = f.split('='); window[k] = (v === undefined) ? true : (isNaN(+v) ? v : +v); }
        bgQuickBake = true; buildBackgroundLayer(); isSweeping = true;
        const sz = window._qbSize, dQ = window._qbDQ, dis = window._qbDisocc, torn = window._qbFgTorn, fp = window._fpData || {};
        if (!sz || !dQ || !dis) return { err: 'missing capture' };
        const pw = sz.pw, ph = sz.ph, N = pw * ph;
        const RWD = Math.max(1, Math.round(4 * pw / 1200));
        // run ends per row
        const tooth = new Uint8Array(N); let nEnds = 0, nTeeth = 0; const teethLen = [];
        const ends = new Array(ph);   // per row: array of [l, r]
        for (let y = 0; y < ph; y++) { const arr = []; let x = 0; while (x < pw) { if (dis[y * pw + x]) { const l = x; while (x < pw && dis[y * pw + x]) x++; arr.push([l, x - 1]); } else x++; } ends[y] = arr; }
        const medianEnd = (y, side, xref) => {   // median of the nearest run end on `side` within ±2 rows (skip y itself)
            const v = [];
            for (const dy of [-2, -1, 1, 2]) { const yy = y + dy; if (yy < 0 || yy >= ph) continue; let best = null, bd = 1e9;
                for (const [l, r] of ends[yy]) { const e = side === 0 ? l : r; const d = Math.abs(e - xref); if (d < bd) { bd = d; best = e; } }
                if (best !== null && bd < 64) v.push(best); }
            if (v.length < 2) return null; v.sort((a, b) => a - b); return v[v.length >> 1];
        };
        const attrib = { claimedRows: 0, tornRows: 0, plainRows: 0 };
        for (let y = 0; y < ph; y++) for (const [l, r] of ends[y]) {
            for (const side of [0, 1]) { const e = side === 0 ? l : r; nEnds++; const m = medianEnd(y, side, e); if (m === null) continue;
                const excess = side === 0 ? (m - e) : (e - m);   // how far this row's band reaches beyond its neighbours' median
                if (excess > RWD) { nTeeth++; teethLen.push(excess);
                    let cl = 0, tn = 0, n = 0;
                    for (let k = 0; k < excess; k++) { const x = side === 0 ? e + k : e - k; if (x < 0 || x >= pw) break; const i = y * pw + x; tooth[i] = 1; n++; if (fp.claimedF && fp.claimedF[i]) cl++; if (torn && torn[i]) tn++; }
                    if (cl > n / 2) attrib.claimedRows++; else if (tn > n / 2) attrib.tornRows++; else attrib.plainRows++; } }
        }
        teethLen.sort((a, b) => a - b);
        const med = teethLen.length ? teethLen[teethLen.length >> 1] : 0, p90 = teethLen.length ? teethLen[Math.floor(0.9 * (teethLen.length - 1))] : 0;
        // densest cluster of tooth texels (48x48 blocks)
        const BS = 48, bw = Math.ceil(pw / BS), bh = Math.ceil(ph / BS); const blk = new Int32Array(bw * bh);
        for (let i = 0; i < N; i++) if (tooth[i]) blk[((i / pw | 0) / BS | 0) * bw + ((i % pw) / BS | 0)]++;
        let best = 0; for (let b = 1; b < blk.length; b++) if (blk[b] > blk[best]) best = b;
        const bx = (best % bw) * BS, by = ((best / bw) | 0) * BS;
        // crop PNG 192x192 around the cluster, 4x
        const L = mediaLayers[0]; const cImg = (L.elements && L.elements.color) || L.textures.color.image;
        const cv = document.createElement('canvas'); cv.width = pw; cv.height = ph; const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(cImg, 0, 0, pw, ph); const src = cx.getImageData(0, 0, pw, ph).data;
        const x0 = Math.max(0, bx - 72), y0 = Math.max(0, by - 72), CW = Math.min(192, pw - x0), CH = Math.min(192, ph - y0);
        const oc = document.createElement('canvas'); oc.width = CW; oc.height = CH; const ox = oc.getContext('2d'); const im = ox.createImageData(CW, CH);
        for (let yy = 0; yy < CH; yy++) for (let xx = 0; xx < CW; xx++) { const i = (y0 + yy) * pw + (x0 + xx), o4 = (yy * CW + xx) * 4;
            let r = src[i * 4] * 0.4, g = src[i * 4 + 1] * 0.4, b = src[i * 4 + 2] * 0.4;
            if (dis[i]) { r = 40; g = 170; b = 70; } if (torn && torn[i]) { b = Math.min(255, b + 120); } if (tooth[i]) { r = 235; g = 50; b = 50; }
            im.data[o4] = r; im.data[o4 + 1] = g; im.data[o4 + 2] = b; im.data[o4 + 3] = 255; }
        ox.putImageData(im, 0, 0);
        const zc = document.createElement('canvas'); zc.width = CW * 4; zc.height = CH * 4; const zx = zc.getContext('2d'); zx.imageSmoothingEnabled = false; zx.drawImage(oc, 0, 0, CW * 4, CH * 4);
        // per-row band width along the cluster's rows (right end), for the log
        const widths = []; for (let yy = by; yy < Math.min(ph, by + BS); yy++) { let r = -1; for (const [l, rr] of ends[yy]) if (l >= x0 && l < x0 + CW) r = Math.max(r, rr); widths.push(r); }
        return { pw, ph, RWD, nEnds, nTeeth, med, p90, attrib, cluster: [bx, by, blk[best]], crop: [x0, y0, CW, CH], png: zc.toDataURL('image/png'), rightEnds: widths, hasFp: !!fp.claimedF, hasTorn: !!torn };
    }, { flush: !!process.env.FLUSH, flags: (process.env.FLAGS || '').split(',').filter(Boolean) });
    if (res.err) { console.log('ERR ' + res.err); process.exit(1); }
    fs.writeFileSync(path.join(OUT, 'teeth_crop.png'), Buffer.from(res.png.split(',')[1], 'base64'));
    console.log(`${TAG} teeth: plate ${res.pw}x${res.ph}, RWD ${res.RWD}; band run ends ${res.nEnds}, teeth (excess > RWD over the ±2-row median) ${res.nTeeth} (${(100 * res.nTeeth / Math.max(1, res.nEnds)).toFixed(1)}%), excess median ${res.med} p90 ${res.p90} texels`);
    console.log(`   tooth rows by content: front-claimed ${res.attrib.claimedRows}, torn-FG ${res.attrib.tornRows}, plain ${res.attrib.plainRows} (fold probe ${res.hasFp ? 'on' : 'OFF'}, torn capture ${res.hasTorn ? 'on' : 'OFF'})`);
    console.log(`   densest 48x48 block at (${res.cluster[0]},${res.cluster[1]}) with ${res.cluster[2]} tooth texels; crop ${JSON.stringify(res.crop)} -> ${path.join(OUT, 'teeth_crop.png')}`);
    console.log(`   right ends of the band per row in that block: ${res.rightEnds.join(' ')}`);
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
