// A68: painterly figure-interior SD coverage measurement (warrior).
// Outputs: SD overlay + figure-region crop, quick-path 3D shots at cone
// offsets, and in-page fragmentation stats of the SD mask inside the
// figure group (largest non-ground component): component count/sizes and
// row-gap distribution between SD fragments.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
fs.copyFileSync('../silverwarrior_color.png', 'defaultImgColor.png');
fs.copyFileSync('../silverwarrior_depth.png', 'defaultImgDepth.png');
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 688 } });
  page.on('pageerror', e => console.log('  [PAGEERR] '+e.message.slice(0,140)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
  const res = await page.evaluate(() => {
    window._srCapture = true; window._rayReproject = true;
    bgQuickBake = true; buildBackgroundLayer();
    const mk = window._qbMask; if (!mk) return { err: 'no capture' };
    const { pw, ph } = mk, PN = pw*ph, D = mk.disocc, G = mk.ground;
    // largest non-ground 4-component = the figure group
    const lbl = new Int32Array(PN); let nl = 0; const q = new Int32Array(PN);
    let bestL = 0, bestN = 0;
    const sizes = [];
    for (let s = 0; s < PN; s++) {
      if (lbl[s] || (G && G[s])) continue;
      nl++; let qh = 0, qt = 0, n = 0;
      q[qt++] = s; lbl[s] = nl;
      while (qh < qt) { const i = q[qh++]; n++;
        const x = i%pw, y = (i/pw)|0;
        if (x>0    && !lbl[i-1]  && !(G&&G[i-1]))  { lbl[i-1]=nl;  q[qt++]=i-1; }
        if (x<pw-1 && !lbl[i+1]  && !(G&&G[i+1]))  { lbl[i+1]=nl;  q[qt++]=i+1; }
        if (y>0    && !lbl[i-pw] && !(G&&G[i-pw])) { lbl[i-pw]=nl; q[qt++]=i-pw; }
        if (y<ph-1 && !lbl[i+pw] && !(G&&G[i+pw])) { lbl[i+pw]=nl; q[qt++]=i+pw; }
      }
      sizes.push(n);
      if (n > bestN) { bestN = n; bestL = nl; }
    }
    // bbox of the figure group
    let x0 = pw, x1 = 0, y0 = ph, y1 = 0;
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      if (lbl[y*pw+x] === bestL) { if (x<x0)x0=x; if (x>x1)x1=x; if (y<y0)y0=y; if (y>y1)y1=y; }
    }
    // SD components inside the figure group
    const lbl2 = new Int32Array(PN); let nc = 0; const compSz = [];
    for (let s = 0; s < PN; s++) {
      if (lbl2[s] || !D[s] || lbl[s] !== bestL) continue;
      nc++; let qh = 0, qt = 0, n = 0;
      q[qt++] = s; lbl2[s] = nc;
      while (qh < qt) { const i = q[qh++]; n++;
        const x = i%pw, y = (i/pw)|0;
        const tryN = (j) => { if (!lbl2[j] && D[j] && lbl[j] === bestL) { lbl2[j] = nc; q[qt++] = j; } };
        if (x>0) tryN(i-1); if (x<pw-1) tryN(i+1); if (y>0) tryN(i-pw); if (y<ph-1) tryN(i+pw);
      }
      compSz.push(n);
    }
    compSz.sort((a,b)=>b-a);
    // row-gap distribution between SD runs inside the figure group
    const gaps = [];
    for (let y = y0; y <= y1; y += 2) {
      let lastEnd = -1;
      for (let x = x0; x <= x1; x++) {
        const i = y*pw+x;
        if (lbl[i] !== bestL) continue;
        if (D[i]) { if (lastEnd >= 0 && x - lastEnd > 1) gaps.push(x - lastEnd - 1); lastEnd = x; }
      }
    }
    gaps.sort((a,b)=>a-b);
    const pct = (p) => gaps.length ? gaps[Math.min(gaps.length-1, (gaps.length*p)|0)] : -1;
    // SD coverage inside figure group
    let nDf = 0; for (let i = 0; i < PN; i++) if (lbl[i] === bestL && D[i]) nDf++;
    // overlay + crop
    const col = (mediaLayers[0].elements && mediaLayers[0].elements.color) || mediaLayers[0].textures.color.image;
    const cv = document.createElement('canvas'); cv.width = pw; cv.height = ph; const c = cv.getContext('2d');
    c.drawImage(col, 0, 0, pw, ph); const id = c.getImageData(0, 0, pw, ph);
    for (let i = 0; i < PN; i++) if (D[i]) { id.data[i*4] = Math.min(255, id.data[i*4]*0.2+255*0.8); id.data[i*4+1] *= 0.2; id.data[i*4+2] *= 0.2; }
    c.putImageData(id, 0, 0);
    const crop = document.createElement('canvas');
    const cw = Math.min(1400, x1-x0+80), chh = Math.min(1400, y1-y0+80);
    crop.width = cw; crop.height = chh;
    crop.getContext('2d').drawImage(cv, Math.max(0,x0-40), Math.max(0,y0-40), cw, chh, 0, 0, cw, chh);
    return { pw, ph, figPx: bestN, figBox: [x0, y0, x1, y1], sdInFig: nDf,
             sdComps: nc, top5: compSz.slice(0,5), gapMed: pct(0.5), gap90: pct(0.9), gapMax: gaps.length?gaps[gaps.length-1]:-1, nGaps: gaps.length,
             overlay: cv.toDataURL('image/png'), crop: crop.toDataURL('image/png') };
  });
  if (res.err) { console.log('ERR ' + res.err); process.exit(1); }
  fs.writeFileSync('a68_sd_overlay.png', Buffer.from(res.overlay.split(',')[1], 'base64'));
  fs.writeFileSync('a68_fig_crop.png', Buffer.from(res.crop.split(',')[1], 'base64'));
  delete res.overlay; delete res.crop;
  console.log('STATS ' + JSON.stringify(res));
  for (const [ptag, px, py] of [['r42',0.42,0.02],['l42',-0.42,0.02],['r25',0.25,0.02]]) {
    const png = await page.evaluate(async ({ px, py }) => {
      isSweeping = true;
      await new Promise(r2 => { let n=0; const tick=()=>{ camera.position.set(px,py,0.2); n++; n<8?requestAnimationFrame(tick):r2(); }; requestAnimationFrame(tick); });
      camera.position.set(px, py, 0.2); render();
      return renderer.domElement.toDataURL('image/png');
    }, { px, py });
    fs.writeFileSync('a68_quick_' + ptag + '.png', Buffer.from(png.split(',')[1], 'base64'));
    console.log('wrote a68_quick_' + ptag + '.png');
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
