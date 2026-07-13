// A45 one-off: where along the y=300 control line does the shipped depth
// lift, and which mechanism (adopt spans from _srDbg vs later stages)?
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
(async () => {
  fs.copyFileSync('synth/synT_color.png', 'defaultImgColor.png');
  fs.copyFileSync('synth/synT_depth.png', 'defaultImgDepth.png');
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
  const FLAG = process.argv[2] || '';
  const res = await page.evaluate((FLAG) => {
    window._srCapture = true;
    if (FLAG === 'noGC') window._srNoGC = true;
    if (FLAG === 'noP2') window._srNoP2 = true; if ((typeof process === "undefined") && window) {} 
    bgMPIFullPlanes = false; bgMPIMode = true; bgPlugMode = 'directional'; bgValidMode = 'auto';
    buildBackgroundLayer();
    window._srCapture = false;
    const oc = mediaLayers[0].textures.depth.image2d;
    const cx = oc.getContext('2d');
    const W = oc.width, H = oc.height;
    const px = cx.getImageData(0, 300, W, 2).data;
    // spans where shipped depth on the line > 0.1 (sky is 0.031)
    const spans = [];
    let s = -1;
    for (let x = 0; x < W; x++) {
      const v = px[x * 4] / 255;
      const hot = v > 0.12 && !(x >= 597 && x <= 604);
      if (hot && s < 0) s = x;
      if (!hot && s >= 0) { spans.push([s, x - 1, +(px[(x-1)*4]/255).toFixed(3)]); s = -1; }
    }
    if (s >= 0) spans.push([s, W - 1, +(px[(W-1)*4]/255).toFixed(3)]);
    // which of those were phase-1 adopted?
    const S = window._srDbg;
    let adoptSpans = 0;
    if (S) for (let x = 0; x < W; x++) if (S.adopt[300 * W + x] > 0) adoptSpans++;
    const L0 = mediaLayers[0];
    const colProfile = {};
    for (const cxp of [100, 900]) {
      const col = [];
      const cpx2 = cx.getImageData(cxp, 288, 1, 30).data;
      for (let k = 0; k < 30; k++) col.push(+(cpx2[k*4]/255).toFixed(3));
      colProfile[cxp] = col;
    }
    const raw = [];
    if (L0._rawDepth && L0._rawDepthW === W) for (const x of [100, 300, 500, 596, 700, 900]) raw.push([x, +L0._rawDepth[300 * W + x].toFixed(3)]);
    return { spans: spans.slice(0, 30), nSpans: spans.length, adoptOnRow: adoptSpans, raw, colProfile };
  }, FLAG);
  console.log(JSON.stringify(res, null, 1));
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
