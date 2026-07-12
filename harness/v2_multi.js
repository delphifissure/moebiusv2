// Multi-layer v2: fabricate a cutout layer (near bar over far disk), build, shoot
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
  page.on('console', m => { const t=m.text(); if (/MPI-V2|PERF/i.test(t)) console.log('  [pg]', t.slice(0,180)); });
  page.on('pageerror', e => console.log('PAGEERR', String(e).slice(0,300)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  await page.evaluate(() => {
    // fabricate a composited cutout layer: far disk (0.30) + near bar (0.72)
    const S = 512;
    const cc2 = document.createElement('canvas'); cc2.width = S; cc2.height = S;
    const c2 = cc2.getContext('2d');
    c2.clearRect(0,0,S,S);
    c2.fillStyle = '#d4483b'; c2.beginPath(); c2.arc(S/2, S/2, 170, 0, Math.PI*2); c2.fill();   // disk
    c2.fillStyle = '#3bd4a0'; c2.fillRect(S/2-60, 40, 120, S-80);                                // bar over it
    const dc2 = document.createElement('canvas'); dc2.width = S; dc2.height = S;
    const d2 = dc2.getContext('2d');
    d2.fillStyle = 'rgb(0,0,0)'; d2.fillRect(0,0,S,S);
    d2.fillStyle = 'rgb(77,77,77)'; d2.beginPath(); d2.arc(S/2, S/2, 170, 0, Math.PI*2); d2.fill();
    d2.fillStyle = 'rgb(184,184,184)'; d2.fillRect(S/2-60, 40, 120, S-80);
    const cTex = new THREE.Texture(cc2); cTex.needsUpdate = true;
    const dTex = new THREE.Texture(dc2); dTex.needsUpdate = true;
    const mat = createShaderMaterial('image', cTex, dTex, null);
    mat.uniforms.u_textureSize.value.set(S, S);
    const geom = new THREE.PlaneGeometry(0.05, 0.05, 8, 8);
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(0.045, 0.02, portalPlaneWorldZ);
    mesh.renderOrder = 1;
    scene.add(mesh);
    mediaLayers.push({ id: 'test2', type: 'image', mesh, textures: { color: cTex, depth: dTex }, elements: {} });
  });
  const t0 = Date.now();
  await page.evaluate(() => { bgMPIFullPlanes = true; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer(); });
  console.log('build:', Date.now()-t0, 'ms');
  await page.waitForTimeout(400);
  const shot = async (name, X, Y) => {
    const d = await page.evaluate(async ({X,Y}) => {
      isSweeping = true; camera.position.x = X; camera.position.y = Y;
      await new Promise(res => { let n=0; const tick=()=>{ camera.position.x=X; camera.position.y=Y; n++; n<5?requestAnimationFrame(tick):res(); }; requestAnimationFrame(tick); });
      return document.getElementById('canvas').toDataURL('image/png');
    }, {X,Y});
    fs.writeFileSync(name, Buffer.from(d.split(',')[1], 'base64'));
  };
  await shot('vm_rest.png', 0, 0);
  await shot('vm_std.png', 0.123, -0.055);
  await shot('vm_wide.png', 0.35, 0.05);
  console.log('shots done');
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
