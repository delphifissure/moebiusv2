// A198 WHICH DEPTH IS ACTUALLY PINNED? AND IS IT A PLANE OR A POINT?
//
// dollytrack follows ONE patch and reports its integer translation. Two things
// that instrument cannot see, and both would look to a user exactly like "the
// focal plane is moving all over the place":
//
//   1. WHICH depth got pinned. The a196 far-subject picker chose the highest
//      contrast window FARTHEST from the portal, and on the star that is THE
//      SKY (depth byte 1). "The sky is pinned to 0px" is true and almost
//      worthless — it is not the subject anyone would select.
//   2. WHETHER the subject plane translates rigidly or SCALES/SHEARS. One patch
//      near the centre of a rescaling image barely moves; the same image is
//      visibly swimming at its edges. A single displacement cannot tell those
//      apart, and it reports the reassuring one.
//
// So: lay a grid of patches over the picture, track each one independently, and
// print its rendered depth beside its travel. Then
//   - the depth column says which plane is actually held, and
//   - comparing patches at the SAME depth but different screen positions says
//     whether that plane is held rigidly or is being scaled/sheared about a
//     point, which is the failure a single tracker is blind to.
// Also reports the content rect per phase, because if the aperture itself
// breathes then everything inside it swims regardless of the pin.
//
//   MODE=quick|realtime|v1|v2  node harness/dollygrid.js [star|troll|warrior]
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
    const phases = [0, 0.6, 1.2, 1.6];
    const RING = 235;
    const PS = 10, SR = 44;

    const grabRGB = (ph) => {
      if (typeof updateVolumeGuidesVisibility === 'function') updateVolumeGuidesVisibility(false);
      for (let n = 0; n < 2; n++) { if (ph !== undefined) dollyZoomTime = ph - PHSTEP; render(); }
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      cv.getContext('2d').drawImage(renderer.domElement, 0, 0, W, Hh);
      return cv.getContext('2d').getImageData(0, 0, W, Hh).data;
    };
    const luma = (d) => { const L = new Float32Array(W * Hh);
      for (let i = 0; i < W * Hh; i++) L[i] = 0.299*d[i*4] + 0.587*d[i*4+1] + 0.114*d[i*4+2];
      return L; };
    const depthMap = () => {
      _depthPassIncludeBG = true; renderNormalizedDepthPass();
      const rt = screenNormalizedDepthTarget, RW = rt.width, RH = rt.height;
      const tmp = new THREE.WebGLRenderTarget(RW, RH, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat });
      const qd = postProcessScene.children[0], prev = qd.material;
      qd.material = copyMaterial; copyMaterial.uniforms.tDiffuse.value = rt.texture;
      renderer.setRenderTarget(tmp); renderer.setViewport(0, 0, RW, RH); renderer.clear();
      renderer.render(postProcessScene, postProcessCamera);
      const px = new Uint8Array(RW * RH * 4);
      renderer.readRenderTargetPixels(tmp, 0, 0, RW, RH, px);
      renderer.setRenderTarget(null); qd.material = prev; tmp.dispose();
      _depthPassIncludeBG = false; return { px, RW, RH };
    };
    // content rect = bbox of pixels that are not the letterbox, from the depth pass
    const contentRect = (dm) => {
      let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
      for (let y = 0; y < dm.RH; y++) for (let x = 0; x < dm.RW; x++) {
        const v = dm.px[(y*dm.RW + x)*4];
        if (v === 0 || v >= RING) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      return (x1 < 0) ? null : [x0, y0, x1, y1, x1-x0+1, y1-y0+1];
    };

    // --- subject = THE FIGURE, chosen the way a person would: the highest
    // contrast window in the NEAR half of the depth range, i.e. the thing
    // standing in front. Not the sky.
    dollyZoomActive = false;
    camera.position.set(0, 0, Math.abs(camera.position.z) || 0.2);
    updateCameraAndProjection();
    const L0 = luma(grabRGB());
    const d0 = depthMap();
    const at = (cx, cy) => d0.px[(Math.min(d0.RH-1, Math.round((Hh-1-cy)*d0.RH/Hh))*d0.RW +
                                  Math.min(d0.RW-1, Math.round(cx*d0.RW/W)))*4];
    const varAt = (cx, cy) => { let sm=0,s2=0,n=0;
      for (let y=cy-PS;y<=cy+PS;y+=3) for (let x=cx-PS;x<=cx+PS;x+=3){ const v=L0[y*W+x]; sm+=v; s2+=v*v; n++; }
      return s2/n - (sm/n)*(sm/n); };

    let subj = null;
    for (let cy = PS+4; cy < Hh-PS-4; cy += 3)
      for (let cx = PS+4; cx < W-PS-4; cx += 3) {
        const dv = at(cx, cy);
        if (dv === 0 || dv >= RING) continue;
        if (dv < 255*currentNormPortalPlane) continue;    // near half only = the standing figure
        let bad = false;
        for (let y=cy-PS;y<=cy+PS && !bad;y+=5) for (let x=cx-PS;x<=cx+PS;x+=5){ if (at(x,y) >= RING) { bad=true; break; } }
        if (bad) continue;
        const v = varAt(cx, cy);
        if (!subj || v > subj.v) subj = { cx, cy, dv, v };
      }
    if (!subj) return { failed: 'no near-half (figure) window found' };
    const rel = subj.dv/255 - currentNormPortalPlane;
    const q = (rel < 0) ? portalPlaneWorldZ - (Math.abs(rel)/Math.max(1e-4,currentNormPortalPlane))*outerVolumeDepth
                        : portalPlaneWorldZ + (rel/Math.max(1e-4,1-currentNormPortalPlane))*innerVolumeDepth;
    subjectFocalPlaneWorldZ = q; subjectLockActive = true;

    // --- A198b PUT THE PATCHES WHERE THE QUESTION IS.
    // The first grid was a blind lattice: 5 patches survived, none of them on the
    // subject plane, so the one row that mattered was never printed. Choose
    // deliberately instead — a spread of patches ON the subject depth (that is
    // the claim under test) plus a few clearly OFF it (those MUST move, and are
    // the control that says the dolly is doing anything at all).
    const wellSpread = (list, want, minSep) => {
      const out = [];
      for (const c of list) {
        if (out.length >= want) break;
        if (out.every(o => Math.abs(o.cx-c.cx) + Math.abs(o.cy-c.cy) >= minSep)) out.push(c);
      }
      return out;
    };
    const usable = [];
    for (let cy = PS+SR; cy < Hh-PS-SR; cy += 2)
      for (let cx = PS+SR; cx < W-PS-SR; cx += 2) {
        const dv = at(cx, cy);
        if (dv === 0 || dv >= RING) continue;
        let bad = false;
        for (let y=cy-PS;y<=cy+PS && !bad;y+=5) for (let x=cx-PS;x<=cx+PS;x+=5){ if (at(x,y) >= RING) { bad=true; break; } }
        if (bad) continue;
        const v = varAt(cx, cy);
        usable.push({ cx, cy, dv, v });
      }
    usable.sort((a,b) => b.v - a.v);
    // relative contrast gate: absolute thresholds do not transfer between assets
    const bestVar = usable.length ? usable[0].v : 0;
    const strong = usable.filter(c => c.v >= 0.25 * bestVar);
    const onPlane  = wellSpread(strong.filter(c => Math.abs(c.dv - subj.dv) <= 10), 8, 40);
    const offPlane = wellSpread(strong.filter(c => Math.abs(c.dv - subj.dv) >  40), 5, 40);
    const pts = onPlane.concat(offPlane);

    // --- sweep
    bgEmbedVolume = true; dollyZoomActive = true;
    window._dzLat = null; window._dzBase = null;
    baselineFaceTrackerOffsetX = 0; baselineFaceTrackerOffsetY = 0;
    latestDetectedFaceY = 0.5; latestDetectedFaceX = 1.0;
    dollyZoomTime = phases[0] - PHSTEP; updateCameraAndProjection();

    const frames = [], rects = [], info = [];
    for (const ph of phases) {
      dollyZoomTime = ph - PHSTEP; updateCameraAndProjection();
      frames.push(luma(grabRGB(ph)));
      rects.push(contentRect(depthMap()));
      info.push({ ph, e: +camera.position.z.toFixed(4), ex: +camera.position.x.toFixed(4), g: +dollyLatGain.toFixed(4) });
    }
    dollyZoomActive = false;

    const track = (L, tmpl, bx, by, pm, pss) => {
      let bestC = -2, bdx = 0, bdy = 0;
      for (let dy = -SR; dy <= SR; dy++) for (let dx = -SR; dx <= SR; dx++) {
        const ox = bx+dx, oy = by+dy;
        if (ox-PS < 0 || ox+PS >= W || oy-PS < 0 || oy+PS >= Hh) continue;
        let s=0,k=0;
        for (let y=-PS;y<=PS;y+=2) for (let x=-PS;x<=PS;x+=2){ s += L[(oy+y)*W+ox+x]; k++; }
        const m = s/k; let num=0, den=0;
        for (let y=-PS;y<=PS;y+=2) for (let x=-PS;x<=PS;x+=2){
          const a = L[(oy+y)*W+ox+x]-m, b = tmpl[(y+PS)*(2*PS+1)+(x+PS)]-pm;
          num += a*b; den += a*a; }
        const c = num/Math.sqrt(Math.max(1e-9,den)*Math.max(1e-9,pss));
        if (c > bestC) { bestC = c; bdx = dx; bdy = dy; }
      }
      return { c: bestC, dx: bdx, dy: bdy };
    };

    const rows = [];
    for (const p of pts) {
      const tmpl = [];
      for (let y=p.cy-PS;y<=p.cy+PS;y++) for (let x=p.cx-PS;x<=p.cx+PS;x++) tmpl.push(frames[0][y*W+x]);
      let pm=0,pss=0,cnt=0;
      for (let y=-PS;y<=PS;y+=2) for (let x=-PS;x<=PS;x+=2){ pm += tmpl[(y+PS)*(2*PS+1)+(x+PS)]; cnt++; }
      pm/=cnt;
      for (let y=-PS;y<=PS;y+=2) for (let x=-PS;x<=PS;x+=2){ const d=tmpl[(y+PS)*(2*PS+1)+(x+PS)]-pm; pss+=d*d; }
      const dxs = [], dys = []; let minc = 2;
      for (let i = 0; i < phases.length; i++) {
        const t = track(frames[i], tmpl, p.cx, p.cy, pm, pss);
        dxs.push(t.dx); dys.push(t.dy); minc = Math.min(minc, t.c);
      }
      // A198c THE PHASE-0 SELF-MATCH IS A VALIDITY TEST, NOT A DATA POINT.
      // The phase-0 template is cut from the phase-0 frame at this exact
      // location, so the true match is (0,0) at correlation 1. If the search
      // prefers somewhere else, this patch has a twin inside the search radius
      // -- a repeating texture or a flat region -- and every later row for it is
      // a coin toss. Two rows in the previous table did exactly that, reporting
      // offset -38 at correlation 1.000, and they are the rows that made the
      // subject plane look like it was coming apart.
      const ambiguous = (dxs[0] !== 0 || dys[0] !== 0);
      const pegged = dxs.some(d => Math.abs(d) >= SR) || dys.some(d => Math.abs(d) >= SR);
      rows.push({ x: p.cx, y: p.cy, dv: p.dv, dxs, dys, minc: +minc.toFixed(2), pegged, ambiguous });
    }
    return { rows, info, rects, W, H: Hh, subj: { at: subj.cx+','+subj.cy, dv: subj.dv },
             q: +q.toFixed(4), embed: +bgEmbedOffsetNow().toFixed(4),
             portalByte: Math.round(255*currentNormPortalPlane), phases };
  }, { mode: process.env.MODE || 'quick' });

  if (r.failed) { console.log('*** ' + r.failed); await browser.close(); srv.kill(); process.exit(3); }
  console.log('\n' + ASSET + '  mode=' + (process.env.MODE||'quick') + '  canvas ' + r.W + 'x' + r.H +
              '  embed=' + r.embed);
  console.log('SUBJECT = the standing figure (highest contrast in the NEAR half): at (' + r.subj.at +
              ') depth byte ' + r.subj.dv + '  (portal byte ' + r.portalByte + ')  q=' + r.q);
  console.log('\nphase / eye z / eye x / gain / content rect (depth-pass px)');
  for (let i = 0; i < r.info.length; i++)
    console.log('   ' + String(r.info[i].ph).padStart(4) + String(r.info[i].e).padStart(9) +
                String(r.info[i].ex).padStart(10) + String(r.info[i].g).padStart(9) +
                '   ' + (r.rects[i] ? r.rects[i].slice(0,4).join(',') + '  size ' + r.rects[i][4] + 'x' + r.rects[i][5] : 'none'));
  console.log('\nper-patch travel across the sweep (dx then dy at each phase), sorted by depth:');
  console.log('   depth   x    y  | ' + r.phases.map(p => String(p).padStart(9)).join('') + '   minCorr');
  r.rows.sort((a,b) => a.dv - b.dv);
  for (const w of r.rows) {
    const cells = w.dxs.map((d,i) => (d + ',' + w.dys[i]).padStart(9)).join('');
    let mark = Math.abs(w.dv - r.subj.dv) <= 12 ? ' <== SUBJECT PLANE' : '';
    if (w.ambiguous) mark += '  [VOID: phase-0 self-match not at 0,0 - repeating texture]';
    if (w.pegged) mark += '  [VOID: pegged at search bound]';
    if (w.minc < 0.6) mark += '  [VOID: minCorr too low]';
    console.log('   ' + String(w.dv).padStart(5) + String(w.x).padStart(5) + String(w.y).padStart(5) +
                '  |' + cells + String(w.minc).padStart(9) + mark);
  }
  const valid = r.rows.filter(w => !w.ambiguous && !w.pegged && w.minc >= 0.6);
  const onSubj = valid.filter(w => Math.abs(w.dv - r.subj.dv) <= 12);
  const offSubj = valid.filter(w => Math.abs(w.dv - r.subj.dv) > 40);
  const summarise = (lbl, set) => {
    if (!set.length) { console.log('  ' + lbl + ': no valid patches'); return; }
    const worst = set.map(w => Math.max(...w.dxs.map(Math.abs), ...w.dys.map(Math.abs)));
    console.log('  ' + lbl + ' (' + set.length + ' valid patches): worst travel per patch = ' +
                worst.join(', ') + '  -> max ' + Math.max(...worst) + 'px');
  };
  console.log('\nVERDICT (invalid patches excluded):');
  summarise('ON the subject plane  (should be ~0)', onSubj);
  summarise('OFF the subject plane (should move) ', offSubj);
  console.log('\nA patch is only readable if minCorr stayed high. Patches at the SUBJECT depth');
  console.log('should all read ~0,0. If they read 0,0 in the middle and non-zero at the edges,');
  console.log('the plane is being SCALED about a point rather than held - which one tracker cannot see.');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
