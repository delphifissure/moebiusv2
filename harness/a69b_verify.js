// a69b same-class gate verification: star quick renders at the USER'S device
// cams — (0.431,-0.065,0.2) and (0.710,0.025,0.2) — with the gated membrane
// (default) vs membrane off. If the gate is right, the two should be close on
// star (flanks disagree at the astronaut -> flood values kept).
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
fs.copyFileSync('../starwatcher_color.png', 'defaultImgColor.png');
fs.copyFileSync('../starwatcher_depth.png', 'defaultImgDepth.png');
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const CAMS = [['u43', 0.431, -0.065], ['u71', 0.710, 0.025]];
  for (const [tag, noMem] of [['gated', false], ['memoff', true]]) {
    const page = await browser.newPage({ viewport: { width: 933, height: 525 } });
    page.on('pageerror', e => console.log('  [PAGEERR] '+e.message.slice(0,140)));
    page.on('console', m => { const t = m.text(); if (t.includes('membrane')) console.log('  ' + t.slice(0, 120)); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
    await page.evaluate((noMem) => {
      window._noPlateMembrane = noMem;
      window._rayReproject = true; bgQuickBake = true; buildBackgroundLayer();
    }, noMem);
    for (const [ctag, px, py] of CAMS) {
      const png = await page.evaluate(async ({ px, py }) => {
        isSweeping = true;
        await new Promise(r2 => { let n = 0; const tick = () => { camera.position.set(px, py, 0.2); n++; n < 8 ? requestAnimationFrame(tick) : r2(); }; requestAnimationFrame(tick); });
        camera.position.set(px, py, 0.2); render();
        return renderer.domElement.toDataURL('image/png');
      }, { px, py });
      fs.writeFileSync('a69b_' + tag + '_' + ctag + '.png', Buffer.from(png.split(',')[1], 'base64'));
      console.log('wrote a69b_' + tag + '_' + ctag + '.png');
    }
    await page.close();
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
