// A117a: IS THE FOLD-LIMIT TEAR WHAT IS SHREDDING QUICK BAKE?
//
// modeprofile.js measured quick bake at 35-63% black and visually a moire
// wreck at the user's own poses, and its log says why it might be:
//
//   [QUICK-BAKE] cliff tear: 692469 spanning triangles dropped of 1737400
//                            (39.9% of the FG mesh)
//                            411529 texels re-shipped as cap cards
//
// Addendum 110 predicted exactly this: the a102 fold limit at 851px is 0.47
// of ONE 8-bit level, so a depth map quantised to 8 bits cannot express a
// fold-safe surface at all — the smallest step it can represent already
// folds, and testing every cell against that limit tears most of the mesh.
// The cap cards then have to reconstruct 411k texels, which is what the comb
// pattern is.
//
// So: A/B the tear criterion in the quick path, at the user's poses, same
// bake otherwise. Three arms:
//   fold  (default)      a102 exact envelope, |shift span| > sqrt(2) px
//   slope (_noExactCone) a101 per-depth slope fallback
//   none  (_qbNoTear)    no pre-tear at all — the a52 "FG intact" behaviour
//
// black% here is over the WHOLE canvas, letterbox included, because quick
// has no scene extension and the letterbox is part of what the user sees.
//
//   node harness/teartest.js [troll|star|warrior]
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
const POSES = [ { nm: 'rest', x: 0, y: 0 }, { nm: '0.52xR', x: 0.178, y: 0.021 },
                { nm: '0.85xR', x: 0.293, y: 0.005 }, { nm: '0.85xU', x: 0.005, y: -0.293 } ];
// NOTE: after a117 the DEFAULT is cliff, so an empty flag object no longer
// selects fold — the 'fold' arm must ask for it explicitly. The run where
// 'fold' and 'cliff' printed identical numbers was measuring cliff twice.
const ARMS = [ ['fold',  { _qbTearMode: 'fold' }], ['cliff', { _qbTearMode: 'cliff' }], ['none', { _qbNoTear: true }] ];

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const all = {};
  for (const [tag, flags] of ARMS) {
    const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 140)));
    const logs = [];
    page.on('console', m => { const t = m.text(); if (/cliff tear|cap cards|plate tear|viewpoint scan/.test(t)) logs.push(t); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 40; t++) {
      const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
      if (ok) break; await new Promise(r => setTimeout(r, 1000));
    }
    const t0 = Date.now();
    await page.evaluate((f) => { window._rayReproject = true; Object.assign(window, f);
      bgQuickBake = true; bgMPIFullPlanes = false; bgMPIMode = false;
      bgBuildStamp = null; buildBackgroundLayer(); }, flags);
    const wall = Date.now() - t0;
    await new Promise(r => setTimeout(r, 500));
    const rows = await page.evaluate(async (poses) => {
      isSweeping = true;
      const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
      const W = 480, Hh = 300; const out = [];
      for (const p of poses) {
        camera.position.set(p.x, p.y, dist);
        for (let n = 0; n < 3; n++) render();
        const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
        const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
        const d = cx.getImageData(0, 0, W, Hh).data;
        let black = 0;
        for (let i = 0; i < W*Hh; i++) { const j = i*4; if (d[j]+d[j+1]+d[j+2] < 24) black++; }
        out.push({ nm: p.nm, black: +(100*black/(W*Hh)).toFixed(2), png: renderer.domElement.toDataURL('image/png') });
      }
      return out;
    }, POSES);
    for (const r of rows) {
      try { fs.writeFileSync(path.join(OUTD, 'TT_' + ASSET + '_' + tag + '_' + r.nm + '.png'),
            Buffer.from(r.png.split(',')[1], 'base64')); } catch (e) {}
      delete r.png; }
    all[tag] = rows;
    console.log('\n=== tear = ' + tag + '  (bake ' + (wall/1000).toFixed(1) + 's) ===');
    for (const l of logs) console.log('   | ' + l.slice(0, 180));
    console.log('  black%: ' + rows.map(r => r.nm + '=' + r.black).join('  '));
    await page.close();
  }
  console.log('\n===== ' + ASSET + ' tear criterion, black% over the whole canvas =====');
  console.log('tear     ' + POSES.map(p => p.nm.padStart(9)).join(''));
  for (const [tag] of ARMS) console.log(tag.padEnd(9) + all[tag].map(r => String(r.black).padStart(9)).join(''));
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
