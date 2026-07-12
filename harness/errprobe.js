const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const seen = new Map();
  page.on('console', m => { const t = m.type()+': '+m.text().slice(0,200); seen.set(t, (seen.get(t)||0)+1); });
  page.on('pageerror', e => { const t = 'PAGEERROR: '+String(e).slice(0,300); seen.set(t, (seen.get(t)||0)+1); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  seen.clear();
  await page.evaluate(async () => {
    bgMPIMode = true; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer();
    await new Promise(r2 => { let n=0; const tick=()=>{ n++; n<12?requestAnimationFrame(tick):r2(); }; requestAnimationFrame(tick); });
  });
  console.log('=== console/pageerror during 12 frames after MPI build ===');
  for (const [t,c] of seen) console.log('x'+c, t);
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
