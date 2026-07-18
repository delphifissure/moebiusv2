// Warrior top-left black corner attribution: v2 at (0.42, 0.02) with pair
// validation ON (default) vs OFF (window._noV2PairValid) in one session.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
fs.copyFileSync('../silverwarrior_color.png', 'defaultImgColor.png');
fs.copyFileSync('../silverwarrior_depth.png', 'defaultImgDepth.png');
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  for (const [tag, noPV] of [['pvOFF', true], ['pvON', false]]) {
    const page = await browser.newPage({ viewport: { width: 860, height: 500 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 140)));
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
    const png = await page.evaluate(async (noPV) => {
      window._rayReproject = true; window._noV2PairValid = noPV;
      bgQuickBake = false; bgMPIFullPlanes = true; bgMPIMode = true;
      buildBackgroundLayer();
      isSweeping = true;
      await new Promise(r2 => { let n = 0; const tick = () => { camera.position.set(0.42, 0.02, 0.2); n++; n < 8 ? requestAnimationFrame(tick) : r2(); }; requestAnimationFrame(tick); });
      camera.position.set(0.42, 0.02, 0.2); render();
      return renderer.domElement.toDataURL('image/png');
    }, noPV);
    fs.writeFileSync('war_' + tag + '_r42.png', Buffer.from(png.split(',')[1], 'base64'));
    console.log('wrote war_' + tag + '_r42.png');
    await page.close();
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
