// A208e PROBE. The suite's dolly lock check reads 168px at the subject columns
// while clickpin reads 2px, the gain algebra verifies to 4 decimals, and the
// perCol drift is nearly UNIFORM (-168 at almost every column). Uniform drift
// of that size across all columns is the signature of the crest metric
// SWITCHING FEATURES between phases: once freeze+corners restore the real
// zoom, the off-plane near dune (0.741) legitimately stretches ~130-170px and
// its bright silhouette may out-gradient the pinned ridge (0.525) in the
// subject columns at one of the two phases. This probe replicates the suite's
// exact config and drive, then measures with FEATURE IDENTITY:
//   1. absolute crest ys per column at both phases (what the suite diffs)
//   2. a template patch cut ON the mid-phase crest at 0.30w, searched in the
//      far frame with a tall window: where did THAT content actually go?
//   3. a second template on the near dune body: where did the OFF-plane
//      content go? (should be ~the stretch magnitude)
//   4. both frames saved as PNGs.
//
//   node harness/dollysuite.js
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const OUT = process.env.OUT || '/tmp/claude-0/-home-user-moebius/989b3965-28fd-58c7-96b5-b4b22c709919/scratchpad';

(async () => {
  fs.copyFileSync(path.join(WT, 'starwatcher_color.png'), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, 'starwatcher_depth.png'), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  const served = await page.evaluate(() => (typeof MOEBIUS_BUILD === 'string') ? MOEBIUS_BUILD : null);
  console.log('served build = ' + served);

  const r = await page.evaluate(async () => {
    window._rayReproject = true;
    bgQuickBake = true; buildBackgroundLayer();

    // ---- A208d sampler, verbatim from the suite ----
    const dImg = mediaLayers[0].textures.depth.image2d || mediaLayers[0].textures.depth.image;
    const cImg = mediaLayers[0].textures.color.image2d || mediaLayers[0].textures.color.image;
    const w = dImg.naturalWidth || dImg.width, h = dImg.naturalHeight || dImg.height;
    const cv0 = document.createElement('canvas'); cv0.width = w; cv0.height = h;
    const cx0 = cv0.getContext('2d'); cx0.drawImage(dImg, 0, 0, w, h);
    const col = cx0.getImageData(Math.round(0.30*w), 0, 1, h).data;
    const cvC = document.createElement('canvas'); cvC.width = w; cvC.height = h;
    const cxC = cvC.getContext('2d'); cxC.drawImage(cImg, 0, 0, w, h);
    const colC = cxC.getImageData(Math.round(0.30*w), 0, 1, h).data;
    const lum0 = y => 0.299*colC[y*4] + 0.587*colC[y*4+1] + 0.114*colC[y*4+2];
    const gw = Math.max(2, Math.round(h * 2 / 450));
    let be = 0, bey = Math.round(0.90*h);
    for (let y = Math.round(0.50*h) + gw; y < Math.round(0.98*h) - gw; y++) {
      const g = Math.abs(lum0(y+gw) - lum0(y-gw));
      if (g > be) { be = g; bey = y; }
    }
    const so = Math.max(gw + 2, Math.round(0.01*h));
    const vUp = col[Math.max(0, bey - so)*4] / 255;
    const vDn = col[Math.min(h-1, bey + so)*4] / 255;
    const v = Math.max(vUp, vDn);
    subjectFocalPlaneWorldZ = volumeWorldZForNormDepth(v);
    initializeSubjectLockConstant();

    const W2 = 720, H2 = 450;
    const grabL = () => {
      const cv = document.createElement('canvas'); cv.width = W2; cv.height = H2;
      const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W2, H2);
      const d = cx.getImageData(0, 0, W2, H2).data;
      const L = new Float32Array(W2*H2);
      for (let i = 0; i < W2*H2; i++) L[i] = 0.299*d[i*4] + 0.587*d[i*4+1] + 0.114*d[i*4+2];
      return { L, png: cv.toDataURL('image/png') };
    };
    // top-3 luma edges per column, same window/range as the suite crest()
    const edges3 = (L, x) => {
      const list = [];
      for (let y = Math.round(0.50*H2); y < Math.round(0.98*H2) - 2; y++) {
        const g = Math.abs(L[(y+2)*W2+x] - L[(y-2)*W2+x]);
        list.push([g, y]);
      }
      list.sort((a,b) => b[0]-a[0]);
      const picked = [];
      for (const [g,y] of list) {
        if (picked.some(p => Math.abs(p[1]-y) < 8)) continue;
        picked.push([Math.round(g), y]); if (picked.length >= 3) break;
      }
      return picked;
    };

    const shoot = async (tval) => {
      subjectLockActive = true; dollyZoomActive = true;
      const pin = () => { dollyZoomTime = tval - dollyZoomSpeed * 100; };
      isSweeping = true;
      await new Promise(r2 => { let n = 0; const tick = () => { pin(); camera.position.x = 0.12 * dollyLatGain; camera.position.y = 0.02 * dollyLatGain; n++; n < 8 ? requestAnimationFrame(tick) : r2(); }; requestAnimationFrame(tick); });
      pin(); camera.position.x = 0.12 * dollyLatGain; camera.position.y = 0.02 * dollyLatGain; render();
      return grabL();
    };

    const mid = await shoot(0);
    const midState = { e: +camera.position.z.toFixed(4), ex: +camera.position.x.toFixed(4),
                       gain: +dollyLatGain.toFixed(4) };
    const far = await shoot(Math.PI/2);
    const farState = { e: +camera.position.z.toFixed(4), ex: +camera.position.x.toFixed(4),
                       gain: +dollyLatGain.toFixed(4) };
    dollyZoomActive = false; render();

    const cols = [];
    for (const xf of [0.24, 0.27, 0.30, 0.33, 0.36, 0.46, 0.50]) {
      const x = Math.round(xf * W2);
      cols.push({ xf, x, mid: edges3(mid.L, x), far: edges3(far.L, x) });
    }

    // ---- identity-preserving template match, mid -> far ----
    const PS = 9;
    const match = (cx, cy, sx0, sx1, sy0, sy1) => {
      const tmpl = []; let pm = 0, n = 0;
      for (let y = cy-PS; y <= cy+PS; y++) for (let x = cx-PS; x <= cx+PS; x++) { tmpl.push(mid.L[y*W2+x]); }
      for (let y = -PS; y <= PS; y += 2) for (let x = -PS; x <= PS; x += 2) { pm += tmpl[(y+PS)*(2*PS+1)+(x+PS)]; n++; }
      pm /= n; let pss = 0;
      for (let y = -PS; y <= PS; y += 2) for (let x = -PS; x <= PS; x += 2) { const d = tmpl[(y+PS)*(2*PS+1)+(x+PS)]-pm; pss += d*d; }
      let bc = -2, bx = 0, by = 0;
      for (let oy = Math.max(PS, cy+sy0); oy <= Math.min(H2-1-PS, cy+sy1); oy++)
        for (let ox = Math.max(PS, cx+sx0); ox <= Math.min(W2-1-PS, cx+sx1); ox++) {
          let s = 0, kk = 0;
          for (let y = -PS; y <= PS; y += 2) for (let x = -PS; x <= PS; x += 2) { s += far.L[(oy+y)*W2+ox+x]; kk++; }
          const m = s/kk; let num = 0, den = 0;
          for (let y = -PS; y <= PS; y += 2) for (let x = -PS; x <= PS; x += 2) {
            const a = far.L[(oy+y)*W2+ox+x]-m, b = tmpl[(y+PS)*(2*PS+1)+(x+PS)]-pm; num += a*b; den += a*a; }
          const c = num/Math.sqrt(Math.max(1e-9,den)*Math.max(1e-9,pss));
          if (c > bc) { bc = c; bx = ox-cx; by = oy-cy; }
        }
      return { dx: bx, dy: by, corr: +bc.toFixed(2) };
    };

    // patch 1: ON the mid-phase crest at 0.30w (the suite's tracked feature)
    const x30 = Math.round(0.30*W2);
    const crestY = edges3(mid.L, x30)[0][1];
    const ridge = match(x30, crestY, -60, 60, -200, 200);
    // patch 2: near-dune body, low in the mid frame
    const duneY = Math.round(0.93*H2);
    const dune = match(x30, duneY, -60, 60, -220, 40);

    return { v: +v.toFixed(4), q: +subjectFocalPlaneWorldZ.toFixed(4),
             pn: +currentNormPortalPlane.toFixed(3),
             midState, farState, cols,
             ridge: { atY: crestY, ...ridge }, dune: { atY: duneY, ...dune },
             midPng: mid.png, farPng: far.png };
  });

  if (r.midPng) {
    fs.writeFileSync(path.join(OUT, 'a208e_mid.png'), Buffer.from(r.midPng.split(',')[1], 'base64'));
    fs.writeFileSync(path.join(OUT, 'a208e_far.png'), Buffer.from(r.farPng.split(',')[1], 'base64'));
    delete r.midPng; delete r.farPng;
  }
  console.log(JSON.stringify(r, null, 1));
  await browser.close(); srv.kill();
  process.exit(0);
})();
