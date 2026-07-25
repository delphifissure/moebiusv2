// A119: READ THE FG-SUB MASK BUFFER DIRECTLY. NO DEBUG VIEWS.
//
// Three instruments in a row gave wrong answers to "how much of the frame does
// the mask claim, and of what":
//   1. hide-the-FG-mesh classification — realtime has no plate mesh at all, so
//      nothing ever classified as gap (0.00% everywhere, structurally).
//   2. luma>128 on the 'gaps' view — catches bright CONTENT as well as gaps;
//      flattered by the troll being dark.
//   3. diff('final','gaps') — the 'gaps' view renders pingPongRenderTargetB,
//      which is a DIFFERENT PASS with its own tone/letterbox, not the same
//      frame minus the fill. It scored 63.73% at rest, which is nonsense.
//
// The mask buffer encodes the populations explicitly, so read it. From the
// seed/flood/mark shaders:
//     A < 0.5                      valid pixel (mesh covers it)
//     A > 0.5, B < 0.5/64          INTERIOR GAP   <- a real disocclusion
//     A > 0.5, B > 0.995           out-of-mesh border void (outpaint)
//     A > 0.5, else                MARKED FG OCCLUDER (the reach dilation)
// BUDGET_NORM = 64.0 and MARK_ITERATIONS = 64 in the shader.
//
// The SD bundle exports fgMaskTargetA wholesale, so occluders ship as if they
// were disocclusions. This measures each population separately, across the
// cone, so the claim "the mask spills into places with no disocclusion" gets a
// number per class instead of one blended figure.
//
//   node harness/fgmask.js [troll|star|warrior]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const OUTD = '/workspace/moebiusv2/harness/val';
const SRC = { troll:   ['defaultImgColor.png', 'defaultImgDepth.png'],
              star:    ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };
