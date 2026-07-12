// One-off shots: node mini_drive.js <prefix> x y
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const PREFIX = process.argv[2] || 'mn', X = parseFloat(process.argv[3]||'0.11'), Y = parseFloat(process.argv[4]||'0');
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('console', m => { const t=m.text(); if (/RUNG-PLUG|error/i.test(t)) console.log('  [page]',t); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && fgMarkDilationMaterial && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  await page.evaluate(() => { bgMPIFullPlanes=true; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer(); });
  await page.waitForTimeout(800);
  const dataUrl = await page.evaluate(async ({X,Y}) => {
    isSweeping = true;
    camera.position.x = X; camera.position.y = Y;
    await new Promise(res => { let n=0; const tick=()=>{ camera.position.x=X; camera.position.y=Y; n++; n<4?requestAnimationFrame(tick):res(); }; requestAnimationFrame(tick); });
    return document.getElementById('canvas').toDataURL('image/png');
  }, {X,Y});
  fs.writeFileSync(PREFIX + '_shot.png', Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('shot done'); await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
