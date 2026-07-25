// A106 isolation: the a106 build's warrior SD mask went 9.6% -> 11.7% and out
// of its band. Is that the exact scan warp (which SHOULD grow the mask, because
// the old warp under-reached near content 3.2x and pruned reveals that do open)
// or something else in the a104/a105/a106 batch?
// One page, one asset, two bakes, _legacyScanWarp toggled between them.
//   node harness/a106_ab.js [warrior|star|troll|photo]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/arc73', H = path.join(WT, 'harness');
const SRC = { warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'],
              star:    ['starwatcher_color.png', 'starwatcher_depth.png'],
              troll:   ['defaultImgColor.png', 'defaultImgDepth.png'],
              photo:   ['roomImg1.png', 'roomDepth1.png'] };
const ASSET = process.argv[2] || 'warrior';
(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  for (const [tag, legacy] of [['a106 exact warp', false], ['legacy linear warp', true]]) {
    const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 140)));
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 40; t++) {
      const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
      if (ok) break; await new Promise(r => setTimeout(r, 1000));
    }
    const r = await page.evaluate((lg) => {
      window._srCapture = true; window._rayReproject = true; window._legacyScanWarp = lg;
      bgQuickBake = true; buildBackgroundLayer();
      const mk = window._qbMask; if (!mk) return null;
      let nD = 0, nG = 0; const N = mk.pw * mk.ph;
      for (let i = 0; i < N; i++) { if (mk.disocc[i]) nD++; if (mk.ground && mk.ground[i]) nG++; }
      return { sd: 100 * nD / N, g: 100 * nG / N };
    }, legacy);
    console.log(ASSET.padEnd(8) + tag.padEnd(22) + (r ? ('SD ' + r.sd.toFixed(2) + '%   ground ' + r.g.toFixed(2) + '%') : '(no capture)'));
    await page.close();
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
