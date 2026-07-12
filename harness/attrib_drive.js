// Attribution shots at a pose: full, FG-only (bg hidden), BG-only (fg hidden).
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const PREFIX = process.argv[2] || 'at', X = parseFloat(process.argv[3]||'0.123'), Y = parseFloat(process.argv[4]||'-0.055');
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('console', m => { const t=m.text(); if (/RUNG-PLUG|error/i.test(t)) console.log('  [page]',t.slice(0,140)); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && fgMarkDilationMaterial && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  await page.evaluate(() => { bgMPIFullPlanes=false; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer(); });
  await page.waitForTimeout(800);
  const shoot = async (mode) => await page.evaluate(async ({X,Y,mode}) => {
    isSweeping = true;
    if (bgLayerMesh) bgLayerMesh.visible = (mode !== 'fg');
    if (mediaLayers[0] && mediaLayers[0].mesh) mediaLayers[0].mesh.visible = (mode !== 'bg');
    camera.position.x = X; camera.position.y = Y;
    await new Promise(res => { let n=0; const tick=()=>{ camera.position.x=X; camera.position.y=Y; n++; n<4?requestAnimationFrame(tick):res(); }; requestAnimationFrame(tick); });
    const d = document.getElementById('canvas').toDataURL('image/png');
    if (bgLayerMesh) bgLayerMesh.visible = true;
    if (mediaLayers[0] && mediaLayers[0].mesh) mediaLayers[0].mesh.visible = true;
    return d;
  }, {X,Y,mode});
  for (const mode of ['full','fg','bg']) {
    const d = await shoot(mode);
    fs.writeFileSync(PREFIX + '_' + mode + '.png', Buffer.from(d.split(',')[1], 'base64'));
    console.log(mode, 'done');
  }
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
