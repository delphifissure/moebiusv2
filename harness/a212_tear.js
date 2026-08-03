// A212 A/B: QUICK FG PRE-TEAR (scan-gated a160 fold criterion) vs UNTORN.
// The quick path returns before the v1 pre-tear, so the shipped default has
// rendered the untorn FG forever — the staff/ship/body taffy. Arms rebake
// with fgPreTear false (A: shipped-until-now) vs true (B: A212).
// Metrics at the user's pose cam(-0.756, 0.064, 0.320):
//   staff/ship boxes: streak energy (mean max(0,|dL/dx|-|dL/dy|)) — down = win
//   ground box: |laplacian| speckle — must stay ~flat (a211's failure mode)
//   REST frame: % pixels changed A vs B — the silhouette-nibble cost, stated.
//   node harness/a212_tear.js
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const OUT = process.env.OUT || '/tmp/claude-0/-home-user-moebius/989b3965-28fd-58c7-96b5-b4b22c709919/scratchpad';

(async () => {
  fs.copyFileSync(path.join(WT, 'starwatcher_color.png'), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, 'starwatcher_depth.png'), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
  page.on('console', m => { const t = m.text(); if (t.includes('A212')) console.log('  [page] ' + t.slice(0, 160)); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  console.log('served ' + await page.evaluate(() => MOEBIUS_BUILD));

  const shoot = async (tear, tag, ungated) => {
    const r = await page.evaluate(async (o) => {
      window._rayReproject = true;
      fgPreTear = o.tear;
      window._a212Ungated = o.ungated || false;
      // restore the full index before every bake so arms are independent
      const g = mediaLayers[0].mesh.geometry;
      if (g.userData._fullIndex) g.setIndex(new THREE.BufferAttribute(g.userData._fullIndex.slice(), 1));
      bgQuickBake = true; buildBackgroundLayer();
      if (typeof updateVolumeGuidesVisibility === 'function') updateVolumeGuidesVisibility(false);
      isSweeping = true;
      const grab = () => {
        const W = renderer.domElement.width, Hh = renderer.domElement.height;
        const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
        const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
        return { d: cx.getImageData(0, 0, W, Hh).data, W, Hh, png: cv.toDataURL('image/png') };
      };
      // rest frame first (nibble check)
      camera.position.set(0, 0, 0.2); updateCameraAndProjection(); render(); updateCameraAndProjection(); render();
      const rest = grab();
      // the user's pose
      camera.position.set(-0.756, 0.064, 0.320); updateCameraAndProjection(); render(); updateCameraAndProjection(); render();
      const off = grab();
      const L = (g2, x, y) => { const i = (y*g2.W+x)*4; return 0.299*g2.d[i]+0.587*g2.d[i+1]+0.114*g2.d[i+2]; };
      const boxes = { staff: [0.155, 0.10, 0.26, 0.60],
                      ship:  [0.03, 0.05, 0.20, 0.22],
                      ghost: [0.02, 0.35, 0.14, 0.75],
                      ground:[0.55, 0.80, 0.95, 0.97] };
      const m = {};
      for (const k in boxes) {
        const [u0, v0, u1, v1] = boxes[k];
        const x0 = Math.max(2, Math.round(u0*off.W)), x1 = Math.min(off.W-3, Math.round(u1*off.W));
        const y0 = Math.max(2, Math.round(v0*off.Hh)), y1 = Math.min(off.Hh-3, Math.round(v1*off.Hh));
        let streak = 0, lap = 0, n = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const gx = Math.abs(L(off, x+1, y) - L(off, x-1, y)) * 0.5;
          const gy = Math.abs(L(off, x, y+1) - L(off, x, y-1)) * 0.5;
          streak += Math.max(0, gx - gy);
          lap += Math.abs(4*L(off, x, y) - L(off, x+1, y) - L(off, x-1, y) - L(off, x, y+1) - L(off, x, y-1));
          n++;
        }
        m[k] = { streak: +(streak/n).toFixed(3), lap: +(lap/n).toFixed(3) };
      }
      // pack the rest frame luma for the cross-arm delta (coarse: every 2px)
      const rl = [];
      for (let y = 0; y < rest.Hh; y += 2) for (let x = 0; x < rest.W; x += 2) rl.push(Math.round(L(rest, x, y)));
      return { m, restLuma: rl, png: off.png, restPng: rest.png };
    }, { tear, ungated });
    fs.writeFileSync(path.join(OUT, 'a212_' + tag + '.png'), Buffer.from(r.png.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT, 'a212_' + tag + '_rest.png'), Buffer.from(r.restPng.split(',')[1], 'base64'));
    console.log(tag + ': ' + JSON.stringify(r.m));
    return r;
  };

  const A = await shoot(false, 'untorn');
  const B = await shoot(true,  'torn');
  const C = await shoot(true,  'torn_ungated', true);
  // attribution: hide the FG mesh at the user pose — if the ghost smear
  // survives, it is the PLATE's slope-limited ramp, not FG rubber.
  const attr = await page.evaluate(async () => {
    mediaLayers[0].mesh.visible = false;
    updateCameraAndProjection(); render(); updateCameraAndProjection(); render();
    const W = renderer.domElement.width, Hh = renderer.domElement.height;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
    const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
    const png = cv.toDataURL('image/png');
    mediaLayers[0].mesh.visible = true;
    updateCameraAndProjection(); render();
    return png;
  });
  fs.writeFileSync(path.join(OUT, 'a212_fghidden.png'), Buffer.from(attr.split(',')[1], 'base64'));
  let ch = 0, big = 0;
  for (let i = 0; i < A.restLuma.length; i++) {
    const d = Math.abs(A.restLuma[i] - B.restLuma[i]);
    if (d > 8) ch++; if (d > 32) big++;
  }
  const pct = (a, b) => ((b - a) / Math.max(1e-6, a) * 100).toFixed(1);
  console.log('VERDICT gated:   staff ' + pct(A.m.staff.streak, B.m.staff.streak) + '% ship ' + pct(A.m.ship.streak, B.m.ship.streak) +
              '% ghost ' + pct(A.m.ghost.streak, B.m.ghost.streak) + '% groundLap ' + pct(A.m.ground.lap, B.m.ground.lap) +
              '% | REST delta ' + (100*ch/A.restLuma.length).toFixed(2) + '% >8, ' + (100*big/A.restLuma.length).toFixed(2) + '% >32');
  console.log('VERDICT ungated: staff ' + pct(A.m.staff.streak, C.m.staff.streak) + '% ship ' + pct(A.m.ship.streak, C.m.ship.streak) +
              '% ghost ' + pct(A.m.ghost.streak, C.m.ghost.streak) + '% groundLap ' + pct(A.m.ground.lap, C.m.ground.lap) + '%');
  await browser.close(); srv.kill(); process.exit(0);
})();
