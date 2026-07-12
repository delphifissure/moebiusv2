// Adversarial review driver: renders a matrix of poses/toggles and dumps PNGs.
// Usage: node review_drive.js <outPrefix> [--asset=starwatcher|silverwarrior|frazetta]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');

const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const URL = 'http://localhost:8099/scratch_moebius.html';
const PREFIX = process.argv[2] || 'rv';

(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',
           '--ignore-gpu-blocklist','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('console', m => { const t=m.text(); if (/RUNG-PLUG|BG-LAYER|BUILD|error|Error|holes|DIAG/i.test(t)) console.log('  [page]',t); });
  page.on('pageerror', e => { if(!/tf is not defined/.test(e.message)) console.log('  [pageerr]',e.message); });

  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const st = await page.evaluate(() => {
      try { return { mesh: !!(typeof mediaLayers!=='undefined' && mediaLayers[0]?.mesh),
        fgmat: typeof fgMarkDilationMaterial!=='undefined' && !!fgMarkDilationMaterial,
        plug: typeof MoebiusPlug!=='undefined', depth: !!(typeof mediaLayers!=='undefined' && mediaLayers[0]?.textures?.depth) }; }
      catch(e){ return { err: e.message }; }
    }).catch(e => ({ evalErr: e.message }));
    if (st.mesh && st.fgmat && st.plug && st.depth) { console.log('READY after', t*2, 's'); break; }
    if (t === 59) { console.log('GATE TIMEOUT', JSON.stringify(st)); process.exit(1); }
    await new Promise(r => setTimeout(r, 2000));
  }

  async function shot(name, opts) {
    const t0 = Date.now();
    const dataUrl = await page.evaluate(async (o) => {
      isSweeping = true;
      const L = mediaLayers[0];
      if (L && L.mesh) L.mesh.visible = o.fg !== false;
      if (typeof bgLayerMesh!=='undefined' && bgLayerMesh) bgLayerMesh.visible = o.bg !== false;
      // arm/disarm the band cut explicitly (forceCut overrides the app's
      // "disarm when BG hidden" rule so we can see the cut holes naked)
      const fu = L?.mesh?.material?.uniforms;
      if (fu && fu.u_useBandCut) fu.u_useBandCut.value =
        o.forceCut === true ? true :
        ((o.cut !== false) && !!fu.u_bandMask.value && !!(bgLayerMesh && bgLayerMesh.visible));
      if (o.pristine) { // pristine = no plug, no cut
        if (bgLayerMesh) bgLayerMesh.visible = false;
        if (fu && fu.u_useBandCut) fu.u_useBandCut.value = false;
      }
      camera.position.x = o.x || 0; camera.position.y = o.y || 0;
      if (o.z !== undefined) camera.position.z = o.z;
      await new Promise(res => { let n=0; const tick=()=>{ camera.position.x=o.x||0; camera.position.y=o.y||0; if(o.z!==undefined)camera.position.z=o.z; n++; n<4?requestAnimationFrame(tick):res(); }; requestAnimationFrame(tick); });
      return document.getElementById('canvas').toDataURL('image/png');
    }, opts);
    fs.writeFileSync(name, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('shot', name, JSON.stringify(opts), (Date.now()-t0)+'ms');
  }

  // Build the BG layer (directional plug)
  await page.evaluate(() => {
    if (typeof bgPlugMode!=='undefined') bgPlugMode='directional';
    if (typeof bgValidMode!=='undefined') bgValidMode='auto';
    buildBackgroundLayer();
  });
  await page.waitForTimeout(800);
  const camz = await page.evaluate(() => camera.position.z);
  console.log('camera z =', camz);

  const P = n => PREFIX + '_' + n + '.png';
  if (process.argv[3] === 'basic') {
    await shot(P('pristine_c'),   { x: 0, pristine: true });
    await shot(P('pristine_r11'), { x: 0.11, pristine: true });
    await shot(P('comp_c'),    { x: 0 });
    await shot(P('comp_r11'),  { x: 0.11 });
    await shot(P('comp_l11'),  { x: -0.11 });
    await shot(P('comp_u06'),  { y: 0.06 });
    await shot(P('fgcut_r11'), { x: 0.11, bg: false, forceCut: true });
    await browser.close(); srv.kill(); console.log('done'); return;
  }
  // Baselines
  await shot(P('pristine_c'),   { x: 0, pristine: true });
  await shot(P('pristine_r11'), { x: 0.11, pristine: true });
  // Composite matrix
  await shot(P('comp_c'),    { x: 0 });
  await shot(P('comp_r11'),  { x: 0.11 });
  await shot(P('comp_l11'),  { x: -0.11 });
  await shot(P('comp_u06'),  { y: 0.06 });
  await shot(P('comp_d06'),  { y: -0.06 });
  await shot(P('comp_r11u06'), { x: 0.11, y: 0.06 });
  await shot(P('comp_r18'),  { x: 0.18 });
  // Layer isolation at +0.11
  await shot(P('fgcut_r11'), { x: 0.11, bg: false, forceCut: true }); // FG alone with the cut armed: shows exactly what the cut removes
  await shot(P('bg_r11'),    { x: 0.11, fg: false });
  // Zoom test: 2.5x closer at rest and offset (uvRate threshold armed at build)
  await shot(P('zoom_c'),    { x: 0, z: camz * 0.4 });
  await shot(P('zoom_r05'),  { x: 0.05, z: camz * 0.4 });
  await shot(P('pristine_zoom_c'), { x: 0, z: camz * 0.4, pristine: true });

  await browser.close(); srv.kill();
  console.log('done');
})().catch(e => { console.error('DRIVER ERROR', e.message); process.exit(1); });
