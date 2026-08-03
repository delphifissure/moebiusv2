// A213 A/B: the shipped isotropic WASH vs the opt-in depth-consistent
// ROW-COLOUR fill (window._plateRowColor), convicted-ghost pose + in-cone.
// The ghost is the wash mixing sky into the ground half of the band (a212
// attribution). The row-colour pass fills each band texel from neighbours
// whose depth matches the plate target — directional by construction.
//   node harness/a213_ab.js
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
  page.on('console', m => { const t = m.text(); if (/row-colour|row \/ |skirt failed/.test(t)) console.log('  [page] ' + t.slice(0, 180)); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  console.log('served ' + await page.evaluate(() => MOEBIUS_BUILD));
  const shoot = async (rowcol, tag) => {
    const r = await page.evaluate(async (o) => {
      window._rayReproject = true;
      window._plateRowColor = o.rowcol;
      const g = mediaLayers[0].mesh.geometry;
      if (g.userData._fullIndex) g.setIndex(new THREE.BufferAttribute(g.userData._fullIndex.slice(), 1));
      bgQuickBake = true; buildBackgroundLayer();
      if (typeof updateVolumeGuidesVisibility === 'function') updateVolumeGuidesVisibility(false);
      isSweeping = true;
      const grab = () => {
        updateCameraAndProjection(); render(); updateCameraAndProjection(); render();
        const W = renderer.domElement.width, Hh = renderer.domElement.height;
        const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
        const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
        return { d: cx.getImageData(0, 0, W, Hh).data, W, Hh, png: cv.toDataURL('image/png') };
      };
      camera.position.set(0, 0, 0.2); const rest = grab();
      camera.position.set(-0.756, 0.064, 0.320); const user = grab();   // 67deg, the report pose
      camera.position.set(-0.28, 0.03, 0.32); const cone = grab();      // ~41deg, in-cone
      const L = (g2, x, y) => { const i = (y*g2.W+x)*4; return 0.299*g2.d[i]+0.587*g2.d[i+1]+0.114*g2.d[i+2]; };
      const m = {};
      for (const [name, g2] of [['user', user], ['cone', cone]]) {
        const boxes = { ghost: [0.02, 0.35, 0.14, 0.75], staff: [0.155, 0.10, 0.26, 0.60], ground: [0.55, 0.80, 0.95, 0.97] };
        for (const k in boxes) {
          const [u0, v0, u1, v1] = boxes[k];
          const x0 = Math.max(2, Math.round(u0*g2.W)), x1 = Math.min(g2.W-3, Math.round(u1*g2.W));
          const y0 = Math.max(2, Math.round(v0*g2.Hh)), y1 = Math.min(g2.Hh-3, Math.round(v1*g2.Hh));
          let streak = 0, lap = 0, n = 0;
          for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
            const gx = Math.abs(L(g2, x+1, y) - L(g2, x-1, y)) * 0.5;
            const gy = Math.abs(L(g2, x, y+1) - L(g2, x, y-1)) * 0.5;
            streak += Math.max(0, gx - gy);
            lap += Math.abs(4*L(g2, x, y) - L(g2, x+1, y) - L(g2, x-1, y) - L(g2, x, y+1) - L(g2, x, y-1));
            n++;
          }
          m[name + '.' + k] = { streak: +(streak/n).toFixed(3), lap: +(lap/n).toFixed(3) };
        }
      }
      const rl = [];
      for (let y = 0; y < rest.Hh; y += 2) for (let x = 0; x < rest.W; x += 2) rl.push(Math.round(L(rest, x, y)));
      return { m, restLuma: rl, userPng: user.png, conePng: cone.png };
    }, { rowcol });
    fs.writeFileSync(path.join(OUT, 'a213_' + tag + '_user.png'), Buffer.from(r.userPng.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT, 'a213_' + tag + '_cone.png'), Buffer.from(r.conePng.split(',')[1], 'base64'));
    console.log(tag + ': ' + JSON.stringify(r.m));
    return r;
  };
  const A = await shoot(false, 'wash');
  const B = await shoot(true,  'rowcol');
  let ch = 0; for (let i = 0; i < A.restLuma.length; i++) if (Math.abs(A.restLuma[i] - B.restLuma[i]) > 8) ch++;
  const pct = (a, b) => ((b - a) / Math.max(1e-6, a) * 100).toFixed(1);
  console.log('VERDICT: user.ghost streak ' + A.m['user.ghost'].streak + ' -> ' + B.m['user.ghost'].streak + ' (' + pct(A.m['user.ghost'].streak, B.m['user.ghost'].streak) + '%)' +
    ' lap ' + pct(A.m['user.ghost'].lap, B.m['user.ghost'].lap) + '%' +
    ' | cone.ghost streak ' + pct(A.m['cone.ghost'].streak, B.m['cone.ghost'].streak) + '%' +
    ' | user.ground lap ' + pct(A.m['user.ground'].lap, B.m['user.ground'].lap) + '%' +
    ' | REST delta ' + (100*ch/A.restLuma.length).toFixed(2) + '% px >8');
  await browser.close(); srv.kill(); process.exit(0);
})();
