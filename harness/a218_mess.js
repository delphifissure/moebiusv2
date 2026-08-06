// A218 WHY IS THE DEMAND REGION SO MUCH BIGGER THAN THE CLIFFS PREDICT?
//
// User: "look at the actual gaps — why is there so much extra mess...
// it's easy to see where the holes will be." Ground truth: a hole can only
// open beside a depth CLIFF, in a band whose width is the cliff's own
// relative parallax budget |shiftPx(near) - shiftPx(far)| at the cone rim.
// Compare: (a) the shipped demand mask (SD region), (b) the cliff-band
// prediction, (c) demand AND NOT predicted = the mess, dumped as PNGs and
// counted, plus per-pixel plate-vs-source depth stats inside the mess.
//   node harness/a218_mess.js
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = process.env.WT || '/workspace/mm', H = path.join(WT, 'harness');
const OUT = '/tmp/claude-0/-home-user-moebius/989b3965-28fd-58c7-96b5-b4b22c709919/scratchpad/a218';

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
  page.on('console', m => { const t = m.text();
    if (t.includes('[QUICK-BAKE] a217') || t.includes('disocclusion:')) console.log('  [page] ' + t.slice(0, 160)); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 45; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  const res = await page.evaluate(async () => {
    window._rayReproject = true;
    bgQuickBake = true; buildBackgroundLayer();
    const L = mediaLayers[0];
    const mTex = bgLayerMesh.material.uniforms.u_sdMask.value;
    const dTex = bgLayerMesh.material.uniforms.displacementMap.value;
    const pw = mTex.image.width, ph = mTex.image.height, PN = pw * ph;
    const maskF = mTex.image.data, plateF = dTex.image.data;   // texture space (y flipped)
    // source depth
    const dImg = L.textures.depth.image2d || L.textures.depth.image;
    const cv = document.createElement('canvas'); cv.width = pw; cv.height = ph;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(dImg, 0, 0, pw, ph);
    const dpx = cx.getImageData(0, 0, pw, ph).data;
    const dQ = new Float32Array(PN);
    for (let i = 0; i < PN; i++) dQ[i] = dpx[i*4] / 255;
    // cliff-band prediction: seeds at cliffs (step > fgTearStep), budget =
    // |shiftPx(near) - shiftPx(far)| at rim, grown by chamfer(5,7)
    const lut = bgShiftLUTFor(pw, ph);
    const STEPC = (typeof fgTearStep === 'number') ? fgTearStep : 0.06;
    const bud = new Int32Array(PN); const q = []; const pred = new Uint8Array(PN);
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const i = y*pw+x; const di = dQ[i];
      let far = di;
      if (x > 0 && di - dQ[i-1] > STEPC && dQ[i-1] < far) far = dQ[i-1];
      if (x < pw-1 && di - dQ[i+1] > STEPC && dQ[i+1] < far) far = dQ[i+1];
      if (y > 0 && di - dQ[i-pw] > STEPC && dQ[i-pw] < far) far = dQ[i-pw];
      if (y < ph-1 && di - dQ[i+pw] > STEPC && dQ[i+pw] < far) far = dQ[i+pw];
      if (far < di) {
        const b = Math.ceil(Math.abs(bgShiftPxAt(lut, di) - bgShiftPxAt(lut, far))) * 5;
        if (b > bud[i]) { bud[i] = b; pred[i] = 1; q.push(i); }
      }
    }
    for (let h = 0; h < q.length; h++) {
      const i = q[h]; const bi = bud[i]; if (bi <= 0) continue;
      const xi = i % pw, yi = (i / pw) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xn = xi + dx, yn = yi + dy;
        if (xn < 0 || yn < 0 || xn >= pw || yn >= ph) continue;
        const j = yn*pw + xn, bn = bi - ((dx && dy) ? 7 : 5);
        if (bn <= bud[j]) continue;
        bud[j] = bn; pred[j] = 1; q.push(j);
      }
    }
    // compare (mask is y-flipped relative to source space)
    let nD = 0, nP = 0, nMess = 0, nMiss = 0;
    const mess = new Uint8Array(PN);
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const i = y*pw+x, j = (ph-1-y)*pw+x;
      const dm = maskF[j] >= 0.5, pr = pred[i] === 1;
      if (dm) nD++;
      if (pr) nP++;
      if (dm && !pr) { nMess++; mess[i] = 1; }
      if (pr && !dm) nMiss++;
    }
    // depth stats inside the mess: how far behind the source is the plate there?
    let sep = [0, 0, 0]; // <0.05, 0.05-0.2, >0.2 depth separation
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const i = y*pw+x; if (!mess[i]) continue;
      const d2 = dQ[i] - plateF[(ph-1-y)*pw+x];
      if (d2 < 0.05) sep[0]++; else if (d2 < 0.2) sep[1]++; else sep[2]++;
    }
    const png = (fill) => {
      const c = document.createElement('canvas'); c.width = pw; c.height = ph;
      const g = c.getContext('2d'); const im = g.createImageData(pw, ph); fill(im.data);
      g.putImageData(im, 0, 0); return c.toDataURL('image/png');
    };
    return {
      pw, ph, nD, nP, nMess, nMiss, PN, sep,
      demandPng: png(d => { for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
        const o = (y*pw+x)*4, v = maskF[(ph-1-y)*pw+x] >= 0.5 ? 255 : 0; d[o]=v; d[o+1]=v; d[o+2]=v; d[o+3]=255; } }),
      predPng: png(d => { for (let i = 0; i < PN; i++) { const o = i*4, v = pred[i] ? 255 : 0; d[o]=v; d[o+1]=v; d[o+2]=v; d[o+3]=255; } }),
      messPng: png(d => { for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
        const i = y*pw+x, o = i*4;
        const dm = maskF[(ph-1-y)*pw+x] >= 0.5, pr = pred[i] === 1;
        d[o]   = dm && !pr ? 255 : 0;          // red   = demand not predicted (the mess)
        d[o+1] = dm && pr  ? 200 : 0;          // green = agreement
        d[o+2] = !dm && pr ? 255 : 0;          // blue  = predicted not in demand
        d[o+3] = 255; } }),
    };
  });
  console.log('pw x ph = ' + res.pw + 'x' + res.ph);
  console.log('demand (SD region):  ' + res.nD + ' px (' + (100*res.nD/res.PN).toFixed(1) + '%)');
  console.log('cliff-band predicted:' + res.nP + ' px (' + (100*res.nP/res.PN).toFixed(1) + '%)');
  console.log('MESS (demand \\\\ pred): ' + res.nMess + ' px (' + (100*res.nMess/res.PN).toFixed(1) + '% of frame, ' + (100*res.nMess/Math.max(1,res.nD)).toFixed(1) + '% of demand)');
  console.log('pred \\\\ demand:       ' + res.nMiss + ' px');
  console.log('mess plate separation dQ-plate: <0.05: ' + res.sep[0] + '  0.05-0.2: ' + res.sep[1] + '  >0.2: ' + res.sep[2]);
  for (const k of ['demandPng', 'predPng', 'messPng'])
    fs.writeFileSync(path.join(OUT, k.replace('Png','') + '.png'), Buffer.from(res[k].split(',')[1], 'base64'));
  console.log('maps -> ' + OUT + '  (mess.png: red = demand the cliffs cannot explain, green = agreement, blue = predicted only)');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
