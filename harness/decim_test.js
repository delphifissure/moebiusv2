// Decimation A/B: shots at rest + pose + extreme pose, with tri counts
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const DEC = process.argv[2] === 'on';
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('console', m => { const t=m.text(); if (/\[MPI\] \d+ layers/.test(t)) console.log('  [pg]', t.slice(0,240)); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  await page.evaluate((dec) => { bgMPIDecimate = dec; bgMPIFullPlanes=false; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer(); }, DEC);
  await page.waitForTimeout(600);
  const shot = async (name, X, Y) => {
    const d = await page.evaluate(async ({X,Y}) => {
      isSweeping = true;
      camera.position.x = X; camera.position.y = Y;
      await new Promise(res => { let n=0; const tick=()=>{ camera.position.x=X; camera.position.y=Y; n++; n<5?requestAnimationFrame(tick):res(); }; requestAnimationFrame(tick); });
      return document.getElementById('canvas').toDataURL('image/png');
    }, {X,Y});
    fs.writeFileSync(name, Buffer.from(d.split(',')[1], 'base64'));
  };
  const tag = DEC ? 'on' : 'off';
  await shot(`dec_${tag}_rest.png`, 0, 0);
  await shot(`dec_${tag}_pose.png`, 0.123, -0.055);
  await shot(`dec_${tag}_xtreme.png`, -0.16, 0.09);
  console.log('done');
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
