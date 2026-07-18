// Per-commit validation probe (works from a60 onward): quick build on one
// asset, mask numbers when available, one render at the given cam.
// argv: color depth outPng camX camY
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const [color, depth, outPng, camX, camY, noRec] = process.argv.slice(2);
fs.copyFileSync(color, 'defaultImgColor.png');
fs.copyFileSync(depth, 'defaultImgDepth.png');
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 933, height: 525 } });
  page.on('pageerror', e => console.log('  [PAGEERR] '+e.message.slice(0,120)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
  if (noRec === 'norec') await page.evaluate(() => { window.__norec = true; });
  const res = await page.evaluate(() => {
    window._srCapture = true; window._rayReproject = true;
    if (window.__norec) { try { bandOfRecordImg = null; sharpOfRecordImg = null; edgeMaskOfRecordImg = null; } catch (e) {} }
    bgQuickBake = true;
    let ok = true;
    try { ok = buildBackgroundLayer() !== false; } catch (e) { return { err: String(e).slice(0, 120) }; }
    const mk = window._qbMask || null;
    if (!mk) return { ok, sd: -1, g: -1 };
    let nD = 0, nG = 0; const N = mk.pw * mk.ph;
    for (let i = 0; i < N; i++) { if (mk.disocc[i]) nD++; if (mk.ground && mk.ground[i]) nG++; }
    return { ok, sd: +(100*nD/N).toFixed(1), g: mk.ground ? +(100*nG/N).toFixed(1) : -1 };
  });
  const png = await page.evaluate(async ({ px, py }) => {
    isSweeping = true;
    await new Promise(r2 => { let n = 0; const tick = () => { camera.position.set(px, py, 0.2); n++; n < 8 ? requestAnimationFrame(tick) : r2(); }; requestAnimationFrame(tick); });
    camera.position.set(px, py, 0.2); render();
    return renderer.domElement.toDataURL('image/png');
  }, { px: parseFloat(camX), py: parseFloat(camY) });
  fs.writeFileSync(outPng, Buffer.from(png.split(',')[1], 'base64'));
  console.log('RESULT ' + JSON.stringify(res));
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
