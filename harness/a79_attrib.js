// A79 taffy attribution at star (0.182,-0.056): one quick build, then
// runtime toggles — (a) hide cap cards, (b) aggressive stretch-net uvRate —
// to identify which mechanism carries the staff-top wisps.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/arc73';
const H = path.join(WT, 'harness');
const OUTD = '/workspace/moebiusv2/harness/val';
fs.copyFileSync(path.join(WT, 'starwatcher_color.png'), path.join(H, 'defaultImgColor.png'));
fs.copyFileSync(path.join(WT, 'starwatcher_depth.png'), path.join(H, 'defaultImgDepth.png'));
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 933, height: 525 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 140)));
  await page.goto('http://localhost:8099/fp_test.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
  await page.evaluate(() => {
    window._bgQuickBaked = false;
    const s = document.getElementById('bgModeSel');
    if (s) { s.value = 'quick'; s.dispatchEvent(new Event('change')); }
    document.getElementById('bgLayerBuildBtn').click();
  });
  await page.waitForFunction(() => window._bgQuickBaked === true, null, { timeout: 480000, polling: 2000 });
  await new Promise(r => setTimeout(r, 600));
  const shoot = async (name, setup) => {
    const png = await page.evaluate(async ({ setup }) => {
      eval(setup);
      isSweeping = true;
      await new Promise(r2 => { let n = 0; const tick = () => { camera.position.set(0.182, -0.056, 0.2); n++; n < 8 ? requestAnimationFrame(tick) : r2(); }; requestAnimationFrame(tick); });
      camera.position.set(0.182, -0.056, 0.2); render();
      return renderer.domElement.toDataURL('image/png');
    }, { setup });
    fs.writeFileSync(path.join(OUTD, name), Buffer.from(png.split(',')[1], 'base64'));
    console.log('wrote ' + name);
  };
  await shoot('A79_base.png', '');
  await shoot('A79_nocards.png', 'if (typeof bgCardMesh !== "undefined" && bgCardMesh) bgCardMesh.visible = false;');
  await shoot('A79_tightnet.png', `if (typeof bgCardMesh !== "undefined" && bgCardMesh) bgCardMesh.visible = true;
    const mu = mediaLayers[0].mesh.material.uniforms;
    if (mu.u_bandCutUvRate) mu.u_bandCutUvRate.value = 0.5 / Math.max(1, renderer.domElement.width);`);
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
