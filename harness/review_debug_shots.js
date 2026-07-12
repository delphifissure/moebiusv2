// Debug-view captures at offset: FG-sub contract, plug error, gaps, and the
// direct (no-inpainting) path, to audit the composite pipeline empirically.
// Usage: node review_debug_shots.js <prefix>
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');

const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const PREFIX = process.argv[2] || 'dbg';

(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('console', m => { const t=m.text(); if (/RUNG-PLUG|BG-LAYER|FG-SUB|error|Error/i.test(t)) console.log('  [page]',t); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && typeof fgMarkDilationMaterial!=='undefined' && fgMarkDilationMaterial && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) { console.log('READY', t*2, 's'); break; }
    if (t === 59) process.exit(1);
    await new Promise(r => setTimeout(r, 2000));
  }
  await page.evaluate(() => { bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer(); });
  await page.waitForTimeout(800);

  async function shot(name, view, x, inpaint) {
    const t0 = Date.now();
    const dataUrl = await page.evaluate(async ({view, x, inpaint}) => {
      isSweeping = true;
      document.getElementById('debugViewSelect').value = view;
      const cb = document.getElementById('useInpaintingCheckbox');
      if (cb) { cb.checked = inpaint; useInpainting = inpaint; }
      camera.position.x = x; camera.position.y = 0;
      await new Promise(res => { let n=0; const tick=()=>{ camera.position.x=x; n++; n<4?requestAnimationFrame(tick):res(); }; requestAnimationFrame(tick); });
      return document.getElementById('canvas').toDataURL('image/png');
    }, {view, x, inpaint});
    fs.writeFileSync(name, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('shot', name, view, 'x='+x, 'inpaint='+inpaint, (Date.now()-t0)+'ms');
  }

  await shot(PREFIX + '_fgexcl_r11.png', 'fg_exclusion_color', 0.11, true); // FG-sub contract at offset
  await shot(PREFIX + '_gaps_r11.png', 'gaps', 0.11, true);                 // raw gap mask
  await shot(PREFIX + '_direct_r11.png', 'final', 0.11, false);             // no-inpainting direct path
  await shot(PREFIX + '_plugerr_r11.png', 'plug_error', 0.11, true);        // author's own seam metric

  await browser.close(); srv.kill();
  console.log('done');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
