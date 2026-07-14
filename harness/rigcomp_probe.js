// A54 one-off: component census of the CLOSED standing mask (post-bake
// state): sizes, p90 lift, bbox — is the party one component, how big,
// and does it bridge into the crest halo?
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
fs.copyFileSync('../starwatcher_color.png', 'defaultImgColor.png');
fs.copyFileSync('../starwatcher_depth.png', 'defaultImgDepth.png');
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate(() => {
    window._srCapture = true;
    bgQuickBake = true;
    buildBackgroundLayer();
    window._srCapture = false;
    const D = window._qbDbg;
    const pw = D.pw, ph = D.ph, PN = pw * ph;
    let band = new Uint8Array(PN);
    for (let i = 0; i < PN; i++) if (D.d[i] - D.plate[i] > 0.02) band[i] = 1;
    const KC = Math.max(2, Math.round(3 * pw / 1200));
    for (let p = 0; p < KC; p++) { const nb = band.slice();
      for (let y = 1; y < ph-1; y++) for (let x = 1; x < pw-1; x++) { const i = y*pw+x;
        if (!band[i] && (band[i-1]||band[i+1]||band[i-pw]||band[i+pw])) nb[i] = 1; } band = nb; }
    for (let p = 0; p < KC; p++) { const nb = band.slice();
      for (let y = 1; y < ph-1; y++) for (let x = 1; x < pw-1; x++) { const i = y*pw+x;
        if (band[i] && (!band[i-1]||!band[i+1]||!band[i-pw]||!band[i+pw])) nb[i] = 0; } band = nb; }
    const seen = new Uint8Array(PN);
    const q = new Int32Array(PN);
    const comps = [];
    for (let s = 0; s < PN; s++) {
      if (!band[s] || seen[s]) continue;
      let qh = 0, qt = 0; q[qt++] = s; seen[s] = 1;
      let n = 0, x0 = pw, x1 = 0, y0 = ph, y1 = 0;
      const lifts = [];
      while (qh < qt) {
        const i = q[qh++]; n++;
        const x = i % pw, y = (i/pw)|0;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (n % 7 === 0) lifts.push(D.d[i] - D.plate[i]);
        if (x > 0 && band[i-1] && !seen[i-1]) { seen[i-1]=1; q[qt++]=i-1; }
        if (x < pw-1 && band[i+1] && !seen[i+1]) { seen[i+1]=1; q[qt++]=i+1; }
        if (y > 0 && band[i-pw] && !seen[i-pw]) { seen[i-pw]=1; q[qt++]=i-pw; }
        if (y < ph-1 && band[i+pw] && !seen[i+pw]) { seen[i+pw]=1; q[qt++]=i+pw; }
      }
      lifts.sort((a,b)=>a-b);
      comps.push({ n, bbox: [x0,x1,y0,y1], p50: +(lifts[lifts.length>>1]||0).toFixed(3),
                   p90: +(lifts[Math.floor(lifts.length*0.9)]||0).toFixed(3) });
    }
    comps.sort((a,b)=>b.n-a.n);
    return { KC, nComps: comps.length, top: comps.slice(0, 12) };
  });
  console.log(JSON.stringify(res, null, 1));
  await browser.close(); srv.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
