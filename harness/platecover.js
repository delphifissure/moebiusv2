// PLATE COVERAGE vs ANGLE. Head-on is now clean (rest black 0.00%), but off
// axis the user reports stretched pixels and EMPTY SPACES where disocclusion
// plugs should be. At rest the FG covers everything, so the plate is never
// asked to show. Off axis the FG separates and the plate must appear behind it.
// So the question is not "does the FG tear" but "does the plate reach".
//
// Two numbers per pose, inside the layer's own footprint (letterbox excluded):
//   black%      what the user sees as a hole, FG + plate + cards all drawn
//   plateOnly%  how much the plate alone covers, FG hidden
// If black% climbs with angle while plateOnly% stays flat and small, the plate
// is not reaching and that is the defect.
//
//   node harness/platecover.js [troll|star|warrior]
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

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 140)));
  page.on('console', m => { const t = m.text(); if (/\[A113\]|EXT-PLATE|SCENE-EXT/.test(t)) console.log('  ' + t.slice(0, 190)); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  const rows = await page.evaluate(async () => {
    window._rayReproject = true;
    bgQuickBake = true; buildBackgroundLayer();
    isSweeping = true;
    const L = mediaLayers[0];
    const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
    const W = 480, Hh = 300;
    const grab = () => { for (let n = 0; n < 3; n++) render();
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
      return cx.getImageData(0, 0, W, Hh).data; };
    // footprint from the rest pose with everything drawn: that is the layer box
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
      for (const [dx, dy, nm] of [[1,0,'R'],[0,-1,'D']]) {
        if (deg === 0 && nm === 'D') continue;
        camera.position.set(r*dx, r*dy, dist);
        L.mesh.visible = true;
        const black = pct(grab(), false);
        L.mesh.visible = false;
        const plateOnly = pct(grab(), true);
        L.mesh.visible = true;
        out.push({ deg, dir: deg === 0 ? '-' : nm, black: +black.toFixed(2), plateOnly: +plateOnly.toFixed(2) });
      }
    }
    camera.position.set(0, 0, dist); render();
    return out;
  });
  console.log('\n' + ASSET + '  (inside the layer footprint; cone is 60deg half-angle)');
  console.log('  deg dir    black%   plateOnly%');
  for (const r of rows) console.log('  ' + String(r.deg).padStart(3) + '  ' + r.dir.padEnd(3) +
    String(r.black).padStart(8) + String(r.plateOnly).padStart(13));
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
