// A221b WHERE IS THE RAGGEDNESS BORN? Dump the A212 FG pre-tear's dropped-
// triangle set as a source-space map. If the DECISION is speckled (isolated
// dropped/kept triangles along the walls), the tear criterion flickers and the
// fix is a coherent per-texel region. If the decision is a clean line, the
// raggedness is born later — at the freed edge under parallax (per-vertex
// depth jitter) — and the fix is edge depth, not the criterion.
//   node harness/a221_tearmap.js
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = process.env.WT || '/workspace/mm', H = path.join(WT, 'harness');
const OUT = '/tmp/claude-0/-home-user-moebius/989b3965-28fd-58c7-96b5-b4b22c709919/scratchpad/a221';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 45; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  const res = await page.evaluate(() => {
    window._rayReproject = true;
    bgQuickBake = true; buildBackgroundLayer();
    const g = mediaLayers[0].mesh.geometry, gp = g.parameters;
    const vw = ((gp.widthSegments || 1) | 0) + 1, vh = ((gp.heightSegments || 1) | 0) + 1;
    const full = g.userData._fullIndex, kept = g.index.array;
    // dropped = full \ kept (both are ordered subsequences of the same list)
    const keptSet = new Set();
    for (let t = 0; t < kept.length; t += 3) keptSet.add(kept[t] + '_' + kept[t+1] + '_' + kept[t+2]);
    const cell = new Uint8Array((vw - 1) * (vh - 1)); // 0 none,1 some,2 all-of-quad dropped markers per anchor cell
    let nDrop = 0;
    const dropList = [];
    for (let t = 0; t < full.length; t += 3) {
      if (keptSet.has(full[t] + '_' + full[t+1] + '_' + full[t+2])) continue;
      nDrop++;
      // anchor at min vertex -> cell coords
      const v = Math.min(full[t], full[t+1], full[t+2]);
      dropList.push(v % vw, (v / vw) | 0);
    }
    // paint dropped map at vertex-grid resolution
    const cv = document.createElement('canvas'); cv.width = vw; cv.height = vh;
    const cx = cv.getContext('2d'); const im = cx.createImageData(vw, vh);
    const dm = new Uint8Array(vw * vh);
    for (let k = 0; k < dropList.length; k += 2) dm[dropList[k+1] * vw + dropList[k]] = 1;
    // coherence stats on the dropped-cell mask: isolated dropped cells (no
    // 8-neighbour dropped) and kept holes inside dropped runs
    let iso = 0, nCells = 0;
    for (let y = 1; y < vh - 1; y++) for (let x = 1; x < vw - 1; x++) {
      const i = y * vw + x; if (!dm[i]) continue; nCells++;
      let nb = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue; if (dm[i + dy * vw + dx]) nb++;
      }
      if (nb === 0) iso++;
    }
    for (let i = 0; i < vw * vh; i++) { const o = i * 4, v = dm[i] ? 255 : 0;
      im.data[o] = v; im.data[o+1] = v; im.data[o+2] = v; im.data[o+3] = 255; }
    cx.putImageData(im, 0, 0);
    // A221c: are the freed-edge cells TRANSITIONAL (mid-ramp) or plateau?
    // For each kept cell 8-adjacent to a dropped cell, its own depth span
    // (over its 4 corner texels) vs the source quantum. If the borders are
    // mostly span>quantum, the tear is cutting mid-ramp and the freed edge
    // sits at interpolated cliff depths — the jitter mechanism.
    const L = mediaLayers[0];
    const dImg = L.textures.depth.image2d || L.textures.depth.image;
    const pw2 = vw, ph2 = vh; // texel grid == vertex grid (idMap) on this asset
    const cvD = document.createElement('canvas'); cvD.width = pw2; cvD.height = ph2;
    const cxD = cvD.getContext('2d', { willReadFrequently: true });
    cxD.drawImage(dImg, 0, 0, pw2, ph2);
    const dpx = cxD.getImageData(0, 0, pw2, ph2).data;
    const dQ2 = new Float32Array(pw2 * ph2);
    for (let i = 0; i < pw2 * ph2; i++) dQ2[i] = dpx[i * 4] / 255;
    const qN2 = (typeof window._qbSrcQuantum === 'number' && window._qbSrcQuantum > 0) ? window._qbSrcQuantum : 1 / 255;
    let nBorder = 0, nTrans = 0; const spans = [];
    for (let y = 1; y < vh - 2; y++) for (let x = 1; x < vw - 2; x++) {
      const i = y * vw + x; if (dm[i]) continue;
      let adj = false;
      for (let dy = -1; dy <= 1 && !adj; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dm[i + dy * vw + dx]) { adj = true; break; }
      }
      if (!adj) continue; nBorder++;
      const d00 = dQ2[i], d10 = dQ2[i + 1], d01 = dQ2[i + vw], d11 = dQ2[i + vw + 1];
      const sp = Math.max(d00, d10, d01, d11) - Math.min(d00, d10, d01, d11);
      if (sp > qN2) { nTrans++; spans.push(sp); }
    }
    spans.sort((a, b) => a - b);
    return { vw, vh, nDrop, nCells, iso, png: cv.toDataURL('image/png'),
      nBorder, nTrans, qN: qN2,
      spanMed: spans.length ? spans[spans.length >> 1] : 0,
      spanP90: spans.length ? spans[Math.floor(spans.length * 0.9)] : 0 };
  });
  console.log('grid ' + res.vw + 'x' + res.vh + '  dropped tris=' + res.nDrop +
    '  dropped cells=' + res.nCells + '  isolated cells=' + res.iso +
    ' (' + (100 * res.iso / Math.max(1, res.nCells)).toFixed(2) + '%)');
  console.log('border cells (kept, 8-adj to drop): ' + res.nBorder +
    '  transitional (span>quantum ' + res.qN.toFixed(4) + '): ' + res.nTrans +
    ' (' + (100 * res.nTrans / Math.max(1, res.nBorder)).toFixed(1) + '%)' +
    '  span med=' + res.spanMed.toFixed(3) + ' p90=' + res.spanP90.toFixed(3));
  fs.writeFileSync(path.join(OUT, 'tear_dropped.png'), Buffer.from(res.png.split(',')[1], 'base64'));
  console.log('map -> ' + OUT + '/tear_dropped.png');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
