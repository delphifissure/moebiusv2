const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const OUT = process.argv[2] || '.';
fs.copyFileSync('../starwatcher_color.png', 'defaultImgColor.png');
fs.copyFileSync('../starwatcher_depth.png', 'defaultImgDepth.png');
const POSES = [[-0.20,0],[-0.10,0.05],[0,0],[0.10,-0.05],[0.20,0],[0.15,0.12],[-0.15,-0.10],[0,0.15]];
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1400));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 2000)); }
  await page.evaluate(() => { bgQuickBake = true; buildBackgroundLayer(); });
  for (let p = 0; p < POSES.length; p++) {
    const [dx,dy] = POSES[p];
    const u = await page.evaluate(async ({dx,dy}) => {
      isSweeping = true;
      await new Promise(r2 => { let n=0; const tick=()=>{ camera.position.x=dx; camera.position.y=dy; camera.position.z=0.2; n++; n<10?requestAnimationFrame(tick):r2(); }; requestAnimationFrame(tick); });
      render(); return renderer.domElement.toDataURL('image/png');
    }, {dx,dy});
    fs.writeFileSync(OUT+'/p'+p+'_'+dx+'_'+dy+'.png', Buffer.from(u.split(',')[1],'base64'));
    console.log('wrote p'+p+' ('+dx+','+dy+')');
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
