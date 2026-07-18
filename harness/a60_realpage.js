// Drive the REAL a60 moebius.html (CDN-stripped, face libs stubbed) the way
// the device does: tick the quick checkbox, click Build, shoot the star at
// the device cams. Compares against the scratch-page harness result.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = process.argv[2];              // worktree root containing the a60 checkout
const OUT = process.argv[3] || 'val';
const color = process.argv[4], depth = process.argv[5], tag = process.argv[6] || 'rp';
const H = path.join(WT, 'harness');
fs.mkdirSync(H, { recursive: true });
// build ui page from THIS commit's real moebius.html
let src = fs.readFileSync(path.join(WT, 'moebius.html'), 'utf8');
src = src.replace(/\s*<script src="https:\/\/[^"]+"[^>]*><\/script>/g, '');
src = src.replace('<script src="moebius.js"></script>',
  '<script src="vendor/three.min.js"></script>\n<script>window.tf={setBackend:async()=>{},ready:async()=>{}};window.faceLandmarksDetection={SupportedModels:{MediaPipeFaceMesh:"m"},createDetector:async()=>({estimateFaces:async()=>[]})};</script>\n<script src="moebius.js"></script>');
fs.writeFileSync(path.join(H, 'rp_test.html'), src);
for (const f of ['scratch_server.js']) fs.copyFileSync(path.join('/workspace/moebiusv2/harness', f), path.join(H, f));
try { fs.cpSync('/workspace/moebiusv2/harness/vendor', path.join(H, 'vendor'), { recursive: true }); } catch (e) {}
try { fs.symlinkSync('../moebius.js', path.join(H, 'moebius.js')); } catch (e) {}
try { fs.copyFileSync(path.join(WT, 'styles.css'), path.join(H, 'styles.css')); } catch (e) {}
fs.copyFileSync(color, path.join(H, 'defaultImgColor.png'));
fs.copyFileSync(depth, path.join(H, 'defaultImgDepth.png'));
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 933, height: 525 } });
  page.on('pageerror', e => console.log('  [PAGEERR] '+e.message.slice(0,120)));
  page.on('console', m => { const t = m.text(); if (t.indexOf('QUICK-BAKE') >= 0 || t.indexOf('BG-BUILD') >= 0) console.log('  [pg] ' + t.slice(0,130)); });
  await page.goto('http://localhost:8099/rp_test.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
  // USER FLOW on the a60 UI: tick quick checkbox, click Build
  const flags = await page.evaluate(() => {
    const c = document.getElementById('bgQuickBakeChk');
    if (c) { c.checked = true; c.dispatchEvent(new Event('change')); }
    document.getElementById('bgLayerBuildBtn').click();
    return { chk: !!c, reach: document.getElementById('fgReachSlider')?.value,
             inner: document.getElementById('innerDepthSlider')?.value, outer: document.getElementById('outerDepthSlider')?.value };
  });
  console.log('flags ' + JSON.stringify(flags));
  await page.waitForFunction(() => window._bgQuickBaked === true, null, { timeout: 300000 });
  await new Promise(r => setTimeout(r, 800));
  for (const [ptag, px, py] of [['L', -0.222, -0.052], ['R', 0.318, -0.051]]) {
    const png = await page.evaluate(async ({ px, py }) => {
      isSweeping = true;
      await new Promise(r2 => { let n = 0; const tick = () => { camera.position.set(px, py, 0.2); n++; n < 8 ? requestAnimationFrame(tick) : r2(); }; requestAnimationFrame(tick); });
      camera.position.set(px, py, 0.2); render();
      return renderer.domElement.toDataURL('image/png');
    }, { px, py });
    fs.writeFileSync(path.join('/workspace/moebiusv2/harness', OUT, 'RP_' + tag + '_' + ptag + '.png'), Buffer.from(png.split(',')[1], 'base64'));
    console.log('wrote RP_' + tag + '_' + ptag + '.png');
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
