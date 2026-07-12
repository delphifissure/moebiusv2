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
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  await page.evaluate(() => { bgMPIFullPlanes = true; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer(); });
  await page.waitForTimeout(400);
  const ranks = await page.evaluate(() => mpiFullMeshes.map(m => m.userData.v2rank));
  console.log('ranks:', JSON.stringify(ranks));
  const shot = async (name) => {
    const d = await page.evaluate(async () => {
      isSweeping = true; camera.position.x = 0.35; camera.position.y = 0.05;
      await new Promise(res => { let n=0; const tick=()=>{ camera.position.x=0.35; camera.position.y=0.05; n++; n<5?requestAnimationFrame(tick):res(); }; requestAnimationFrame(tick); });
      return document.getElementById('canvas').toDataURL('image/png');
    });
    fs.writeFileSync(name, Buffer.from(d.split(',')[1], 'base64'));
  };
  await shot('ba_all.png');
  for (const r of [...new Set(ranks)].sort((a,b)=>a-b)) {
    await page.evaluate((rr) => { for (const m of mpiFullMeshes) m.visible = (m.userData.v2rank === rr); }, r);
    await shot('ba_rank' + r + '.png');
  }
  await page.evaluate(() => { for (const m of mpiFullMeshes) m.visible = true; });
  console.log('done');
  await browser.close(); srv.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
