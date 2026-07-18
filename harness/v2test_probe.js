const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const OUT = process.argv[2] || '.';
const DX = parseFloat(process.argv[3] || '0.18');
fs.copyFileSync('../starwatcher_color.png', 'defaultImgColor.png');
fs.copyFileSync('../starwatcher_depth.png', 'defaultImgDepth.png');
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1400));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  async function run(mode, tag) {
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
    for (let t = 0; t < 60; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 2000)); }
    const u = await page.evaluate(async ({mode,dx}) => {
      window._noV2Anamorphic = (mode==='clone');
      bgMPIMode = true; bgMPIFullPlanes = true; bgQuickBake = false;
      buildBackgroundLayer();
      isSweeping = true;
      await new Promise(r2 => { let n=0; const tick=()=>{ camera.position.x=dx; camera.position.y=0.0; camera.position.z=0.2; n++; n<12?requestAnimationFrame(tick):r2(); }; requestAnimationFrame(tick); });
      render();
      // also grab backdrop-only: hide all planes except the farthest
      const comp = renderer.domElement.toDataURL('image/png');
      return {comp};
    }, {mode,dx:DX});
    fs.writeFileSync(OUT+'/'+tag+'.png', Buffer.from(u.comp.split(',')[1],'base64'));
    console.log('wrote '+tag);
  }
  await run('ana', 'v2ana');
  await run('clone', 'v2clone');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
