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
  await page.evaluate(() => { bgMPIFullPlanes=false; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer(); });
  await page.waitForTimeout(800);
  const list = await page.evaluate(() => scene.children.map((o,i) => ({
    i, type: o.type, name: o.name || '', ro: o.renderOrder, vis: o.visible,
    isFG: o === mediaLayers[0].mesh, isBG: o === bgLayerMesh,
    mat: o.material ? (o.material.type + ' transp=' + o.material.transparent + ' depthWrite=' + o.material.depthWrite) : null
  })));
  console.log(JSON.stringify(list, null, 1));
  // sample blob pixels in the full composite at pose
  const px = await page.evaluate(async () => {
    isSweeping = true;
    camera.position.x = 0.123; camera.position.y = -0.055;
    await new Promise(r2 => { let n=0; const tick=()=>{ camera.position.x=0.123; camera.position.y=-0.055; n++; n<4?requestAnimationFrame(tick):r2(); }; requestAnimationFrame(tick); });
    const c = document.getElementById('canvas');
    const t = document.createElement('canvas'); t.width=c.width; t.height=c.height;
    const cx = t.getContext('2d'); cx.drawImage(c,0,0);
    const out = [];
    for (const [x,y] of [[380,300],[400,290],[370,320],[390,310]]) {
      const sx = Math.round(x*c.width/860), sy = Math.round(y*c.height/484);
      out.push([x,y,...cx.getImageData(sx,sy,1,1).data].join(','));
    }
    return { pts: out, cw: c.width, ch: c.height };
  });
  console.log('canvas', px.cw+'x'+px.ch, 'blob samples x,y,r,g,b,a:', px.pts);
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
