// A164 THE INVARIANT, PROVEN IN A DEPTH BUFFER RATHER THAN ON PAPER
//
// a162 derives the cross-texel ordering invariant and enforces it on the plate
// depth, but the only evidence it landed is a bake statistic (367060 texels
// pushed back). The a162 note recorded that a COLOUR comparison cannot verify
// it, because the foreground is alpha-blended at its silhouette edges and the
// backstop legitimately composites through — that is antialiasing, not
// occlusion. The right instrument compares DEPTHS.
//
//   foreground alone   -> depth buffer D_fg, and where it has geometry
//   full scene         -> depth buffer D_all
//   violation          -> D_all NEARER than D_fg where D_fg has geometry
//
// A backstop is behind by definition, so on a correct build that count is zero
// at every pose. Run with and without window._noCrossTexelOrder to price a162.
//
// It also settles the last open ablation on the 31% detail loss: the GHOST MESH
// is the one object never hidden in a152's run, and a second alpha-blended copy
// of the sheet would raise the mean and drop the local variance exactly as
// measured. Hidden here and re-scored.
//
//   node harness/depthorder.js
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
// bracket the cone rim: bgViewFadeEndDeg is 45, and the invariant only
// promises anything INSIDE it, so 43/45/47 is where the promise should end.
const T = (deg) => 0.2 * Math.tan(deg * Math.PI / 180);
// A186 THE VERTICAL AXIS WAS NEVER IN THIS PROOF. Every pose below the first
// group has y: 0 — a164 declared "zero violations at every pose INSIDE the cone"
// on the strength of six HORIZONTAL poses. The invariant itself is derived from
// screen(x,d) = f*(x/D - ex*g(d)) with ex the LATERAL eye offset, so whether it
// covers vertical motion was assumed, never measured.
//
// The user reports the BG WASH DRAWING IN FRONT of the astronaut and the dune
// party as the eye rises — which is precisely an ordering violation, on the axis
// this proof never visited.
const POSES = [{ tag: 'rest', x: 0, y: 0 }, { tag: 'H 35deg', x: T(35), y: 0 },
               { tag: 'H 43deg', x: T(43), y: 0 }, { tag: 'H 45deg', x: T(45), y: 0 },
               { tag: 'H 47deg', x: T(47), y: 0 }, { tag: 'H 55deg', x: T(55), y: 0 },
               // A186: the same angles on the VERTICAL axis, both signs
               { tag: 'V +20deg', x: 0, y: T(20) }, { tag: 'V +27deg', x: 0, y: T(27) },
               { tag: 'V +35deg', x: 0, y: T(35) }, { tag: 'V +45deg', x: 0, y: T(45) },
               { tag: 'V -20deg', x: 0, y: -T(20) }, { tag: 'V -27deg', x: 0, y: -T(27) },
               { tag: 'V -35deg', x: 0, y: -T(35) }, { tag: 'V -45deg', x: 0, y: -T(45) },
               // and the user's own reported pose, scaled to this eye distance
               { tag: 'USER', x: 0.024 * (0.2 / 0.177), y: 0.090 * (0.2 / 0.177) }];

