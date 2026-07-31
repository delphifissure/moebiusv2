// A179: DOES BAKING QUICK FIRST CHANGE THE v2 BAKE?
//
// a178 put the v2 smear gate in regress, which bakes quick and THEN v2 in the
// same page. Two of three assets agreed with a standalone v2-only bake; star did
// not (5.240 standalone vs 7.6 after a quick bake). Either one run is noise, or
// the quick bake leaves state that changes v2 — which is the a151 failure class
// (bake state surviving a mode switch) and would mean the shipped default's
// geometry depends on whether the user pressed quick first.
//
// Decides it in ONE page, so nothing differs but the order:
//     v2  ->  quick  ->  v2      and the two v2 readings are compared.
//
//   node harness/v2order.js [star|troll|warrior]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const ASSET = process.argv[2] || 'star';
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star: ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
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

  await page.evaluate(() => { window._rayReproject = true; window._srCapture = true;
                              bgViewFadeStartDeg = 35; bgViewFadeEndDeg = 45; });
  const bakeV2 = () => page.evaluate(() => {
    bgQuickBake = false; bgMPIFullPlanes = true; bgMPIMode = true;
    bgBuildStamp = null; buildBackgroundLayer();
    const S = window._v2Stretch;
    return S ? { keep: S.keep, foldPct: S.foldPct, maxRatio: S.maxRatio,
                 meanRatio: S.meanRatio, tornPct: S.tornPct, q: S.srcQuantum } : null;
  });
  const bakeQuick = () => page.evaluate(() => {
    bgQuickBake = true; bgMPIFullPlanes = false; bgMPIMode = false;
    bgBuildStamp = null; buildBackgroundLayer();
    const S = window._qbStretch;
    return S ? { maxRatio: S.maxRatio } : null;
  });

  const A = await bakeV2();
  const Q = await bakeQuick();
  const B = await bakeV2();
  const C = await bakeV2();   // third: separates ORDER from plain nondeterminism

  const f = (o) => o ? JSON.stringify(o) : 'null';
  console.log('\n' + ASSET);
  console.log('  v2 #1 (cold)            ' + f(A));
  console.log('  quick (in between)      ' + f(Q));
  console.log('  v2 #2 (after quick)     ' + f(B));
  console.log('  v2 #3 (after v2)        ' + f(C));
  const same = (x, y) => x && y && x.maxRatio === y.maxRatio && x.keep === y.keep;
  console.log('\n  v2#1 == v2#2 ? ' + (same(A, B) ? 'YES — order does not matter'
              : 'NO  *** the quick bake CHANGED the v2 bake ***'));
  console.log('  v2#2 == v2#3 ? ' + (same(B, C) ? 'YES — v2 is repeatable once settled'
              : 'NO  — v2 is not even repeatable against itself'));
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
