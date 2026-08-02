// A203 PER-LAYER. WHICH MESHES DRAW, WHAT LAW EACH ONE OBEYS, AND HOW FAR EACH
// ONE MOVES DURING THE DOLLY.
//
// a202 froze u_refEye and added a lateral scale u_dollyScale derived to pin the
// subject exactly. The algebra holds; the measurement said the subject went from
// 3px to 11px while a far witness went 3px -> 12px, i.e. nearly the SAME motion
// was added to both. That is the signature of a correction that is not reaching
// the geometry it was meant to correct, or of layers that disagree with each
// other about where a texel goes.
//
// Both possibilities are per-LAYER questions, and every instrument so far has
// measured the composited frame, where a layer that ignores the law is hidden
// behind one that obeys it. So:
//
//   PART 1  INVENTORY. Every mesh that draws, with the uniforms that decide its
//           parallax law: u_useRayReproject, u_refEye.z, u_embedOffset, and
//           u_dollyScale if the build has it. A material that lacks a uniform
//           the shader reads gets 0.0 from WebGL, which for a scale means
//           "collapse to the eye axis" - so absence is not neutral and has to be
//           listed, not assumed.
//   PART 2  MOTION. Each mesh rendered ALONE across the dolly, with a patch
//           tracked on it. Layers that disagree show up as different travel for
//           the same nominal depth.
//
//   MODE=quick|realtime|v1|v2  node harness/layers.js [star|troll|warrior]
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
    const phases = [0, 0.5, 1.0, 1.5];
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

    // ---------- PART 1: INVENTORY ----------
    // Engage the dolly and hold a phase where the scale is meaningfully != 1, so
    // a material that is NOT receiving it is visible as a stale 1.0 (or absent).
    subjectLockActive = true;
    bgEmbedVolume = true; dollyZoomActive = true;
    dollyRefEyeZ = null; window._dzLat = null; window._dzBase = null;
    baselineFaceTrackerOffsetX = 0; baselineFaceTrackerOffsetY = 0;
    latestDetectedFaceY = 0.5; latestDetectedFaceX = 1.0;
    dollyZoomTime = 1.2 - PHSTEP; updateCameraAndProjection(); render();

    const named = new Map();
    const tag = (m, nm) => { if (m) named.set(m.uuid, nm); };
    try { if (typeof mediaLayers !== 'undefined') mediaLayers.forEach((L, i) => {
            tag(L.mesh, 'mediaLayer[' + i + ']'); tag(L.ghostMesh, 'ghostMesh[' + i + ']'); }); } catch (e) {}
    try { if (typeof mpiFullMeshes !== 'undefined' && mpiFullMeshes)
            mpiFullMeshes.forEach((m, i) => tag(m, 'mpiFull[' + i + ' rank ' + (m.userData && m.userData.v2rank) + ']')); } catch (e) {}
    try { if (typeof mpiStripMeshes !== 'undefined' && mpiStripMeshes)
            mpiStripMeshes.forEach((m, i) => tag(m, 'mpiStrip[' + i + ']')); } catch (e) {}
    try { tag(bgLayerMesh, 'bgLayerMesh'); } catch (e) {}
    try { tag(mpiMidMesh, 'mpiMidMesh'); } catch (e) {}
    try { tag(bgFishtankMesh, 'bgFishtankMesh'); } catch (e) {}
    try { tag(portalPlaneGuide, 'portalPlaneGuide'); } catch (e) {}

    const inv = [], drawable = [];
    scene.traverse((m) => {
      if (!m.isMesh || !m.visible) return;
      const u = m.material && m.material.uniforms;
      const has = (k) => !!(u && u[k]);
      const val = (k, f) => has(k) ? (f ? f(u[k].value) : u[k].value) : null;
      const row = {
        name: named.get(m.uuid) || (m.name || m.type) + ':' + m.uuid.slice(0, 6),
        shader: !!u,
        reproj: has('u_useRayReproject') ? !!u.u_useRayReproject.value : null,
        refEyeZ: has('u_refEye') ? +u.u_refEye.value.z.toFixed(4) : null,
        embed: has('u_embedOffset') ? +Number(u.u_embedOffset.value).toFixed(4) : null,
        dScale: has('u_dollyScale') ? +Number(u.u_dollyScale.value).toFixed(4) : null,
        tris: (m.geometry && m.geometry.index) ? (m.geometry.index.count / 3) | 0
              : (m.geometry && m.geometry.attributes && m.geometry.attributes.position)
                ? (m.geometry.attributes.position.count / 3) | 0 : 0,
      };
      inv.push(row);
      if (row.tris > 100) drawable.push({ mesh: m, name: row.name });
    });
    const camZ = +camera.position.z.toFixed(4);
    const wantScale = +Number(dollySubjectScale).toFixed(4);
    const wantRef = +Number(dollyRefEyeZ === null ? camera.position.z : dollyRefEyeZ).toFixed(4);
    dollyZoomActive = false; dollyRefEyeZ = null;

    // ---------- PART 2: PER-LAYER MOTION ----------
    // Render each substantial mesh ALONE and track its highest-contrast patch.
    const allMeshes = [];
    scene.traverse((m) => { if (m.isMesh) allMeshes.push({ m, wasVisible: m.visible }); });
    const soloResults = [];
    for (const d of drawable) {
      for (const a of allMeshes) a.m.visible = (a.m === d.mesh);
      // engage
      subjectLockActive = true; bgEmbedVolume = true; dollyZoomActive = true;
      dollyRefEyeZ = null; window._dzLat = null; window._dzBase = null;
      baselineFaceTrackerOffsetX = 0; baselineFaceTrackerOffsetY = 0;
      latestDetectedFaceY = 0.5; latestDetectedFaceX = 1.0;
      dollyZoomTime = phases[0] - PHSTEP; updateCameraAndProjection();
      const base = grab(phases[0]);
      // pick the strongest patch on THIS layer, in THIS frame
      let bx = -1, by = -1, bv = -1;
      for (let cy = PS+SR; cy < Hh-PS-SR; cy += 4)
        for (let cx = PS+SR; cx < W-PS-SR; cx += 4) {
          let sm=0,s2=0,n=0;
          for (let y=cy-PS;y<=cy+PS;y+=3) for (let x=cx-PS;x<=cx+PS;x+=3){ const v=base[y*W+x]; sm+=v; s2+=v*v; n++; }
          const varr = s2/n - (sm/n)*(sm/n);
          if (varr > bv) { bv = varr; bx = cx; by = cy; }
        }
      if (bv < 120) { soloResults.push({ name: d.name, skipped: 'nothing with contrast when drawn alone (var ' + Math.round(bv) + ')' });
                      dollyZoomActive = false; dollyRefEyeZ = null; continue; }
      const tmpl = [];
      for (let y=by-PS;y<=by+PS;y++) for (let x=bx-PS;x<=bx+PS;x++) tmpl.push(base[y*W+x]);
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
          const ox=bx+dx, oy=by+dy;
          if (ox-PS<0||ox+PS>=W||oy-PS<0||oy+PS>=Hh) continue;
          let s=0,kk=0;
          for (let y=-PS;y<=PS;y+=2) for (let x=-PS;x<=PS;x+=2){ s+=L[(oy+y)*W+ox+x]; kk++; }
          const mm=s/kk; let num=0,den=0;
          for (let y=-PS;y<=PS;y+=2) for (let x=-PS;x<=PS;x+=2){
            const A=L[(oy+y)*W+ox+x]-mm, B=tmpl[(y+PS)*(2*PS+1)+(x+PS)]-pm; num+=A*B; den+=A*A; }
          const c=num/Math.sqrt(Math.max(1e-9,den)*Math.max(1e-9,pss));
          if (c>bc){ bc=c; bdx=dx; bdy=dy; }
        }
        if (k===0 && (bdx!==0||bdy!==0)) amb = true;
        worst = Math.max(worst, Math.abs(bdx), Math.abs(bdy));
        minc = Math.min(minc, bc); trail.push(bdx+','+bdy);
      }
      dollyZoomActive = false; dollyRefEyeZ = null;
      soloResults.push({ name: d.name, at: bx+','+by, worst, minc:+minc.toFixed(2), amb, trail });
    }
    for (const a of allMeshes) a.m.visible = a.wasVisible;
    subjectLockActive = true;

    return { inv, soloResults, camZ, wantScale, wantRef, W, H: Hh,
             q: +subjectFocalPlaneWorldZ.toFixed(4), emb: +bgEmbedOffsetNow().toFixed(4) };
  }, { mode: process.env.MODE || 'quick' });

  if (r.failed) { console.log('*** ' + r.failed); await browser.close(); srv.kill(); process.exit(3); }
  console.log('\n' + ASSET + '  mode=' + (process.env.MODE||'quick') + '  canvas ' + r.W + 'x' + r.H +
              '   subject q=' + r.q + '  embed=' + r.emb);
  console.log('mid-dolly: camera z ' + r.camZ + ',  refEye SHOULD be ' + r.wantRef +
              ',  dollyScale SHOULD be ' + r.wantScale);
  console.log('\nPART 1  every visible mesh and the law it obeys');
  console.log('  ' + 'mesh'.padEnd(30) + 'tris'.padStart(8) + '  shader  reproj  refEye.z    embed  dollyScale');
  for (const w of r.inv) {
    const f = (v) => v === null ? '   --' : String(v);
    console.log('  ' + w.name.slice(0,29).padEnd(30) + String(w.tris).padStart(8) +
                '  ' + (w.shader ? 'yes' : ' no ').padStart(6) +
                '  ' + f(w.reproj).padStart(6) + '  ' + f(w.refEyeZ).padStart(8) +
                '  ' + f(w.embed).padStart(7) + '  ' + f(w.dScale).padStart(10));
  }
  console.log('\n  A "--" means the material has no such uniform. For a SCALE that is not');
  console.log('  neutral: if the shader declares it and the material omits it, WebGL');
  console.log('  supplies 0.0 and the layer collapses to the eye axis.');
  console.log('\nPART 2  each mesh drawn ALONE across the dolly');
  for (const s of r.soloResults) {
    if (s.skipped) { console.log('  ' + s.name.slice(0,29).padEnd(30) + s.skipped); continue; }
    console.log('  ' + s.name.slice(0,29).padEnd(30) + 'patch (' + s.at + ')  travel ' +
                String(s.worst).padStart(3) + 'px  minCorr ' + String(s.minc).padStart(5) +
                '  [' + s.trail.join('  ') + ']' + (s.amb ? '  [VOID ambiguous]' : ''));
  }
  console.log('\n  Layers that obey the same law must show the same travel for the same');
  console.log('  depth. A layer that differs is one the pin is not reaching.');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
