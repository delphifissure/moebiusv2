// A41 PROBE: after a v1 build on synT, the PLATE (world-without-FG) must
// carry NO outline ink: at every stroke probe the plate color must match
// the local BG (not dark) and the plug depth must be the BG completion
// (not the lifted near depth). Dumps band/underMask/plug/fill at the
// outline, staff, ornament, and occluder-interior probes.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const meta = JSON.parse(fs.readFileSync('synth/synT_meta.json', 'utf8'));
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
  const res = await page.evaluate((meta) => {
    window._dbgFillCapture = true;
    bgMPIFullPlanes = false; bgMPIMode = true; bgPlugMode = 'directional'; bgValidMode = 'auto';
    buildBackgroundLayer();
    window._dbgFillCapture = false;
    const D = window._dbgFill;
    if (!D) return { err: 'no _dbgFill capture' };
    const { pw, ph } = D;
    const at = (x, y) => {
      const i = y * pw + x;
      return {
        x, y,
        band: D.band[i],
        under: D.underMask ? D.underMask[i] : -1,
        plug: +D.plug[i].toFixed(3),
        src: +D.srcDepth[i].toFixed(3),
        raw: D.rawD ? +D.rawD[i].toFixed(3) : -1,
        fill: [D.pre[i*3]|0, D.pre[i*3+1]|0, D.pre[i*3+2]|0],
        fb: D.fb[i],
      };
    };
    const p = meta.probe;
    const probes = {
      outlineL: at(p.outlineXs[0], p.outlineY),          // left outline col
      outlineL2: at(p.outlineXs[0] - 1, p.outlineY),
      outlineR: at(p.outlineXs[1], p.outlineY),
      staff: at(p.staffX, p.staffYs[0]),
      staffHi: at(p.staffX, 170),                         // staff above ornament
      ornament: at(p.ornament[0], p.ornament[1]),
      occCenter: at(600, 500),                            // occluder interior
      occTop: at(600, 360),                               // occluder interior near top
      bgLeft: at(400, 500),                               // plain BG (reference)
      bgSky: at(400, 200),                                // plain sky (reference)
    };
    // how much outline ink survives in the fill: scan the full outline ring
    // (2px rect border at [497,347]-[702,652]) + staff, count dark fills
    let inkPx = 0, tot = 0, worstL = 1, worstAt = null;
    const dark = (i) => (0.2126*D.pre[i*3] + 0.7152*D.pre[i*3+1] + 0.0722*D.pre[i*3+2]) / 255;
    const scan = (x, y) => { const i = y*pw+x; tot++; const l = dark(i);
      if (l < 0.30) { inkPx++; if (l < worstL) { worstL = l; worstAt = [x, y]; } } };
    for (let x = 497; x <= 702; x++) { scan(x, 347); scan(x, 348); scan(x, 651); scan(x, 652); }
    for (let y = 347; y <= 652; y++) { scan(497, y); scan(498, y); scan(701, y); scan(702, y); }
    for (let y = 150; y <= 345; y += 1) scan(600, y);
    // plug-depth ghost inside the occluder footprint: max plug depth in the
    // interior (should be <= BG completion, never near the occluder's 0.678)
    let plugMax = 0, plugMaxAt = null;
    for (let y = 360; y <= 640; y++) for (let x = 510; x <= 690; x++) {
      const i = y*pw+x; if (D.plug[i] > plugMax) { plugMax = D.plug[i]; plugMaxAt = [x, y]; } }
    return { pw, ph, probes, inkPx, tot, worstL: +worstL.toFixed(3), worstAt, plugMax: +plugMax.toFixed(3), plugMaxAt };
  }, meta);
  console.log(JSON.stringify(res, null, 1));
  if (!res.err) {
    const lum = (c) => (0.2126*c[0] + 0.7152*c[1] + 0.0722*c[2]) / 255;
    const p = res.probes;
    const checks = [
      ['outline scrubbed from plate (left col fill not ink)',  lum(p.outlineL.fill) >= 0.30],
      ['outline scrubbed from plate (right col fill not ink)', lum(p.outlineR.fill) >= 0.30],
      ['staff scrubbed from plate',                            lum(p.staff.fill) >= 0.30],
      ['plate depth under staff = sky completion',             p.staff.plug < 0.1],
      ['plate depth at outline = BG completion (not lifted near)', p.outlineL.plug < 0.55],
      ['occluder interior completed (not occluder depth) at mid-height', p.occTop.plug < 0.55],
      ['outline-ring ink survivors bounded (ground-contact band residue only)', res.inkPx <= 120],
    ];
    let pass = true;
    for (const [n, ok] of checks) { console.log((ok ? 'OK  ' : 'FAIL'), n); if (!ok) pass = false; }
    console.log(pass ? 'ALL CHECKS PASS' : 'CHECKS FAILED');
  }
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
