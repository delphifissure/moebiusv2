// Visual A/B: v1 bake composite at a wide pose, cropped PNG.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const SRC = process.argv[2] || null;
const OUT = process.argv[3] || 'vis.png';
(async () => {
  let pageFile = 'scratch_moebius.html';
  if (SRC) {
    fs.copyFileSync(SRC, 'm_active.js');
    fs.writeFileSync('scratch_ab.html',
      fs.readFileSync('scratch_moebius.html', 'utf8').replace('src="moebius.js"', 'src="m_active.js"'));
    pageFile = 'scratch_ab.html';
  }
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto('http://localhost:8099/' + pageFile, { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const png = await page.evaluate(async () => {
    bgMPIFullPlanes = false; bgMPIMode = true; bgPlugMode = 'directional'; bgValidMode = 'auto';
    buildBackgroundLayer();
    isSweeping = true;
    const X = 0.14, Y = 0.05;
    camera.position.x = X; camera.position.y = Y; camera.position.z = 0.2;
    await new Promise(r2 => { let n = 0; const tick = () => { camera.position.x = X; camera.position.y = Y; camera.position.z = 0.2; n++; n < 8 ? requestAnimationFrame(tick) : r2(); }; requestAnimationFrame(tick); });
    const cnv = document.getElementById('canvas');
    const g = document.createElement('canvas'); g.width = cnv.width; g.height = cnv.height;
    g.getContext('2d').drawImage(cnv, 0, 0);
    return g.toDataURL('image/png');
  });
  fs.writeFileSync(OUT, Buffer.from(png.split(',')[1], 'base64'));
  console.log((SRC || 'live'), '->', OUT);
  await browser.close(); srv.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
