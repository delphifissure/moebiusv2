const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');

const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const URL = 'http://localhost:8099/scratch_moebius.html';

(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader',
           '--ignore-gpu-blocklist','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('console', m => { const t=m.text(); if (/RUNG-PLUG|BG-LAYER|RENDER|error|Error|ERROR|THREE|shader|fill:|holes|DIAG/i.test(t)) console.log('  [page]',t); });
  page.on('pageerror', e => { if(!/tf is not defined/.test(e.message)) console.log('  [pageerr]',e.message); });

  await page.goto(URL, { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const st = await page.evaluate(() => {
      try { return { layers: typeof mediaLayers!=='undefined', mesh: !!(typeof mediaLayers!=='undefined' && mediaLayers[0]?.mesh),
        fgmat: typeof fgMarkDilationMaterial!=='undefined' && !!fgMarkDilationMaterial,
        plug: typeof MoebiusPlug!=='undefined', depth: !!(typeof mediaLayers!=='undefined' && mediaLayers[0]?.textures?.depth) }; }
      catch(e){ return { err: e.message }; }
    }).catch(e => ({ evalErr: e.message }));
    if (st.mesh && st.fgmat && st.plug && st.depth) { console.log('READY after', t*2, 's'); break; }
    if (t % 5 === 0) console.log('gate@'+(t*2)+'s', JSON.stringify(st));
    if (t === 59) { console.log('GATE TIMEOUT, final state:', JSON.stringify(st)); process.exit(1); }
    await new Promise(r => setTimeout(r, 2000));
  }

  // directional plug, auto Otsu valid; build the BG layer (runs the plug + fill)
  await page.evaluate(() => {
    if (typeof bgPlugMode!=='undefined') bgPlugMode='directional';
    if (typeof bgValidMode!=='undefined') bgValidMode='auto';
    buildBackgroundLayer();
  });
  await page.waitForTimeout(800);

  // Dump the plug's inpaint region (band) as a mask and overlaid on the image,
  // to judge whether it hugs the disocclusion silhouette or spills/streaks.
  const dumps = await page.evaluate(() => {
    const out = {};
    const xE = (typeof bgDirectionalExport!=='undefined') && bgDirectionalExport;
    if (!xE) return { err: 'no bgDirectionalExport' };
    const pw = xE.pw, ph = xE.ph, band = xE.band; // top-row-first
    // source color at native res
    const L = mediaLayers[0];
    const cimg = L.textures.color && L.textures.color.image;
    const cc = document.createElement('canvas'); cc.width=pw; cc.height=ph;
    const cx = cc.getContext('2d'); if (cimg) cx.drawImage(cimg,0,0,pw,ph);
    const src = cimg ? cx.getImageData(0,0,pw,ph).data : null;
    // 1) band mask (white = inpaint region)
    { const m=document.createElement('canvas'); m.width=pw; m.height=ph; const mx=m.getContext('2d');
      const id=mx.createImageData(pw,ph); for(let i=0;i<pw*ph;i++){const v=band[i]?255:0; id.data[i*4]=v;id.data[i*4+1]=v;id.data[i*4+2]=v;id.data[i*4+3]=255;} mx.putImageData(id,0,0);
      out.mask = m.toDataURL('image/png'); }
    // 2) band overlaid red on the image
    if (src){ const o=document.createElement('canvas'); o.width=pw; o.height=ph; const ox=o.getContext('2d');
      const id=ox.createImageData(pw,ph); for(let i=0;i<pw*ph;i++){ let r=src[i*4],g=src[i*4+1],b=src[i*4+2];
        if(band[i]){ r=Math.min(255,r*0.25+255*0.75); g=g*0.25; b=b*0.25; }
        id.data[i*4]=r;id.data[i*4+1]=g;id.data[i*4+2]=b;id.data[i*4+3]=255; } ox.putImageData(id,0,0);
      out.overlay = o.toDataURL('image/png'); }
    out.pw=pw; out.ph=ph; let n=0; for(let i=0;i<pw*ph;i++) n+=band[i]?1:0; out.bandPct=(100*n/(pw*ph)).toFixed(2);
    return out;
  });
  if (dumps.err) { console.log('DUMP ERR', dumps.err); }
  else {
    if (dumps.mask) fs.writeFileSync('scratch_band_mask.png', Buffer.from(dumps.mask.split(',')[1],'base64'));
    if (dumps.overlay) fs.writeFileSync('scratch_band_overlay.png', Buffer.from(dumps.overlay.split(',')[1],'base64'));
    console.log('band dump:', dumps.pw+'x'+dumps.ph, 'band', dumps.bandPct+'%');
  }

  async function shot(name, offset, fgVisible, bgVisible) {
    const t0 = Date.now();
    const dataUrl = await page.evaluate(async ({offset, fgVisible, bgVisible}) => {
      isSweeping = true;
      if (mediaLayers[0] && mediaLayers[0].mesh) mediaLayers[0].mesh.visible = fgVisible;
      if (typeof bgLayerMesh!=='undefined' && bgLayerMesh) bgLayerMesh.visible = bgVisible;
      camera.position.x = offset; camera.position.y = 0;
      await new Promise(res => { let n=0; const tick=()=>{ camera.position.x=offset; n++; n<4?requestAnimationFrame(tick):res(); }; requestAnimationFrame(tick); });
      return document.getElementById('canvas').toDataURL('image/png');
    }, {offset, fgVisible, bgVisible});
    fs.writeFileSync(name, Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('shot', name, 'offset', offset, 'FG', fgVisible, 'BG', bgVisible, (Date.now()-t0)+'ms');
  }

  // bg_right already captured
  await shot('scratch_sw_v11_right.png', 0.11, true, true);       // full composite, head right
  await shot('scratch_sw_v11_center.png', 0.0, true, true);       // at rest — integrity
  await shot('scratch_sw_v11_left.png', -0.11, true, true);       // composite, head left

  await browser.close(); srv.kill();
  console.log('done');
})().catch(e => { console.error('RENDER HARNESS ERROR', e.message); process.exit(1); });
