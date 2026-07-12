// True-source-reference measurement: criterion 6 says "pixel-faithful to the
// SOURCE IMAGE". ref_c renders the bare mesh (no gap generators, no inpaint,
// no plug) = the source mapped through the mesh. Both the pristine app and
// the plug build are then diffed against it.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const PREFIX = process.argv[2] || 'rf';

(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('console', m => { const t=m.text(); if (/RUNG-PLUG|BG-LAYER|error/i.test(t)) console.log('  [page]',t); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && typeof fgMarkDilationMaterial!=='undefined' && fgMarkDilationMaterial && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break;
    if (t === 59) process.exit(1);
    await new Promise(r => setTimeout(r, 2000));
  }
  await page.evaluate(() => { bgMPIFullPlanes=false; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer(); });
  await page.waitForTimeout(800);

  async function shot(name, o) {
    const t0 = Date.now();
    const dataUrl = await page.evaluate(async (o) => {
      isSweeping = true;
      const L = mediaLayers[0];
      L.mesh.visible = true;
      if (bgLayerMesh) bgLayerMesh.visible = o.plug !== false;
      const fu = L.mesh.material.uniforms;
      if (fu.u_useBandCut) fu.u_useBandCut.value = false; // pre-tear build: cut always off
      // reference mode: all generators off, no screen-space inpaint
      const sob = document.getElementById('useSobelCheck');
      const inp = document.getElementById('useInpaintingCheckbox');
      if (o.ref) { if (sob) sob.checked = false; if (inp) { inp.checked = false; useInpainting = false; } if (bgLayerMesh) bgLayerMesh.visible = false; }
      else { if (sob) sob.checked = true; if (inp) { inp.checked = true; useInpainting = true; } }
      camera.position.x = o.x || 0; camera.position.y = o.y || 0;
      await new Promise(res => { let n=0; const tick=()=>{ camera.position.x=o.x||0; camera.position.y=o.y||0; n++; n<4?requestAnimationFrame(tick):res(); }; requestAnimationFrame(tick); });
      return document.getElementById('canvas').toDataURL('image/png');
    }, o);
    fs.writeFileSync(name, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('shot', name, JSON.stringify(o), (Date.now()-t0)+'ms');
  }

  const P = n => PREFIX + '_' + n + '.png';
  await shot(P('ref_c'),      { x: 0, ref: true });          // source through bare mesh
  await shot(P('pristine_c'), { x: 0, plug: false });         // pristine app (sobel+inpaint)
  await shot(P('comp_c'),     { x: 0 });                      // plug build
  await shot(P('comp_r11'),   { x: 0.11 });                   // D8 side-effect check
  await shot(P('comp_u06'),   { y: 0.06 });
  await browser.close(); srv.kill();
  console.log('done');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
