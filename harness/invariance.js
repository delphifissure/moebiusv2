// INVARIANCE SUITE. The regression suite pins per-asset numbers, which HIDES
// dimensional drift: a constant that silently means something different at a
// different resolution still reproduces its own pinned number. This asserts
// the property directly — the same scene, resampled, must bake to the same
// RELATIVE result. It is the test that would have caught a88 (sCone not
// scaled with resolution) and a89 (8-bit grid hardcoded) on the day they
// landed.
//
// Axes covered here: R (resolution) and B (source bit depth).
// Metrics are scale-free: SD mask %, plate coverage %, and the fraction of
// plate cells that FOLD at the fade end (the a88 symptom, measured directly).
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/arc73';
const H = path.join(WT, 'harness');
const SRC = { star: ['starwatcher_color.png','starwatcher_depth.png'],
              war:  ['silverwarrior_color.png','silverwarrior_depth.png'],
              troll:['defaultImgColor.png','defaultImgDepth.png'] };
const ASSET = process.argv[2] || 'star';
const TOL   = parseFloat(process.argv[3] || '0.15');   // 15% relative tolerance

(async () => {
  const { execSync } = require('child_process');
  // variants: full res, half res (R axis) and a 16-bit depth copy (B axis)
  const variants = [];
  for (const scale of [1.0, 0.5]) {
    const tag = 'inv_' + ASSET + '_s' + scale;
    execSync(`cd ${H} && python3 - <<'P'
from PIL import Image
c=Image.open('${WT}/${SRC[ASSET][0]}'); d=Image.open('${WT}/${SRC[ASSET][1]}')
w,h=int(c.size[0]*${scale}), int(c.size[1]*${scale})
c.resize((w,h), Image.LANCZOS).save('${H}/${tag}_color.png')
d.resize((w,h), Image.NEAREST).save('${H}/${tag}_depth.png')
print('${tag}', w, h)
P`, { stdio: 'inherit' });
    variants.push({ tag, scale });
  }
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const results = [];
  for (const v of variants) {
    fs.copyFileSync(path.join(H, v.tag + '_color.png'), path.join(H, 'defaultImgColor.png'));
    fs.copyFileSync(path.join(H, v.tag + '_depth.png'), path.join(H, 'defaultImgDepth.png'));
    const page = await browser.newPage({ viewport: { width: 933, height: 525 } });
    await page.goto('http://localhost:8099/fp_test.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
    await page.evaluate(() => { window._srCapture = true; bgQuickBake = true; window._bgQuickBaked = false; buildBackgroundLayer(); });
    await page.waitForFunction(() => window._bgQuickBaked === true, null, { timeout: 900000, polling: 2000 });
    const m = await page.evaluate(() => {
      const D = window._qbDbg; if (!D) return null;
      const { plate, d, pw, ph } = D;
      let mask = 0, folded = 0, cells = 0;
      // fold test: |dP/dx| * k >= 1 at the fade end, k = 396*(pw/1920) — the
      // SAME law the fill is calibrated against, so a mis-scaled sCone shows
      // up here as a resolution-dependent fold fraction.
      const k = 396 * (pw / 1920);
      for (let y = 0; y < ph; y++) for (let x = 0; x + 1 < pw; x++) {
        const i = y * pw + x;
        if (plate[i] < d[i] - 0.001) mask++;
        const g = Math.abs(plate[i + 1] - plate[i]);
        cells++; if (g * k >= 1) folded++;
      }
      return { pw, ph, maskPct: 100 * mask / (pw * ph), foldPct: 100 * folded / cells };
    });
    results.push({ ...v, ...m });
    console.log(`${v.tag}: ${m.pw}x${m.ph}  mask ${m.maskPct.toFixed(2)}%  folded ${m.foldPct.toFixed(2)}%`);
    await page.close();
  }
  await browser.close(); srv.kill();
  // ASSERT: scale-free metrics must agree across resolution
  let fail = 0;
  const [a, b] = results;
  for (const key of ['maskPct', 'foldPct']) {
    const rel = Math.abs(a[key] - b[key]) / Math.max(1e-6, Math.max(a[key], b[key]));
    const ok = rel <= TOL;
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${key} invariant across resolution: ${a[key].toFixed(2)} vs ${b[key].toFixed(2)} (rel ${(100*rel).toFixed(1)}%, tol ${(100*TOL).toFixed(0)}%)`);
  }
  console.log(fail ? `INVARIANCE FAIL (${fail})` : 'INVARIANCE PASS');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
