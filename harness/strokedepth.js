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
    return {
      outline: +mean(outlinePts).toFixed(3),
      staff: +mean(staffPts).toFixed(3),
      iso: +mean(isoPts).toFixed(3),
      occD: +occD.toFixed(3), skyD: +skyD.toFixed(3), W, H,
    };
  }, meta);
  console.log((SRC || 'live'), JSON.stringify(res), logs[0] || '(no repair log)');
  if (!res.err) {
    const okOutline = Math.abs(res.outline - res.occD) < 0.06;
    const okStaff   = Math.abs(res.staff - res.occD) < 0.06;
    const okIso     = res.iso < res.skyD + 0.06;
    console.log((okOutline?'OK  ':'FAIL'), 'outline adopts occluder depth');
    console.log((okStaff?'OK  ':'FAIL'), 'staff adopts occluder depth (geodesic)');
    console.log((okIso?'OK  ':'FAIL'), 'isolated stroke untouched (negative control)');
  }
  await browser.close(); srv.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
