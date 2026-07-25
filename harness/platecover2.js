// A113 MEASUREMENT — PLATE COVERAGE vs ANGLE, ON A **FULL v1 BAKE**.
//
// harness/platecover.js used bgQuickBake, and the quick branch RETURNS at
// L11716 — long before the scene-extension block at L14099. So that probe
// could never see a113 at all, and its numbers were identical before and
// after the edit for a reason that had nothing to do with the edit.
// (It is still a valid measurement of the quick path: the 23x vertical
// asymmetry it reports exists with NO scene extension in the scene.)
//
// This probe runs the v1 full bake, which is the path the user bakes with
// and the only path that builds the extended plate, and A/Bs the margin
// law with window._legacyExtMargin. Same two numbers per pose:
//   black%      what the user sees as a hole, FG + plate + cards all drawn
//   plateOnly%  how much the plate alone covers, FG hidden
//
//   node harness/platecover2.js [troll|star|warrior]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const OUTD = '/workspace/moebiusv2/harness/val';
const SRC = { troll:   ['defaultImgColor.png', 'defaultImgDepth.png'],
              star:    ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };
const ASSET = process.argv[2] || 'troll';

const SWEEP = async (page) => page.evaluate(async () => {
  isSweeping = true;
  const L = mediaLayers[0];
  const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
  const W = 480, Hh = 300;
  const grab = () => { for (let n = 0; n < 3; n++) render();
    const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
    const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
    return cx.getImageData(0, 0, W, Hh).data; };
  camera.position.set(0, 0, dist);
  const d0 = grab();
  let x0 = W, x1 = -1, y0 = Hh, y1 = -1;
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) { const i = (y*W+x)*4;
    if (d0[i]+d0[i+1]+d0[i+2] > 24) { if (x<x0) x0=x; if (x>x1) x1=x; if (y<y0) y0=y; if (y>y1) y1=y; } }
  const pct = (d, want) => { let n = 0, tot = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = (y*W+x)*4; tot++;
      const lit = d[i]+d[i+1]+d[i+2] > 24; if (lit === want) n++; }
    return 100*n/Math.max(1,tot); };
  const out = [];
  for (const deg of [0, 10, 20, 30, 40, 50]) {
    const r = dist * Math.tan(deg * Math.PI / 180);
    for (const [dx, dy, nm] of [[1,0,'R'],[0,-1,'D'],[0,1,'U']]) {
      if (deg === 0 && nm !== 'R') continue;
      camera.position.set(r*dx, r*dy, dist);
      L.mesh.visible = true;
      const black = pct(grab(), false);
      let png = null;
      if (deg === 0 || (deg === 30 && nm !== 'R')) { for (let n = 0; n < 2; n++) render();
        png = renderer.domElement.toDataURL('image/png'); }
      L.mesh.visible = false;
      const plateOnly = pct(grab(), true);
      L.mesh.visible = true;
      out.push({ deg, dir: deg === 0 ? '-' : nm, black: +black.toFixed(2), plateOnly: +plateOnly.toFixed(2), png });
    }
  }
  camera.position.set(0, 0, dist); render();
  return { rows: out, box: [x1-x0+1, y1-y0+1] };
});

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const all = {};
  for (const [tag, legacy] of [['a113 envelope margin', false], ['legacy slider margin', true]]) {
    const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 140)));
    page.on('console', m => { const t = m.text();
      if (/\[A113\]|SCENE-EXT|EXT-PLATE/.test(t)) console.log('  ' + t.slice(0, 200)); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 40; t++) {
      const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
      if (ok) break; await new Promise(r => setTimeout(r, 1000));
    }
    console.log('\n=== ' + tag + ' ===');
    await page.evaluate((lg) => { window._rayReproject = true; window._legacyExtMargin = lg;
      bgQuickBake = false; bgMPIFullPlanes = false; bgMPIMode = false;
      window._bsRefs = null; buildBackgroundLayer(); }, legacy);
    await page.waitForFunction(() => !!window._bsRefs, null, { timeout: 900000, polling: 2000 })
      .catch(() => console.log('  [WARN] _bsRefs never set — bake did not reach RUNG-PLUG'));
    await new Promise(r => setTimeout(r, 800));
    const r = await SWEEP(page);
    const slug = legacy ? 'legacy' : 'a113';
    for (const row of r.rows) { if (!row.png) continue;
      try { fs.writeFileSync(path.join(OUTD, 'PC2_' + ASSET + '_' + slug + '_' + row.deg + row.dir + '.png'),
            Buffer.from(row.png.split(',')[1], 'base64')); } catch (e) {}
      delete row.png; }
    for (const row of r.rows) delete row.png;
    all[tag] = r.rows;
    console.log('  footprint box ' + r.box.join('x'));
    await page.close();
  }
  const A = all['a113 envelope margin'], B = all['legacy slider margin'];
  console.log('\n' + ASSET + '  FULL v1 BAKE, inside the layer footprint (cone 60deg half-angle)');
  console.log('  deg dir   black% a113   black% legacy      plateOnly a113   legacy');
  for (let i = 0; i < A.length; i++) {
    const a = A[i], b = B[i] || {};
    console.log('  ' + String(a.deg).padStart(3) + '  ' + a.dir.padEnd(3) +
      String(a.black).padStart(10) + String(b.black).padStart(16) +
      String(a.plateOnly).padStart(20) + String(b.plateOnly).padStart(9));
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
