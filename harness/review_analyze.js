// Pixel tests over the review_drive.js output PNGs (T1 rest fidelity, T2 holes,
// T3 FG contamination, T4 streak anisotropy). 2D canvas only — fast.
// Usage: node review_analyze.js <prefix>
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');

const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const PREFIX = process.argv[2] || 'sw';

(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 600));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  // same-origin blank page so canvas getImageData is not tainted
  await page.goto('http://localhost:8099/blank.html', { waitUntil: 'domcontentloaded', timeout: 30000 });

  const result = await page.evaluate(async (PREFIX) => {
    const load = (n) => new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0);
        res({ d: x.getImageData(0, 0, img.width, img.height).data, W: img.width, H: img.height });
      };
      img.onerror = () => res(null);
      img.src = 'http://localhost:8099/' + PREFIX + '_' + n + '.png';
    });

    // interior transparent pixels = transparent, not border-connected
    function interiorHoles(im) {
      const { d, W, H } = im, N = W * H;
      const trans = new Uint8Array(N);
      for (let i = 0; i < N; i++) trans[i] = d[i * 4 + 3] < 128 ? 1 : 0;
      const outside = new Uint8Array(N); const q = [];
      for (let x = 0; x < W; x++) { for (const y of [0, H - 1]) { const i = y * W + x; if (trans[i] && !outside[i]) { outside[i] = 1; q.push(i); } } }
      for (let y = 0; y < H; y++) { for (const x of [0, W - 1]) { const i = y * W + x; if (trans[i] && !outside[i]) { outside[i] = 1; q.push(i); } } }
      for (let h = 0; h < q.length; h++) { const i = q[h], x = i % W, y = (i / W) | 0;
        const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
        for (const j of nb) if (j >= 0 && trans[j] && !outside[j]) { outside[j] = 1; q.push(j); } }
      let holes = 0; const holeMask = new Uint8Array(N); let bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1;
      for (let i = 0; i < N; i++) if (trans[i] && !outside[i]) { holes++; holeMask[i] = 1;
        const x = i % W, y = (i / W) | 0; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
      return { holes, holeMask, bbox: holes ? [bx0, by0, bx1, by1] : null };
    }

    function diffStats(a, b, thr1, thr2) {
      // interior = pixels opaque in the BASELINE b (margin additions counted separately)
      const N = a.W * a.H; let n1 = 0, n2 = 0, marginAdd = 0; const mask = new Uint8Array(N);
      let bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1;
      for (let i = 0; i < N; i++) {
        const dr = Math.abs(a.d[i*4] - b.d[i*4]), dg = Math.abs(a.d[i*4+1] - b.d[i*4+1]),
              db = Math.abs(a.d[i*4+2] - b.d[i*4+2]), da = Math.abs(a.d[i*4+3] - b.d[i*4+3]);
        const m = Math.max(dr, dg, db, da);
        // interior = baseline pixel actually shows content (pillarbox renders
        // opaque BLACK through the composite, so alpha alone can't split it)
        const bLum = Math.max(b.d[i*4], b.d[i*4+1], b.d[i*4+2]);
        if (b.d[i*4+3] < 128 || bLum <= 6) { if (m > thr1) marginAdd++; continue; }
        if (m > thr1) { n1++; mask[i] = 1;
          const x = i % a.W, y = (i / a.W) | 0; if (x<bx0)bx0=x; if (x>bx1)bx1=x; if (y<by0)by0=y; if (y>by1)by1=y; }
        if (m > thr2) n2++;
      }
      return { n1, n2, marginAdd, mask, bbox: n1 ? [bx0, by0, bx1, by1] : null };
    }

    function maskPng(mask, W, H, baseIm) {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d'); const id = x.createImageData(W, H);
      for (let i = 0; i < W * H; i++) {
        const on = mask[i];
        id.data[i*4]   = on ? 255 : (baseIm ? baseIm.d[i*4] >> 2 : 0);
        id.data[i*4+1] = baseIm ? baseIm.d[i*4+1] >> 2 : 0;
        id.data[i*4+2] = baseIm ? baseIm.d[i*4+2] >> 2 : 0;
        id.data[i*4+3] = 255;
      }
      x.putImageData(id, 0, 0);
      return c.toDataURL('image/png');
    }

    // region metrics: color + gradient anisotropy inside mask vs annulus around it
    function regionStats(im, mask) {
      const { d, W, H } = im, N = W * H;
      const dil = mask.slice();
      for (let it = 0; it < 12; it++) { const nb = dil.slice();
        for (let y = 1; y < H-1; y++) for (let x = 1; x < W-1; x++) { const i = y*W+x; if (dil[i]) continue;
          if (dil[i-1]||dil[i+1]||dil[i-W]||dil[i+W]) nb[i] = 1; } dil.set(nb); }
      const ann = new Uint8Array(N); for (let i = 0; i < N; i++) ann[i] = dil[i] && !mask[i] && d[i*4+3] > 128 ? 1 : 0;
      const lum = new Float32Array(N);
      for (let i = 0; i < N; i++) lum[i] = 0.299*d[i*4]+0.587*d[i*4+1]+0.114*d[i*4+2];
      function stats(sel) {
        let n=0, mr=0,mg=0,mb=0, warm=0, gx=0, gy=0, ng=0;
        for (let y = 1; y < H-1; y++) for (let x = 1; x < W-1; x++) { const i = y*W+x; if (!sel[i]) continue;
          n++; const r=d[i*4],g=d[i*4+1],b=d[i*4+2]; mr+=r;mg+=g;mb+=b;
          if (r>g && g>b && r-b>25) warm++;
          if (sel[i-1]&&sel[i+1]&&sel[i-W]&&sel[i+W]) { gx += Math.abs(lum[i+1]-lum[i-1]); gy += Math.abs(lum[i+W]-lum[i-W]); ng++; } }
        return n ? { n, mean: [mr/n, mg/n, mb/n].map(v=>+v.toFixed(1)), warmFrac: +(warm/n).toFixed(4),
                     gx: ng?+(gx/ng).toFixed(3):0, gy: ng?+(gy/ng).toFixed(3):0 } : { n: 0 };
      }
      return { region: stats(mask), annulus: stats(ann) };
    }

    const out = {};
    const names = ['pristine_c','pristine_r11','comp_c','comp_r11','comp_l11','comp_u06','comp_d06',
                   'comp_r11u06','comp_r18','fgcut_r11','bg_r11','zoom_c','zoom_r05','pristine_zoom_c'];
    const ims = {};
    for (const n of names) ims[n] = await load(n);

    // T1: rest fidelity (interior only; margin additions reported separately)
    if (ims.comp_c && ims.pristine_c) {
      const t1 = diffStats(ims.comp_c, ims.pristine_c, 8, 30);
      out.T1_rest = { interiorOver8: t1.n1, interiorOver30: t1.n2, marginAdded: t1.marginAdd, bbox: t1.bbox };
      out.T1_maskPng = maskPng(t1.mask, ims.comp_c.W, ims.comp_c.H, ims.pristine_c);
    }
    // attribution runs (optional files)
    for (const nm of ['plugonly_c','cutonly_c']) {
      const im = await load(nm);
      if (im && ims.pristine_c) {
        const t = diffStats(im, ims.pristine_c, 8, 30);
        out['T1_' + nm] = { interiorOver8: t.n1, interiorOver30: t.n2, marginAdded: t.marginAdd };
        out['T1_' + nm + '_maskPng'] = maskPng(t.mask, im.W, im.H, ims.pristine_c);
      }
    }
    // T1 zoom variant
    if (ims.zoom_c && ims.pristine_zoom_c) {
      const tz = diffStats(ims.zoom_c, ims.pristine_zoom_c, 8, 30);
      out.T1_zoom = { pxOver8: tz.n1, pxOver30: tz.n2, bbox: tz.bbox };
      out.T1z_maskPng = maskPng(tz.mask, ims.zoom_c.W, ims.zoom_c.H, ims.pristine_zoom_c);
    }
    // T2: interior holes per composite
    out.T2_holes = {};
    for (const n of ['comp_c','comp_r11','comp_l11','comp_u06','comp_d06','comp_r11u06','comp_r18','zoom_c','zoom_r05']) {
      if (!ims[n]) continue;
      const r = interiorHoles(ims[n]);
      out.T2_holes[n] = { holes: r.holes, bbox: r.bbox };
      if (r.holes > 0) out['T2_' + n + '_maskPng'] = maskPng(r.holeMask, ims[n].W, ims[n].H, ims[n]);
    }
    // T3/T4: "plug-affected" region at +0.11 = pixels the plug changed vs the
    // pristine pipeline at the same pose (screen-space fill paints over cut
    // holes, so transparency cannot define the reveal).
    if (ims.comp_r11 && ims.pristine_r11) {
      const t = diffStats(ims.comp_r11, ims.pristine_r11, 30, 60);
      const revealed = t.mask;
      const N = ims.comp_r11.W * ims.comp_r11.H;
      let nRev = 0; for (let i = 0; i < N; i++) nRev += revealed[i];
      out.T34_revealedPx = nRev;
      if (nRev > 100) {
        out.T34 = regionStats(ims.comp_r11, revealed);
        out.T34_maskPng = maskPng(revealed, ims.comp_r11.W, ims.comp_r11.H, ims.comp_r11);
      }
    }
    return out;
  }, PREFIX);

  for (const k of Object.keys(result)) {
    if (k.endsWith('maskPng') && result[k]) {
      fs.writeFileSync(PREFIX + '_AN_' + k.replace('_maskPng','') + '.png', Buffer.from(result[k].split(',')[1], 'base64'));
      delete result[k];
    }
  }
  console.log(JSON.stringify(result, null, 2));
  await browser.close(); srv.kill();
})().catch(e => { console.error('ANALYZE ERROR', e); process.exit(1); });
