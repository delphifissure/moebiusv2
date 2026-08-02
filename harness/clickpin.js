// A205 TEST THE GESTURE THE USER ACTUALLY MAKES, AND THE CLAIM IT IMPLIES.
//
// The user: "clicking on the subject sets the focal plane at that distance, and
// maybe that's labeled portal plane". It is. handleCanvasClick - a plain click on
// the canvas, which IS the Set Subject gesture - runs:
//
//     currentNormPortalPlane = clickedDepthValue_8bit;  // portal := clicked depth
//     subjectFocalPlaneWorldZ = portalPlaneWorldZ;      // subject := portal plane
//     outerVolumeDepth = 0.01;
//
// So in the real flow the subject is ALWAYS at the portal plane, and the clicked
// texel has vNormalizedDepth == u_portalPlaneDepthNorm, hence displacement == 0,
// hence zOff == 0 + displacementBias + u_embedOffset.
//
// Before a167 the embed was 0, so that texel sat at zOff == 0 EXACTLY - and the
// Kooima frustum is pinned to the portal rect, so a texel at zOff == 0 is pinned
// by construction. No gain, no scale, no subject-lock code at all. If that is
// what "it used to work perfectly" means, then every pin from a67 onward has been
// compensating for having knocked the subject off a plane that was already
// pinned, and the fix is to stop knocking it off rather than to compensate
// better.
//
// Every measurement before this one reproduced the BUTTON path (Set Subject Focus
// from Peek, portal norm left at 0.5, outer volume 0.02), not the CLICK path.
// Different portal plane, different volume, different subject. So this harness
// emulates handleCanvasClick exactly and then runs three arms:
//
//   A  embed ON,  lock OFF   what the click path does today with no pin
//   B  embed OFF, lock OFF   THE HYPOTHESIS: the frustum alone should pin it
//   C  embed ON,  lock ON    the shipped a196 pin
//
// If B is ~0 with no pin code running, the portal plane IS the pin and a167 is
// what broke it.
//
//   MODE=quick|realtime|v1|v2  node harness/clickpin.js [star|troll|warrior]
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
    if (typeof dollySubjectScale === 'undefined') window.dollySubjectScale = 1;
    if (typeof dollyRefEyeZ === 'undefined') window.dollyRefEyeZ = null;
    window._rayReproject = true;
    if (o.mode === 'realtime') { bgQuickBake = false; bgMPIFullPlanes = false; bgMPIMode = false; }
    else if (o.mode === 'v1')  { bgQuickBake = false; bgMPIFullPlanes = false; bgMPIMode = false; bgBuildStamp = null; buildBackgroundLayer(); }
    else if (o.mode === 'v2')  { bgQuickBake = false; bgMPIFullPlanes = true;  bgMPIMode = true;  bgBuildStamp = null; buildBackgroundLayer(); }
    else                       { bgQuickBake = true;  bgMPIFullPlanes = false; bgMPIMode = false; bgBuildStamp = null; buildBackgroundLayer(); }

    const W = renderer.domElement.width, Hh = renderer.domElement.height;
    const PHSTEP = dollyZoomSpeed * 100;
    // A205c COVER THE WHOLE SWEEP. dist = min + (max-min)*0.5*(1+sin(t)), so
    // phases [0, 0.5, 1.0, 1.5] span sin 0..1 - only the FAR HALF of the dolly.
    // The user's own debug stamps show camera z going 0.345 -> 0.052: the NEAR
    // extreme, where h = e - P collapses toward zero and every parallax term
    // blows up. Every number reported before this was measured in the gentle
    // half of a sweep whose violent half was never sampled.
    // t = -pi/2 gives sin = -1 (nearest), t = +pi/2 gives sin = +1 (farthest).
    const phases = [0, -0.8, -1.5708, 0.8, 1.5708];
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

    // rest frame, eye exactly on axis -> screen == portal plane, uv is exact
    isSweeping = true;
    dollyZoomActive = false; subjectLockActive = false;
    camera.position.set(0, 0, Math.abs(camera.position.z) || 0.2);
    updateCameraAndProjection();
    const L0 = grab();
    const dm = depthPass();
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
    isSweeping = false;

    // ---- EMULATE handleCanvasClick's sweet spot on a real, trackable texel ----
    // choose a click point: uniform source depth, strong contrast at the engage
    // pose (the frame the templates come from), in the NEAR half = the figure
    const cands = [];
    for (let cy = PS+SR; cy < Hh-PS-SR; cy += 2)
      for (let cx = PS+SR; cx < W-PS-SR; cx += 2) {
        const d0 = srcD(cx, cy);
        if (d0 === null || d0 < 0.01) continue;
        let mn=2,mx=-1,ok=true;
        for (const [ox,oy] of [[-PS,-PS],[PS,-PS],[-PS,PS],[PS,PS]]) {
          const v = srcD(cx+ox, cy+oy); if (v===null){ok=false;break;} mn=Math.min(mn,v); mx=Math.max(mx,v); }
        if (!ok || (mx-mn) > 0.03) continue;
        cands.push({ cx, cy, d: (mn+mx)/2 });
      }
    if (!cands.length) return { failed: 'no uniform-depth click candidate' };

    // score contrast at the engage pose (the frame that will be searched)
    bgEmbedVolume = true; dollyZoomActive = true; subjectLockActive = false;
    dollyRefEyeZ = null; window._dzLat = null; window._dzBase = null;
    baselineFaceTrackerOffsetX = 0; baselineFaceTrackerOffsetY = 0;
    latestDetectedFaceY = 0.5; latestDetectedFaceX = 1.0;
    dollyZoomTime = phases[0] - PHSTEP; updateCameraAndProjection();
    const E0 = grab(phases[0]);
    dollyZoomActive = false; dollyRefEyeZ = null;
    for (const c of cands) { let sm=0,s2=0,n=0;
      for (let y=c.cy-PS;y<=c.cy+PS;y+=2) for (let x=c.cx-PS;x<=c.cx+PS;x+=2){ const v=E0[y*W+x]; sm+=v; s2+=v*v; n++; }
      c.ve = s2/n - (sm/n)*(sm/n); }
    cands.sort((a,b) => b.ve - a.ve);
    const strong = cands.filter(c => c.ve >= 120);
    if (!strong.length) return { failed: 'no click candidate with contrast at the engage pose' };
    const click = strong.find(c => c.d >= 0.45) || strong[0];

    // THE SWEET SPOT, exactly as handleCanvasClick sets it
    currentNormPortalPlane = click.d;
    subjectFocalPlaneWorldZ = portalPlaneWorldZ;
    outerVolumeDepth = 0.01;

    const measure = (embedOn, lockOn) => {
      bgEmbedVolume = embedOn; subjectLockActive = lockOn;
      dollyZoomActive = true;
      dollyRefEyeZ = null; window._dzLat = null; window._dzBase = null;
      baselineFaceTrackerOffsetX = 0; baselineFaceTrackerOffsetY = 0;
      latestDetectedFaceY = 0.5; latestDetectedFaceX = 1.0;
      dollyZoomTime = phases[0] - PHSTEP; updateCameraAndProjection();
      const base = grab(phases[0]);
      const tmpl = [];
      for (let y=click.cy-PS;y<=click.cy+PS;y++) for (let x=click.cx-PS;x<=click.cx+PS;x++) tmpl.push(base[y*W+x]);
      let pm=0,pss=0,cnt=0;
      for (let y=-PS;y<=PS;y+=2) for (let x=-PS;x<=PS;x+=2){ pm+=tmpl[(y+PS)*(2*PS+1)+(x+PS)]; cnt++; }
      pm/=cnt;
      for (let y=-PS;y<=PS;y+=2) for (let x=-PS;x<=PS;x+=2){ const q=tmpl[(y+PS)*(2*PS+1)+(x+PS)]-pm; pss+=q*q; }
      let worst=0, minc=2, amb=false; const trail=[];
      for (let k=0;k<phases.length;k++) {
        dollyZoomTime = phases[k] - PHSTEP; updateCameraAndProjection();
        const L = grab(phases[k]);
        let bc=-2,bdx=0,bdy=0;
        for (let dy=-SR;dy<=SR;dy++) for (let dx=-SR;dx<=SR;dx++) {
          const ox=click.cx+dx, oy=click.cy+dy;
          if (ox-PS<0||ox+PS>=W||oy-PS<0||oy+PS>=Hh) continue;
          let s=0,kk=0;
          for (let y=-PS;y<=PS;y+=2) for (let x=-PS;x<=PS;x+=2){ s+=L[(oy+y)*W+ox+x]; kk++; }
          const mmv=s/kk; let num=0,den=0;
          for (let y=-PS;y<=PS;y+=2) for (let x=-PS;x<=PS;x+=2){
            const A=L[(oy+y)*W+ox+x]-mmv, B=tmpl[(y+PS)*(2*PS+1)+(x+PS)]-pm; num+=A*B; den+=A*A; }
          const c=num/Math.sqrt(Math.max(1e-9,den)*Math.max(1e-9,pss));
          if (c>bc){ bc=c; bdx=dx; bdy=dy; }
        }
        if (k===0 && (bdx!==0||bdy!==0)) amb = true;
        worst = Math.max(worst, Math.abs(bdx), Math.abs(bdy));
        minc = Math.min(minc, bc); trail.push(bdx+','+bdy);
      }
      const gain = dollyLatGain, embSeen = bgEmbedOffsetNow();
      dollyZoomActive = false; dollyRefEyeZ = null;
      return { worst, minc:+minc.toFixed(2), amb, trail,
               gain:+Number(gain).toFixed(4), emb:+Number(embSeen).toFixed(4) };
    };

    const A = measure(true,  false);
    const B = measure(false, false);
    const C = measure(true,  true);

    // A205b WITNESSES. The subject staying put is only half the effect; the other
    // half is everything else moving. Track patches at clearly different source
    // depths under the SHIPPED config (embed on, lock on), because "the dolly
    // zoom is so minor" is a statement about these, not about the subject.
    const wit = [];
    for (const c of strong) {
      if (Math.abs(c.d - click.d) < 0.12) continue;
      if (wit.some(w => Math.abs(w.d - c.d) < 0.10)) continue;
      if (Math.abs(c.cx - click.cx) + Math.abs(c.cy - click.cy) < 40) continue;
      wit.push(c); if (wit.length >= 3) break;
    }
    const witOut = wit.map(w => {
      const savedX = click.cx, savedY = click.cy;
      click.cx = w.cx; click.cy = w.cy;
      const m = measure(true, true);
      click.cx = savedX; click.cy = savedY;
      return { at: w.cx+','+w.cy, d: +w.d.toFixed(3), m };
    });

    bgEmbedVolume = true; subjectLockActive = true;
    return { click: { at: click.cx+','+click.cy, d: +click.d.toFixed(4) },
             P: portalPlaneWorldZ, inner: innerVolumeDepth, outer: outerVolumeDepth,
             A, B, C, witOut, W, H: Hh };
  }, { mode: process.env.MODE || 'quick' });

  if (r.failed) { console.log('*** ' + r.failed); await browser.close(); srv.kill(); process.exit(3); }
  console.log('\n' + ASSET + '  mode=' + (process.env.MODE||'quick') + '  canvas ' + r.W + 'x' + r.H);
  console.log('emulated canvas click at (' + r.click.at + '), source depth ' + r.click.d);
  console.log('  -> currentNormPortalPlane = ' + r.click.d + ',  subject = portal plane (' + r.P + '),  outerVolumeDepth = ' + r.outer);
  console.log('  the clicked texel therefore has displacement = 0, so zOff = embed exactly.\n');
  const row = (lbl, m) => console.log('  ' + lbl.padEnd(30) + 'travel ' + String(m.worst).padStart(3) +
      'px   minCorr ' + String(m.minc).padStart(5) + '   embed ' + String(m.emb).padStart(7) +
      '   gain ' + String(m.gain).padStart(7) + '   [' + m.trail.join('  ') + ']' +
      (m.amb ? '  [VOID]' : ''));
  row('A  embed ON,  lock OFF', r.A);
  row('B  embed OFF, lock OFF', r.B);
  row('C  embed ON,  lock ON', r.C);
  if (r.witOut && r.witOut.length) {
    console.log('\n  WITNESSES at other depths, shipped config (embed on, lock on).');
    console.log('  These MUST move for there to be a dolly zoom at all:');
    for (const w of r.witOut) row('   depth ' + w.d + ' at (' + w.at + ')', w.m);
  } else console.log('\n  (no witness patch far enough in depth from the click)');
  console.log('\n  B is the hypothesis: with the embed off the clicked texel sits at zOff = 0,');
  console.log('  where the Kooima frustum pins it by construction, with NO pin code running.');
  console.log('  If B is ~0 and A is not, a167 is what broke the subject lock and every pin');
  console.log('  since has been compensating for it.');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
