// MPI slice-1 probe: color-coded layer map + per-layer stats.
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
  page.on('console', m => { const t=m.text(); if (/MPI|RUNG-PLUG|error/i.test(t)) console.log('  [page]', t.slice(0,160)); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate(async () => {
    bgMPIMode=true; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer();
    const D = window._mpiDebug;
    if (!D) return { err: 'no _mpiDebug (bgMPIMode off?)' };
    const { pw, ph, K, texLayer, meanD } = D;
    // distinct colors per layer, ordered by depth (far=blue-ish to near=warm)
    const PAL = [[60,80,220],[70,170,230],[80,210,160],[140,220,80],[230,220,70],[240,170,60],[240,110,60],[230,70,90],[200,60,180],[130,70,230]];
    const rank = Array.from({length:K},(_,k)=>k).sort((a,b)=>meanD[a]-meanD[b]);
    const rankOf = new Int32Array(K+1); rank.forEach((k,r)=>rankOf[k+1]=r);
    const S = 2, c = document.createElement('canvas');
    c.width = (pw/S)|0; c.height = (ph/S)|0;
    const cx = c.getContext('2d'); const id = cx.createImageData(c.width, c.height);
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const i = (y*S)*pw + x*S, o = (y*c.width+x)*4;
      const l = texLayer[i];
      const col = l ? PAL[rankOf[l] % PAL.length] : [0,0,0];
      id.data[o]=col[0]; id.data[o+1]=col[1]; id.data[o+2]=col[2]; id.data[o+3]=255;
    }
    cx.putImageData(id, 0, 0);
    return { map: c.toDataURL('image/png'), K, meanD, layers: mpiLayers.map(L => ({ meanD: L.meanD, tris: L.tris, texels: L.texels })) };
  });
  if (res.err) { console.error(res.err); process.exit(1); }
  fs.writeFileSync('mpi_layermap.png', Buffer.from(res.map.split(',')[1],'base64'));
  console.log('K=' + res.K);
  res.layers.forEach((L,i) => console.log('  layer', i, 'meanD', L.meanD.toFixed(3), 'tris', L.tris, 'texels', L.texels));
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
