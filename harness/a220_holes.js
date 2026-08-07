
// A220: are the holes the plate's TRANSPARENT texels (wash ink-rejection
// alpha) rather than missing geometry? A/B in one page at the user's pose:
// arm A = shipped; arm B = same frame with the plate's map swapped for a
// fully opaque source-color canvas. If B has no holes, the mechanism is
// the alpha, and the fix is an opaque plate map.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const OUT = '/tmp/claude-0/-home-user-moebius/989b3965-28fd-58c7-96b5-b4b22c709919/scratchpad/a220';
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 45; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  const res = await page.evaluate(async () => {
    window._rayReproject = true;
    bgQuickBake = true; buildBackgroundLayer();
    isSweeping = true;
    camera.position.set(0.100, -0.023, 0.200);   // the user's labeled-sheet pose, 27.2deg
    const grab = () => { for (let n = 0; n < 3; n++) render();
      const W = renderer.domElement.width, Hh = renderer.domElement.height;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
      return { d: cx.getImageData(0, 0, W, Hh).data, W, Hh, png: cv.toDataURL('image/png') };
    };
    const dark = (g) => { let n = 0, tot = 0;
      // content region: middle 70% of frame (excludes letterbox/edge)
      const x0 = Math.round(0.15*g.W), x1 = Math.round(0.85*g.W), y0 = Math.round(0.1*g.Hh), y1 = Math.round(0.9*g.Hh);
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y*g.W+x)*4; tot++;
        if (g.d[i]+g.d[i+1]+g.d[i+2] < 24 || g.d[i+3] < 8) n++; }
      return +(100*n/tot).toFixed(2); };
    const A = grab();
    // arm B: opaque source-color map on the plate
    const L = mediaLayers[0];
    const cImg = (L.elements && L.elements.color) || L.textures.color.image;
    const pw = cImg.naturalWidth || cImg.width, ph = cImg.naturalHeight || cImg.height;
    const cv2 = document.createElement('canvas'); cv2.width = pw; cv2.height = ph;
    cv2.getContext('2d').drawImage(cImg, 0, 0, pw, ph);
    const tex = new THREE.CanvasTexture(cv2);
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    if ('colorSpace' in tex && L.textures.color && 'colorSpace' in L.textures.color) tex.colorSpace = L.textures.color.colorSpace;
    const m0 = bgLayerMesh.material.uniforms.map.value;
    bgLayerMesh.material.uniforms.map.value = tex;
    const B = grab();
    bgLayerMesh.material.uniforms.map.value = m0;
    return { darkA: dark(A), darkB: dark(B), pngA: A.png, pngB: B.png };
  });
  console.log('dark% in content, shipped map: ' + res.darkA + '   opaque source map: ' + res.darkB);
  fs.writeFileSync(path.join(OUT, 'shipped.png'), Buffer.from(res.pngA.split(',')[1], 'base64'));
  fs.writeFileSync(path.join(OUT, 'opaque.png'), Buffer.from(res.pngB.split(',')[1], 'base64'));
  console.log('frames -> ' + OUT);
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
