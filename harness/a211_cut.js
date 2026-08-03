// A211 A/B: PLATE-BACKED STRETCH CUT vs THE SHIPPED MASK GATE.
// User report (a209/a210 sheet, star asset): taffy on the staff and on the
// spaceship at cam(-0.756, 0.064, 0.320) even though the FG-sub contract
// classifies those pixels as GAP (blue) — the screen pass sees them, the
// bake mask that gates the live cut does not (thin-feature reveals).
// Arm A: shipped (mask-gated). Arm B: plate-backed (u_cutPlateBacked=true,
// the a161 argument: with a plate behind, a discard reveals plate, not hole).
// Metrics, same quick bake, same pose, per arm:
//   - streak energy in the STAFF and SHIP boxes: mean over pixels of
//     max(0, |dL/dx| - |dL/dy|) — vertical streamers are strong horizontal
//     gradients with weak vertical ones. Down = less taffy.
//   - speckle on OPEN GROUND (dune box): mean |laplacian| — the a83/a84
//     failure mode was the dithered band eating legitimate grazing ground;
//     this must NOT rise materially in arm B.
//   node harness/a211_cut.js
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
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  console.log('served ' + await page.evaluate(() => MOEBIUS_BUILD));

  await page.evaluate(() => {
    window._rayReproject = true;
    bgQuickBake = true; buildBackgroundLayer();
    if (typeof updateVolumeGuidesVisibility === 'function') updateVolumeGuidesVisibility(false);
    isSweeping = true;
    camera.position.set(-0.756, 0.064, 0.320);   // the user's pose
  });

  const shoot = async (backed, tag) => {
    const r = await page.evaluate(async (o) => {
      window._cutPlateBacked = o.backed;
      updateCameraAndProjection(); render();
      updateCameraAndProjection(); render();
      const W = renderer.domElement.width, Hh = renderer.domElement.height;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
      const d = cx.getImageData(0, 0, W, Hh).data;
      const L = (x, y) => { const i = (y*W+x)*4; return 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; };
      // boxes in fractions of the frame, read off the user's 912x513 sheet
      const boxes = { staff: [0.155, 0.10, 0.26, 0.60],
                      ship:  [0.03, 0.05, 0.20, 0.22],
                      ground:[0.55, 0.80, 0.95, 0.97] };
      const outM = {};
      for (const k in boxes) {
        const [u0, v0, u1, v1] = boxes[k];
        const x0 = Math.max(2, Math.round(u0*W)), x1 = Math.min(W-3, Math.round(u1*W));
        const y0 = Math.max(2, Math.round(v0*Hh)), y1 = Math.min(Hh-3, Math.round(v1*Hh));
        let streak = 0, lap = 0, n = 0;
        for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
          const gx = Math.abs(L(x+1, y) - L(x-1, y)) * 0.5;
          const gy = Math.abs(L(x, y+1) - L(x, y-1)) * 0.5;
          streak += Math.max(0, gx - gy);
          lap += Math.abs(4*L(x, y) - L(x+1, y) - L(x-1, y) - L(x, y+1) - L(x, y-1));
          n++;
        }
        outM[k] = { streak: +(streak/n).toFixed(3), lap: +(lap/n).toFixed(3) };
      }
      return { m: outM, png: cv.toDataURL('image/png') };
    }, { backed });
    fs.writeFileSync(path.join(OUT, 'a211_' + tag + '.png'), Buffer.from(r.png.split(',')[1], 'base64'));
    console.log(tag + ': ' + JSON.stringify(r.m));
    return r.m;
  };

  const A = await shoot(false, 'maskgated');
  const B = await shoot(true,  'platebacked');
  const pct = (a, b) => ((b - a) / Math.max(1e-6, a) * 100).toFixed(1);
  console.log('VERDICT: staff streak ' + A.staff.streak + ' -> ' + B.staff.streak + ' (' + pct(A.staff.streak, B.staff.streak) + '%)' +
              ' | ship streak ' + A.ship.streak + ' -> ' + B.ship.streak + ' (' + pct(A.ship.streak, B.ship.streak) + '%)' +
              ' | ground speckle ' + A.ground.lap + ' -> ' + B.ground.lap + ' (' + pct(A.ground.lap, B.ground.lap) + '%)');
  await browser.close(); srv.kill(); process.exit(0);
})();
