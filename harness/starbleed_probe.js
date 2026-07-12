// A41 PROBE (real asset): v1 build on starwatcher. Measures (a) how much
// dark outline ink the stroke repair actually lifts, (b) how much ink
// survives in the PLATE fill (the "outline on the background" leak),
// (c) plate plug depth ghosts under near content. Dumps the plate fill
// and plug depth as PNGs for eyeballing.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const OUT = process.argv[2] || '.';
(async () => {
  fs.copyFileSync('../starwatcher_color.png', 'defaultImgColor.png');
  fs.copyFileSync('../starwatcher_depth.png', 'defaultImgDepth.png');
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const logs = [];
  page.on('console', m => { const t = m.text(); if (/STROKE-REPAIR|RUNG-PLUG|RUNG-A/.test(t)) logs.push(t); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate(() => {
    window._srCapture = true; window._dbgFillCapture = true;
    bgMPIFullPlanes = false; bgMPIMode = true; bgPlugMode = 'directional'; bgValidMode = 'auto';
    buildBackgroundLayer();
    window._srCapture = false; window._dbgFillCapture = false;
    const D = window._dbgFill, S = window._srDbg;
    if (!D) return { err: 'no _dbgFill' };
    const { pw, ph } = D;
    const PN = pw * ph;
    const lumF = (i) => (0.2126*D.pre[i*3] + 0.7152*D.pre[i*3+1] + 0.0722*D.pre[i*3+2]) / 255;
    // source luma from the stroke-repair capture (same grid)
    const srcLum = S && S.w === pw ? S.lum : null;
    // near-cliff mask: within 4px of a texel whose REPAIRED depth is
    // nearer by > 0.05 (silhouette neighborhoods, where outline ink lives)
    const GAP = 0.05;
    const nearCliff = new Uint8Array(PN);
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const i = y*pw+x; let mx = 0;
      for (let dy = -4; dy <= 4; dy += 2) for (let dx = -4; dx <= 4; dx += 2) {
        const xx = x+dx, yy = y+dy; if (xx<0||yy<0||xx>=pw||yy>=ph) continue;
        const v = D.rawD ? D.rawD[yy*pw+xx] : D.srcDepth[yy*pw+xx]; if (v > mx) mx = v;
      }
      const own = D.rawD ? D.rawD[i] : D.srcDepth[i];
      if (mx > own + GAP) nearCliff[i] = 1;
    }
    let srcDark = 0, srcDarkStroke = 0, srcDarkAdopted = 0, srcDarkCliff = 0, srcDarkCliffStuck = 0;
    if (S && S.w === pw) {
      for (let i = 0; i < PN; i++) {
        if (S.lum[i] < 0.30) {
          srcDark++;
          if (S.stroke[i]) srcDarkStroke++;
          if (S.adopt[i] > 0 && S.adopt[i] > S.D0[i] + GAP) srcDarkAdopted++;
          if (nearCliff[i]) { srcDarkCliff++; if (!(S.adopt[i] > 0 && S.adopt[i] > S.D0[i] + GAP)) srcDarkCliffStuck++; }
        }
      }
    }
    // plate leak: dark fill pixels in the removed-content zone (band or under)
    let fillDarkRemoved = 0, removedTot = 0, fillDarkCliff = 0, cliffTot = 0;
    for (let i = 0; i < PN; i++) {
      const removed = D.band[i] || (D.underMask && D.underMask[i]);
      if (removed) { removedTot++; if (lumF(i) < 0.30) fillDarkRemoved++; }
      if (nearCliff[i] && !removed) { cliffTot++; if (lumF(i) < 0.30) fillDarkCliff++; }
    }
    // dump plate fill + plug + leak overlay
    const mk = (fn) => { const c = document.createElement('canvas'); c.width = pw; c.height = ph;
      const cx = c.getContext('2d'); const id = cx.createImageData(pw, ph);
      for (let i = 0; i < PN; i++) fn(i, id.data, i*4);
      cx.putImageData(id, 0, 0); return c.toDataURL('image/png'); };
    const fillPng = mk((i, d, o) => { d[o]=D.pre[i*3]; d[o+1]=D.pre[i*3+1]; d[o+2]=D.pre[i*3+2]; d[o+3]=255; });
    const plugPng = mk((i, d, o) => { const v = Math.max(0, Math.min(255, D.plug[i]*255|0)); d[o]=d[o+1]=d[o+2]=v; d[o+3]=255; });
    const leakPng = mk((i, d, o) => {
      const dark = lumF(i) < 0.30; const removed = D.band[i] || (D.underMask && D.underMask[i]);
      const g = Math.max(0, Math.min(255, D.pre[i*3+1]|0)) >> 1;
      d[o]=dark && (removed || nearCliff[i]) ? 255 : g; d[o+1]=g; d[o+2]=g; d[o+3]=255; });
    return { pw, ph, srcDark, srcDarkStroke, srcDarkAdopted, srcDarkCliff, srcDarkCliffStuck,
             removedTot, fillDarkRemoved, cliffTot, fillDarkCliff, fillPng, plugPng, leakPng };
  });
  if (!res.err) {
    for (const k of ['fillPng','plugPng','leakPng']) {
      fs.writeFileSync(OUT + '/sw_' + k.replace('Png','') + '.png', Buffer.from(res[k].split(',')[1], 'base64'));
      delete res[k];
    }
  }
  console.log(JSON.stringify(res, null, 1));
  console.log(logs.join('\n') || '(no logs)');
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
