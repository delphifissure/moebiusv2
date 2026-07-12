const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  await page.evaluate(() => { bgPlugMode='directional'; bgValidMode='auto'; document.getElementById('bgLayerBuildBtn').click(); });
  await page.waitForTimeout(1000);
  const d = await page.evaluate(async () => {
    isSweeping = true;
    camera.position.x = 0.123; camera.position.y = -0.055;
    await new Promise(res => { let n=0; const tick=()=>{ camera.position.x=0.123; camera.position.y=-0.055; n++; n<5?requestAnimationFrame(tick):res(); }; requestAnimationFrame(tick); });
    return document.getElementById('canvas').toDataURL('image/png');
  });
  fs.writeFileSync('mdef_pure_pose.png', Buffer.from(d.split(',')[1], 'base64'));
  const st = await page.evaluate(() => ({ mode: bgMPIMode, layers: mpiLayers ? mpiLayers.length : 0 }));
  console.log(JSON.stringify(st));
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
