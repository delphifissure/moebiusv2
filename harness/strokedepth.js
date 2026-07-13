// STROKE DEPTH REPAIR verification (ground truth): synT draws, in COLOR
// ONLY (depth untouched), (a) a dark outline hugging the occluder, (b) a
// staff line connected to the occluder's top edge running into the sky,
// (c) an isolated stroke with no near content (negative control). After
// applyLiveBake the shipped depth must carry the occluder depth on (a)
// and (b) and remain sky on (c). argv[2] = moebius.js variant ('' = live).
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const SRC = process.argv[2] || null;
const meta = JSON.parse(fs.readFileSync('synth/synT_meta.json', 'utf8'));
(async () => {
  fs.copyFileSync('synth/synT_color.png', 'defaultImgColor.png');
  fs.copyFileSync('synth/synT_depth.png', 'defaultImgDepth.png');
  let pageFile = 'scratch_moebius.html';
  if (SRC) {
    fs.copyFileSync(SRC, 'm_active.js');
    fs.writeFileSync('scratch_ab.html',
      fs.readFileSync('scratch_moebius.html', 'utf8').replace('src="moebius.js"', 'src="m_active.js"'));
    pageFile = 'scratch_ab.html';
  }
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const logs = [];
  page.on('console', m => { const t = m.text(); if (/STROKE-REPAIR/.test(t)) logs.push(t); });
  await page.goto('http://localhost:8099/' + pageFile, { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate((meta) => {
    bgMPIFullPlanes = false; bgMPIMode = true; bgPlugMode = 'directional'; bgValidMode = 'auto';
    buildBackgroundLayer();   // runs applyLiveBake -> repaired depth ships in L.textures.depth.image2d
    const oc = mediaLayers[0].textures.depth.image2d;
    if (!oc) return { err: 'no image2d' };
    const cx = oc.getContext('2d');
    const W = oc.width, H = oc.height;
    const px = cx.getImageData(0, 0, W, H).data;
    const dAt = (x, y) => px[(y * W + x) * 4] / 255;
    const p = meta.probe;
    const occD = 173 / 255;
    const mean = (pts) => { let s = 0; for (const [x, y] of pts) s += dAt(x, y); return s / pts.length; };
    const outlinePts = [], staffPts = [], isoPts = [];
    for (let x = p.outlineXs[0] - 1; x <= p.outlineXs[0]; x++) outlinePts.push([x, p.outlineY]);
    for (let x = p.outlineXs[1]; x <= p.outlineXs[1] + 1; x++) outlinePts.push([x, p.outlineY]);
    for (let y = p.staffYs[0]; y <= p.staffYs[1]; y += 5) staffPts.push([p.staffX, y]);
    for (let x = p.isoXs[0]; x <= p.isoXs[1]; x += 5) isoPts.push([x, Math.round(p.isoY - (x - p.isoXs[0]) * 30 / 190)]);
    const skyD = meta.dSky / 255;
    // caravan ground truth: ground depth at each figure's row
    const gd = (yy) => (meta.dHor + (meta.dNear - meta.dHor) * (yy - meta.horizon) / Math.max(1, meta.H - meta.horizon)) / 255;
    let carDev = 0;
    for (const [cxp, cyp] of meta.probe.caravan) carDev = Math.max(carDev, Math.abs(dAt(cxp, cyp) - gd(cyp)));
    const orn = dAt(meta.probe.ornament[0], meta.probe.ornament[1]);
    const fpD = dAt(meta.probe.footprint[0], meta.probe.footprint[1]);
    const fpTruth = gd(meta.probe.footprint[1]);
    // horizon-line control: thin scenery ink crossing behind the staff must
    // NOT adopt near depth — it must match the surface it lies on (probe the
    // rows just below the 2px line; the line sits ON the scene's sky step)
    const hPts = [], hRef = [];
    for (const [hx0, hx1] of p.horizonXs) for (let x = hx0; x <= hx1; x += 20) {
      hPts.push([x, p.horizonY]); hRef.push([x, p.horizonY + 4]);
    }
    return {
      horizon: +mean(hPts).toFixed(3),
      horizonRef: +mean(hRef).toFixed(3),
      outline: +mean(outlinePts).toFixed(3),
      staff: +mean(staffPts).toFixed(3),
      iso: +mean(isoPts).toFixed(3),
      caravanDev: +carDev.toFixed(3),
      ornament: +orn.toFixed(3),
      footDev: +Math.abs(fpD - fpTruth).toFixed(3),
      occD: +occD.toFixed(3), skyD: +skyD.toFixed(3), W, H,
    };
  }, meta);
  console.log((SRC || 'live'), JSON.stringify(res), logs[0] || '(no repair log)');
  if (!res.err) {
    const okOutline = Math.abs(res.outline - res.occD) < 0.06;
    const okStaff   = Math.abs(res.staff - res.occD) < 0.06;
    const okIso     = res.iso < res.skyD + 0.06;
    const okCaravan = res.caravanDev < 0.06;
    const okOrn     = Math.abs(res.ornament - res.occD) < 0.06;
    const okFoot    = res.footDev < 0.06;
    const okHorizon = Math.abs(res.horizon - res.horizonRef) < 0.06;
    console.log((okOutline?'OK  ':'FAIL'), 'outline adopts occluder depth');
    console.log((okStaff?'OK  ':'FAIL'), 'staff at native near depth stays (estimator-caught object)');
    console.log((okIso?'OK  ':'FAIL'), 'isolated stroke untouched (negative control)');
    console.log((okCaravan?'OK  ':'FAIL'), 'far-side figures by the cliff NOT lifted (caravan case)');
    console.log((okOrn?'OK  ':'FAIL'), 'thick ornament lifts (threaded on near ink)');
    console.log((okFoot?'OK  ':'FAIL'), 'footprint beside outline stays (one-sided brush)');
    console.log((okHorizon?'OK  ':'FAIL'), 'horizon line behind occluder NOT lifted (anti-staff control)');
  }
  await browser.close(); srv.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
