// A163 THE ACCEPTANCE TEST THAT NEVER EXISTED: IS THE REST FRAME THE PICTURE?
//
// Every "rest frame unchanged" claim in this arc compares a build against
// ANOTHER BUILD. None compares it against the source image. If the whole arc
// drifted away from the picture at rest, no A/B in it could have shown that.
//
// At rest the eye is the reference eye, so the a104 reprojection is the
// identity: Sw = refEye + (Pw - refEye) * s puts every texel back on its own
// sight ray whatever its depth. The rest frame therefore MUST be the source
// image, resampled to the content rect and nothing else. That is a property of
// the geometry, not a tuning target, so it is a real acceptance test.
//
// Reported three ways, because a systematic difference is not the same defect
// as a wrong pixel:
//   raw            mean |delta| per channel, straight comparison
//   gain/offset    after the best-fit linear transfer per channel — separates
//                  "different tone curve / colour space" from "wrong content"
//   structure      fraction of pixels off by more than 8 levels after that fit
//
//   node harness/restfidelity.js <rev:label> [rev:label ...]
const { chromium } = require('playwright-core');
const { spawn, execSync } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm';
const TMP = '/tmp/claude-0/-home-user-moebius/989b3965-28fd-58c7-96b5-b4b22c709919/scratchpad/restfid';
const REVS = process.argv.slice(2);
const ASSET = process.env.ASSET || 'troll';
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star: ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };

const materialise = (rev, dir) => {
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  execSync(`git archive ${rev} | tar -x -C ${dir}`, { cwd: WT });
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(dir, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(dir, 'defaultImgDepth.png'));
  fs.copyFileSync(path.join(WT, 'harness', 'scratch_server.js'), path.join(dir, 'scratch_server.js'));
  fs.cpSync(path.join(WT, 'harness', 'vendor'), path.join(dir, 'vendor'), { recursive: true });
  const hp = path.join(dir, 'moebius.html');
  let html = fs.readFileSync(hp, 'utf8');
  html = html.replace(/^.*<script src="https?:\/\/[^"]*"[^>]*><\/script>.*$/gm,
                      (m) => (/three(\.min)?\.js/.test(m) ? '  <script src="vendor/three.min.js"></script>' : ''));
  fs.writeFileSync(hp, html);
};

