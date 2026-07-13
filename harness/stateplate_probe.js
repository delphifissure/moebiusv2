// A43 STATE-LEVEL PLATE CONTRACT: the plate may never stand nearer than
// every FG surface in its neighbourhood — texture-space version of the
// protrude screen test, run directly on the build outputs so violating
// texels come back with their mask class (band / underMask / valid) and
// coordinates. argv[2] = 'synT'|'star' asset selector (default: leave
// harness defaults untouched).
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
if (process.argv[2] === 'synT') {
  fs.copyFileSync('synth/synT_color.png', 'defaultImgColor.png');
  fs.copyFileSync('synth/synT_depth.png', 'defaultImgDepth.png');
} else if (process.argv[2] === 'star') {
  fs.copyFileSync('../starwatcher_color.png', 'defaultImgColor.png');
  fs.copyFileSync('../starwatcher_depth.png', 'defaultImgDepth.png');
}
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate(() => {
    window._dbgFillCapture = true;
    bgMPIFullPlanes = false; bgMPIMode = true; bgPlugMode = 'directional'; bgValidMode = 'auto';
    buildBackgroundLayer();
    window._dbgFillCapture = false;
    const D = window._dbgFill;
    if (!D || !D.rawD) return { err: 'no capture / rawD' };
    const { pw, ph } = D, PN = pw * ph;
    // FG proxy = repaired depth (dispDepth adds only NEARER halo, so this
    // over-reports, never under-reports, plate violations)
    const R = 8, TH = 0.03;
    const rowMax = new Float32Array(PN), fgMax = new Float32Array(PN);
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { let m = 0;
      for (let o = -R; o <= R; o++) { const xx = x+o; if (xx<0||xx>=pw) continue;
        const v = D.rawD[y*pw+xx]; if (v > m) m = v; }
      rowMax[y*pw+x] = m; }
    for (let x = 0; x < pw; x++) for (let y = 0; y < ph; y++) { let m = 0;
      for (let o = -R; o <= R; o++) { const yy = y+o; if (yy<0||yy>=ph) continue;
        if (rowMax[yy*pw+x] > m) m = rowMax[yy*pw+x]; }
      fgMax[y*pw+x] = m; }
    let nBand = 0, nUnder = 0, nValid = 0, worst = 0;
    const tops = [];
    for (let i = 0; i < PN; i++) {
      const d = D.plug[i] - fgMax[i];
      if (d <= TH) continue;
      const cls = D.band[i] ? 'band' : (D.underMask && D.underMask[i] ? 'under' : 'valid');
      if (cls === 'band') nBand++; else if (cls === 'under') nUnder++; else nValid++;
      if (d > worst) worst = d;
      tops.push([i % pw, (i / pw) | 0, +d.toFixed(3), cls, +D.plug[i].toFixed(3), +D.srcDepth[i].toFixed(3), +D.rawD[i].toFixed(3)]);
    }
    tops.sort((a, b) => b[2] - a[2]);
    return { pw, ph, nBand, nUnder, nValid, worst: +worst.toFixed(3), tops: tops.slice(0, 25) };
  });
  console.log(JSON.stringify(res, null, 1));
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
