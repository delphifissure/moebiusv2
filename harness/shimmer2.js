// A118b: SHIMMER UNDER MOTION, WHICH IS THE ONLY PLACE IT CAN LIVE.
//
// The final dither is hash(gl_FragCoord.xy) with no time term and strength 0
// by default, so it cannot flicker. If the realtime fill is recomputed every
// frame from the CURRENT warped view, then holding still is stable and the
// crawl only appears while the head moves — which is exactly what the user
// sees and what a static-pose probe would score as zero.
//
// THE TEST. Take two camera positions a HAIR apart (eps = 0.0015 world, about
// 0.4% of the rim). Real parallax between them is sub-pixel almost everywhere,
// so a view-INDEPENDENT fill must produce almost the same frame. Any large
// difference is the fill re-deriving itself.
//
// Then separate the two populations, because they have different fixes:
//   dNonGap  mean |dL| where the source mesh covers the pixel (true parallax,
//            should be tiny)
//   dGap     mean |dL| inside the disocclusion region (the inpaint; this is
//            the shimmer)
// A ratio dGap/dNonGap near 1 means the fill is as stable as the geometry.
// Large means the fill is the thing that crawls.
//
// Swept across the cone so the trend with reveal size is visible.
//
//   node harness/shimmer2.js [troll|star|warrior]
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
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  const rows = await page.evaluate(async () => {
    isSweeping = true;
    const L = mediaLayers[0];
    const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
    const W = 480, Hh = 300, EPS = 0.0015;
    const grab = () => { for (let n = 0; n < 3; n++) render();
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
      return cx.getImageData(0, 0, W, Hh).data; };
    const lum = (d, i) => 0.299*d[i*4] + 0.587*d[i*4+1] + 0.114*d[i*4+2];
    const out = [];
    for (const frac of [0.0, 0.15, 0.30, 0.52, 0.70, 0.85]) {
      const x = frac * dist * Math.tan(60 * Math.PI / 180);
      // GAP MAP. Hiding L.mesh does NOT work in the realtime path: there is no
      // plate mesh at all (the fill is a post-process on the render target), so
      // the FG-hidden frame is empty and nothing classifies as gap — measured,
      // gap% came back 0.00 at every pose. The app's own 'gaps' debug view is
      // the authority on where a hole is, so ask it.
      camera.position.set(x, 0, dist);
      const sel = document.getElementById('debugViewSelect');
      const prevView = sel ? sel.value : 'final';
      if (sel) sel.value = 'gaps';
      const gapFrame = grab();
      if (sel) sel.value = prevView;
      const isGap = new Uint8Array(W*Hh);
      let ngap = 0;
      for (let i = 0; i < W*Hh; i++) { const g = lum(gapFrame, i) > 128 ? 1 : 0; isGap[i] = g; ngap += g; }
      const a = grab();
      camera.position.set(x + EPS, 0, dist);
      const b = grab();
      let sg = 0, ng = 0, sn = 0, nn = 0;
      for (let i = 0; i < W*Hh; i++) {
        const la = lum(a, i), lb = lum(b, i);
        if (la < 4 && lb < 4) continue;
        const d = Math.abs(la - lb);
        if (isGap[i]) { sg += d; ng++; } else { sn += d; nn++; }
      }
      const dGap = sg / Math.max(1, ng), dNon = sn / Math.max(1, nn);
      out.push({ frac, gapPct: +(100*ngap/(W*Hh)).toFixed(2),
                 dGap: +dGap.toFixed(3), dNonGap: +dNon.toFixed(3),
                 ratio: +(dGap / Math.max(1e-6, dNon)).toFixed(2) });
    }
    camera.position.set(0, 0, dist); render();
    return out;
  });
  console.log('\n' + ASSET + '  REALTIME, two camera positions 0.0015 apart (sub-pixel parallax)');
  console.log('  rim frac   gap%     dGap    dNonGap   ratio');
  for (const r of rows) console.log('  ' + String(r.frac).padEnd(9) + String(r.gapPct).padStart(6) +
    String(r.dGap).padStart(9) + String(r.dNonGap).padStart(10) + String(r.ratio).padStart(8));
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