(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const rows = [];
  for (const spec of REVS) {
    const [rev, label] = spec.split(':');
    const dir = path.join(TMP, label);
    materialise(rev, dir);
    const srv = spawn('node', ['scratch_server.js'], { cwd: dir, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const browser = await chromium.launch({ executablePath: CHROME, headless: true,
      args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
             '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [' + label + ' PAGEERR] ' + e.message.slice(0, 140)));
    try {
      await page.goto('http://localhost:8099/moebius.html', { waitUntil: 'load', timeout: 90000 });
      for (let t = 0; t < 45; t++) {
        const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
        if (ok) break; await new Promise(r => setTimeout(r, 1000));
      }
      const out = await page.evaluate(async (o) => {
        const set = (id, v) => { const el = document.getElementById(id); if (!el) return;
          el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true })); };
        if (o.userCtrl) { set('fgReachSlider', '60'); set('fgSubThresholdSlider', '0.03');
                          set('bgSeedModeSel', '2'); set('bgRelaxModeSel', 'harmonic'); }
        window._rayReproject = true;
        try { isSweeping = true; } catch (e) {}
        const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
        const res = {};
        const measure = () => {
          if (typeof bgFishtankMesh !== 'undefined' && bgFishtankMesh) bgFishtankMesh.visible = false;
          if (typeof bgSkirtMesh !== 'undefined' && bgSkirtMesh) bgSkirtMesh.visible = false;
          camera.position.set(0, 0, dist);
          for (let n = 0; n < 4; n++) render();
          const cw = renderer.domElement.width, chh = renderer.domElement.height;
          const cv = document.createElement('canvas'); cv.width = cw; cv.height = chh;
          const cx = cv.getContext('2d', { willReadFrequently: true });
          cx.drawImage(renderer.domElement, 0, 0);
          const R = cx.getImageData(0, 0, cw, chh).data;
          // content bbox = what the sheet paints, with tank and skirt off
          let x0 = cw, x1 = -1, y0 = chh, y1 = -1;
          for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) {
            if (R[(y * cw + x) * 4 + 3] >= 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
          const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
          if (bw < 8 || bh < 8) return { err: 'no content' };
          // the source, resampled to the same rect
          const L = mediaLayers[0];
          const img = (L.elements && L.elements.color) || L.textures.color.image;
          const sv = document.createElement('canvas'); sv.width = bw; sv.height = bh;
          const sx = sv.getContext('2d', { willReadFrequently: true });
          sx.drawImage(img, 0, 0, bw, bh);
          const S = sx.getImageData(0, 0, bw, bh).data;
          // best-fit gain/offset per channel over painted pixels
          const acc = [0,1,2].map(() => ({ n: 0, sx: 0, sy: 0, sxx: 0, sxy: 0 }));
          let painted = 0;
          for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
            const ri = ((y + y0) * cw + (x + x0)) * 4, si = (y * bw + x) * 4;
            if (R[ri + 3] < 8) continue;
            painted++;
            for (let c = 0; c < 3; c++) { const a = acc[c], u = S[si + c], v = R[ri + c];
              a.n++; a.sx += u; a.sy += v; a.sxx += u * u; a.sxy += u * v; }
          }
          const fit = acc.map(a => { const d = a.n * a.sxx - a.sx * a.sx;
            const g = Math.abs(d) < 1e-6 ? 1 : (a.n * a.sxy - a.sx * a.sy) / d;
            return { g, b: (a.sy - g * a.sx) / Math.max(1, a.n) }; });
          // SMOOTH-ONLY POPULATION. My resampling of the source is a canvas
          // drawImage; the renderer's is a GPU bilinear fetch off a different
          // grid. On high-frequency detail those two disagree by several levels
          // for reasons that have nothing to do with the render being wrong, so
          // an absolute claim needs a population where resampling cannot matter.
          // Local 3x3 range <= 8 levels in the SOURCE is that population: there,
          // any reasonable filter lands within the same 8 levels, so a larger
          // error is the content, not the filter.
          const smooth = new Uint8Array(bw * bh);
          for (let y = 1; y < bh - 1; y++) for (let x = 1; x < bw - 1; x++) {
            let mn = 255, mx = 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
              const v = S[((y + dy) * bw + (x + dx)) * 4 + 1];
              if (v < mn) mn = v; if (v > mx) mx = v;
            }
            smooth[y * bw + x] = (mx - mn <= 8) ? 1 : 0;
          }
          let rawSum = 0, fitSum = 0, off8 = 0, n = 0, worst = 0, sn = 0, sOff = 0, sSum = 0;
          for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
            const ri = ((y + y0) * cw + (x + x0)) * 4, si = (y * bw + x) * 4;
            if (R[ri + 3] < 8) continue;
            let dRaw = 0, dFit = 0;
            for (let c = 0; c < 3; c++) {
              const u = S[si + c], v = R[ri + c];
              dRaw = Math.max(dRaw, Math.abs(v - u));
              dFit = Math.max(dFit, Math.abs(v - (fit[c].g * u + fit[c].b)));
            }
            rawSum += dRaw; fitSum += dFit; n++;
            if (dFit > 8) off8++;
            if (dFit > worst) worst = dFit;
            if (smooth[y * bw + x]) { sn++; sSum += dFit; if (dFit > 8) sOff++; }
          }
          return { bbox: [bw, bh], paintedPct: +(100 * painted / (bw * bh)).toFixed(2),
                   rawMean: +(rawSum / n).toFixed(2), fitMean: +(fitSum / n).toFixed(2),
                   off8Pct: +(100 * off8 / n).toFixed(2), worst,
                   gain: fit.map(f => +f.g.toFixed(3)), bias: fit.map(f => +f.b.toFixed(1)),
                   smoothPct: +(100 * sn / Math.max(1, n)).toFixed(1),
                   smoothMean: +(sSum / Math.max(1, sn)).toFixed(2),
                   smoothOff8Pct: +(100 * sOff / Math.max(1, sn)).toFixed(2) };
        };
        res.realtime = measure();
        try {
          if (typeof bgQuickBake !== 'undefined') bgQuickBake = true;
          if (typeof bgMPIFullPlanes !== 'undefined') { bgMPIFullPlanes = false; bgMPIMode = false; }
          bgBuildStamp = null; buildBackgroundLayer();
          res.quick = measure();
        } catch (e) { res.quick = { err: e.message.slice(0, 80) }; }
        return res;
      }, { userCtrl: process.env.USERCTRL === '1' });
      rows.push({ label, out });
    } catch (e) { rows.push({ label, err: e.message.slice(0, 160) }); }
    await page.close(); await browser.close(); srv.kill();
    await new Promise(r => setTimeout(r, 800));
  }
  console.log('\n' + ASSET.toUpperCase() + ' — IS THE REST FRAME THE SOURCE IMAGE?');
  console.log('  build      mode      raw mean|d|   after fit   off>8   |  SMOOTH REGIONS: mean   off>8   (share)');
  for (const r of rows) {
    if (r.err) { console.log('  ' + r.label.padEnd(10) + ' FAILED: ' + r.err); continue; }
    for (const [mode, v] of Object.entries(r.out)) {
      if (v.err) { console.log('  ' + r.label.padEnd(10) + ' ' + mode.padEnd(9) + ' ' + v.err); continue; }
      console.log('  ' + r.label.padEnd(10) + ' ' + mode.padEnd(9) + String(v.rawMean).padStart(11) +
        String(v.fitMean).padStart(12) + String(v.off8Pct + '%').padStart(8) + '   |' +
        String(v.smoothMean).padStart(20) + String(v.smoothOff8Pct + '%').padStart(9) +
        String('(' + v.smoothPct + '% of px)').padStart(16));
    }
  }
  console.log('\n  raw = straight |render - source|. after gain/offset = the same with the best-fit');
  console.log('  linear transfer removed, so a colour-space difference shows as a gain != 1 rather');
  console.log('  than as error. "px off by >8" is the one that means the CONTENT is wrong.');
  process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
