// A197 LOOK AT THE SWEEP. The tracker says the subject plane is pinned to 0px in
// every bake mode; the user says it is moving all over the place. One of those is
// wrong and no further statistic will settle it, so render the sweep and put it in
// front of both of us — the a196f lesson, applied before three more rounds of
// inference rather than after.
//
// Emits one PNG per dolly phase plus a tiled contact sheet, with a fixed crosshair
// drawn at the chosen subject feature's rest position. If the pin works, the
// content under the crosshair does not move while everything at other depths
// slides. If it does not, the sheet shows exactly how it fails, and a difference
// image against phase 0 shows where.
//
//   MODE=quick|realtime|v1|v2  SUBJ=far|portal  node harness/dollysheet.js [star|troll|warrior]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const ASSET = process.argv[2] || 'star';
const OUT = process.env.OUT || '/tmp/dollysheet';
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star: ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
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
  const onDisk = (fs.readFileSync(path.join(WT, 'moebius.js'), 'utf8')
                    .match(/MOEBIUS_BUILD\s*=\s*'([^']+)'/) || [])[1] || null;
  const served = await page.evaluate(() => (typeof MOEBIUS_BUILD === 'string') ? MOEBIUS_BUILD : null);
  console.log('served build = ' + served + (served === onDisk ? ' (matches this tree)' : '  *** TREE SAYS ' + onDisk + ' ***'));

  const r = await page.evaluate(async (o) => {
    window._rayReproject = true;
    if (o.mode === 'realtime') { bgQuickBake = false; bgMPIFullPlanes = false; bgMPIMode = false; }
    else if (o.mode === 'v1')  { bgQuickBake = false; bgMPIFullPlanes = false; bgMPIMode = false; bgBuildStamp = null; buildBackgroundLayer(); }
    else if (o.mode === 'v2')  { bgQuickBake = false; bgMPIFullPlanes = true;  bgMPIMode = true;  bgBuildStamp = null; buildBackgroundLayer(); }
    else                       { bgQuickBake = true;  bgMPIFullPlanes = false; bgMPIMode = false; bgBuildStamp = null; buildBackgroundLayer(); }

    const W = renderer.domElement.width, Hh = renderer.domElement.height;
    const PHSTEP = dollyZoomSpeed * 100;
    const phases = [0, 0.4, 0.8, 1.2, 1.6, 2.0, 2.4];
    const RING = 235;

    const shoot = (ph) => {
      if (typeof updateVolumeGuidesVisibility === 'function') updateVolumeGuidesVisibility(false);
      for (let n = 0; n < 2; n++) { if (ph !== undefined) dollyZoomTime = ph - PHSTEP; render(); }
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      cv.getContext('2d').drawImage(renderer.domElement, 0, 0, W, Hh);
      return cv;
    };
    const lumaOf = (cv) => {
      const d = cv.getContext('2d').getImageData(0, 0, W, Hh).data;
      const L = new Float32Array(W * Hh);
      for (let i = 0; i < W * Hh; i++) L[i] = 0.299*d[i*4] + 0.587*d[i*4+1] + 0.114*d[i*4+2];
      return L;
    };
    const depthMap = () => {
      _depthPassIncludeBG = true;
      renderNormalizedDepthPass();
      const rt = screenNormalizedDepthTarget, RW = rt.width, RH = rt.height;
      const tmp = new THREE.WebGLRenderTarget(RW, RH, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat });
      const qd = postProcessScene.children[0], prev = qd.material;
      qd.material = copyMaterial; copyMaterial.uniforms.tDiffuse.value = rt.texture;
      renderer.setRenderTarget(tmp); renderer.setViewport(0, 0, RW, RH); renderer.clear();
      renderer.render(postProcessScene, postProcessCamera);
      const px = new Uint8Array(RW * RH * 4);
      renderer.readRenderTargetPixels(tmp, 0, 0, RW, RH, px);
      renderer.setRenderTarget(null); qd.material = prev; tmp.dispose();
      _depthPassIncludeBG = false;
      return { px, RW, RH };
    };

    // subject, same rule as dollytrack
    const PS = Math.max(6, Math.round(Math.min(W, Hh) / 18));
    const SR = Math.max(12, Math.round(Math.min(W, Hh) / 6));
    dollyZoomActive = false;
    camera.position.set(0, 0, Math.abs(camera.position.z) || 0.2);
    updateCameraAndProjection();
    const L0 = lumaOf(shoot());
    const d0 = depthMap();
    const at = (cx, cy) => d0.px[(Math.min(d0.RH - 1, Math.round((Hh - 1 - cy) * d0.RH / Hh)) * d0.RW +
                                  Math.min(d0.RW - 1, Math.round(cx * d0.RW / W))) * 4];
    let pick = null, maxVar = 0; const cands = [];
    for (let cy = PS + SR; cy < Hh - PS - SR; cy += 4)
      for (let cx = PS + SR; cx < W - PS - SR; cx += 4) {
        const dv = at(cx, cy);
        if (dv === 0 || dv >= RING) continue;
        let bad = false, onGeom = 0, n2 = 0;
        for (let y = cy - PS; y <= cy + PS && !bad; y += 4) for (let x = cx - PS; x <= cx + PS; x += 4) {
          const v = at(x, y); n2++; if (v >= RING) { bad = true; break; } else if (v > 0) onGeom++; }
        if (bad || onGeom < 0.8 * n2) continue;
        let sm = 0, s2 = 0, n = 0;
        for (let y = cy - PS; y <= cy + PS; y += 3) for (let x = cx - PS; x <= cx + PS; x += 3) {
          const v = L0[y*W+x]; sm += v; s2 += v*v; n++; }
        const varr = s2/n - (sm/n)*(sm/n);
        if (varr > maxVar) maxVar = varr;
        cands.push({ cx, cy, dv, varr });
      }
    for (const c of cands) {
      c.dist = Math.abs(c.dv / 255 - currentNormPortalPlane);
      if (o.subj === 'portal') { if (c.dist > 16/255) continue; if (!pick || c.varr > pick.varr) pick = c; continue; }
      if (c.varr < 0.5 * maxVar) continue;
      if (!pick || c.dist > pick.dist) pick = c;
    }
    if (!pick) return { failed: 'no subject window found' };
    let dNorm, q;
    if (o.subj === 'portal') { dNorm = currentNormPortalPlane; q = portalPlaneWorldZ; }
    else {
      dNorm = pick.dv / 255;
      const rel = dNorm - currentNormPortalPlane;
      q = (rel < 0) ? portalPlaneWorldZ - (Math.abs(rel)/Math.max(1e-4, currentNormPortalPlane)) * outerVolumeDepth
                    : portalPlaneWorldZ + (rel/Math.max(1e-4, 1 - currentNormPortalPlane)) * innerVolumeDepth;
    }
    subjectFocalPlaneWorldZ = q; subjectLockActive = true;

    // sweep
    bgEmbedVolume = true; dollyZoomActive = true;
    window._dzLat = null; window._dzBase = null;
    baselineFaceTrackerOffsetX = 0; baselineFaceTrackerOffsetY = 0;
    latestDetectedFaceY = 0.5; latestDetectedFaceX = 1.0;
    dollyZoomTime = phases[0] - PHSTEP; updateCameraAndProjection();

    const shots = [], lumas = [], meta = [];
    for (const ph of phases) {
      dollyZoomTime = ph - PHSTEP; updateCameraAndProjection();
      const cv = shoot(ph);
      shots.push(cv.toDataURL('image/png'));
      lumas.push(lumaOf(cv));
      meta.push({ ph, e: +camera.position.z.toFixed(4), ex: +camera.position.x.toFixed(4),
                  gain: +dollyLatGain.toFixed(4) });
    }
    dollyZoomActive = false;

    // contact sheet: each phase, crosshair at the subject's REST position, and
    // the |difference| against phase 0 so any motion is visible as bright edges
    const COLS = 4, ROWS = Math.ceil(phases.length / COLS) * 2;
    const sheet = document.createElement('canvas');
    sheet.width = COLS * W; sheet.height = ROWS * Hh;
    const g = sheet.getContext('2d');
    g.fillStyle = '#111'; g.fillRect(0, 0, sheet.width, sheet.height);
    const imgs = await Promise.all(shots.map(u => new Promise(res => {
      const im = new Image(); im.onload = () => res(im); im.src = u; })));
    const nRow = Math.ceil(phases.length / COLS);
    for (let i = 0; i < phases.length; i++) {
      const c = i % COLS, rw = Math.floor(i / COLS);
      const x0 = c * W, y0 = rw * Hh;
      g.drawImage(imgs[i], x0, y0);
      g.strokeStyle = '#00ff66'; g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x0 + pick.cx - 14, y0 + pick.cy); g.lineTo(x0 + pick.cx + 14, y0 + pick.cy);
      g.moveTo(x0 + pick.cx, y0 + pick.cy - 14); g.lineTo(x0 + pick.cx, y0 + pick.cy + 14);
      g.stroke();
      g.strokeRect(x0 + pick.cx - PS, y0 + pick.cy - PS, 2*PS, 2*PS);
      g.fillStyle = '#000'; g.fillRect(x0 + 2, y0 + 2, 150, 14);
      g.fillStyle = '#0f6'; g.font = '11px monospace';
      g.fillText('ph ' + meta[i].ph + ' e ' + meta[i].e + ' g ' + meta[i].gain, x0 + 5, y0 + 13);
      // difference row
      const dy0 = (nRow + rw) * Hh;
      const im = g.createImageData(W, Hh);
      for (let p = 0; p < W * Hh; p++) {
        const d = Math.min(255, Math.abs(lumas[i][p] - lumas[0][p]) * 3);
        im.data[p*4] = d; im.data[p*4+1] = d; im.data[p*4+2] = d; im.data[p*4+3] = 255;
      }
      const tmpc = document.createElement('canvas'); tmpc.width = W; tmpc.height = Hh;
      tmpc.getContext('2d').putImageData(im, 0, 0);
      g.drawImage(tmpc, x0, dy0);
      g.strokeStyle = '#00ff66';
      g.strokeRect(x0 + pick.cx - PS, dy0 + pick.cy - PS, 2*PS, 2*PS);
      g.fillStyle = '#000'; g.fillRect(x0 + 2, dy0 + 2, 190, 14);
      g.fillStyle = '#0f6'; g.font = '11px monospace';
      g.fillText('|diff vs ph0| x3   ph ' + meta[i].ph, x0 + 5, dy0 + 13);
    }
    return { sheet: sheet.toDataURL('image/png'), meta, W, H: Hh,
             pick: { at: pick.cx + ',' + pick.cy, dv: pick.dv, dNorm: +dNorm.toFixed(3) },
             q: +q.toFixed(4), embed: +bgEmbedOffsetNow().toFixed(4),
             portalNorm: +currentNormPortalPlane.toFixed(3) };
  }, { subj: process.env.SUBJ || 'far', mode: process.env.MODE || 'quick' });

  if (r.failed) { console.log('*** ' + r.failed); await browser.close(); srv.kill(); process.exit(3); }
  const f = OUT + '_' + (process.env.MODE || 'quick') + '_' + (process.env.SUBJ || 'far') + '.png';
  fs.writeFileSync(f, Buffer.from(r.sheet.split(',')[1], 'base64'));
  console.log('subject at (' + r.pick.at + ') depth byte ' + r.pick.dv + ' dNorm ' + r.pick.dNorm +
              ' (portal ' + r.portalNorm + ')  q=' + r.q + '  embed=' + r.embed);
  console.log('phase / eye z / eye x / gain:');
  for (const m of r.meta) console.log('   ' + String(m.ph).padStart(4) + String(m.e).padStart(9) +
                                      String(m.ex).padStart(10) + String(m.gain).padStart(9));
  console.log('wrote ' + f);
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
