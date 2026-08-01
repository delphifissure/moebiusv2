// A188b: IS THE PASS-1 BUFFER ALREADY WRONG, OR ONLY ITS DOWNSAMPLE?
//
// a188 proved the artifact belongs to the pass-1 supersample: rebuild the buffer
// at canvas size and the ghosted astronaut, the stripes and the black wedge all
// disappear. That names the CAUSE but not the ROUTE, and the two routes need
// different fixes:
//
//   (a) THE DOWNSAMPLE. 665x375 -> 380x214 is a 1.75x minification and the
//       pass-1 texture is LinearFilter with no mip chain, so pass 2 takes ONE
//       bilinear tap over a 1.75x1.75 footprint. That is undersampling by
//       definition and it aliases fine texture into low-frequency banding.
//       Fix: give the target a mip chain. The supersample survives.
//
//   (b) THE RENDER. The portal's own buffers are all sized to the CANVAS by
//       onWindowResize, and u_resolution on the layer material is literally
//       renderer.domElement.width/height. Two shaders recover a screen UV as
//       gl_FragCoord.xy / u_resolution and feed it into the test that DISCARDS
//       foreground fragments. At 1.75x that UV is wrong everywhere.
//       Fix: the supersample cannot survive without resizing the whole
//       pipeline, or pass 1 must render at canvas size.
//
// THE TEST SEPARATES THEM WITHOUT AMBIGUITY. Read the pass-1 buffer back at its
// OWN native resolution, before pass 2 has touched it. If the ghost is already
// in those pixels the render is wrong — route (b), and a mip chain would fix
// nothing. If the native buffer is clean and only the canvas-sized result is
// ghosted, it is route (a).
//
// A black wedge and a see-through figure are not what bilinear minification
// produces — aliasing scrambles detail, it does not delete geometry — so (b) is
// the expectation going in. Stated in advance so the result can contradict it.
//
//   node harness/svbuf.js [star|troll|warrior] [quick|v2]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const ASSET = process.argv[2] || 'star';
const MODE = process.argv[3] || 'quick';
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star: ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };
const PITCH = [0, 27];

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
  page.on('console', m => { const t = m.text(); if (/\[SV\] a130 pass-1 buffer/.test(t)) console.log('  ' + t); });
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
    bgViewFadeStartDeg = 35; bgViewFadeEndDeg = 45;
    bgQuickBake = (o.mode === 'quick');
    bgMPIFullPlanes = (o.mode === 'v2'); bgMPIMode = (o.mode === 'v2');
    bgBuildStamp = null; buildBackgroundLayer();

    svState.pip = false; svState.showHud = false; svState.falloff = false;
    svState.active = true; svState.pipShowsRaw = false;
    svState.yawDeg = 0; svState.pitchDeg = 0;
    svRenderFrame();

    const out = { rt: svState.rt.width + 'x' + svState.rt.height,
                  canvas: renderer.domElement.width + 'x' + renderer.domElement.height,
                  ss: svState.ss, urls: {}, res: {} };
    // What u_resolution the layer material is actually carrying while pass 1
    // renders into a buffer of a different size. If these disagree, route (b)
    // has a named mechanism and not just a suspicion.
    try {
      const u = mediaLayers[0].mesh.material.uniforms;
      out.res.uRes = u.u_resolution ? (u.u_resolution.value.x + 'x' + u.u_resolution.value.y) : 'absent';
      out.res.useEdgeMask = u.u_useEdgeMask ? !!u.u_useEdgeMask.value : 'absent';
    } catch (e) { out.res.err = String(e); }

    const readback = () => {
      const rt = svState.rt, W = rt.width, Hh = rt.height;
      const px = new Uint8Array(W * Hh * 4);
      renderer.readRenderTargetPixels(rt, 0, 0, W, Hh, px);
      // WebGL reads bottom-up; put it back the way a canvas expects.
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const g = cv.getContext('2d'); const im = g.createImageData(W, Hh);
      for (let y = 0; y < Hh; y++) {
        const src = (Hh - 1 - y) * W * 4, dst = y * W * 4;
        for (let i = 0; i < W * 4; i++) im.data[dst + i] = px[src + i];
      }
      g.putImageData(im, 0, 0);
      return cv.toDataURL('image/png');
    };
    const canvasShot = () => { const cv = document.createElement('canvas');
      cv.width = renderer.domElement.width; cv.height = renderer.domElement.height;
      cv.getContext('2d').drawImage(renderer.domElement, 0, 0);
      return cv.toDataURL('image/png'); };

    for (const p of o.pitch) {
      svState.pitchDeg = p;
      svRenderFrame(); svRenderFrame();
      out.urls['native' + p] = readback();     // pass 1, at its own resolution
      out.urls['canvas' + p] = canvasShot();   // the same frame after pass 2
    }
    svState.pitchDeg = 0; svState.active = false; svState.pip = true; svState.showHud = true;

    // the plain path at the same eyes, at canvas resolution
    isSweeping = true;
    for (const p of o.pitch) {
      svState.pitchDeg = p; const E = svEye(); svState.pitchDeg = 0;
      camera.position.set(E.x, E.y, E.z);
      for (let n = 0; n < 3; n++) render();
      out.urls['plain' + p] = canvasShot();
    }
    camera.position.set(0, 0, 0.2); render();
    return out;
  }, { pitch: PITCH, mode: MODE });

  console.log('\n  pass-1 buffer ' + r.rt + '   canvas ' + r.canvas + '   ss ' + r.ss.toFixed(3));
  console.log('  layer material u_resolution = ' + r.res.uRes +
    '   u_useEdgeMask = ' + r.res.useEdgeMask);
  console.log('  (u_resolution is set from renderer.domElement in onWindowResize and never');
  console.log('   from the bound target, so during pass 1 it names the wrong buffer.)');
  for (const k of Object.keys(r.urls)) {
    const f = path.join(H, 'svbuf_' + ASSET + '_' + MODE + '_' + k + '.png');
    fs.writeFileSync(f, Buffer.from(r.urls[k].split(',')[1], 'base64'));
  }
  console.log('\n  wrote harness/svbuf_' + ASSET + '_' + MODE + '_{native,canvas,plain}*.png');
  console.log('  native* IS the pass-1 buffer, untouched by pass 2. Ghost present there => the');
  console.log('  RENDER is wrong and a mip chain fixes nothing. Ghost absent => the DOWNSAMPLE is.');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
