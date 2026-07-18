// A73 diagnostic 2: seed field + class map + region stats (build-only, no shots).
// Decides between "far-lip seeds missing" (seed-value defect) and "far-lip
// seeds losing to nearer body anchors" (conflict-rule defect).
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = process.argv[2];
const H = path.join(WT, 'harness');
const OUTD = '/workspace/moebiusv2/harness/val';
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 851, height: 1023 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 140)));
  await page.goto('http://localhost:8099/fp_test.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
  await page.evaluate(() => {
    window._foldProbe = true; window._bgQuickBaked = false;
    const s = document.getElementById('bgModeSel');
    if (s) { s.value = 'quick'; s.dispatchEvent(new Event('change')); }
    document.getElementById('bgLayerBuildBtn').click();
  });
  await page.waitForFunction(() => window._bgQuickBaked === true, null, { timeout: 300000 });
  const stats = await page.evaluate(() => {
    const d = window._fpData, s = window._fpSeed;
    const N = d.pw * d.ph, pw = d.pw;
    // region stats: rect = [x, y, w, h]
    const R = { passage: [370, 290, 230, 260], woman: [430, 450, 110, 440], ring: [400, 420, 180, 500] };
    const out = {};
    for (const k in R) {
      const [rx, ry, rw, rh] = R[k];
      let n = 0, nG = 0, sD = 0, nCl = 0, sP = 0, sAv = 0, nSeed = 0, nSeedFar = 0, nSeedNear = 0, sSeedAv = 0;
      for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) {
        const i = y * pw + x;
        n++; sD += d.dQ[i];
        if (d.ground && d.ground[i]) nG++;
        if (d.claimedF[i]) { nCl++; sP += d.P[i]; sAv += d.carAv[i]; }
        if (s.seen[i]) { nSeed++; sSeedAv += s.av[i]; if (s.av[i] <= 0.2) nSeedFar++; if (s.av[i] > 0.35) nSeedNear++; }
      }
      out[k] = { px: n, groundPct: +(nG / n * 100).toFixed(1), meanSrc: +(sD / n).toFixed(3),
                 claimedPct: +(nCl / n * 100).toFixed(1),
                 meanP: nCl ? +(sP / nCl).toFixed(3) : null, meanWinAv: nCl ? +(sAv / nCl).toFixed(3) : null,
                 seeds: nSeed, seedFar: nSeedFar, seedNear: nSeedNear,
                 meanSeedAv: nSeed ? +(sSeedAv / nSeed).toFixed(3) : null };
    }
    let totSeed = 0, totSeedFar = 0;
    for (let i = 0; i < N; i++) if (s.seen[i]) { totSeed++; if (s.av[i] <= 0.2) totSeedFar++; }
    out.global = { seeds: totSeed, seedFarPct: +(totSeedFar / Math.max(1, totSeed) * 100).toFixed(1) };
    return out;
  });
  console.log('DIAG ' + JSON.stringify(stats, null, 1));
  const dump = async (name, mode) => {
    const png = await page.evaluate((mode) => {
      const d = window._fpData, s = window._fpSeed;
      const c = document.createElement('canvas'); c.width = d.pw; c.height = d.ph;
      const ctx = c.getContext('2d'); const im = ctx.createImageData(d.pw, d.ph);
      for (let i = 0; i < d.pw * d.ph; i++) {
        let r = 0, g = 0, b = 0;
        if (mode === 'class') {
          // ground = green scaled by depth; object = red scaled by depth
          const v = 40 + Math.round(d.dQ[i] * 215);
          if (d.ground && d.ground[i]) g = v; else r = v;
        } else if (mode === 'seed') {
          // seeds: far (<=0.2) cyan, mid gray-blue, near (>0.35) yellow/red; non-seed dim depth
          if (s.seen[i]) { const v = s.av[i];
            if (v <= 0.2) { g = 200; b = 255; } else if (v > 0.35) { r = 255; g = 200; } else { r = 120; g = 120; b = 255; } }
          else { const v = Math.round(d.dQ[i] * 70); r = g = b = v; }
        }
        im.data[i*4] = r; im.data[i*4+1] = g; im.data[i*4+2] = b; im.data[i*4+3] = 255;
      }
      ctx.putImageData(im, 0, 0);
      return c.toDataURL('image/png');
    }, mode);
    fs.writeFileSync(path.join(OUTD, name), Buffer.from(png.split(',')[1], 'base64'));
    console.log('wrote ' + name);
  };
  await dump('FP_class.png', 'class');
  await dump('FP_seed.png', 'seed');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
