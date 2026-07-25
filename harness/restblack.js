// REST-POSE BLACK. The pose sweep measured black RELATIVE TO REST to cancel the
// letterbox — which cancelled the defect. At rest the reprojection is identity
// and the frame should be pixel-faithful to the source, so ANY hole at rest is
// the FG mesh missing triangles, not a disocclusion.
//
// The FG pre-tear drops triangles at BAKE time, permanently, so a torn cell is a
// hole at every pose including rest. tearcount.py says a102 drops 33.6% of troll
// cells and 14.4% of star's, against a88's 1.67%. This asks what that costs on
// screen, at rest, inside the layer's own footprint (letterbox excluded).
//
//   node harness/restblack.js [troll|star|warrior]
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
  for (const [tag, flags] of [
      ['a102 exact tear',    {}],
      ['legacy cliff tear',  { _noFoldTear: true }],
      ['NO pre-tear at all', { _qbNoTear: true }]]) {
    const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 140)));
    const logs = [];
    page.on('console', m => { const t = m.text(); if (/cliff tear|cap cards|per-cell tear/.test(t)) logs.push(t); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 40; t++) {
      const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
      if (ok) break; await new Promise(r => setTimeout(r, 1000));
    }
    const r = await page.evaluate(async (f) => {
      window._rayReproject = true; Object.assign(window, f);
      bgQuickBake = true; buildBackgroundLayer();
      isSweeping = true;
      const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
      camera.position.set(0, 0, dist);
      for (let n = 0; n < 4; n++) render();
      const W = 480, Hh = 300;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
      const d = cx.getImageData(0, 0, W, Hh).data;
      // layer footprint = bounding box of everything non-black. The letterbox is
      // a solid band at the sides, so this bounds the content region and the
      // black measured inside it is holes, not framing.
      let x0 = W, x1 = -1, y0 = Hh, y1 = -1;
      for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) { const i = (y*W+x)*4;
        if (d[i]+d[i+1]+d[i+2] > 24) { if (x<x0) x0=x; if (x>x1) x1=x; if (y<y0) y0=y; if (y>y1) y1=y; } }
      let black = 0, tot = 0;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = (y*W+x)*4; tot++;
        if (d[i]+d[i+1]+d[i+2] < 24) black++; }
      return { black: 100*black/Math.max(1,tot), box: [x1-x0+1, y1-y0+1],
               png: renderer.domElement.toDataURL('image/png') };
    }, flags);
    console.log(ASSET.padEnd(8) + tag.padEnd(21) + 'REST black inside footprint = ' +
                r.black.toFixed(2) + '%   (box ' + r.box.join('x') + ')');
    for (const l of logs) console.log('     ' + l.slice(0, 170));
    try { fs.writeFileSync(path.join(OUTD, 'REST_' + ASSET + '_' + tag.split(' ')[0] + '.png'),
          Buffer.from(r.png.split(',')[1], 'base64')); } catch (e) {}
    await page.close();
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