(async () => {
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
  const run = async (noOrder) => page.evaluate(async (o) => {
    const set = (id, v) => { const el = document.getElementById(id); if (!el) return;
      el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true })); };
    set('fgReachSlider', '60'); set('fgSubThresholdSlider', '0.03');
    set('bgSeedModeSel', '2'); set('bgRelaxModeSel', 'harmonic');
    window._rayReproject = true;
    window._noCrossTexelOrder = !!o.noOrder;
    try { isSweeping = true; } catch (e) {}
    bgQuickBake = true; bgMPIFullPlanes = false; bgMPIMode = false;
    bgBuildStamp = null; buildBackgroundLayer();
    if (typeof bgFishtankMesh !== 'undefined' && bgFishtankMesh) bgFishtankMesh.visible = false;
    const L = mediaLayers[0];
    const depth = () => {
      // renderNormalizedDepthPass HIDES the background layer by design (the gap
      // pipeline must keep seeing the foreground's holes). Without this the test
      // compares the foreground against itself — which is exactly what the
      // known-positive control caught: shoving the plate 0.05 toward the viewer
      // moved nothing. _depthPassIncludeBG is the switch the debug sheet uses.
      _depthPassIncludeBG = true;
      renderNormalizedDepthPass();
      const rt = screenNormalizedDepthTarget, W = rt.width, Hh = rt.height;
      const tmp = new THREE.WebGLRenderTarget(W, Hh, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat });
      const q = postProcessScene.children[0], prev = q.material;
      q.material = copyMaterial; copyMaterial.uniforms.tDiffuse.value = rt.texture;
      renderer.setRenderTarget(tmp); renderer.setViewport(0, 0, W, Hh); renderer.clear();
      renderer.render(postProcessScene, postProcessCamera);
      const px = new Uint8Array(W * Hh * 4);
      renderer.readRenderTargetPixels(tmp, 0, 0, W, Hh, px);
      renderer.setRenderTarget(null); q.material = prev; tmp.dispose();
      _depthPassIncludeBG = false;
      return { px, W, H: Hh };
    };
    const out = {};
    for (const p of o.poses) {
      camera.position.set(p.x, p.y, 0.2);
      for (let n = 0; n < 3; n++) render();
      // A186b THE FRAMES ARE NOT CONTENT, AND COUNTING THEM SATURATED THIS TEST.
      // a153's fishtank walls are opaque geometry NEARER than the content behind
      // them, so from any off-axis pose the tank registers as "something in front
      // of the foreground" — which is true and completely uninteresting. It shows
      // up as horizontal-only because the tank only intrudes on that axis here,
      // and it made the live build (32.6% at H35) indistinguishable from the
      // deliberately-broken control (36.5%). A test whose control matches its
      // subject is measuring nothing. Frames are excluded from BOTH passes; the
      // question is whether CONTENT draws in front of content.
      const frames = [];
      for (const fm of [(typeof bgFishtankMesh !== 'undefined') ? bgFishtankMesh : null,
                        (typeof bgOuterFrameMesh !== 'undefined') ? bgOuterFrameMesh : null]) {
        if (fm) { frames.push([fm, fm.visible]); fm.visible = false; }
      }
      for (let n = 0; n < 2; n++) render();
      const all = depth();
      const hidden = [];
      scene.traverse(m => { if (m.isMesh && m !== L.mesh) { hidden.push([m, m.visible]); m.visible = false; } });
      for (let n = 0; n < 3; n++) render();
      const fg = depth();
      for (const [m, v] of hidden) m.visible = v;
      for (const [fm, v] of frames) fm.visible = v;
      // the depth pass writes 0 where nothing is drawn (cleared); alpha marks it
      let fgPx = 0, viol = 0, worst = 0;
      for (let i = 0; i < fg.px.length; i += 4) {
        const dFg = fg.px[i], dAll = all.px[i];
        if (dFg === 0) continue;              // foreground drew nothing here
        fgPx++;
        // normalized depth: larger = nearer in this pass. Something in front of
        // the foreground reads a LARGER value than the foreground alone.
        const d = dAll - dFg;
        if (d > 2) { viol++; if (d > worst) worst = d; }
      }
      // KNOWN-POSITIVE CONTROL. A test that reports zero is worthless until it
      // has been shown to report non-zero on a case that is broken BY
      // CONSTRUCTION. Shove the plate bodily toward the viewer and re-measure:
      // if the instrument cannot see that, it cannot see anything.
      let ctrl = null;
      if (bgLayerMesh) {
        const z0 = bgLayerMesh.position.z;
        bgLayerMesh.position.z = z0 + 0.05;
        for (let n = 0; n < 3; n++) render();
        const bad = depth();
        bgLayerMesh.position.z = z0;
        let cv = 0, cn = 0;
        for (let i = 0; i < fg.px.length; i += 4) {
          if (fg.px[i] === 0) continue; cn++;
          if (bad.px[i] - fg.px[i] > 2) cv++;
        }
        ctrl = +(100 * cv / Math.max(1, cn)).toFixed(2);
      }
      out[p.tag] = { fgPx, violPct: +(100 * viol / Math.max(1, fgPx)).toFixed(3),
                     worstLevels: worst, controlPct: ctrl };
    }
    return out;
  }, { poses: POSES, noOrder });

  const withOrder = await run(false);
  const without = await run(true);
  console.log('\nTROLL, quick, user controls — DOES ANYTHING RENDER IN FRONT OF THE FOREGROUND?');
  console.log('  (depth buffers compared, not colours, so silhouette antialiasing cannot register)');
  console.log('  pose     fg px    a162 ON: viol%  worst  |  a162 OFF: viol%  worst  |  CONTROL (plate shoved 0.05 forward)');
  for (const tag of Object.keys(withOrder)) {
    const a = withOrder[tag], b = without[tag];
    console.log('  ' + tag.padEnd(8) + String(a.fgPx).padStart(8) + String(a.violPct).padStart(16) +
                String(a.worstLevels).padStart(7) + '  |' + String(b.violPct).padStart(16) +
                String(b.worstLevels).padStart(7) + '  |' + String(a.controlPct + '%').padStart(12));
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
