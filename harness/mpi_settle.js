// MPI on with LONG settle before shots; classic-framing check.
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
  await page.evaluate(() => { bgMPIMode = true; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer(); });
  await page.waitForTimeout(3000);
  await page.evaluate(async () => { await new Promise(r2 => { let n=0; const tick=()=>{ n++; n<20?requestAnimationFrame(tick):r2(); }; requestAnimationFrame(tick); }); });
  const shot = async (name, X, Y) => {
    const d = await page.evaluate(async ({X,Y}) => {
      isSweeping = true;
      camera.position.x = X; camera.position.y = Y;
      await new Promise(r2 => { let n=0; const tick=()=>{ camera.position.x=X; camera.position.y=Y; n++; n<6?requestAnimationFrame(tick):r2(); }; requestAnimationFrame(tick); });
      return document.getElementById('canvas').toDataURL('image/png');
    }, {X,Y});
    fs.writeFileSync(name, Buffer.from(d.split(',')[1],'base64'));
    console.log(name, 'done');
  };
  await shot('mpis_rest.png', 0, 0);
  await shot('mpis_pose.png', 0.123, -0.055);
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
