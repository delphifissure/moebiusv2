// v2 plane-seam column probe: build v2 (full planes) and capture frames at
// several offsets to reproduce the vertical seam column seen during the a62b
// port verification. Usage: node v2seam_probe.js [color depth tag]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const color = process.argv[2] || '../starwatcher_color.png';
const depth = process.argv[3] || '../starwatcher_depth.png';
const tag = process.argv[4] || 'star';
fs.copyFileSync(color, 'defaultImgColor.png');
fs.copyFileSync(depth, 'defaultImgDepth.png');
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 750 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 140)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
  const built = await page.evaluate(() => {
    window._rayReproject = true;
    bgQuickBake = false; bgMPIFullPlanes = true; bgMPIMode = true;
    const ok = buildBackgroundLayer();
    return ok !== false;
  });
  console.log('v2 build ok=' + built);
  const POSES = [
    ['r42', 0.42, 0.02], ['l42', -0.42, 0.02], ['r25', 0.25, 0.02],
    ['up',  0.123, -0.155], ['dn', -0.123, 0.155], ['rest', 0, 0],
  ];
  for (const [ptag, px, py] of POSES) {
    const png = await page.evaluate(async ({ px, py }) => {
      isSweeping = true;
      await new Promise(r2 => { let n = 0; const tick = () => { camera.position.set(px, py, 0.2); n++; n < 8 ? requestAnimationFrame(tick) : r2(); }; requestAnimationFrame(tick); });
      camera.position.set(px, py, 0.2); render();
      return renderer.domElement.toDataURL('image/png');
    }, { px, py });
    fs.writeFileSync('v2seam_' + tag + '_' + ptag + '.png', Buffer.from(png.split(',')[1], 'base64'));
    console.log('wrote v2seam_' + tag + '_' + ptag + '.png');
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