const ASSET = process.argv[2] || 'troll';

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 140)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  const out = await page.evaluate(async (reachSweep) => {
    // A120b: THE MESH MUST BE TORN BEFORE COVERAGE MEANS ANYTHING.
    // The first a120 run measured interiorGap = 0.00% at EVERY pose, because
    // it ran with no bake: an intact connected mesh has no coverage holes at
    // all, it just stretches across the reveal. Holes are created by the CUT.
    // So bake first (a117 cliff tear, ~0.5% of triangles) and then ask what
    // the coverage pass sees.
    window._rayReproject = true;
    bgQuickBake = true; bgMPIFullPlanes = false; bgMPIMode = false;
    bgBuildStamp = null; buildBackgroundLayer();
    isSweeping = true;
    const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
    const q = postProcessScene.children[0];
    // classifier: fgMaskTargetA -> 8-bit RGB, one channel per population
    const mat = new THREE.ShaderMaterial({
      uniforms: { tMask: { value: null } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position,1.0); }',
      fragmentShader: `
        uniform sampler2D tMask; varying vec2 vUv;
        const float BUDGET_NORM = 64.0;
        void main(){
          vec4 c = texture2D(tMask, vUv);
          float interiorGap = 0.0, borderVoid = 0.0, occluder = 0.0;
          if (c.a > 0.5) {
            if (c.b < (0.5/BUDGET_NORM)) interiorGap = 1.0;
            else if (c.b > 0.995)        borderVoid = 1.0;
            else                          occluder  = 1.0;
          }
          gl_FragColor = vec4(interiorGap, occluder, borderVoid, 1.0);
        }`,
      depthWrite: false, depthTest: false
    });
    const thrEl = document.getElementById('fgSubThresholdSlider');
    const reachEl = document.getElementById('fgReachSlider');
    const sample = () => {
      renderNormalizedDepthPass();
      if (window._legacyGapPass !== true && typeof renderGeometricGapPass === 'function') renderGeometricGapPass();
      const thr = parseFloat(thrEl?.value || '0.05');
      if (!runFGSubtraction(pingPongRenderTargetB?.texture || null, true, thr)) return null;
      const w = fgMaskTargetA.width, h = fgMaskTargetA.height;
      const rt = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter, format: THREE.RGBAFormat, type: THREE.UnsignedByteType });
      const prev = q.material; q.material = mat; mat.uniforms.tMask.value = fgMaskTargetA.texture;
      renderer.setRenderTarget(rt); renderer.clear();
      renderer.render(postProcessScene, postProcessCamera);
      const buf = new Uint8Array(w*h*4);
      renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
      renderer.setRenderTarget(null); q.material = prev; rt.dispose();
      let gi = 0, oc = 0, bv = 0;
      for (let i = 0; i < w*h; i++) { if (buf[i*4] > 127) gi++; if (buf[i*4+1] > 127) oc++; if (buf[i*4+2] > 127) bv++; }
      const N = w*h;
      return { gap: +(100*gi/N).toFixed(2), occl: +(100*oc/N).toFixed(2), border: +(100*bv/N).toFixed(2) };
    };
    const byGapPass = [];
    camera.position.set(0, 0, dist);
    for (const legacy of [true, false]) {
      window._legacyGapPass = legacy;
      for (let n = 0; n < 3; n++) render();
      const s = sample(); if (s) byGapPass.push(Object.assign({ legacy }, s));
    }
    window._legacyGapPass = false;
    const byPose = [];
    for (const frac of [0.0, 0.15, 0.30, 0.52, 0.70, 0.85]) {
      camera.position.set(frac * dist * Math.tan(60*Math.PI/180), 0, dist);
      for (let n = 0; n < 3; n++) render();
      const s = sample(); if (s) byPose.push(Object.assign({ frac }, s));
    }
    // IS THE REST-POSE GAP THE BAND CUT? At rest the reprojection is identity
    // and no surface can be revealed, so any interior gap is something the
    // pipeline CUT on purpose. u_useBandCut is the band-gated FG cut; turn it
    // off and re-measure the same pose.
    const byCut = [];
    camera.position.set(0, 0, dist);
    for (const on of [true, false]) {
      setAllLayerUniforms('u_useBandCut', on);
      for (let n = 0; n < 3; n++) render();
      const s = sample(); if (s) byCut.push(Object.assign({ bandCut: on }, s));
    }
    setAllLayerUniforms('u_useBandCut', true);
    // does the occluder band track the reach constant?
    const byReach = [];
    camera.position.set(0, 0, dist);
    const reach0 = reachEl ? reachEl.value : null;
    for (const r of reachSweep) {
      if (reachEl) { reachEl.value = String(r); reachEl.dispatchEvent(new Event('input')); }
      for (let n = 0; n < 3; n++) render();
      const s = sample(); if (s) byReach.push(Object.assign({ reach: r }, s));
    }
    if (reachEl && reach0 !== null) { reachEl.value = reach0; reachEl.dispatchEvent(new Event('input')); }
    camera.position.set(0, 0, dist); render();
    return { byPose, byReach, byCut, byGapPass, reachDefault: reach0,
             maskSize: [fgMaskTargetA.width, fgMaskTargetA.height] };
  }, [0, 10, 30, 60, 120, 240]);
  console.log('\n' + ASSET + '  FG-SUB MASK POPULATIONS (read from the buffer, % of mask area)');
  console.log('  mask ' + out.maskSize.join('x') + ', default fgReach = ' + out.reachDefault);
  console.log('\n  AT REST, gap buffer source (A120):');
  console.log('    gapPass              interiorGap%   occluderBand%   borderVoid%');
  for (const r of (out.byGapPass||[])) console.log('    ' +
    (r.legacy ? 'legacy edge-detector' : 'a120 geometric      ').padEnd(21) +
    String(r.gap).padStart(9) + String(r.occl).padStart(15) + String(r.border).padStart(13));
  console.log('\n  ACROSS THE CONE (reach at default):');
  console.log('    rim frac   interiorGap%   occluderBand%   borderVoid%');
  for (const r of out.byPose) console.log('    ' + String(r.frac).padEnd(11) +
    String(r.gap).padStart(11) + String(r.occl).padStart(15) + String(r.border).padStart(13));
  console.log('\n  AT REST, band-gated FG cut on vs off:');
  console.log('    bandCut   interiorGap%   occluderBand%   borderVoid%');
  for (const r of (out.byCut||[])) console.log('    ' + String(r.bandCut).padEnd(10) +
    String(r.gap).padStart(10) + String(r.occl).padStart(15) + String(r.border).padStart(13));
  console.log('\n  AT REST, sweeping fgReachSlider (px of reach per unit depth step):');
  console.log('    reach   interiorGap%   occluderBand%   borderVoid%');
  for (const r of out.byReach) console.log('    ' + String(r.reach).padEnd(8) +
    String(r.gap).padStart(11) + String(r.occl).padStart(15) + String(r.border).padStart(13));
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
