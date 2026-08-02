// A196: TRACK REAL CONTENT. THE SYNTHETIC PROBE WAS BLIND, BOTH WAYS.
//
// Everything measured in a194/a195 projected a synthetic world point, and that
// probe is structurally incapable of answering this question:
//
//   - the 797e858 pin works by SCALING THE MESHES about the eye-axis point on
//     the subject plane. A world point I place myself is not a mesh, so mesh
//     scaling cannot move it. My probe read 18.21px there and I concluded the
//     old builds did not pin. They did; I was watching the wrong object.
//   - at HEAD the probe reads 0.00px because a67's gain pins the plane q for a
//     STATIC point. But under a59f reprojection the shader places each texel on
//     its reference ray at zOff = displacement + bias + embed, so the content
//     the user picked at q renders at q + embed. The probe and the content are
//     on different planes.
//
// Both readings were artifacts of the instrument, and on their strength I told
// the user the embed was the cause, then that it was not. Neither claim was
// entitled.
//
// SO TRACK THE PIXELS. Take a template patch from the rendered frame at the
// engage pose, then find it by normalised cross-correlation at every later dolly
// phase. That measures where the CONTENT went, with no model of the geometry in
// the loop at all — which, given the record above, is where my model belongs.
//
// A196c TWO DEFECTS IN THE FIRST WORKING RUN, BOTH FIXED.
//   1. EACH ARM PICKED ITS OWN PATCH — (128,152), (328,144), (160,160). Three
//      different features at three different depths, so the travel figures were
//      not comparable across arms. The patch is now chosen ONCE and the same
//      template and location are reused by every arm.
//   2. THE HEADER CLAIMED THE PATCH WAS DEPTH-MATCHED TO THE SUBJECT PLANE AND
//      THE CODE DID NOT DO IT. dTex was fetched and never used, so the tracked
//      feature could be anywhere in depth — possibly the astronaut while the
//      lock defends the dune. Now the screen-space depth pass selects it: the
//      patch must be the highest-variance window whose RENDERED depth is within
//      one bin of the subject plane's normalised depth.
//
// Reported per arm: the tracked displacement of that patch across the sweep, and
// the correlation peak, because a tracker that has lost the patch must not be
// read as "the content did not move".
//
//   node harness/dollytrack.js [star|troll|warrior]
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
    // A197 THE MODE IS AN ARM NOW. a196 was verified on QUICK only, with a
    // static synthetic head. The shipped default on load is REALTIME (a112
    // reverts to it for every new image) and the shipped BAKE is v2, so the
    // regime the user actually reports on was never measured. A fix verified in
    // one mode is a fix verified in one mode.
    window._rayReproject = true;
    if (o.mode === 'realtime') {
        // no bake at all — the state the app is in when an image finishes loading
        bgQuickBake = false; bgMPIFullPlanes = false; bgMPIMode = false;
    } else if (o.mode === 'v1') {
        bgQuickBake = false; bgMPIFullPlanes = false; bgMPIMode = false;
        bgBuildStamp = null; buildBackgroundLayer();
    } else if (o.mode === 'v2') {
        bgQuickBake = false; bgMPIFullPlanes = true; bgMPIMode = true;
        bgBuildStamp = null; buildBackgroundLayer();
    } else {
        bgQuickBake = true; bgMPIFullPlanes = false; bgMPIMode = false;
        bgBuildStamp = null; buildBackgroundLayer();
    }

    const W = renderer.domElement.width, Hh = renderer.domElement.height;
    const grab = (ph) => {
      // A196g the volume wireframes are static in screen space and would anchor
      // the tracker; a timed re-show must not sneak one back into a frame.
      if (typeof updateVolumeGuidesVisibility === 'function') updateVolumeGuidesVisibility(false);
      // A196j PIN THE DOLLY PHASE TO EACH RENDER. render() -> renderPortalFrame()
      // -> updateCameraAndProjection(), which does dollyZoomTime += speed*100 on
      // every call. Grabbing with two renders therefore advanced the phase twice
      // past the one being measured, and — worse — the pin arms captured e0 two
      // steps before their own measured frame, so g was NOT 1 at nominal phase 0
      // and the arms started from different eye positions. That showed up in the
      // portal run as arms tracking different content at the same coordinates
      // (patch depth 114 in the pinned arm, 0 in the floor arm). Re-stamping the
      // phase before each render makes every render land on exactly ph.
      for (let n = 0; n < 2; n++) { if (ph !== undefined) dollyZoomTime = ph - PHSTEP; render(); }
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const g = cv.getContext('2d'); g.drawImage(renderer.domElement, 0, 0, W, Hh);
      const d = g.getImageData(0, 0, W, Hh).data;
      const L = new Float32Array(W * Hh);
      for (let i = 0; i < W * Hh; i++) L[i] = 0.299*d[i*4] + 0.587*d[i*4+1] + 0.114*d[i*4+2];
      return L;
    };


    const PHSTEP = dollyZoomSpeed * 100;
    const phases = [0, 0.4, 0.8, 1.2, 1.6, 2.0, 2.4];
    // A196b SIZE THE PATCH TO THE CANVAS, AND PROVE ONE WAS FOUND. The first run
    // used PS=24, SR=90 on a 380x214 backing store, so the selection loop bounds
    // (PS+SR .. H-PS-SR) were 114..100 — empty. No patch was ever chosen, every
    // correlation came back -2, and all three arms reported "travel 0px". The
    // min-corr guard caught it; without that column this would have read as a
    // flawless pin in all three arms including the one with no pin at all.
    const PS = Math.max(6, Math.round(Math.min(W, Hh) / 18));
    const SR = Math.max(12, Math.round(Math.min(W, Hh) / 6));

    // screen-space normalised depth, the same pass depthorder.js uses
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

    // A196g TWO THINGS IN THE FRAME WERE NOT THE PICTURE, AND BOTH WERE FATAL.
    //
    // Dumping the buffers (a196f) ended three rounds of guessing in one look:
    //
    //  1. THE DEPTH PASS HAS A BRIGHT RING AT ~246 — the a168 OUTER MATTE, which
    //     sits in the viewport surface and is therefore the NEAREST thing in the
    //     scene. It is 15750 px, the single most populated value in the frame, so
    //     "most populated depth bin off the portal plane" selected THE LETTERBOX.
    //     Stride-4 sampling of the centre then hit none of it, which is exactly
    //     the contradiction a196f reported: 15750 wanted pixels, 0 windows passed.
    //     The ring is a border; the samples were interior. Both numbers were true.
    //  2. THE VOLUME GUIDES WERE DRAWN OVER THE PICTURE — the green portal plane
    //     and the red/blue volume boxes are wireframes in the scene, and they are
    //     STATIC IN SCREEN SPACE under the dolly. A patch containing one is
    //     anchored by it, so the tracker would have reported a flawless pin for
    //     an arm with no pin at all. Nothing in the numbers would have shown it.
    //
    // Also corrected: `v > 0` was treating depth 0 as "nothing drawn". Zero is the
    // FAR end — it is the sky, which is real content, just untrackable.
    //
    // So the subject is now chosen by what the tracker actually needs. Among
    // windows that sit on real geometry, take the highest-contrast ones and, of
    // those, the one FARTHEST from the portal plane in depth — because the pin's
    // job scales with |q - P|, so the farthest trackable feature is where a
    // broken pin shows up largest. No separation constant is invented: the
    // variance gate is relative to the best window in this frame, and the chosen
    // window's depth, distance and contrast are all printed for audit.
    updateVolumeGuidesVisibility(false);
    const RING = 235;          // >= this is the outer matte, not the picture
    let dNorm, q;
    {
      dollyZoomActive = false;
      camera.position.set(0, 0, Math.abs(camera.position.z) || 0.2);
      updateCameraAndProjection();
      const L0 = grab();   // dolly off here; no phase to pin
      const d0 = depthMap();
      const at = (cx, cy) => d0.px[(Math.min(d0.RH - 1, Math.round((Hh - 1 - cy) * d0.RH / Hh)) * d0.RW +
                                    Math.min(d0.RW - 1, Math.round(cx * d0.RW / W))) * 4];
      const cands = [];
      let maxVar = 0;
      for (let cy = PS + SR; cy < Hh - PS - SR; cy += 4)
        for (let cx = PS + SR; cx < W - PS - SR; cx += 4) {
          const dv = at(cx, cy);
          if (dv === 0 || dv >= RING) continue;        // sky (untrackable) or the matte
          // the whole window must be picture: no matte, and mostly real geometry
          let onGeom = 0, n2 = 0, bad = false;
          for (let y = cy - PS; y <= cy + PS; y += 4) for (let x = cx - PS; x <= cx + PS; x += 4) {
            const v = at(x, y); n2++;
            if (v >= RING) bad = true; else if (v > 0) onGeom++;
          }
          if (bad || onGeom < 0.8 * n2) continue;
          let sm = 0, s2 = 0, n = 0;
          for (let y = cy - PS; y <= cy + PS; y += 3) for (let x = cx - PS; x <= cx + PS; x += 3) {
            const v = L0[y*W+x]; sm += v; s2 += v*v; n++; }
          const varr = s2/n - (sm/n)*(sm/n);
          if (varr > maxVar) maxVar = varr;
          cands.push({ cx, cy, dv, varr });
        }
      if (!cands.length) return { failed: 'no candidate window sits on picture geometry' };
      let pick = null;
      for (const c of cands) {
        c.dist = Math.abs(c.dv / 255 - currentNormPortalPlane);
        // the relative-contrast gate exists to stop 'far' mode walking off into
        // the flat sky in search of distance. In portal mode distance is FIXED
        // by the mode, so there is nothing to trade against contrast and the
        // gate only rejects the best window the plane has — which is what it
        // did on the first run: 'no trackable window at subj=portal' with 1521
        // portal-depth pixels sitting in the frame.
        if (o.subj !== 'portal' && c.varr < 0.5 * maxVar) continue;
        // SUBJ=portal reproduces the SHIPPED DEFAULT, where the subject plane is
        // left AT the portal (subjectFocalPlaneWorldZ = portalPlaneWorldZ on
        // load) and subjectLockActive is already true. Before a167 that case
        // needed no pin; with the embed it renders at P + emb and drifts, so
        // a196 engages the pin there and this arm is what proves that is not a
        // regression. Track content ON the portal plane, highest contrast.
        if (o.subj === 'portal') { if (c.dist > 16 / 255) continue;
          if (!pick || c.varr > pick.varr) pick = c; continue; }
        if (!pick || c.dist > pick.dist) pick = c;
      }
      if (!pick) return { failed: 'no trackable window at the requested subject plane (subj=' + o.subj + ')' };
      if (o.subj === 'portal') {
        dNorm = currentNormPortalPlane; q = portalPlaneWorldZ;
        window.__pick = { dNorm: +dNorm.toFixed(3), dv: pick.dv, at: pick.cx + ',' + pick.cy,
                          dist: 0, varr: Math.round(pick.varr), maxVar: Math.round(maxVar),
                          nCand: cands.length, portalNorm: +currentNormPortalPlane.toFixed(3) };
      } else {
        dNorm = pick.dv / 255;
        const rel = dNorm - currentNormPortalPlane;
        q = (rel < 0)
          ? portalPlaneWorldZ - (Math.abs(rel) / Math.max(1e-4, currentNormPortalPlane)) * outerVolumeDepth
          : portalPlaneWorldZ + (rel / Math.max(1e-4, 1 - currentNormPortalPlane)) * innerVolumeDepth;
        window.__pick = { dNorm: +dNorm.toFixed(3), dv: pick.dv, at: pick.cx + ',' + pick.cy,
                          dist: +pick.dist.toFixed(3), varr: Math.round(pick.varr),
                          maxVar: Math.round(maxVar), nCand: cands.length,
                          portalNorm: +currentNormPortalPlane.toFixed(3) };
      }
    }
    subjectFocalPlaneWorldZ = q;
    subjectLockActive = true;
    initializeSubjectLockConstant();

    // ---- choose the patch ONCE, on the subject plane ----
    bgEmbedVolume = true; dollyZoomActive = true;
    window._dzLat = null; window._dzBase = null;
    baselineFaceTrackerOffsetX = 0; baselineFaceTrackerOffsetY = 0;
    latestDetectedFaceY = 0.5; latestDetectedFaceX = 1.0;
    dollyZoomTime = phases[0] - PHSTEP;
    updateCameraAndProjection();
    const base0 = grab(phases[0]);
    const dm = depthMap();
    const wantD = dNorm * 255;
    // A196f COUNT THE REJECTIONS, AND LOCATE THE WANTED PIXELS.
    // a196e reported "no window passed the subject-plane depth filter" while its
    // own histogram, read from the same buffer, showed 15686 pixels at the wanted
    // depth. Both cannot be true, so one of the two readings is lying and no
    // further hypothesis about the depth pass is worth forming until I know
    // which. The loop now records how many windows each test rejected and the
    // closest depth it ever saw; the failure path additionally reports the
    // bounding box of the wanted-depth pixels, so a candidate that is simply
    // outside the selection margin shows up as a box rather than as a mystery.
    let PX = -1, PY = -1, bestScore = -1;
    let nVisit = 0, nZero = 0, nOff = 0, nPass = 0, closest = 1e9;
    for (let cy = PS + SR; cy < Hh - PS - SR; cy += 4)
      for (let cx = PS + SR; cx < W - PS - SR; cx += 4) {
        nVisit++;
        const dvAt = (x, y) => dm.px[(Math.min(dm.RH - 1, Math.round((Hh - 1 - y) * dm.RH / Hh)) * dm.RW +
                                      Math.min(dm.RW - 1, Math.round(x * dm.RW / W))) * 4];
        const dv = dvAt(cx, cy);
        if (dv === 0 || dv >= RING) { nZero++; continue; }   // sky, or the outer matte
        closest = Math.min(closest, Math.abs(dv - wantD));
        if (Math.abs(dv - wantD) > 16) { nOff++; continue; }  // not on the subject plane
        // A196g the patch must be entirely picture: a window overlapping the
        // static letterbox is anchored by it and would read as a perfect pin.
        let bad = false, onGeom = 0, n2 = 0;
        for (let y = cy - PS; y <= cy + PS && !bad; y += 4) for (let x = cx - PS; x <= cx + PS; x += 4) {
          const v = dvAt(x, y); n2++;
          if (v >= RING) { bad = true; break; } else if (v > 0) onGeom++; }
        if (bad || onGeom < 0.8 * n2) { nOff++; continue; }
        nPass++;
        let sm = 0, s2 = 0, n = 0;
        for (let y = cy - PS; y <= cy + PS; y += 3) for (let x = cx - PS; x <= cx + PS; x += 3) {
          const v = base0[y*W+x]; sm += v; s2 += v*v; n++; }
        const varr = s2/n - (sm/n)*(sm/n);
        if (varr > bestScore) { bestScore = varr; PX = cx; PY = cy; }
      }
    dollyZoomActive = false;
    if (PX < 0) {
      // A196d DIAGNOSE, DO NOT GUESS. The filter rejected every window, and the
      // candidates are a resolution/flip mismatch between canvas and depth pass
      // or a wrong tolerance. Report what the depth pass actually contains so
      // the next attempt is aimed rather than tried.
      const hist = new Array(16).fill(0); let nz = 0, mn = 255, mx = 0;
      let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1, nWant = 0;
      for (let i = 0; i < dm.px.length; i += 4) { const v = dm.px[i];
        if (v === 0) continue; nz++; if (v < mn) mn = v; if (v > mx) mx = v;
        hist[Math.min(15, v >> 4)]++;
        if (Math.abs(v - wantD) <= 12) { nWant++;
          const p = i >> 2, px_ = p % dm.RW, py_ = (p / dm.RW) | 0;
          if (px_ < x0) x0 = px_; if (px_ > x1) x1 = px_;
          if (py_ < y0) y0 = py_; if (py_ > y1) y1 = py_; }
      }
      return { failed: 'no window passed the subject-plane depth filter',
               wantD: +wantD.toFixed(1), dNorm: +dNorm.toFixed(4),
               portalNorm: +currentNormPortalPlane.toFixed(4),
               depthPass: dm.RW + 'x' + dm.RH, canvas: W + 'x' + Hh,
               nonZero: nz, minD: mn, maxD: mx, hist16: hist,
               nVisit, nZero, nOff, nPass, closest: (closest > 1e8 ? null : closest),
               PS, SR, box: [PS + SR, PS + SR, W - PS - SR, Hh - PS - SR],
               nWant, wantBox: (nWant ? [x0, y0, x1, y1] : null),
               // A196f LOOK AT THE BUFFER. The counters above are mutually
               // contradictory, so the next step is not another statistic.
               depthPng: (() => {
                 const cv = document.createElement('canvas'); cv.width = dm.RW; cv.height = dm.RH;
                 const g = cv.getContext('2d'), im = g.createImageData(dm.RW, dm.RH);
                 for (let y = 0; y < dm.RH; y++) for (let x = 0; x < dm.RW; x++) {
                   const s = ((dm.RH - 1 - y) * dm.RW + x) * 4, d = (y * dm.RW + x) * 4;
                   const v = dm.px[s];
                   im.data[d] = v; im.data[d+1] = v; im.data[d+2] = v; im.data[d+3] = 255;
                 }
                 g.putImageData(im, 0, 0); return cv.toDataURL('image/png');
               })(),
               colorPng: (() => {
                 const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
                 cv.getContext('2d').drawImage(renderer.domElement, 0, 0, W, Hh);
                 return cv.toDataURL('image/png');
               })() };
    }
    // A196h THE TEMPLATE IS PER ARM; ONLY THE LOCATION IS SHARED.
    // a196g gave all three arms one template grabbed in the embed-ON
    // configuration. The embed-OFF arm then had to match a picture taken under a
    // DIFFERENT volume placement, lost the patch outright (corr 0.22, dx flipping
    // between -13 and +36 — two false peaks, not a measurement) and reported a
    // 49px "travel" that was pure tracker failure. Travel is a WITHIN-arm
    // quantity: displacement from that arm's own starting frame. So each arm now
    // cuts its own template, at the same screen location, from its own phase-0
    // render. Phase 0 consequently reads dx=dy=0 corr=1.000 by construction, and
    // that row is a self-check rather than data. Each arm also reports the
    // rendered depth under the patch at its own phase 0, so an arm that is no
    // longer looking at the subject plane declares itself instead of being read.
    const runArm = (embedOn) => {
      bgEmbedVolume = embedOn;
      dollyZoomActive = true;
      window._dzLat = null; window._dzBase = null;
      baselineFaceTrackerOffsetX = 0; baselineFaceTrackerOffsetY = 0;
      latestDetectedFaceY = 0.5; latestDetectedFaceX = 0.5 + 0.5;

      const bx = PX, by = PY;
      dollyZoomTime = phases[0] - PHSTEP;
      updateCameraAndProjection();     // captures _dzLat.e0 at exactly phase 0
      const armBase = grab(phases[0]);
      const armDm = depthMap();
      const armDepth = armDm.px[(Math.min(armDm.RH - 1, Math.round((Hh - 1 - by) * armDm.RH / Hh)) * armDm.RW +
                                 Math.min(armDm.RW - 1, Math.round(bx * armDm.RW / W))) * 4];
      const patch = [];
      for (let y = by - PS; y <= by + PS; y++) for (let x = bx - PS; x <= bx + PS; x++) patch.push(armBase[y*W+x]);
      // A196h pm/pss MUST be taken over the same stride-2 subset track() sums, or
      // the normaliser is 625/169 too large and every correlation is scaled by
      // 0.52 — which is exactly why a phase-0 self-match, necessarily perfect,
      // was reading 0.515. The ranking was unaffected but the guard was not
      // readable as a correlation, and a guard you have to mentally rescale is
      // one you will eventually misread.
      let pm = 0, pss = 0, cnt = 0;
      for (let y = -PS; y <= PS; y += 2) for (let x = -PS; x <= PS; x += 2) {
        pm += patch[(y+PS)*(2*PS+1) + (x+PS)]; cnt++; }
      pm /= cnt;
      for (let y = -PS; y <= PS; y += 2) for (let x = -PS; x <= PS; x += 2) {
        const d = patch[(y+PS)*(2*PS+1) + (x+PS)] - pm; pss += d*d; }

      const track = (L) => {
        let bestC = -2, bdx = 0, bdy = 0;
        for (let dy = -SR; dy <= SR; dy += 1) for (let dx = -SR; dx <= SR; dx += 1) {
          const ox = bx + dx, oy = by + dy;
          if (ox - PS < 0 || ox + PS >= W || oy - PS < 0 || oy + PS >= Hh) continue;
          let s = 0, k = 0;
          for (let y = -PS; y <= PS; y += 2) for (let x = -PS; x <= PS; x += 2) { s += L[(oy+y)*W + ox+x]; k++; }
          const m = s / k;
          let num = 0, den = 0;
          let i = 0;
          for (let y = -PS; y <= PS; y += 2) for (let x = -PS; x <= PS; x += 2) {
            const a = L[(oy+y)*W + ox+x] - m;
            const b = patch[(y+PS)*(2*PS+1) + (x+PS)] - pm;
            num += a*b; den += a*a; i++;
          }
          const c = num / Math.sqrt(Math.max(1e-9, den) * Math.max(1e-9, pss));
          if (c > bestC) { bestC = c; bdx = dx; bdy = dy; }
        }
        return { c: bestC, dx: bdx, dy: bdy };
      };

      const rows = [];
      for (const ph of phases) {
        dollyZoomTime = ph - PHSTEP;
        updateCameraAndProjection();
        const L = grab(ph);
        const t = track(L);
        rows.push({ ph, e: +camera.position.z.toFixed(4), ex: +camera.position.x.toFixed(4),
                    dx: t.dx, dy: t.dy, corr: +t.c.toFixed(3) });
      }
      dollyZoomActive = false;
      const dxs = rows.map(v => v.dx), dys = rows.map(v => v.dy);
      return { rows, patch: bx + ',' + by, armDepth,
               travelX: Math.max(...dxs) - Math.min(...dxs),
               travelY: Math.max(...dys) - Math.min(...dys),
               minCorr: Math.min(...rows.map(v => v.corr)),
               exFrom: rows[0].ex, exTo: rows[rows.length-1].ex };
    };

    const on = runArm(true);
    const off = runArm(false);
    // and with the pin disabled entirely, as the floor
    subjectLockActive = false;
    const nopin = runArm(true);
    subjectLockActive = true; bgEmbedVolume = true;
    return { q: +q.toFixed(4), P: portalPlaneWorldZ, embed: +bgEmbedOffsetNow().toFixed(4),
             W, H: Hh, on, off, nopin, pick: window.__pick };
  }, { subj: process.env.SUBJ || 'far', mode: process.env.MODE || 'quick' });

  const pad = (s, n) => String(s).padStart(n);
  if (r.failed) {
    console.log('\n  *** ' + r.failed);
    console.log('  wanted depth ' + r.wantD + ' (dNorm ' + r.dNorm + ', portalNorm ' + r.portalNorm + ')');
    console.log('  depth pass ' + r.depthPass + ', canvas ' + r.canvas +
                ', non-zero px ' + r.nonZero + ', range ' + r.minD + '..' + r.maxD);
    if (r.hist16) {
      console.log('  histogram of depth-pass values in 16 bins of 16:');
      console.log('    ' + r.hist16.map((v, i) => (i*16) + ':' + v).join('  '));
    }
    if (r.PS !== undefined) {
    console.log('  selection: PS=' + r.PS + ' SR=' + r.SR + '  search box (canvas, top-left origin) ' +
                'x ' + r.box[0] + '..' + r.box[2] + ', y ' + r.box[1] + '..' + r.box[3]);
    console.log('  windows visited ' + r.nVisit + ' -> rejected depth==0 ' + r.nZero +
                ', rejected off-plane ' + r.nOff + ', passed ' + r.nPass +
                '  (closest |dv-want| seen = ' + r.closest + ')');
    console.log('  wanted-depth pixels in the WHOLE depth pass: ' + r.nWant +
                (r.wantBox ? '  bbox (depth-pass coords, bottom-left origin) x ' +
                 r.wantBox[0] + '..' + r.wantBox[2] + ', y ' + r.wantBox[1] + '..' + r.wantBox[3] : ''));
    }
    console.log('\n  If the wanted value sits outside the range, the mapping or the sign is');
    console.log('  wrong. If it sits inside but no window passed, the tolerance is too tight.');
    const OUT = process.env.OUT || '/tmp/dt';
    for (const [k, nm] of [['depthPng', 'depth'], ['colorPng', 'color']]) {
      if (!r[k]) continue;
      const f = OUT + '_' + nm + '.png';
      fs.writeFileSync(f, Buffer.from(r[k].split(',')[1], 'base64'));
      console.log('  wrote ' + f);
    }
    await browser.close(); srv.kill(); process.exit(3);
  }
  console.log('\n' + ASSET + '  mode=' + (process.env.MODE || 'quick') + '  canvas ' + r.W + 'x' + r.H + '  embed=' + r.embed + '  subject q=' + r.q);
  if (r.pick) console.log('  subject chosen from the picture: dNorm ' + r.pick.dNorm + ' (depth byte ' + r.pick.dv +
    ', portal ' + r.pick.portalNorm + ', distance ' + r.pick.dist + ')  at (' + r.pick.at + ')' +
    '  contrast ' + r.pick.varr + ' of best ' + r.pick.maxVar + ' over ' + r.pick.nCand + ' candidates');
  const show = (lbl, a) => {
    if (a.failed) { console.log('\n  ' + lbl + '   *** ARM INVALID: ' + a.failed); return; }
    console.log('\n  ' + lbl + '   patch at (' + a.patch + ') depth ' + a.armDepth +
      '   eye x ' + a.exFrom + '..' + a.exTo +
      '   travel ' + a.travelX + 'px x, ' + a.travelY + 'px y   min corr ' + a.minCorr);
    console.log('     phase        e        ex      dx    dy    corr');
    for (const w of a.rows)
      console.log('    ' + pad(w.ph, 6) + pad(w.e, 10) + pad(w.ex, 10) + pad(w.dx, 7) + pad(w.dy, 6) + pad(w.corr, 8));
  };
  const PORTAL = (process.env.SUBJ === 'portal');
  show(PORTAL ? 'PIN ON at the portal plane  (a196 behaviour)' : 'PIN ON, embed ON  (shipped)', r.on);
  show('PIN ON, embed OFF', r.off);
  show(PORTAL ? 'PIN OFF  (a192 behaviour at the portal: gain was forced to 1)' : 'PIN OFF (floor)', r.nopin);
  console.log('\n  travel is how far the tracked CONTENT moved across the dolly — the quantity the');
  console.log('  user reports. min corr guards the tracker: if it drops the patch, its "no');
  console.log('  movement" is meaningless, so a low value invalidates that row.');
  console.log('  PIN OFF is the floor — how far the content moves with no pin at all. A pin that');
  console.log('  is working must sit far below it.');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
