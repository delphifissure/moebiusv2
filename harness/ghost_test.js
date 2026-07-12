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
  await page.evaluate(() => { bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer(); });
  await page.waitForTimeout(800);
  const shot = async (ghostOn) => await page.evaluate(async (ghostOn) => {
    isSweeping = true;
    const g = mediaLayers[0].ghostMesh;
    if (g) g.visible = ghostOn;
    camera.position.x = 0.123; camera.position.y = -0.055;
    await new Promise(r2 => { let n=0; const tick=()=>{ camera.position.x=0.123; camera.position.y=-0.055; n++; n<4?requestAnimationFrame(tick):r2(); }; requestAnimationFrame(tick); });
    return document.getElementById('canvas').toDataURL('image/png');
  }, ghostOn);
  const on = await shot(true), off = await shot(false);
  fs.writeFileSync('ghost_on.png', Buffer.from(on.split(',')[1],'base64'));
  fs.writeFileSync('ghost_off.png', Buffer.from(off.split(',')[1],'base64'));
  console.log('ghost exists:', await page.evaluate(() => !!mediaLayers[0].ghostMesh));
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
