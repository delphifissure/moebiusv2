// A215 A/B, FRESH PAGE PER ARM — wash vs two-sided blend, starwatcher.
//
// The original a213_ab.js re-bakes in one page AFTER off-axis grabs, and on
// SwiftShader that bake pays the DEFERRED rasterization bill of every
// unsynced off-axis frame inside its first getImageData (~200s measured,
// identical pre-a214 — an environment cost, not a code regression; see
// Addendum 158). Fresh page per arm: load (rest) -> bake -> grab poses,
// paying render cost incrementally, no cross-arm debt.
//   node harness/a215_ab_fresh.js
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = process.env.WT || '/workspace/mm', H = path.join(WT, 'harness');
const OUT = process.env.OUT || '/tmp/claude-0/-home-user-moebius/989b3965-28fd-58c7-96b5-b4b22c709919/scratchpad';

(async () => {
  fs.copyFileSync(path.join(WT, 'starwatcher_color.png'), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, 'starwatcher_depth.png'), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });

  const arm = async (legacyWash, tag) => {
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
    page.on('console', m => { const t = m.text();
      if (/A215|band fill/.test(t)) console.log('  [page] ' + t.slice(0, 180)); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) {
      const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
      if (ok) break; await new Promise(r => setTimeout(r, 1000));
    }
    const r = await page.evaluate(async (lw) => {
      window._rayReproject = true;
      window._bandFillLegacyWash = lw;
      bgQuickBake = true; buildBackgroundLayer();
      if (typeof updateVolumeGuidesVisibility === 'function') updateVolumeGuidesVisibility(false);
      isSweeping = true;
      const grab = () => {
        updateCameraAndProjection(); render(); updateCameraAndProjection(); render();
        const W = renderer.domElement.width, Hh = renderer.domElement.height;
        const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
        const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
        return { d: Array.from(cx.getImageData(0, 0, W, Hh).data), W, Hh, png: cv.toDataURL('image/png') };
      };
      camera.position.set(0, 0, 0.2); const rest = grab();
      camera.position.set(-0.756, 0.064, 0.320); const user = grab();   // 67deg report pose
      camera.position.set(-0.28, 0.03, 0.32); const cone = grab();      // ~41deg in-cone
      const rl = [];
      const L = (g2, x, y) => { const i = (y*g2.W+x)*4; return 0.299*g2.d[i]+0.587*g2.d[i+1]+0.114*g2.d[i+2]; };
      for (let y = 0; y < rest.Hh; y += 2) for (let x = 0; x < rest.W; x += 2) rl.push(Math.round(L(rest, x, y)));
      return { restLuma: rl, userPng: user.png, conePng: cone.png };
    }, legacyWash);
    fs.writeFileSync(path.join(OUT, 'a215_' + tag + '_user.png'), Buffer.from(r.userPng.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT, 'a215_' + tag + '_cone.png'), Buffer.from(r.conePng.split(',')[1], 'base64'));
    console.log(tag + ' arm done');
    await page.close();
    return r;
  };

  const WHICH = process.env.ARMS || 'both';
  let A = null, B = null;
  if (WHICH === 'both' || WHICH === 'wash') A = await arm(true, 'wash');
  if (WHICH === 'both' || WHICH === 'blend') B = await arm(false, 'blend');
  if (A && B) {
    let ch = 0; for (let i = 0; i < A.restLuma.length; i++) if (Math.abs(A.restLuma[i] - B.restLuma[i]) > 8) ch++;
    console.log('REST delta wash vs blend: ' + (100*ch/A.restLuma.length).toFixed(2) + '% px >8 luma (band content differs by design; figure must not)');
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
