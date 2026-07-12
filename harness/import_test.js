// Headless reimport test: paint layer 1's strips solid magenta via applyMPILayerImage,
// verify slot textures changed only at layer-1 texels + magenta appears at the pose.
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
  const res = await page.evaluate(async () => {
    bgMPIFullPlanes=false; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer();
    const sE = bgMPIStripExport;
    if (!sE) return { err: 'no strip export' };
    const { pw, ph } = sE;
    // synthetic "SD result": full magenta canvas
    const cv = document.createElement('canvas'); cv.width = pw; cv.height = ph;
    const cc = cv.getContext('2d'); cc.fillStyle = '#ff00ff'; cc.fillRect(0, 0, pw, ph);
    // snapshot one non-layer-1 strip texel color before
    let otherIdx = -1, otherSlot = -1;
    for (let i = 0; i < pw*ph && otherIdx < 0; i++) for (let s = 0; s < 2; s++)
      if (sE.slotO[s][i] && sE.slotO[s][i] !== 1) { otherIdx = i; otherSlot = s; break; }
    const before = otherIdx >= 0 ? Array.from(sE.slotC[otherSlot].slice(otherIdx*3, otherIdx*3+3)) : null;
    const n = applyMPILayerImage(1, cv);
    const after = otherIdx >= 0 ? Array.from(sE.slotC[otherSlot].slice(otherIdx*3, otherIdx*3+3)) : null;
    // sample one layer-1 strip texel
    let l1 = null;
    for (let i = 0; i < pw*ph && !l1; i++) for (let s = 0; s < 2; s++)
      if (sE.slotO[s][i] === 1) { l1 = Array.from(sE.slotC[s].slice(i*3, i*3+3)); break; }
    // pose render
    isSweeping = true; camera.position.x = 0.123; camera.position.y = -0.055;
    await new Promise(r2 => { let n2=0; const tick=()=>{ camera.position.x=0.123; camera.position.y=-0.055; n2++; n2<5?requestAnimationFrame(tick):r2(); }; requestAnimationFrame(tick); });
    const d = document.getElementById('canvas').toDataURL('image/png');
    return { n, before, after, l1, shot: d };
  });
  if (res.err) { console.log('ERR', res.err); process.exit(1); }
  console.log('applied px:', res.n, '| layer-1 texel now:', JSON.stringify(res.l1),
    '| non-layer-1 texel before/after:', JSON.stringify(res.before), JSON.stringify(res.after));
  fs.writeFileSync('import_shot.png', Buffer.from(res.shot.split(',')[1], 'base64'));
  // count magenta pixels in the render
  const { execSync } = require('child_process');
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
