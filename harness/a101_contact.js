// A101: verify the a84 contact-rubber exemption.
// Per asset: one shipped-defaults bake, then per pose two shots with the
// u_cutContactRamp uniform toggled at runtime (1 = fix on, 0 = a83 behavior).
// Assets: star (streamer cams + vertical speckle poses), troll (wall cams).
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/arc73';
const H = path.join(WT, 'harness');
const OUTD = '/workspace/moebiusv2/harness/val';
const ASSET = process.argv[2] || 'star';
if (ASSET === 'star') {
  fs.copyFileSync(path.join(WT, 'starwatcher_color.png'), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, 'starwatcher_depth.png'), path.join(H, 'defaultImgDepth.png'));
} else {
  fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
}
const POSES = ASSET === 'star'
  ? [['leg', -0.409, 0.074], ['legmid', -0.2, 0.05], ['up', 0.0, 0.2], ['down', 0.0, -0.2]]
  : [['wall', 1.053, -0.014], ['wide', 0.358, 0.0]];
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 933, height: 525 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 140)));
  await page.goto('http://localhost:8099/fp_test.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
  await page.evaluate(() => { bgQuickBake = true; window._bgQuickBaked = false; buildBackgroundLayer(); });
  await page.waitForFunction(() => window._bgQuickBaked === true, null, { timeout: 480000, polling: 2000 });
  await new Promise(r => setTimeout(r, 400));
  for (const [tag, px, py] of POSES) {
    for (const [mode, val] of [['fix', 1.0], ['a83', 0.0]]) {
      const png = await page.evaluate(async ({ px, py, val }) => {
        scene.traverse(o => { const u = o.material && o.material.uniforms;
          if (u && u.u_cutContactRamp) u.u_cutContactRamp.value = val; });
        isSweeping = true;
        await new Promise(r2 => { let n = 0; const tick = () => { camera.position.set(px, py, 0.2); n++; n < 8 ? requestAnimationFrame(tick) : r2(); }; requestAnimationFrame(tick); });
        camera.position.set(px, py, 0.2); render();
        return renderer.domElement.toDataURL('image/png');
      }, { px, py, val });
      fs.writeFileSync(path.join(OUTD, `A101_${ASSET}_${tag}_${mode}.png`), Buffer.from(png.split(',')[1], 'base64'));
      console.log(`wrote A101_${ASSET}_${tag}_${mode}.png`);
    }
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
