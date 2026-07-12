// Rest-state attribution: which mechanism changes the rest render?
//   plugonly_c : BG plug visible, FG cut disarmed
//   cutonly_c  : BG plug hidden, FG cut force-armed
// Compare each against pristine_c from the main run.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');

const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const PREFIX = process.argv[2] || 'sw';

(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('console', m => { const t=m.text(); if (/RUNG-PLUG|BG-LAYER|error/i.test(t)) console.log('  [page]',t); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && typeof fgMarkDilationMaterial!=='undefined' && fgMarkDilationMaterial && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break;
    if (t === 59) process.exit(1);
    await new Promise(r => setTimeout(r, 2000));
  }
  await page.evaluate(() => { bgMPIFullPlanes=false; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer(); });
  await page.waitForTimeout(800);

  async function shot(name, mode) {
    const t0 = Date.now();
    const dataUrl = await page.evaluate(async (mode) => {
      isSweeping = true;
      const fu = mediaLayers[0].mesh.material.uniforms;
      if (mode === 'plugonly') { bgLayerMesh.visible = true; fu.u_useBandCut.value = false; }
      if (mode === 'cutonly')  { bgLayerMesh.visible = false; fu.u_useBandCut.value = true; }
      camera.position.x = 0; camera.position.y = 0;
      await new Promise(res => { let n=0; const tick=()=>{ n++; n<4?requestAnimationFrame(tick):res(); }; requestAnimationFrame(tick); });
      return document.getElementById('canvas').toDataURL('image/png');
    }, mode);
    fs.writeFileSync(name, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('shot', name, mode, (Date.now()-t0)+'ms');
  }
  await shot(PREFIX + '_plugonly_c.png', 'plugonly');
  await shot(PREFIX + '_cutonly_c.png', 'cutonly');
  await browser.close(); srv.kill();
  console.log('done');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
