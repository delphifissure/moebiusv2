// Layer-isolation probe: build v2 full planes once, then render each plane
// mesh SOLO at the failing pose (0.42, 0.02) to see which bin carries the
// gray ghost column and what its completion region looks like.
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
  const page = await browser.newPage({ viewport: { width: 900, height: 562 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 140)));
  page.on('console', m => { const t = m.text(); if (t.includes('[MPI-V2]')) console.log('  ' + t.slice(0, 160)); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
  const info = await page.evaluate(() => {
    window._rayReproject = true;
    bgQuickBake = false; bgMPIFullPlanes = true; bgMPIMode = true;
    buildBackgroundLayer();
    return mpiFullMeshes.map((m, i) => ({ i, name: m.name || ('mesh' + i),
      z: m.position.z, tris: (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3,
      meanD: m.userData && m.userData.meanD !== undefined ? m.userData.meanD : null }));
  });
  console.log(JSON.stringify(info, null, 1));
  // move camera to the failing pose once
  await page.evaluate(async () => {
    isSweeping = true;
    await new Promise(r2 => { let n = 0; const tick = () => { camera.position.set(0.42, 0.02, 0.2); n++; n < 8 ? requestAnimationFrame(tick) : r2(); }; requestAnimationFrame(tick); });
  });
  for (let k = 0; k < info.length; k++) {
    const png = await page.evaluate((k) => {
      for (let j = 0; j < mpiFullMeshes.length; j++) mpiFullMeshes[j].visible = (j === k);
      camera.position.set(0.42, 0.02, 0.2); render();
      return renderer.domElement.toDataURL('image/png');
    }, k);
    fs.writeFileSync('v2solo_' + String(k).padStart(2, '0') + '.png', Buffer.from(png.split(',')[1], 'base64'));
    console.log('wrote v2solo_' + String(k).padStart(2, '0') + '.png');
  }
  await page.evaluate(() => { for (const m of mpiFullMeshes) m.visible = true; });
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
