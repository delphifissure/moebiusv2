// A161 WHERE DOES THE PLUG FAIL TO REACH?
//
// a160 tears where the mesh folds and hands that footprint to the plug, and
// ~3% of the frame is still uncovered at the user's controls. Two very
// different causes look identical in the render:
//
//   (a) the plug's GEOMETRY is not there — the plate mesh, reprojected, does
//       not cover that screen pixel at all; or
//   (b) the plug's geometry IS there and its FRAGMENT is discarded — the
//       island gate, the source-alpha test, or the stretch cut killed it.
//
// Distinguishing them is the whole diagnosis, and it needs no new metric: render
// the plate alone with its gate forced open and see whether the pixel gets
// painted. If it does, the gate is the problem. If it does not, the geometry is.
//
//   node harness/plugreach.js
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const OUT = '/tmp/claude-0/-home-user-moebius/989b3965-28fd-58c7-96b5-b4b22c709919/scratchpad/plugreach';
const POSES = [{ tag: '35deg', x: 0.140, y: 0.002 }, { tag: '52deg', x: 0.219, y: 0.138 }];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 720, height: 405 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 45; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  const res = await page.evaluate(async (o) => {
    const set = (id, v) => { const el = document.getElementById(id); if (!el) return;
      el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true })); };
    set('fgReachSlider', '60'); set('fgSubThresholdSlider', '0.03');
    set('bgSeedModeSel', '2'); set('bgRelaxModeSel', 'harmonic');
    window._rayReproject = true;
    try { isSweeping = true; } catch (e) {}
    bgQuickBake = true; bgMPIFullPlanes = false; bgMPIMode = false;
    bgBuildStamp = null; buildBackgroundLayer();
    if (typeof bgFishtankMesh !== 'undefined' && bgFishtankMesh) bgFishtankMesh.visible = false;
    const W = 600, Hh = 337;
    const grab = () => { for (let n = 0; n < 3; n++) render();
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
      return cx.getImageData(0, 0, W, Hh).data; };
    const alphaMask = (d) => { const m = new Uint8Array(W * Hh);
      for (let i = 0, p = 0; i < d.length; i += 4, p++) m[p] = d[i + 3] >= 8 ? 1 : 0; return m; };
    const out = { poses: {}, png: {}, gateTest: {} };
    const L = mediaLayers[0];
    // THE INVARIANT'S OWN ACCEPTANCE TEST, stated as the thing it forbids:
    // does the plate ever OVERWRITE A FOREGROUND PIXEL? Render the foreground
    // alone, then the full frame; a pixel the foreground painted whose colour
    // changed in the full frame is a pixel the backstop occluded, which is the
    // violation. No gate toggling, no conflation with hole-filling.
    {
      const others = [];
      for (const p of [{ tag: '0deg', x: 0, y: 0 }].concat(o.poses)) {
        camera.position.set(p.x, p.y, 0.2);
        const full = grab().slice();
        others.length = 0;
        scene.traverse(m => { if (m.isMesh && m !== L.mesh) { others.push([m, m.visible]); m.visible = false; } });
        const fg = grab().slice();
        for (const [m, v] of others) m.visible = v;
        let fgPx = 0, over = 0, worst = 0;
        for (let i = 0; i < fg.length; i += 4) {
          if (fg[i + 3] < 8) continue;
          fgPx++;
          const dm = Math.max(Math.abs(fg[i] - full[i]), Math.abs(fg[i+1] - full[i+1]), Math.abs(fg[i+2] - full[i+2]));
          if (dm > 2) { over++; if (dm > worst) worst = dm; }
        }
        out.gateTest['OVERWRITE ' + p.tag] = {
          uncoveredGateOn: +(100 * over / Math.max(1, fgPx)).toFixed(2),
          uncoveredGateOff: worst, alreadyPaintedPixelsChanged: fgPx };
      }
    }
    // IS THE GATE DOING ANY WORK THE DEPTH TEST DOES NOT ALREADY DO?
    // The plate is a backstop at background depth. Wherever the foreground
    // survives, the plate is BEHIND it and the depth test discards it for free.
    // If that is true, the island gate can only ever act where the foreground is
    // gone — which is a disocclusion, where we want the plate. Measured rather
    // than argued: full render, gate on vs off, at rest and off-axis.
    {
      const U = bgLayerMesh && bgLayerMesh.material.uniforms.u_useBgIslands;
      for (const p of [{ tag: '0deg', x: 0, y: 0 }].concat(o.poses)) {
        camera.position.set(p.x, p.y, 0.2);
        if (U) U.value = true;
        const on = grab().slice();
        if (U) U.value = false;
        const off = grab().slice();
        if (U) U.value = true;
        let unOn = 0, unOff = 0, changed = 0, n = 0;
        for (let i = 0; i < on.length; i += 4) {
          n++;
          if (on[i + 3] < 8) unOn++;
          if (off[i + 3] < 8) unOff++;
          const dm = Math.max(Math.abs(on[i] - off[i]), Math.abs(on[i+1] - off[i+1]), Math.abs(on[i+2] - off[i+2]));
          if (on[i+3] >= 8 && off[i+3] >= 8 && dm > 2) changed++;
        }
        out.gateTest[p.tag] = {
          uncoveredGateOn: +(100 * unOn / n).toFixed(2),
          uncoveredGateOff: +(100 * unOff / n).toFixed(2),
          alreadyPaintedPixelsChanged: +(100 * changed / n).toFixed(2) };
      }
    }
    for (const p of o.poses) {
      camera.position.set(p.x, p.y, 0.2);
      const full = alphaMask(grab());
      // plate alone, gate forced open: does the PLUG's geometry reach here?
      const vis = [];
      scene.traverse(m => { if (m.isMesh && m !== bgLayerMesh) { vis.push([m, m.visible]); m.visible = false; } });
      let gate0 = null;
      if (bgLayerMesh && bgLayerMesh.material.uniforms.u_useBgIslands) {
        gate0 = bgLayerMesh.material.uniforms.u_useBgIslands.value;
        bgLayerMesh.material.uniforms.u_useBgIslands.value = false;
      }
      const plateOpen = alphaMask(grab());
      if (gate0 !== null) bgLayerMesh.material.uniforms.u_useBgIslands.value = gate0;
      const plateGated = alphaMask(grab());
      for (const [m, v] of vis) m.visible = v;
      let un = 0, gateKill = 0, geomMiss = 0;
      for (let i = 0; i < full.length; i++) {
        if (full[i]) continue;
        un++;
        if (plateOpen[i]) gateKill++; else geomMiss++;
      }
      out.poses[p.tag] = {
        uncoveredPct: +(100 * un / full.length).toFixed(2),
        gateKilledPct: +(100 * gateKill / Math.max(1, un)).toFixed(1),
        geometryMissingPct: +(100 * geomMiss / Math.max(1, un)).toFixed(1),
        plateOpenCoverPct: +(100 * plateOpen.reduce((a, b) => a + b, 0) / full.length).toFixed(1),
        plateGatedCoverPct: +(100 * plateGated.reduce((a, b) => a + b, 0) / full.length).toFixed(1) };
      // a map: red = gate killed it, blue = no geometry at all
      camera.position.set(p.x, p.y, 0.2);
      for (let n = 0; n < 3; n++) render();
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
      const im = cx.getImageData(0, 0, W, Hh); const d = im.data;
      for (let i = 0, p2 = 0; i < d.length; i += 4, p2++) {
        if (full[p2]) { const g = (d[i] + d[i+1] + d[i+2]) / 6 + 40; d[i] = d[i+1] = d[i+2] = g; d[i+3] = 255; continue; }
        if (plateOpen[p2]) { d[i] = 255; d[i+1] = 0; d[i+2] = 0; }
        else { d[i] = 0; d[i+1] = 90; d[i+2] = 255; }
        d[i+3] = 255;
      }
      cx.putImageData(im, 0, 0);
      out.png[p.tag] = cv.toDataURL('image/png');
    }
    return out;
  }, { poses: POSES });

  console.log('\nTROLL, QUICK, user controls — WHY IS THE PIXEL UNCOVERED?');
  console.log('  pose     uncovered%   of that: gate discarded   no geometry     plate covers (gate open / gated)');
  for (const [tag, v] of Object.entries(res.poses))
    console.log('  ' + tag.padEnd(9) + String(v.uncoveredPct).padStart(9) +
      String(v.gateKilledPct + '%').padStart(22) + String(v.geometryMissingPct + '%').padStart(15) +
      String(v.plateOpenCoverPct + '% / ' + v.plateGatedCoverPct + '%').padStart(24));
  console.log('\n  DOES THE BACKSTOP EVER OVERWRITE A FOREGROUND PIXEL? (the invariant, directly)');
  for (const [tag, v] of Object.entries(res.gateTest)) if (tag.startsWith('OVERWRITE'))
    console.log('  ' + tag.padEnd(20) + String(v.uncoveredGateOn).padStart(8) + '% of foreground pixels, worst delta ' +
                v.uncoveredGateOff + ' levels (of ' + v.alreadyPaintedPixelsChanged + ' fg px)');
  console.log('\n  IS THE ISLAND GATE DOING WORK THE DEPTH TEST DOES NOT?');
  console.log('  pose      uncovered% gate ON   gate OFF   already-painted pixels that CHANGED');
  for (const [tag, v] of Object.entries(res.gateTest)) if (!tag.startsWith('OVERWRITE'))
    console.log('  ' + tag.padEnd(9) + String(v.uncoveredGateOn).padStart(15) +
      String(v.uncoveredGateOff).padStart(11) + String(v.alreadyPaintedPixelsChanged + '%').padStart(38));
  for (const [tag, png] of Object.entries(res.png))
    fs.writeFileSync(path.join(OUT, 'why_' + tag + '.png'), Buffer.from(png.split(',')[1], 'base64'));
  console.log('\n  maps -> ' + OUT + '   (red = plug geometry there but discarded, blue = no plug geometry)');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
