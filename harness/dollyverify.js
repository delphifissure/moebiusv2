// A202 VERIFICATION. Three claims, three measurements, one run.
//
//   1. THE REST PATH IS UNTOUCHED. With the dolly off, refEye tracks the live
//      eye and u_dollyScale is 1, so a202 must be bit-identical to a201. Printed
//      as a hash of the rest frame; compare across the two builds.
//   2. THE SUBJECT IS PINNED. Travel of a patch on the selected plane.
//   3. THE DOLLY ZOOM IS BACK. Travel of patches at OTHER depths. Under a201
//      these barely moved (the coefficient on px was exactly 1, so an on-axis
//      dolly was a structural no-op); if the zoom has returned they must move a
//      lot, and by more the further they are from the subject.
//
// The subject is chosen the way the UI does it: read the SOURCE depth (the image
// Depth Peek samples) and map it with volumeWorldZForNormDepth, the a200 shared
// mapping. Screen -> source uv is exact at rest with the eye on axis, because the
// a104 parallax term vanishes for every depth when ex = 0 (isSweeping stops face
// tracking from moving the eye), so no raycasting is needed.
//
//   MODE=quick|realtime|v1|v2  node harness/dollyverify.js [star|troll|warrior]
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
    // the a202 globals do not exist on older builds; stub them so this harness
    // can measure the control as well as the change (reading an undeclared name
    // throws, which is what killed the first control run).
    if (typeof dollySubjectScale === 'undefined') window.dollySubjectScale = 1;
    if (typeof dollyRefEyeZ === 'undefined') window.dollyRefEyeZ = null;
    window._rayReproject = true;
    if (o.mode === 'realtime') { bgQuickBake = false; bgMPIFullPlanes = false; bgMPIMode = false; }
    else if (o.mode === 'v1')  { bgQuickBake = false; bgMPIFullPlanes = false; bgMPIMode = false; bgBuildStamp = null; buildBackgroundLayer(); }
    else if (o.mode === 'v2')  { bgQuickBake = false; bgMPIFullPlanes = true;  bgMPIMode = true;  bgBuildStamp = null; buildBackgroundLayer(); }
    else                       { bgQuickBake = true;  bgMPIFullPlanes = false; bgMPIMode = false; bgBuildStamp = null; buildBackgroundLayer(); }

    const W = renderer.domElement.width, Hh = renderer.domElement.height;
    const PHSTEP = dollyZoomSpeed * 100;
    const phases = [0, 0.5, 1.0, 1.5];
    const PS = 11, SR = 46, RING = 235;

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
    const hashOf = (L) => { let h = 2166136261 >>> 0;
      for (let i = 0; i < L.length; i++) { h ^= Math.round(L[i]) & 255; h = Math.imul(h, 16777619) >>> 0; }
      return ('00000000' + h.toString(16)).slice(-8); };
    const depthPass = () => {
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

    // ---- CLAIM 1: rest frame, eye exactly on axis ----
    isSweeping = true;
    dollyZoomActive = false; subjectLockActive = false;
    camera.position.set(0, 0, Math.abs(camera.position.z) || 0.2);
    updateCameraAndProjection();
    const L0 = grab();
    const restHash = hashOf(L0);
    const restEx = camera.position.x, restEy = camera.position.y;
    const dm = depthPass();

    // content rect -> exact screen->source uv (valid only because ex = ey = 0)
    let x0=1e9,x1=-1,y0=1e9,y1=-1;
    for (let y=0;y<dm.RH;y++) for (let x=0;x<dm.RW;x++) {
      const v = dm.px[(y*dm.RW+x)*4];
      if (v === 0 || v >= RING) continue;
      if (x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y;
    }
    if (x1 < 0) return { failed: 'no content rect' };
    const rx0 = x0*W/dm.RW, rx1 = (x1+1)*W/dm.RW;
    const ry0 = Hh - (y1+1)*Hh/dm.RH, ry1 = Hh - y0*Hh/dm.RH;

    const dImg = mediaLayers[0].elements.depth;
    const dcv = document.createElement('canvas');
    dcv.width = dImg.naturalWidth || dImg.width; dcv.height = dImg.naturalHeight || dImg.height;
    dcv.getContext('2d').drawImage(dImg, 0, 0);
    const DW = dcv.width, DH = dcv.height;
    const dData = dcv.getContext('2d').getImageData(0, 0, DW, DH).data;
    const srcD = (sx, sy) => {
      const u = (sx-rx0)/(rx1-rx0), v = (sy-ry0)/(ry1-ry0);
      if (u < 0 || u > 1 || v < 0 || v > 1) return null;
      return dData[(Math.min(DH-1,Math.max(0,Math.round(v*(DH-1))))*DW +
                    Math.min(DW-1,Math.max(0,Math.round(u*(DW-1)))))*4] / 255;
    };
    const varAt = (cx, cy) => { let sm=0,s2=0,n=0;
      for (let y=cy-PS;y<=cy+PS;y+=3) for (let x=cx-PS;x<=cx+PS;x+=3){ const v=L0[y*W+x]; sm+=v; s2+=v*v; n++; }
      return s2/n - (sm/n)*(sm/n); };

    // candidates: uniform source depth, trackable
    const cands = [];
    for (let cy = PS+SR; cy < Hh-PS-SR; cy += 2)
      for (let cx = PS+SR; cx < W-PS-SR; cx += 2) {
        const d0 = srcD(cx, cy);
        if (d0 === null) continue;
        let mn=2,mx=-1,ok=true;
        for (const [ox,oy] of [[-PS,-PS],[PS,-PS],[-PS,PS],[PS,PS]]) {
          const v = srcD(cx+ox, cy+oy); if (v===null){ok=false;break;} mn=Math.min(mn,v); mx=Math.max(mx,v); }
        if (!ok || (mx-mn) > 0.03) continue;
        cands.push({ cx, cy, d: (mn+mx)/2, v: varAt(cx, cy) });
      }
    if (!cands.length) return { failed: 'no uniform-depth candidates' };
    isSweeping = false;

    // A202b SCORE CONTRAST IN THE FRAME THE PATCH WILL BE TRACKED IN. The first
    // run scored variance on the REST frame while every template is cut from the
    // ENGAGE frame — a different eye, a different picture. It picked a patch that
    // is textured at rest and flat sky at engage, so the template had no variance
    // and the NCC search returned the corner of its own window at every phase
    // (-46,-46, minCorr 0). Same trap as a196: judge a patch by the frame that
    // will actually be searched.
    bgEmbedVolume = true; dollyZoomActive = true; subjectLockActive = false;
    dollyRefEyeZ = null; window._dzLat = null; window._dzBase = null;
    baselineFaceTrackerOffsetX = 0; baselineFaceTrackerOffsetY = 0;
    latestDetectedFaceY = 0.5; latestDetectedFaceX = 1.0;
    dollyZoomTime = phases[0] - PHSTEP; updateCameraAndProjection();
    const E0 = grab(phases[0]);
    dollyZoomActive = false; dollyRefEyeZ = null;
    const varE = (cx, cy) => { let sm=0,s2=0,n=0;
      for (let y=cy-PS;y<=cy+PS;y+=2) for (let x=cx-PS;x<=cx+PS;x+=2){ const v=E0[y*W+x]; sm+=v; s2+=v*v; n++; }
      return s2/n - (sm/n)*(sm/n); };
    for (const c of cands) c.ve = varE(c.cx, c.cy);
    cands.sort((a,b) => b.ve - a.ve);
    const strong = cands.filter(c => c.ve >= 120);        // a flat sky patch is ~0
    if (!strong.length) return { failed: 'no candidate has usable contrast at the engage pose' };

    // SUBJECT: the highest-contrast NEAR-half patch = the standing figure
    const subj = strong.find(c => c.d >= currentNormPortalPlane) || strong[0];
    // WITNESSES: strongest patches at clearly different depths, to show the stretch
    const wit = [];
    for (const c of strong) {
      if (Math.abs(c.d - subj.d) < 0.10) continue;
      if (wit.some(w => Math.abs(w.d - c.d) < 0.08)) continue;
      if (Math.abs(c.cx - subj.cx) + Math.abs(c.cy - subj.cy) < 40) continue;
      wit.push(c); if (wit.length >= 3) break;
    }

    subjectFocalPlaneWorldZ = volumeWorldZForNormDepth(subj.d);

    const measure = (pt, pinOn) => {
      subjectLockActive = pinOn;
      bgEmbedVolume = true; dollyZoomActive = true;
      dollyRefEyeZ = null;                      // fresh engage for each arm
      window._dzLat = null; window._dzBase = null;
      baselineFaceTrackerOffsetX = 0; baselineFaceTrackerOffsetY = 0;
      latestDetectedFaceY = 0.5; latestDetectedFaceX = 1.0;
      dollyZoomTime = phases[0] - PHSTEP; updateCameraAndProjection();
      const base = grab(phases[0]);
      const tmpl = [];
      for (let y=pt.cy-PS;y<=pt.cy+PS;y++) for (let x=pt.cx-PS;x<=pt.cx+PS;x++) tmpl.push(base[y*W+x]);
      let pm=0,pss=0,cnt=0;
      for (let y=-PS;y<=PS;y+=2) for (let x=-PS;x<=PS;x+=2){ pm+=tmpl[(y+PS)*(2*PS+1)+(x+PS)]; cnt++; }
      pm/=cnt;
      for (let y=-PS;y<=PS;y+=2) for (let x=-PS;x<=PS;x+=2){ const d=tmpl[(y+PS)*(2*PS+1)+(x+PS)]-pm; pss+=d*d; }
      let worst=0, minc=2, amb=false; const trail=[];
      for (let k=0;k<phases.length;k++) {
        dollyZoomTime = phases[k] - PHSTEP; updateCameraAndProjection();
        const L = grab(phases[k]);
        let bc=-2,bdx=0,bdy=0;
        for (let dy=-SR;dy<=SR;dy++) for (let dx=-SR;dx<=SR;dx++) {
          const ox=pt.cx+dx, oy=pt.cy+dy;
          if (ox-PS<0||ox+PS>=W||oy-PS<0||oy+PS>=Hh) continue;
          let s=0,kk=0;
          for (let y=-PS;y<=PS;y+=2) for (let x=-PS;x<=PS;x+=2){ s+=L[(oy+y)*W+ox+x]; kk++; }
          const m=s/kk; let num=0,den=0;
          for (let y=-PS;y<=PS;y+=2) for (let x=-PS;x<=PS;x+=2){
            const a=L[(oy+y)*W+ox+x]-m, b=tmpl[(y+PS)*(2*PS+1)+(x+PS)]-pm; num+=a*b; den+=a*a; }
          const c=num/Math.sqrt(Math.max(1e-9,den)*Math.max(1e-9,pss));
          if (c>bc){ bc=c; bdx=dx; bdy=dy; }
        }
        if (k===0 && (bdx!==0||bdy!==0)) amb = true;
        worst = Math.max(worst, Math.abs(bdx), Math.abs(bdy));
        minc = Math.min(minc, bc);
        trail.push(bdx + ',' + bdy);
      }
      const scaleSeen = dollySubjectScale, refSeen = dollyRefEyeZ;
      dollyZoomActive = false;
      return { worst, minc: +minc.toFixed(2), amb, trail, scaleSeen: +Number(scaleSeen).toFixed(4),
               refSeen: refSeen === null ? null : +Number(refSeen).toFixed(4) };
    };

    const out = { subject: { at: subj.cx+','+subj.cy, d: +subj.d.toFixed(3),
                             pinOn: measure(subj, true), pinOff: measure(subj, false) },
                  witnesses: wit.map(w => ({ at: w.cx+','+w.cy, d: +w.d.toFixed(3),
                                             pinOn: measure(w, true) })) };
    subjectLockActive = true;
    return { nCand: cands.length, nStrong: strong.length, restHash, restEx: +restEx.toFixed(4), restEy: +restEy.toFixed(4),
             q: +subjectFocalPlaneWorldZ.toFixed(4), emb: +bgEmbedOffsetNow().toFixed(4),
             portalNorm: +currentNormPortalPlane.toFixed(3), W, H: Hh, out };
  }, { mode: process.env.MODE || 'quick' });

  if (r.failed) { console.log('*** ' + r.failed); await browser.close(); srv.kill(); process.exit(3); }
  console.log('\n' + ASSET + '  mode=' + (process.env.MODE||'quick') + '  canvas ' + r.W + 'x' + r.H);
  console.log('CLAIM 1  rest frame hash = ' + r.restHash + '   (rest eye ' + r.restEx + ',' + r.restEy +
              ' - must be 0,0)   compare this across builds');
  console.log('candidates ' + r.nCand + ', with usable engage contrast ' + r.nStrong + '\nsubject source depth ' + r.out.subject.d + ' (portal ' + r.portalNorm + ')  -> q=' + r.q +
              '  embed=' + r.emb);
  const row = (lbl, m) => console.log('  ' + lbl.padEnd(34) + 'travel ' + String(m.worst).padStart(3) +
      'px   minCorr ' + String(m.minc).padStart(5) + '   scale ' + String(m.scaleSeen).padStart(7) +
      '   [' + m.trail.join('  ') + ']' + (m.amb ? '  [VOID ambiguous]' : ''));
  console.log('\nCLAIM 2  the subject plane');
  row('pin ON  at (' + r.out.subject.at + ')', r.out.subject.pinOn);
  row('pin OFF at (' + r.out.subject.at + ')', r.out.subject.pinOff);
  console.log('\nCLAIM 3  other depths - these MUST move, that is the zoom');
  for (const w of r.out.witnesses) row('depth ' + w.d + ' at (' + w.at + ')', w.pinOn);
  if (!r.out.witnesses.length) console.log('  (no witness patch far enough from the subject in depth)');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
