// A69 step 1: profile plateQ under the warrior figure — quantify the depth
// terraces (plateau lengths and step sizes along y) inside the disocc region,
// and dump a few raw column profiles for eyeballing.
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
  const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
  page.on('pageerror', e => console.log('  [PAGEERR] '+e.message.slice(0,140)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
  const res = await page.evaluate(() => {
    window._srCapture = true; window._rayReproject = true;
    bgQuickBake = true; buildBackgroundLayer();
    const dbg = window._qbDbg, mk = window._qbMask;
    if (!dbg || !mk) return { err: 'no capture' };
    const { plate, d, pw, ph } = dbg; const D = mk.disocc;
    // terrace stats along y inside the disocc region, columns across the figure bbox
    const stats = { plateaus: [], steps: [], cols: {} };
    const KEEP = new Set([1000, 1200, 1432, 1700, 2000]);
    for (let x = 500; x <= 2400; x += 25) {
      let runStart = -1, runVal = null, inD = false;
      const segs = [];
      for (let y = 400; y < ph; y++) {
        const i = y*pw + x;
        const on = !!D[i];
        if (on && !inD) { inD = true; runStart = y; runVal = plate[i]; }
        else if (!on && inD) { inD = false; if (y - runStart > 2) segs.push([runStart, y]); }
      }
      if (inD) segs.push([runStart, ph]);
      for (const [y0, y1] of segs) {
        // plateau detection: runs of |dplate/dy| < 1e-5, steps between them
        let ps = y0, pv = plate[y0*pw+x];
        for (let y = y0+1; y < y1; y++) {
          const v = plate[y*pw+x];
          if (Math.abs(v - pv) > 5e-4) {   // plateau break
            if (y - ps >= 4) { stats.plateaus.push(y - ps); stats.steps.push(Math.abs(v - pv)); }
            ps = y; pv = v;
          } else pv = v;   // track slow drift as same plateau
        }
        if (y1 - ps >= 4) stats.plateaus.push(y1 - ps);
      }
      if (KEEP.has(x)) {
        const prof = [];
        for (let y = 400; y < ph; y += 8) { const i = y*pw+x; prof.push([y, +(d[i].toFixed(4)), D[i] ? +(plate[i].toFixed(4)) : null]); }
        stats.cols[x] = prof;
      }
    }
    const med = (a) => { if (!a.length) return -1; const b = a.slice().sort((p,q)=>p-q); return b[(b.length/2)|0]; };
    return { pw, ph, nPlateaus: stats.plateaus.length,
             plateauMed: med(stats.plateaus), plateauP90: stats.plateaus.slice().sort((a,b)=>a-b)[(stats.plateaus.length*0.9)|0] || -1,
             stepMed: med(stats.steps), stepP90: stats.steps.slice().sort((a,b)=>a-b)[(stats.steps.length*0.9)|0] || -1,
             cols: stats.cols };
  });
  if (res.err) { console.log('ERR ' + res.err); process.exit(1); }
  fs.writeFileSync('a69_cols.json', JSON.stringify(res.cols));
  delete res.cols;
  console.log('TERRACES ' + JSON.stringify(res));
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
