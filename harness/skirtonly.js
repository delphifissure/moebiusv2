// A150 diagnostic: how many pixels does the skirt ALONE paint, a149 vs a150?
// Hides the plate and the FG so the only thing that can mark the framebuffer is
// the skirt. If a150 paints fewer pixels than a149, the far-envelope depth is
// removing the skirt rather than repositioning it.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
(async () => {
  fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
  page.on('pageerror', e => console.log('[PAGEERR] ' + e.message.slice(0, 200)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  const res = await page.evaluate(async (ed) => {
    window._rayReproject = true;
    bgViewFadeStartDeg = 35; bgViewFadeEndDeg = 45;
    if (ed.edgeDepth) window._skirtEdgeDepth = true;
    if (ed.noInset) window._skirtNoInset = true;
    bgQuickBake = true; bgMPIFullPlanes = false; bgMPIMode = false;
    bgBuildStamp = null; buildBackgroundLayer();
    isSweeping = true;
    const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
    const W = 600, Hh = 375;
    const count = () => { for (let n = 0; n < 3; n++) render();
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
      const d = cx.getImageData(0, 0, W, Hh).data; let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] >= 8) n++;
      return +(100 * n / (W * Hh)).toFixed(2); };
    const out = {};
    // everything on, for reference
    // Hide EVERY other object in the scene, not just the plate and the FG.
    // The first version of this instrument hid two meshes and left the cap
    // cards standing, so a skirt pushed BEHIND the cards read as "not painting"
    // when it was merely occluded. Walk the graph.
    const others = [];
    scene.traverse(o => { if (o.isMesh && o !== bgSkirtMesh) others.push([o, o.visible]); });
    for (const [m] of others) m.visible = false;
    for (const deg of [0, 25, 45]) {
      camera.position.set(dist * Math.tan(deg * Math.PI / 180), 0, dist);
      out['skirtOnly_' + deg] = count();
    }
    // Which uniform diverged? Compare the clone against the plate material
    // value by value after a render, rather than guessing which one matters.
    {
      render();
      const a = bgSkirtMesh.material.uniforms, b = bgLayerMesh.material.uniforms;
      const diff = [];
      for (const k of Object.keys(b)) {
        const va = a[k] && a[k].value, vb = b[k] && b[k].value;
        if (va === vb) continue;
        const num = (x) => (typeof x === 'number' || typeof x === 'boolean');
        if (num(va) && num(vb)) { if (va !== vb) diff.push(k + ': skirt ' + va + ' vs plate ' + vb); continue; }
        if (va && vb && va.isVector2 || va && va.isVector3) {
          if (va.equals && vb && va.equals(vb)) continue; diff.push(k + ': vector differs'); continue; }
        diff.push(k + ': ' + (va === undefined ? 'MISSING' : typeof va) + ' vs ' + (typeof vb));
      }
      out.uniformDiff = diff;
      out.progA = !!bgSkirtMesh.material.program; out.needsUpdate = bgSkirtMesh.material.version;
      out.plateVersion = bgLayerMesh.material.version;
      out.skirtDefines = JSON.stringify(bgSkirtMesh.material.defines) === JSON.stringify(bgLayerMesh.material.defines);
      out.fragSame = bgSkirtMesh.material.fragmentShader === bgLayerMesh.material.fragmentShader;
      out.vertSame = bgSkirtMesh.material.vertexShader === bgLayerMesh.material.vertexShader;
      out.sideSame = bgSkirtMesh.material.side === bgLayerMesh.material.side;
      out.transparentSame = bgSkirtMesh.material.transparent === bgLayerMesh.material.transparent;
      out.depthWriteSame = bgSkirtMesh.material.depthWrite === bgLayerMesh.material.depthWrite;
    }
    // Decisive split: is it the CLONED MATERIAL or the FAR DEPTH? Swap the
    // clone's depth texture back to the plate's and re-count with the same
    // mesh, same material object, same geometry.
    if (bgSkirtMesh.userData.ownsMaterial && bgLayerMesh) {
      const far = bgSkirtMesh.material.uniforms.displacementMap.value;
      bgSkirtMesh.material.uniforms.displacementMap.value =
          bgLayerMesh.material.uniforms.displacementMap.value;
      for (const deg of [0, 45]) {
        camera.position.set(dist * Math.tan(deg * Math.PI / 180), 0, dist);
        out['cloneWithPlateDepth_' + deg] = count();
      }
      bgSkirtMesh.material.uniforms.displacementMap.value = far;
    }
    for (const [m, v] of others) m.visible = v;
    // and the skirt's post-displacement world Z, read straight off the shader inputs
    const u = bgSkirtMesh.material.uniforms;
    out.camFar = camera.far; out.camNear = camera.near; out.camZ = camera.position.z;
    out.dispScale = u.displacementScale ? u.displacementScale.value : null;
    out.dispBias = u.displacementBias ? u.displacementBias.value : null;
    out.outerVol = u.u_worldOuterVolumeDepth ? u.u_worldOuterVolumeDepth.value : null;
    out.innerVol = u.u_worldInnerVolumeDepth ? u.u_worldInnerVolumeDepth.value : null;
    out.portalNorm = u.u_portalPlaneDepthNorm ? u.u_portalPlaneDepthNorm.value : null;
    out.meshZ = bgSkirtMesh.position.z;
    out.useBgIslands = u.u_useBgIslands ? u.u_useBgIslands.value : null;
    camera.position.set(0, 0, dist); render();
    return out;
  }, { edgeDepth: process.env.EDGEDEPTH === '1', noInset: process.env.NOINSET === '1' });
  console.log((process.env.EDGEDEPTH === '1' ? 'depth=EDGE (a149)' : 'depth=FAR-ENVELOPE') +
              '  ' + (process.env.NOINSET === '1' || process.env.EDGEDEPTH === '1' ? 'inset=0' : 'inset=k') +
              '  ' + JSON.stringify(res));
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
