// A191e: WHICH PLANE DRAWS THE SMEAR?
//
// a191a-d eliminated four candidate causes of the warrior's trailing band and
// withdrew the premise that it is periodic at all. The crop shows ragged
// horizontal filaments filling the disocclusion to the right of the figure.
//
// v2 draws that region from one of two places, and they have different owners:
//   - the FRONT planes, whose cells a177's tear criterion governs. Already
//     eliminated: tearing 8x harder gave 36% more quads and moved comb energy
//     by +0.2% (a191d).
//   - the BACKDROP, rank 0, the farthest plane. Its content comes from the
//     claim flood, which propagates BY ROW. Row-wise propagation is what
//     horizontal filaments look like, and it is the object of the long-open A85
//     item ("per-strip gradient carry in the plate fill").
//
// mpiFullMeshes carry userData.v2rank, assigned far -> near, and the shipped UI
// already documents rank 0 as the backdrop. So the two can be separated exactly,
// with no new machinery:
//
//   FULL          everything, as shipped
//   BACKDROP ONLY only rank 0 (plus the flat originals hidden, as bgSoloToggle
//                 does — otherwise they occlude the thing being isolated)
//   NO BACKDROP   everything EXCEPT rank 0
//
// PREDICTION. If the smear is the backdrop's flood, it is present in BACKDROP
// ONLY and absent from NO BACKDROP. If it is in the front planes after all, the
// reverse — which would also contradict a191d and put that result in question.
//
// Comb energy is reported per arm but it is NOT the evidence here: an arm that
// hides most of the scene has less of everything, so a drop is expected whatever
// the cause. Coverage is printed beside it for exactly that reason, and the
// crops are written out because locating an artifact is a question about where
// it IS, which is a question for an image.
//
//   node harness/band5.js [warrior|star|troll] [deg]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const ASSET = process.argv[2] || 'warrior';
const DEG = Number(process.argv[3] || 35);
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star: ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };
const RECT = [0.421, 0.780, 0.037, 0.996];   // the trailing band, from a191c

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  const onDisk = (fs.readFileSync(path.join(WT, 'moebius.js'), 'utf8')
                    .match(/MOEBIUS_BUILD\s*=\s*'([^']+)'/) || [])[1] || null;
  const served = await page.evaluate(() => (typeof MOEBIUS_BUILD === 'string') ? MOEBIUS_BUILD : null);
  console.log('served build = ' + served + (served === onDisk ? ' (matches this tree)' : '  *** TREE SAYS ' + onDisk + ' ***'));

  const r = await page.evaluate(async (o) => {
    window._rayReproject = true;
    bgViewFadeStartDeg = 35; bgViewFadeEndDeg = 45;
    bgQuickBake = false; bgMPIFullPlanes = true; bgMPIMode = true;
    bgBuildStamp = null; buildBackgroundLayer();
    isSweeping = true;
    const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
    camera.position.set(dist * Math.tan(o.deg * Math.PI / 180), 0, dist);
    for (let n = 0; n < 3; n++) render();

    const planes = (typeof mpiFullMeshes !== 'undefined' && mpiFullMeshes) ? mpiFullMeshes : [];
    const ranks = {};
    for (const m of planes) { const k = m.userData.v2rank; ranks[k] = (ranks[k] || 0) + 1; }
    const L = mediaLayers[0];

    const W = renderer.domElement.width, Hh = renderer.domElement.height;
    const X0 = Math.round(o.rect[0]*W), X1 = Math.round(o.rect[1]*W);
    const Y0 = Math.round(o.rect[2]*Hh), Y1 = Math.round(o.rect[3]*Hh);

    const shoot = () => {
      for (let n = 0; n < 3; n++) render();
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const g = cv.getContext('2d'); g.drawImage(renderer.domElement, 0, 0, W, Hh);
      const px = g.getImageData(0, 0, W, Hh).data;
      const cc = document.createElement('canvas'); cc.width = X1-X0+1; cc.height = Y1-Y0+1;
      cc.getContext('2d').drawImage(cv, X0, Y0, X1-X0+1, Y1-Y0+1, 0, 0, X1-X0+1, Y1-Y0+1);
      const lum = new Float32Array(W*Hh);
      for (let i = 0; i < W*Hh; i++) lum[i] = 0.299*px[i*4] + 0.587*px[i*4+1] + 0.114*px[i*4+2];
      let s = 0, n = 0, cov = 0, tot = 0;
      for (let y = Math.max(1,Y0); y <= Math.min(Hh-2,Y1); y++)
        for (let x = Math.max(0,X0); x <= Math.min(W-1,X1); x++) {
          const i = y*W+x; tot++;
          const on = px[i*4+3] >= 8 && lum[i] >= 8;
          if (on) cov++;
          if (!on) continue;
          s += Math.abs(2*lum[i] - lum[i-W] - lum[i+W]); n++;
        }
      return { comb: +(s/Math.max(1,n)).toFixed(3),
               cover: +(100*cov/Math.max(1,tot)).toFixed(2),
               url: cc.toDataURL('image/png') };
    };

    const state = () => {
      const s = planes.map(m => m.visible);
      s.push(L.mesh ? L.mesh.visible : null);
      return s;
    };
    const restore = (s) => { planes.forEach((m, i) => m.visible = s[i]);
      if (L.mesh && s[planes.length] !== null) L.mesh.visible = s[planes.length]; };

    const base = state();
    const out = {};
    out.full = shoot();
    // backdrop only: rank 0, flat originals hidden (what bgSoloToggle does)
    for (const m of planes) m.visible = (m.userData.v2rank === 0);
    if (L.mesh) L.mesh.visible = false;
    out.backdrop = shoot();
    restore(base);
    // everything except the backdrop
    for (const m of planes) if (m.userData.v2rank === 0) m.visible = false;
    out.nobackdrop = shoot();
    restore(base);

    return { out, W, H: Hh, nPlanes: planes.length, ranks,
             region: X0+'..'+X1+', '+Y0+'..'+Y1 };
  }, { deg: DEG, rect: RECT });

  const pad = (s, n) => String(s).padStart(n);
  console.log('\n' + ASSET + ' at ' + DEG + ' deg — which plane draws the trailing smear?');
  console.log('  ' + r.nPlanes + ' v2 plane meshes, by rank (0 = farthest = backdrop): ' +
    JSON.stringify(r.ranks));
  console.log('  region ' + r.region + ' of ' + r.W + 'x' + r.H + '\n');
  console.log('  arm                  region coverage%   comb energy');
  for (const [k, lbl] of [['full','FULL (shipped)'], ['backdrop','BACKDROP ONLY (rank 0)'], ['nobackdrop','NO BACKDROP']])
    console.log('  ' + lbl.padEnd(24) + pad(r.out[k].cover, 10) + pad(r.out[k].comb, 15));
  console.log('\n  comb energy is NOT the evidence here — an arm that hides most of the scene has');
  console.log('  less of everything. Coverage sits beside it for that reason, and the crops are');
  console.log('  what answers the question: locating an artifact is a question about WHERE, and');
  console.log('  that is a question for an image.');
  for (const k of Object.keys(r.out))
    fs.writeFileSync(path.join(H, 'band5_' + ASSET + '_' + k + '.png'),
      Buffer.from(r.out[k].url.split(',')[1], 'base64'));
  console.log('\n  wrote harness/band5_' + ASSET + '_{full,backdrop,nobackdrop}.png');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
