// Idempotence: build once (shot A), rebuild (shot B) — A==baseline, B==A required
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
  page.on('console', m => { const t=m.text(); if (/thin-feature|standing-content|pre-torn/i.test(t)) console.log('  [pg]', t.slice(0,110)); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const shot = async (name) => {
    const d = await page.evaluate(async () => {
      isSweeping = true;
      camera.position.x = 0.123; camera.position.y = -0.055;
      await new Promise(res => { let n=0; const tick=()=>{ camera.position.x=0.123; camera.position.y=-0.055; n++; n<5?requestAnimationFrame(tick):res(); }; requestAnimationFrame(tick); });
      return document.getElementById('canvas').toDataURL('image/png');
    });
    fs.writeFileSync(name, Buffer.from(d.split(',')[1], 'base64'));
  };
  await page.evaluate(() => { bgMPIFullPlanes=false; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer(); });
  await page.waitForTimeout(600);
  await shot('reb_A.png');
  await page.evaluate(() => { buildBackgroundLayer(); });
  await page.waitForTimeout(600);
  await shot('reb_B.png');
  console.log('done');
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
