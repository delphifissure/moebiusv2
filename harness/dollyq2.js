// A199c FOUR CANDIDATE MAPPINGS, TESTED DIRECTLY, WITH BRACKETS.
//
// a199 established the method: the subject plane that MINIMISES a patch's travel
// is the plane that patch is on, with no mapping assumed. Two things made the
// first version unusable:
//
//   - it raycast a million-triangle mesh ~17000 times to read source depth, and
//     Three.js raycasting has no BVH here, so it never finished;
//   - it swept 17 blind values, most of which are nowhere near any candidate.
//
// Both go away with one observation: AT REST WITH THE EYE ON AXIS, the a104 law
// is X = px - ex*zOff/(H-zOff) with ex = 0, so screen position IS portal-plane
// position for every texel at every depth. Screen -> source uv is then an exact
// linear map off the content rect, no raycasting. (Getting ex to 0 requires
// isSweeping = true, which is the flag that tells updateCameraAndProjection an
// external owner holds camera.position; otherwise face-tracking overwrites it.)
//
// So: pick a patch, read its source depth directly, compute the four candidate
// planes, and measure travel AT those four values plus brackets either side. The
// candidate that wins is the mapping the pin must use.
//
//   A  q_linear         setSubjectFocusZFromPeek as shipped (linear in depth)
//   B  q_linear + emb   what a196 pins
//   C  q_smoothstep     the vertex shader's own mapping, no embed
//   D  q_smoothstep+emb the shader mapping plus the a167 embed
//
//   MODE=quick|realtime|v1|v2  node harness/dollyq2.js [star|troll|warrior]
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

    // ---- REST FRAME, EYE EXACTLY ON AXIS ----
    // isSweeping tells updateCameraAndProjection that an external owner holds
    // camera.position, so face tracking does not overwrite it. With ex = ey = 0
    // the parallax term vanishes for every depth and screen == portal plane.
    isSweeping = true;
    dollyZoomActive = false; subjectLockActive = false;
    camera.position.set(0, 0, Math.abs(camera.position.z) || 0.2);
    updateCameraAndProjection();
    const L0 = grab();
    const dm = depthPass();
    const exRest = camera.position.x, eyRest = camera.position.y;

    // content rect from the depth pass (bottom-left origin), in canvas coords
    let x0=1e9,x1=-1,y0=1e9,y1=-1;
    for (let y=0;y<dm.RH;y++) for (let x=0;x<dm.RW;x++) {
      const v = dm.px[(y*dm.RW+x)*4];
      if (v === 0 || v >= RING) continue;
      if (x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y;
    }
    if (x1 < 0) return { failed: 'no content rect' };
    const rx0 = x0 * W / dm.RW, rx1 = (x1+1) * W / dm.RW;
    const ry0c = Hh - (y1+1) * Hh / dm.RH, ry1c = Hh - y0 * Hh / dm.RH;   // to top-down canvas

    // source depth image, read the way Depth Peek reads it
    const dImg = mediaLayers[0].elements.depth;
    const dcv = document.createElement('canvas');
    dcv.width = dImg.naturalWidth || dImg.width; dcv.height = dImg.naturalHeight || dImg.height;
    dcv.getContext('2d').drawImage(dImg, 0, 0);
    const DW = dcv.width, DH = dcv.height;
    const dData = dcv.getContext('2d').getImageData(0, 0, DW, DH).data;
    const srcDepthAt = (sx, sy) => {
      const u = (sx - rx0) / (rx1 - rx0), v = (sy - ry0c) / (ry1c - ry0c);
      if (u < 0 || u > 1 || v < 0 || v > 1) return null;
      const px = Math.min(DW-1, Math.max(0, Math.round(u * (DW-1))));
      const py = Math.min(DH-1, Math.max(0, Math.round(v * (DH-1))));
      return dData[(py*DW + px)*4] / 255;
    };

    let best = null;
    for (let cy = PS+SR; cy < Hh-PS-SR; cy += 2)
      for (let cx = PS+SR; cx < W-PS-SR; cx += 2) {
        const d0 = srcDepthAt(cx, cy);
        if (d0 === null) continue;
        let mn=2, mx=-1, ok=true;
        for (const [ox,oy] of [[-PS,-PS],[PS,-PS],[-PS,PS],[PS,PS],[0,0]]) {
          const v = srcDepthAt(cx+ox, cy+oy);
          if (v === null) { ok = false; break; }
          mn = Math.min(mn,v); mx = Math.max(mx,v);
        }
        if (!ok || (mx-mn) > 0.03) continue;
        let sm=0,s2=0,n=0;
        for (let y=cy-PS;y<=cy+PS;y+=3) for (let x=cx-PS;x<=cx+PS;x+=3){ const v=L0[y*W+x]; sm+=v; s2+=v*v; n++; }
        const varr = s2/n - (sm/n)*(sm/n);
        if (!best || varr > best.varr) best = { cx, cy, d: (mn+mx)/2, varr };
      }
    isSweeping = false;
    if (!best) return { failed: 'no uniform-depth high-contrast patch found' };

    const pn = currentNormPortalPlane, P0 = portalPlaneWorldZ;
    const ss = (e0,e1,x) => { const t = Math.min(1, Math.max(0, (x-e0)/Math.max(1e-6, e1-e0))); return t*t*(3-2*t); };
    const popExtra = (() => { const u = mediaLayers[0].mesh.material.uniforms;
      return (u && u.u_popExtra) ? u.u_popExtra.value : 0; })();
    const rel = best.d - pn;
    const qLinear = (rel < 0) ? P0 - (Math.abs(rel)/Math.max(1e-4,pn))*outerVolumeDepth
                              : P0 + (rel/Math.max(1e-4,1-pn))*innerVolumeDepth;
    const qSmooth = (best.d < pn) ? P0 - outerVolumeDepth*(1 - ss(0,pn,best.d))
                                  : P0 + (innerVolumeDepth + popExtra)*ss(pn,1,best.d);
    const emb = bgEmbedOffsetNow();

    const cands = [
      ['A q_linear',          qLinear],
      ['B q_linear+emb',      qLinear + emb],
      ['C q_smoothstep',      qSmooth],
      ['D q_smoothstep+emb',  qSmooth + emb],
      ['-- bracket lo',       Math.min(qLinear, qSmooth) + emb - 0.008],
      ['-- bracket hi',       Math.max(qLinear, qSmooth) + 0.008],
    ];

    const measure = (q) => {
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
      let worst=0, minc=2, amb=false;
      for (let k=0;k<phases.length;k++) {
        dollyZoomTime = phases[k] - PHSTEP; updateCameraAndProjection();
        const L = grab(phases[k]);
        let bc=-2,bdx=0,bdy=0;
        for (let dy=-SR;dy<=SR;dy++) for (let dx=-SR;dx<=SR;dx++) {
          const ox=best.cx+dx, oy=best.cy+dy;
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
      }
      dollyZoomActive = false;
      return { worst, minc: +minc.toFixed(2), amb };
    };

    const out = cands.map(([n,q]) => ({ name: n, q: +q.toFixed(4), ...measure(q) }));
    return { out, patch: best.cx+','+best.cy, srcDepth: +best.d.toFixed(4),
             qLinear: +qLinear.toFixed(4), qSmooth: +qSmooth.toFixed(4),
             emb: +emb.toFixed(4), popExtra, P: P0, portalNorm: +pn.toFixed(3),
             inner: innerVolumeDepth, outer: outerVolumeDepth,
             exRest: +exRest.toFixed(4), eyRest: +eyRest.toFixed(4),
             rect: [Math.round(rx0), Math.round(ry0c), Math.round(rx1), Math.round(ry1c)] };
  }, { mode: process.env.MODE || 'quick' });

  if (r.failed) { console.log('*** ' + r.failed); await browser.close(); srv.kill(); process.exit(3); }
  console.log('\n' + ASSET + '  mode=' + (process.env.MODE||'quick'));
  console.log('rest eye offset (must be 0,0 for the uv map to be exact): ' + r.exRest + ',' + r.eyRest);
  console.log('content rect ' + r.rect.join(',') + '   portal z ' + r.P + '  inner ' + r.inner +
              '  outer ' + r.outer + '  popExtra ' + r.popExtra + '  embed ' + r.emb);
  console.log('patch (' + r.patch + ')  SOURCE depth ' + r.srcDepth + '  (portal ' + r.portalNorm + ')');
  console.log('\n  candidate               q     worst travel px   minCorr');
  let win = null;
  for (const w of r.out) {
    const bad = w.amb || w.minc < 0.6;
    console.log('  ' + w.name.padEnd(20) + String(w.q).padStart(9) + String(w.worst).padStart(14) +
                String(w.minc).padStart(11) + (bad ? '   [void]' : ''));
    if (!bad && !w.name.startsWith('--') && (!win || w.worst < win.worst)) win = w;
  }
  if (win) {
    console.log('\nWINNER: ' + win.name + '  (' + win.worst + 'px)');
    console.log('The pin must be computed in that frame. A/B differ from C/D by the');
    console.log('linear-vs-smoothstep volume mapping; B/D add the a167 embed.');
  } else console.log('\nno valid candidate row');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
