// A156 WHERE DOES QUICK LOSE ITS DETAIL AT REST?
//
// a152 measured that quick cold loses 31% of its tiles at rest against the
// realtime reference. That is a number, not a cause. This ablates everything
// the quick bake touches, one thing at a time, and re-scores after each: the
// step that restores the detail is the step that destroyed it.
//
// Under ray reprojection the rest pose is the reference eye, so a DEPTH change
// cannot move anything on screen at rest — s scales along the eye ray. That
// makes depth the least likely culprit and the plate/cards/tear the most
// likely, but it is measured rather than assumed.
//
//   node harness/quickloss.js [troll|star|warrior]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const ASSET = process.argv[2] || 'star';
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star: ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };
const OUT = '/tmp/claude-0/-home-user-moebius/989b3965-28fd-58c7-96b5-b4b22c709919/scratchpad/quickloss';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  const res = await page.evaluate(async () => {
    window._rayReproject = true;
    bgViewFadeStartDeg = 35; bgViewFadeEndDeg = 45;
    isSweeping = true;
    const L = mediaLayers[0];
    const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
    const W = 600, Hh = 375, T = 24;
    camera.position.set(0, 0, dist);
    const grab = () => { for (let n = 0; n < 3; n++) render();
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
      return cx.getImageData(0, 0, W, Hh); };
    const tiles = (d) => { const r = [];
      for (let ty = 0; ty + T <= Hh; ty += T) for (let tx = 0; tx + T <= W; tx += T) {
        let s = 0, s2 = 0, n = 0;
        for (let y = ty; y < ty + T; y++) for (let x = tx; x < tx + T; x++) {
          const i = (y * W + x) * 4; if (d[i + 3] < 8) continue;
          const Lu = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          s += Lu; s2 += Lu * Lu; n++; }
        if (n < T * T * 0.5) { r.push(null); continue; }
        const m = s / n; r.push(Math.sqrt(Math.max(0, s2 / n - m * m))); }
      return r; };
    // IS THE REFERENCE ITSELF STABLE? The whole 31% figure rests on this one
    // capture. Take it, render a great deal more, take it again, compare — if
    // the two disagree, the reference was caught before the scene settled and
    // every number derived from it is an artefact of that.
    const ref0 = tiles(grab().data);
    for (let n = 0; n < 40; n++) render();
    const ref = tiles(grab().data);
    let refDrift = 0;
    { let moved = 0, tot = 0;
      for (let i = 0; i < ref.length; i++) {
        if (ref0[i] === null || ref[i] === null || ref0[i] < 3) continue;
        tot++; if (Math.abs(ref[i] - ref0[i]) / ref0[i] > 0.5) moved++; }
      refDrift = +(100 * moved / Math.max(1, tot)).toFixed(2); }
    const refPng = renderer.domElement.toDataURL('image/png');
    const score = (t) => { let lost = 0, tot = 0;
      for (let i = 0; i < ref.length; i++) {
        if (ref[i] === null || t[i] === null || ref[i] < 3) continue;
        tot++; if (t[i] / ref[i] < 0.5) lost++; }
      return +(100 * lost / Math.max(1, tot)).toFixed(2); };

    const out = { steps: [], pngs: {}, refDrift };
    const take = (name) => { const im = grab(); const s = score(tiles(im.data));
      out.steps.push([name, s]); out.pngs[name] = renderer.domElement.toDataURL('image/png'); return s; };

    // remember every FG-side thing the bake replaces, so each can be put back
    const depth0 = L.textures.depth;
    const dispMap0 = L.mesh.material.uniforms.displacementMap
                   ? L.mesh.material.uniforms.displacementMap.value : null;
    const map0 = L.mesh.material.uniforms.map ? L.mesh.material.uniforms.map.value : null;
    // Hash the FG's colour DATA, not its object identity. Every uniform-level
    // ablation failed, which leaves an in-place mutation of the pixels behind
    // the texture — the one thing restoring a uniform cannot undo.
    const hashTex = (t) => {
      try {
        const img = t && (t.image || t.source?.data); if (!img) return null;
        const iw = img.width || img.videoWidth, ih = img.height || img.videoHeight;
        if (!iw || !ih) return null;
        const c = document.createElement('canvas'); c.width = Math.min(256, iw); c.height = Math.min(256, ih);
        const cx = c.getContext('2d', { willReadFrequently: true });
        cx.drawImage(img, 0, 0, c.width, c.height);
        const d = cx.getImageData(0, 0, c.width, c.height).data;
        let h1 = 2166136261, s = 0, s2 = 0, n = 0;
        for (let i = 0; i < d.length; i += 4) {
          h1 ^= d[i]; h1 = Math.imul(h1, 16777619);
          const L2 = 0.2126*d[i] + 0.7152*d[i+1] + 0.0722*d[i+2];
          s += L2; s2 += L2*L2; n++;
        }
        const m = s/n;
        return { hash: (h1 >>> 0), mean: +m.toFixed(3), std: +Math.sqrt(Math.max(0,s2/n - m*m)).toFixed(3) };
      } catch (e) { return { err: e.message }; }
    };
    out.texBefore = hashTex(L.mesh.material.uniforms.map ? L.mesh.material.uniforms.map.value : null);
    // THE DECISIVE ISOLATION. Every ablation of the bake's added meshes leaves
    // the score at ~41%, which is WORSE than the 31% with them shown — so the
    // added geometry is helping and the difference lives in the FOREGROUND MESH
    // itself. Score the foreground ALONE before the bake and again after: that
    // brackets it with nothing else in the frame.
    const fgAlone = () => {
      const hid = [];
      scene.traverse(m => { if (m.isMesh && m !== L.mesh) { hid.push([m, m.visible]); m.visible = false; } });
      const im = grab(); const sc = score(tiles(im));
      for (const [m, v] of hid) m.visible = v;
      return sc;
    };
    out.fgAloneBefore = fgAlone();
    out.matIdBefore = L.mesh.material.uuid;
    out.geoIdBefore = L.mesh.geometry.uuid;
    out.posVerBefore = L.mesh.geometry.attributes.position.version;
    out.uvVerBefore = L.mesh.geometry.attributes.uv ? L.mesh.geometry.attributes.uv.version : -1;
    bgQuickBake = true; bgMPIFullPlanes = false; bgMPIMode = false;
    bgBuildStamp = null; buildBackgroundLayer();
    out.texAfter = hashTex(L.mesh.material.uniforms.map ? L.mesh.material.uniforms.map.value : null);
    // DOES THE BAKED FRAME SETTLE? The reference is stable across 40 extra
    // renders, but the late measurement in this same run scores 0% where the
    // baseline scored 32% — so the thing that moved is the BAKED frame, not the
    // reference. grab() renders three times; the bake creates new textures,
    // targets and materials, and three frames may not be enough for all of them
    // to be uploaded and compiled. Score immediately, then after 40 more.
    out.settleImmediate = score(tiles(grab().data));
    for (let n = 0; n < 40; n++) render();
    out.settleAfter40 = score(tiles(grab().data));
    out.fgAloneAfter = fgAlone();
    out.matIdAfter = L.mesh.material.uuid;
    out.geoIdAfter = L.mesh.geometry.uuid;
    out.posVerAfter = L.mesh.geometry.attributes.position.version;
    out.uvVerAfter = L.mesh.geometry.attributes.uv ? L.mesh.geometry.attributes.uv.version : -1;
    take('quick baked (baseline)');
    // THE POPULATION SPLIT THAT SETTLES IT. The foreground is identical before
    // and after the bake, and hiding every added mesh moves the score by about a
    // point — so the difference cannot be something drawn OVER the picture. What
    // is left is WHERE THE FOREGROUND WAS TORN: those pixels are the plug, and
    // the plug's colour is the pull-push wash, which is blurry by construction.
    // Split the tiles into those that contain plug pixels and those that do not.
    // If the plug-free tiles score ~0, the "detail loss" is the wash showing
    // through the tear, which is the placeholder SD is meant to replace, not a
    // defect in the render.
    {
      // grab() returns an ImageData; tiles() and the loops below index the raw
      // byte array. The first version of this block passed the ImageData
      // straight through, so every comparison was against `undefined`, every
      // tile std came back NaN, and it reported "300 tiles, 0% lost" — a clean
      // zero produced entirely by a type error, which then looked like it
      // contradicted the 32% baseline.
      const full = grab().data;
      const hid = [];
      scene.traverse(m => { if (m.isMesh && m !== L.mesh) { hid.push([m, m.visible]); m.visible = false; } });
      const fgOnly = grab().data;
      for (const [m, v] of hid) m.visible = v;
      // a pixel is PLUG if the foreground alone did not paint it but the full
      // frame did — i.e. the tear opened it and something behind filled it
      const T2 = 24, tw = Math.floor(W / T2);
      const plugTile = [];
      for (let ty = 0; ty + T2 <= Hh; ty += T2) for (let tx = 0; tx + T2 <= W; tx += T2) {
        let hasPlug = false;
        for (let y = ty; y < ty + T2 && !hasPlug; y++) for (let x = tx; x < tx + T2; x++) {
          const i = (y * W + x) * 4;
          if (fgOnly[i + 3] < 8 && full[i + 3] >= 8) { hasPlug = true; break; }
        }
        plugTile.push(hasPlug);
      }
      const t = tiles(full);
      let lostFree = 0, totFree = 0, lostPlug = 0, totPlug = 0;
      for (let i = 0; i < ref.length; i++) {
        if (ref[i] === null || t[i] === null || ref[i] < 3) continue;
        const r = t[i] / ref[i];
        if (plugTile[i]) { totPlug++; if (r < 0.5) lostPlug++; }
        else { totFree++; if (r < 0.5) lostFree++; }
      }
      out.plugSplit = {
        plugFreeTiles: totFree, plugFreeLostPct: +(100 * lostFree / Math.max(1, totFree)).toFixed(2),
        plugTiles: totPlug, plugLostPct: +(100 * lostPlug / Math.max(1, totPlug)).toFixed(2) };
    }
    // ONE CLEAN, ISOLATED ABLATION PER OBJECT. The earlier list was CUMULATIVE
    // and the fishtank came second, so every later row was measured with the
    // tank already hidden — which is itself a large change, since the reference
    // frame has the tank in it. Each row here hides exactly one thing.
    {
      const one = (name, pick) => {
        const hid = [];
        scene.traverse(m => { if (m.isMesh && pick(m)) { hid.push([m, m.visible]); m.visible = false; } });
        if (!hid.length) { out.steps.push(['ONLY ' + name + ' (absent)', null]); return; }
        take('ONLY ' + name + ' hidden');
        for (const [m, v] of hid) m.visible = v;
      };
      one('plate',    m => m === bgLayerMesh);
      one('fishtank', m => typeof bgFishtankMesh !== 'undefined' && m === bgFishtankMesh);
      one('skirt',    m => typeof bgSkirtMesh !== 'undefined' && m === bgSkirtMesh);
      one('cards',    m => typeof bgCardMesh !== 'undefined' && m === bgCardMesh);
    }
    // THE GHOST MESH — the one object a152's ablation never hid, and the only
    // remaining candidate. It is a clone of the layer's geometry AND material
    // with the depth forced flat to the far plane, BackSide, drawn first
    // (renderOrder -5), and its fragment darkened to 30% brightness with alpha
    // forced to 1. A second copy of the sheet compositing under a foreground
    // that is alpha-blended would lower local contrast exactly as measured.
    {
      const gh = [];
      for (const Lr of mediaLayers) if (Lr && Lr.ghostMesh) gh.push([Lr.ghostMesh, Lr.ghostMesh.visible]);
      out.ghostCount = gh.length;
      out.ghostVisible = gh.filter(([m]) => m.visible).length;
      if (gh.length) {
        for (const [m] of gh) m.visible = false;
        take('- ghost mesh');
        for (const [m, v] of gh) m.visible = v;
      } else out.steps.push(['- ghost mesh (none in scene)', null]);
    }
    // the FG's OWN FRAGMENT SHADER — the only place left after every mesh was
    // ablated and the FG's map, depth and index were all restored.
    {
      const u = L.mesh.material.uniforms;
      const flags = ['u_sdHighlight', 'u_bandCutAll', 'u_useEdgeMask', 'u_depthPeekActive',
                     'u_splitPeekActive', 'u_isBackgroundLayer'];
      for (const f of flags) {
        if (!u[f] || u[f].value === false) continue;
        const v0 = u[f].value; u[f].value = false;
        take('- FG uniform ' + f);
        u[f].value = v0;
      }
      out.fgFlags = {};
      for (const f of flags) if (u[f]) out.fgFlags[f] = u[f].value;
    }
    // the POST-PROCESS COMPOSITE. Nothing that was hidden above changed the
    // number, and the lost tiles are the starfield — a broad, fine-detail loss
    // rather than anything geometric. A frame routed through an inpainting
    // chain at a fixed target resolution would look exactly like that.
    if (typeof useInpainting !== 'undefined') {
      const u0 = useInpainting; useInpainting = false;
      take('- inpainting post-process'); useInpainting = u0;
    }
    if (typeof currentInpaintingMethod !== 'undefined') {
      const m0 = currentInpaintingMethod; currentInpaintingMethod = 'none';
      take('- inpainting method -> none'); currentInpaintingMethod = m0;
    }
    // the FG's own depth texture — the a86 float promotion
    if (L.textures.depth !== depth0) {
      const dNew = L.textures.depth, dispNew = L.mesh.material.uniforms.displacementMap.value;
      L.textures.depth = depth0; L.mesh.material.uniforms.displacementMap.value = dispMap0;
      take('- a86 depth promotion (FG depth restored)');
      L.textures.depth = dNew; L.mesh.material.uniforms.displacementMap.value = dispNew;
    } else out.steps.push(['- a86 depth promotion (FG depth unchanged)', null]);
    if (L.mesh.material.uniforms.map && L.mesh.material.uniforms.map.value !== map0) {
      const mNew = L.mesh.material.uniforms.map.value;
      L.mesh.material.uniforms.map.value = map0;
      take('- FG colour texture swap');
      L.mesh.material.uniforms.map.value = mNew;
    } else out.steps.push(['- FG colour (unchanged by the bake)', null]);
    // ablate, cumulatively, cheapest-to-restore first
    if (typeof bgSkirtMesh !== 'undefined' && bgSkirtMesh) { bgSkirtMesh.visible = false; take('- skirt'); }
    if (typeof bgFishtankMesh !== 'undefined' && bgFishtankMesh) { bgFishtankMesh.visible = false; take('- fishtank'); }
    if (typeof bgCardMesh !== 'undefined' && bgCardMesh) { bgCardMesh.visible = false; take('- cap cards'); }
    if (typeof bgLayerMesh !== 'undefined' && bgLayerMesh) { bgLayerMesh.visible = false; take('- plate'); }
    const g = L.mesh.geometry;
    if (g.userData && g.userData._fullIndex) {
      const torn = g.index;
      g.setIndex(g.userData._fullIndex.slice ? new THREE.BufferAttribute(g.userData._fullIndex, 1) : g.userData._fullIndex);
      take('- FG tear (index restored)');
      g.setIndex(torn);
    } else out.steps.push(['- FG tear (no _fullIndex stored)', null]);
    out.dropped = (g.userData && g.userData._fullIndex)
        ? (g.userData._fullIndex.count || g.userData._fullIndex.length) / 3 - g.index.count / 3 : null;
    out.pngs.reference = refPng;
    return out;
  });

  console.log('\n' + ASSET + '  WHERE QUICK LOSES DETAIL AT REST (lost% of tiles vs the realtime reference)');
  for (const [name, s] of res.steps) console.log('  ' + name.padEnd(32) + (s === null ? 'n/a' : s + '%'));
  console.log('\n  BAKED-FRAME SETTLING: ' + res.settleImmediate + '% immediately after the bake, ' +
              res.settleAfter40 + '% after 40 more renders of the same frame');
  console.log('\n  REFERENCE STABILITY: ' + res.refDrift + '% of tiles changed by >50% between the ' +
              'first capture and one 40 renders later (same scene, same pose, nothing touched)');
  if (res.plugSplit) { const p2 = res.plugSplit;
    console.log('\n  TILES CONTAINING PLUG PIXELS vs TILES WITHOUT:');
    console.log('    plug-free tiles: ' + p2.plugFreeTiles + ', lost ' + p2.plugFreeLostPct + '%');
    console.log('    plug tiles:      ' + p2.plugTiles + ', lost ' + p2.plugLostPct + '%'); }
  console.log('\n  FOREGROUND ALONE, before -> after the bake:  ' + res.fgAloneBefore + '% -> ' + res.fgAloneAfter + '%');
  console.log('    material uuid  ' + (res.matIdBefore === res.matIdAfter ? 'SAME' : 'REPLACED'));
  console.log('    geometry uuid  ' + (res.geoIdBefore === res.geoIdAfter ? 'SAME' : 'REPLACED'));
  console.log('    position ver   ' + res.posVerBefore + ' -> ' + res.posVerAfter +
              '     uv ver ' + res.uvVerBefore + ' -> ' + res.uvVerAfter);
  console.log('\n  ghost meshes in scene: ' + res.ghostCount + ' (' + res.ghostVisible + ' visible)');
  console.log('\n  FG colour texture DATA, before -> after the bake:');
  console.log('    ' + JSON.stringify(res.texBefore) + '\n    ' + JSON.stringify(res.texAfter));
  if (res.fgFlags) console.log('\n  FG fragment flags after the bake: ' + JSON.stringify(res.fgFlags));
  if (res.dropped !== null) console.log('\n  FG triangles dropped by the tear: ' + res.dropped);
  for (const [k, v] of Object.entries(res.pngs))
    fs.writeFileSync(path.join(OUT, ASSET + '_' + k.replace(/[^a-z0-9]+/gi, '_') + '.png'),
                     Buffer.from(v.split(',')[1], 'base64'));
  console.log('  shots -> ' + OUT);
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
