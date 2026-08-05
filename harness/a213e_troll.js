// A213e verification on the CONVICTING asset: troll, rest pose. The a213d
// tear shredded the figure interior (pale wash blob visible at rest). With
// the far-side match the rest frame must be ~identical between tear ON and
// OFF (interior kept), while silhouette walls still tear.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const OUT = process.env.OUT || '/tmp/claude-0/-home-user-moebius/989b3965-28fd-58c7-96b5-b4b22c709919/scratchpad';
(async () => {
  fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
  page.on('console', m => { const t = m.text(); if (t.includes('A212')) console.log('  [page] ' + t.slice(0, 150)); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  console.log('served ' + await page.evaluate(() => MOEBIUS_BUILD));
  const shot = async (tear, tag) => {
    const r = await page.evaluate(async (o) => {
      window._rayReproject = true; fgPreTear = o.tear;
      const g = mediaLayers[0].mesh.geometry;
      if (g.userData._fullIndex) g.setIndex(new THREE.BufferAttribute(g.userData._fullIndex.slice(), 1));
      bgQuickBake = true; buildBackgroundLayer();
      if (typeof updateVolumeGuidesVisibility === 'function') updateVolumeGuidesVisibility(false);
      isSweeping = true;
      camera.position.set(0, 0, 0.2); updateCameraAndProjection(); render(); updateCameraAndProjection(); render();
      const W = renderer.domElement.width, Hh = renderer.domElement.height;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
      const d = cx.getImageData(0, 0, W, Hh).data;
      const rl = [];
      for (let y = 0; y < Hh; y += 2) for (let x = 0; x < W; x += 2) {
        const i = (y*W+x)*4; rl.push(Math.round(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]));
      }
      return { rl, png: cv.toDataURL('image/png') };
    }, { tear });
    fs.writeFileSync(path.join(OUT, 'a213e_' + tag + '.png'), Buffer.from(r.png.split(',')[1], 'base64'));
    return r.rl;
  };
  const A = await shot(false, 'troll_untorn');
  const B = await shot(true,  'troll_torn');
  let ch = 0, big = 0;
  for (let i = 0; i < A.length; i++) { const d = Math.abs(A[i]-B[i]); if (d > 8) ch++; if (d > 32) big++; }
  console.log('TROLL REST delta tear-on vs off: ' + (100*ch/A.length).toFixed(2) + '% px >8 luma, ' +
              (100*big/A.length).toFixed(2) + '% >32  (a213d shredding showed as a large blob; expect ~0 now)');
  await browser.close(); srv.kill(); process.exit(0);
})();
