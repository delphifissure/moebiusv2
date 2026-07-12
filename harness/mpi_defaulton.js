// A/B: bgMPIMode set immediately at page load (default-on simulation) vs off.
// Build via the real button, screenshot at REST and at pose, report content bounds.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const MODE = process.argv[2] === 'on';
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.addInitScript(mode => { window.__forceMPI = mode; }, MODE);
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  // set the flag as early as the variable exists (simulates default value)
  await page.evaluate(m => { const t = setInterval(() => { try { bgMPIMode = m; clearInterval(t); } catch(e){} }, 5); }, MODE);
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const shot = async (name, X, Y) => {
    const d = await page.evaluate(async ({X,Y}) => {
      isSweeping = true;
      camera.position.x = X; camera.position.y = Y;
      await new Promise(res => { let n=0; const tick=()=>{ camera.position.x=X; camera.position.y=Y; n++; n<5?requestAnimationFrame(tick):res(); }; requestAnimationFrame(tick); });
      return document.getElementById('canvas').toDataURL('image/png');
    }, {X,Y});
    fs.writeFileSync(name, Buffer.from(d.split(',')[1], 'base64'));
  };
  await page.evaluate(() => { bgPlugMode='directional'; bgValidMode='auto'; document.getElementById('bgLayerBuildBtn').click(); });
  await page.waitForTimeout(1000);
  const tag = MODE ? 'on' : 'off';
  await shot(`mdef_${tag}_rest.png`, 0, 0);
  await shot(`mdef_${tag}_pose.png`, 0.123, -0.055);
  const st = await page.evaluate(() => ({
    mpi: (typeof mpiLayers !== 'undefined' && mpiLayers) ? mpiLayers.length : 0,
    fgVisible: mediaLayers[0].mesh.visible,
    camZ: +camera.position.z.toFixed(5), zoom: camera.zoom, fov: camera.fov
  }));
  console.log(tag, JSON.stringify(st));
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
