// A100: leg-streamer A/B at the user's sheet cam (-0.409, 0.074), star.
// One bake at SHIPPED defaults (scan ON). Shot 1: stock (a83 mask-gated cut).
// Shot 2: u_sdMask swapped for a 1x1 white texture => svBacked forced true,
// i.e. the pre-a83 cut authority. If the streamers vanish in shot 2, the a83
// gate is convicted (contact rubber not covered by the SD mask).
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/arc73';
const H = path.join(WT, 'harness');
const OUTD = '/workspace/moebiusv2/harness/val';
fs.copyFileSync(path.join(WT, 'starwatcher_color.png'), path.join(H, 'defaultImgColor.png'));
fs.copyFileSync(path.join(WT, 'starwatcher_depth.png'), path.join(H, 'defaultImgDepth.png'));
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
  const shoot = async (tag) => {
    const png = await page.evaluate(async () => {
      isSweeping = true;
      await new Promise(r2 => { let n = 0; const tick = () => { camera.position.set(-0.409, 0.074, 0.2); n++; n < 8 ? requestAnimationFrame(tick) : r2(); }; requestAnimationFrame(tick); });
      camera.position.set(-0.409, 0.074, 0.2); render();
      return renderer.domElement.toDataURL('image/png');
    });
    fs.writeFileSync(path.join(OUTD, 'A100_' + tag + '.png'), Buffer.from(png.split(',')[1], 'base64'));
    console.log('wrote A100_' + tag + '.png');
  };
  await shoot('stock');
  await page.evaluate(() => {
    const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    white.needsUpdate = true;
    scene.traverse(o => { const u = o.material && o.material.uniforms;
      if (u && u.u_sdMask && u.u_sdMask.value) u.u_sdMask.value = white; });
  });
  await shoot('whitemask');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
