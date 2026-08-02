// A199 SWEEP THE SUBJECT PLANE AND ASK THE PICTURE WHICH ONE IT IS.
//
// Everything upstream of this has depended on a mapping I could not verify:
// "the content the user picks at depth d lives at world z = q(d), and is drawn
// at q(d) + emb". a196 rests on it. My harnesses then made it worse by reading a
// depth byte out of the RENDERED (post-embed) depth pass and converting it with
// the PRE-embed Depth Peek formula, so the plane they pinned was not the plane
// they tracked.
//
// Stop asserting the mapping. Measure it.
//
// Take one high-contrast patch. Sweep subjectFocalPlaneWorldZ across the whole
// volume. For each value, run the dolly and record how far that patch travels.
// The q that MINIMISES travel is, by definition, the plane that patch is on --
// no mapping, no normalisation constant, no assumption about the depth pass.
//
// Then compare three numbers:
//   q_best     what the picture says holds this patch still
//   q_ui       what Set Subject Focus would assign from this patch's SOURCE depth
//   q_ui + emb what a196 pins for that selection
// If q_best == q_ui + emb, a196 is right and the pin is doing its job.
// If q_best == q_ui, the embed term is wrong and a196 made it worse.
// Anything else and the mapping itself is not what either of us thought.
//
//   MODE=quick|realtime|v1|v2  node harness/dollyq.js [star|troll|warrior]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const ASSET = process.argv[2] || 'star';
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
    const phases = [0, 0.7, 1.4];
    const PS = 11, SR = 46;

    const grab = (ph) => {
      if (typeof updateVolumeGuidesVisibility === 'function') updateVolumeGuidesVisibility(false);
      for (let n = 0; n < 2; n++) { if (ph !== undefined) dollyZoomTime = ph - PHSTEP; render(); }
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      cv.getContext('2d').drawImage(renderer.domElement, 0, 0, W, Hh);
      const d = cv.getContext('2d').getImageData(0, 0, W, Hh).data;
      const L = new Float32Array(W * Hh);
      for (let i = 0; i < W * Hh; i++) L[i] = 0.299*d[i*4] + 0.587*d[i*4+1] + 0.114*d[i*4+2];
      return L;
    };

    // --- the patch: highest contrast window whose SOURCE depth is uniform, so
    // the "which plane is it on" question has a single answer. Source depth is
    // read the same way Depth Peek reads it: the layer's own depth image.
    const layer = mediaLayers[0];
    const dImg = layer.elements.depth;
    const dcv = document.createElement('canvas');
    dcv.width = dImg.naturalWidth || dImg.width; dcv.height = dImg.naturalHeight || dImg.height;
    dcv.getContext('2d').drawImage(dImg, 0, 0);
    const dData = dcv.getContext('2d').getImageData(0, 0, dcv.width, dcv.height).data;
    const DW = dcv.width, DH = dcv.height;

    // content rect on screen at rest, so screen->source uv is known
    dollyZoomActive = false; subjectLockActive = false;
    camera.position.set(0, 0, Math.abs(camera.position.z) || 0.2);
    updateCameraAndProjection();
    const L0 = grab();

    // map screen px -> source uv by raycasting the media mesh
    const rc = new THREE.Raycaster();
    const srcDepthAt = (sx, sy) => {
      rc.setFromCamera(new THREE.Vector2((sx / W) * 2 - 1, -((sy / Hh) * 2 - 1)), camera);
      const hit = rc.intersectObject(layer.mesh, false)[0];
      if (!hit || !hit.uv) return null;
      const px = Math.min(DW-1, Math.max(0, Math.round(hit.uv.x * (DW-1))));
      const py = Math.min(DH-1, Math.max(0, Math.round((1 - hit.uv.y) * (DH-1))));
      return dData[(py*DW + px)*4] / 255;
    };

    let best = null;
    for (let cy = PS+SR; cy < Hh-PS-SR; cy += 3)
      for (let cx = PS+SR; cx < W-PS-SR; cx += 3) {
        const d0 = srcDepthAt(cx, cy);
        if (d0 === null) continue;
        // uniform depth across the patch, else "which plane" has no answer
        let mn = 2, mx = -1, ok = true;
        for (const [ox, oy] of [[-PS,-PS],[PS,-PS],[-PS,PS],[PS,PS],[0,0]]) {
          const v = srcDepthAt(cx+ox, cy+oy);
          if (v === null) { ok = false; break; }
          mn = Math.min(mn, v); mx = Math.max(mx, v);
        }
        if (!ok || (mx - mn) > 0.04) continue;
        let sm=0,s2=0,n=0;
        for (let y=cy-PS;y<=cy+PS;y+=3) for (let x=cx-PS;x<=cx+PS;x+=3){ const v=L0[y*W+x]; sm+=v; s2+=v*v; n++; }
        const varr = s2/n - (sm/n)*(sm/n);
        if (!best || varr > best.varr) best = { cx, cy, d: d0, varr };
      }
    if (!best) return { failed: 'no uniform-depth high-contrast patch found' };

    // A199b PRINT EVERY CANDIDATE MAPPING, LET THE PICTURE PICK.
    // setSubjectFocusZFromPeek interpolates the volume LINEARLY in the peeked
    // depth. The vertex shader interpolates it with SMOOTHSTEP, and adds
    // u_popExtra to the inner half. Those agree only at the two endpoints and
    // the portal plane, so the plane the UI names and the plane the shader draws
    // on are different surfaces for every other selection.
    const pn = currentNormPortalPlane, P0 = portalPlaneWorldZ;
    const sstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x-e0)/(e1-e0))); return t*t*(3-2*t); };
    const popExtra = (() => { const u = mediaLayers[0].mesh.material.uniforms;
      return (u && u.u_popExtra) ? u.u_popExtra.value : 0; })();
    const relUI = best.d - pn;
    const qLinear = (relUI < 0)
      ? P0 - (Math.abs(relUI)/Math.max(1e-4, pn)) * outerVolumeDepth
      : P0 + (relUI/Math.max(1e-4, 1 - pn)) * innerVolumeDepth;
    const qSmooth = (best.d < pn)
      ? P0 - outerVolumeDepth * (1 - sstep(0, pn, best.d))
      : P0 + (innerVolumeDepth + popExtra) * sstep(pn, 1, best.d);
    const emb = bgEmbedOffsetNow();
    const qUI = qLinear;

    // --- sweep q, measure travel of THIS patch
    const P = portalPlaneWorldZ;
    const qLo = P - outerVolumeDepth - Math.abs(emb) - 0.01;
    const qHi = P + innerVolumeDepth + 0.01;
    const N = 17;
    const results = [];
    for (let i = 0; i < N; i++) {
      const q = qLo + (qHi - qLo) * i / (N - 1);
      subjectFocalPlaneWorldZ = q; subjectLockActive = true;
      bgEmbedVolume = true; dollyZoomActive = true;
      window._dzLat = null; window._dzBase = null;
      baselineFaceTrackerOffsetX = 0; baselineFaceTrackerOffsetY = 0;
      latestDetectedFaceY = 0.5; latestDetectedFaceX = 1.0;
      dollyZoomTime = phases[0] - PHSTEP; updateCameraAndProjection();

      const base = grab(phases[0]);
      const tmpl = [];
      for (let y=best.cy-PS;y<=best.cy+PS;y++) for (let x=best.cx-PS;x<=best.cx+PS;x++) tmpl.push(base[y*W+x]);
      let pm=0,pss=0,cnt=0;
      for (let y=-PS;y<=PS;y+=2) for (let x=-PS;x<=PS;x+=2){ pm += tmpl[(y+PS)*(2*PS+1)+(x+PS)]; cnt++; }
      pm/=cnt;
      for (let y=-PS;y<=PS;y+=2) for (let x=-PS;x<=PS;x+=2){ const d=tmpl[(y+PS)*(2*PS+1)+(x+PS)]-pm; pss+=d*d; }

      let worst = 0, minc = 2, amb = false;
      for (let k = 0; k < phases.length; k++) {
        dollyZoomTime = phases[k] - PHSTEP; updateCameraAndProjection();
        const L = grab(phases[k]);
        let bestC=-2, bdx=0, bdy=0;
        for (let dy=-SR; dy<=SR; dy++) for (let dx=-SR; dx<=SR; dx++) {
          const ox=best.cx+dx, oy=best.cy+dy;
          if (ox-PS<0||ox+PS>=W||oy-PS<0||oy+PS>=Hh) continue;
          let s=0,kk=0;
          for (let y=-PS;y<=PS;y+=2) for (let x=-PS;x<=PS;x+=2){ s += L[(oy+y)*W+ox+x]; kk++; }
          const m=s/kk; let num=0,den=0;
          for (let y=-PS;y<=PS;y+=2) for (let x=-PS;x<=PS;x+=2){
            const a=L[(oy+y)*W+ox+x]-m, b=tmpl[(y+PS)*(2*PS+1)+(x+PS)]-pm;
            num+=a*b; den+=a*a; }
          const c=num/Math.sqrt(Math.max(1e-9,den)*Math.max(1e-9,pss));
          if (c>bestC){ bestC=c; bdx=dx; bdy=dy; }
        }
        if (k === 0 && (bdx !== 0 || bdy !== 0)) amb = true;
        worst = Math.max(worst, Math.abs(bdx), Math.abs(bdy));
        minc = Math.min(minc, bestC);
      }
      dollyZoomActive = false;
      results.push({ q: +q.toFixed(4), worst, minc: +minc.toFixed(2), amb });
    }
    return { results, patch: best.cx + ',' + best.cy, srcDepth: +best.d.toFixed(4),
             qLinear: +qLinear.toFixed(4), qSmooth: +qSmooth.toFixed(4), popExtra,
             qUI: +qUI.toFixed(4), emb: +emb.toFixed(4), P, portalNorm: +currentNormPortalPlane.toFixed(3),
             inner: innerVolumeDepth, outer: outerVolumeDepth };
  }, { mode: process.env.MODE || 'quick' });

  if (r.failed) { console.log('*** ' + r.failed); await browser.close(); srv.kill(); process.exit(3); }
  console.log('\n' + ASSET + '  mode=' + (process.env.MODE||'quick'));
  console.log('patch (' + r.patch + ')  SOURCE depth ' + r.srcDepth + ' (portal ' + r.portalNorm + ')');
  console.log('portal z ' + r.P + '  inner ' + r.inner + '  outer ' + r.outer + '  embed ' + r.emb);
  console.log('  popExtra ' + r.popExtra);
  console.log('  A  q_linear         = ' + r.qLinear.toFixed(4) + '   (Set Subject Focus, pre-a196)');
  console.log('  B  q_linear + emb   = ' + (r.qLinear + r.emb).toFixed(4) + '   (what a196 pins)');
  console.log('  C  q_smoothstep     = ' + r.qSmooth.toFixed(4) + '   (the shader mapping, no embed)');
  console.log('  D  q_smoothstep+emb = ' + (r.qSmooth + r.emb).toFixed(4) + '   (the shader mapping + embed)');
  console.log('\n     q      worst travel px   minCorr');
  let bestRow = null;
  for (const w of r.results) {
    const bad = w.amb || w.minc < 0.6;
    console.log('  ' + String(w.q).padStart(8) + String(w.worst).padStart(12) +
                String(w.minc).padStart(12) + (bad ? '   [void]' : ''));
    if (!bad && (!bestRow || w.worst < bestRow.worst)) bestRow = w;
  }
  if (bestRow) {
    console.log('\nq that actually holds this patch still: ' + bestRow.q + '  (' + bestRow.worst + 'px)');
    const cand = [['A q_linear', r.qLinear], ['B q_linear+emb', r.qLinear + r.emb],
                  ['C q_smoothstep', r.qSmooth], ['D q_smoothstep+emb', r.qSmooth + r.emb]];
    cand.sort((a,b) => Math.abs(bestRow.q - a[1]) - Math.abs(bestRow.q - b[1]));
    for (const [n,v] of cand) console.log('   ' + n.padEnd(20) + v.toFixed(4) + '   off by ' + (bestRow.q - v).toFixed(4));
    console.log('\nThe candidate closest to the measured plane is the mapping the pin must use.');
    console.log('Sweep step is ' + ((r.results[1].q - r.results[0].q).toFixed(4)) + ', so a gap below that is a tie.');
  } else console.log('\nno valid row - every q had an unreadable tracker');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
