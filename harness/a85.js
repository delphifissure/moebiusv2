// A193: IS THE WARRIOR'S BAND THE ROW-FIRST CLAIM CONTINUATION, UNDER-RELAXED?
//
// a191e located the band inside v2's BACKDROP (rank 0) buffer. Reading that
// fill, the completion colour for a claimed texel is
//
//     0.5 * row-anchor continuation  +  0.5 * quarter-res pull-push wash
//
// and the anchoring is ROW-FIRST by design: left/right anchors are used, and
// columns only when a row has none. Inside a tall occluder every row is
// therefore lerped independently between its own two side anchors, so row-to-row
// variation in those endpoints becomes horizontal filaments — which is the
// artifact, exactly.
//
// The code already anticipates this twice. The claim colour comment says "50/50
// with the wash softens residual row streaking", and the relaxation below it is
// introduced as "soften anchor-continuation striation". It runs FOUR Jacobi
// passes. Jacobi diffuses roughly sqrt(passes) texels per pass-set, so 4 passes
// reach ~2 texels across a claim region hundreds of texels wide. The remedy was
// present and out of range.
//
// THE PREDICTION. If the band is under-relaxed row continuation, comb energy in
// the region must fall monotonically as the pass count rises, and then plateau
// once the diffusion length exceeds the band's own scale. If the band is
// something else, more relaxation will blur the whole region without
// preferentially removing it — which shows up as comb falling no faster than
// overall edge energy.
//
// So BOTH are measured, and the ratio is what carries the claim: comb energy
// (vertical second difference — what row-to-row discontinuity maximises) against
// total edge energy (all detail). A fix removes the artifact faster than it
// removes the picture; a blur removes both together.
//
// Bake time is printed because the relaxation is O(passes x region) on the CPU
// and the requirement is a near-instant preview — a fix that costs ten seconds
// is not a fix for this path.
//
//   node harness/a85.js [warrior|star|troll] [deg]
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
const PASSES = [4, 16, 64, 256];
const RECT = [0.421, 0.780, 0.037, 0.996];   // the trailing band, from a191c

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
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
  const hasKnob = await page.evaluate(() => typeof bgV2ClaimRelax !== 'undefined');
  if (!hasKnob) { console.log('*** bgV2ClaimRelax absent — arms could not diverge, nothing to measure');
    await browser.close(); srv.kill(); process.exit(1); }

  const run = (o) => page.evaluate(async (o) => {
    window._rayReproject = true;
    bgViewFadeStartDeg = 35; bgViewFadeEndDeg = 45;
    bgQuickBake = false; bgMPIFullPlanes = true; bgMPIMode = true;
    bgV2ClaimRelax = o.passes;
    const t0 = performance.now();
    bgBuildStamp = null; buildBackgroundLayer();
    const bakeMs = Math.round(performance.now() - t0);
    isSweeping = true;
    const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
    camera.position.set(dist * Math.tan(o.deg * Math.PI / 180), 0, dist);
    for (let n = 0; n < 3; n++) render();
    const W = renderer.domElement.width, Hh = renderer.domElement.height;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
    const g = cv.getContext('2d'); g.drawImage(renderer.domElement, 0, 0, W, Hh);
    const px = g.getImageData(0, 0, W, Hh).data;
    const X0 = Math.round(o.rect[0]*W), X1 = Math.round(o.rect[1]*W);
    const Y0 = Math.round(o.rect[2]*Hh), Y1 = Math.round(o.rect[3]*Hh);
    const cc = document.createElement('canvas'); cc.width = X1-X0+1; cc.height = Y1-Y0+1;
    cc.getContext('2d').drawImage(cv, X0, Y0, X1-X0+1, Y1-Y0+1, 0, 0, X1-X0+1, Y1-Y0+1);
    const lum = new Float32Array(W*Hh);
    for (let i = 0; i < W*Hh; i++) lum[i] = 0.299*px[i*4] + 0.587*px[i*4+1] + 0.114*px[i*4+2];
    let comb = 0, edge = 0, n = 0;
    for (let y = Math.max(1,Y0); y <= Math.min(Hh-2,Y1); y++)
      for (let x = Math.max(1,X0); x <= Math.min(W-2,X1); x++) {
        const i = y*W+x;
        if (px[i*4+3] < 8) continue;
        comb += Math.abs(2*lum[i] - lum[i-W] - lum[i+W]);
        const gx = lum[i+1]-lum[i-1], gy = lum[i+W]-lum[i-W];
        edge += Math.sqrt(gx*gx+gy*gy); n++;
      }
    return { passes: o.passes, bakeMs,
             comb: +(comb/Math.max(1,n)).toFixed(3),
             edge: +(edge/Math.max(1,n)).toFixed(3),
             ratio: +((comb/Math.max(1,n)) / Math.max(1e-9, edge/Math.max(1,n))).toFixed(4),
             url: cc.toDataURL('image/png') };
  }, o);

  const rows = [];
  for (const p of PASSES) rows.push(await run({ passes: p, deg: DEG, rect: RECT }));

  const pad = (s, n) => String(s).padStart(n);
  console.log('\n' + ASSET + ' at ' + DEG + ' deg — does relaxing the claim remove the band?');
  console.log('  region fixed at [' + RECT.join(', ') + ']\n');
  console.log('  Jacobi passes   bake ms   comb energy   edge energy   comb/edge');
  for (const r of rows)
    console.log('  ' + pad(r.passes, 13) + pad(r.bakeMs, 10) + pad(r.comb, 14) + pad(r.edge, 14) + pad(r.ratio, 12));
  const a = rows[0], z = rows[rows.length-1];
  const dComb = 100*(1 - z.comb/Math.max(1e-9, a.comb));
  const dEdge = 100*(1 - z.edge/Math.max(1e-9, a.edge));
  console.log('\n  ' + a.passes + ' -> ' + z.passes + ' passes:  comb -' + dComb.toFixed(1) +
    '%,  edge -' + dEdge.toFixed(1) + '%,  bake ' + a.bakeMs + 'ms -> ' + z.bakeMs + 'ms');
  console.log('  VERDICT: ' + (dComb < 5
    ? 'REFUTED — relaxation does not touch the band, so it is not under-relaxed row continuation'
    : (dComb > dEdge * 1.5
       ? 'CONSISTENT — comb falls faster than overall detail, so the relaxation is removing the ARTIFACT rather than the picture'
       : 'AMBIGUOUS — comb and edge fall together, which is a blur, not a fix')));
  for (const r of rows)
    fs.writeFileSync(path.join(H, 'a85_' + ASSET + '_relax' + r.passes + '.png'),
      Buffer.from(r.url.split(',')[1], 'base64'));
  console.log('\n  wrote harness/a85_' + ASSET + '_relax{4,16,64,256}.png — the region, per arm');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
