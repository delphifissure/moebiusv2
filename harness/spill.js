// A170: THE WINDOW WITHIN THE WINDOW — DOES ANYTHING ACTUALLY BREAK THE FRAME?
//
// Two rules from the user, which are the two halves of one rule:
//   windowed   — "keep everything inside the box ... nothing poking through"
//   fullscreen — "our content can spill out beyond the letterbox or pillar box
//                 (but only the immersive content of course)"
//
// So this measures, at each pose, the CONTENT pixels lying strictly outside the
// projected outer aperture. Windowed that number must be 0. Fullscreen it must
// be > 0 and must be the INNER VOLUME and nothing else.
//
// Two instrument notes, both of which cost a wrong answer first:
//
//  1. "Painted" cannot be a brightness test. The outer matte is the PAGE COLOUR
//     (white here) and the renderer's clear is opaque, so a bright-pixel test
//     scored the frame itself as content and reported 100% spill at rest with
//     the matte ON. Content is identified DIFFERENTIALLY instead: render the
//     scene, render it again with everything hidden EXCEPT the two frames, and
//     call a pixel content wherever they differ. Exact, no threshold.
//
//  2. Fullscreen is driven for real — requestFullscreen() from a genuine
//     Playwright click, so document.fullscreenElement is actually set and
//     bgIsFullscreen() is exercised rather than stubbed. If the headless shell
//     refuses, the run SAYS SO and does not report fullscreen numbers.
//
// The third arm is the control: fullscreen with innerVolumeDepth driven to 0.
// If the spill is the inner volume, it must vanish; if it survives, the spill is
// something else (the extension apron) wearing the inner volume's name.
//
//   node harness/spill.js [troll|star|warrior] [v2|quick]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const ASSET = process.argv[2] || 'troll';
const MODE = process.argv[3] || 'v2';
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star: ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };
const DEGS = [0, 25, 45];

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  const served = await page.evaluate(() => (typeof MOEBIUS_BUILD === 'string') ? MOEBIUS_BUILD : null);
  const onDisk = (fs.readFileSync(path.join(WT, 'moebius.js'), 'utf8')
                    .match(/MOEBIUS_BUILD\s*=\s*'([^']+)'/) || [])[1] || null;
  console.log('served build = ' + served + (served === onDisk ? ' (matches this tree)'
              : '  *** TREE SAYS ' + onDisk + ' ***'));

  // one-time setup: build the requested mode
  await page.evaluate(async (mode) => {
    window._rayReproject = true;
    bgViewFadeStartDeg = 35; bgViewFadeEndDeg = 45;
    bgQuickBake = (mode === 'quick');
    bgMPIFullPlanes = (mode === 'v2'); bgMPIMode = (mode === 'v2');
    bgBuildStamp = null; buildBackgroundLayer();
    isSweeping = true;
    window.__fsHook = () => { document.documentElement.requestFullscreen().catch(() => {}); };
    document.body.addEventListener('click', window.__fsHook);
  }, MODE);

  const measure = (degs) => page.evaluate(async (o) => {
    const L = mediaLayers[0];
    const gp = L.mesh.geometry.parameters || {};
    const hw = gp.width * (L.mesh.scale.x || 1) / 2, hh = gp.height * (L.mesh.scale.y || 1) / 2;
    const cx = L.mesh.position.x, cy = L.mesh.position.y, zN = L.mesh.position.z;
    const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
    const W = 640, Hh = 400;
    const corners = () => [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => {
      const v = new THREE.Vector3(cx + x, cy + y, zN).project(camera);
      return [(v.x * 0.5 + 0.5) * W, (1 - (v.y * 0.5 + 0.5)) * Hh];
    });
    const inQuad = (P, px, py) => { let s = 0;
      for (let i = 0; i < 4; i++) { const [ax, ay] = P[i], [bx, by] = P[(i + 1) % 4];
        const c = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
        if (c > 0) s++; else if (c < 0) s--; }
      return Math.abs(s) === 4; };
    const grab = () => { for (let n = 0; n < 3; n++) render();
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const cxt = cv.getContext('2d'); cxt.drawImage(renderer.domElement, 0, 0, W, Hh);
      return cxt.getImageData(0, 0, W, Hh).data; };
    const keepSet = () => new Set([bgFishtankMesh, bgOuterFrameMesh].filter(Boolean));
    const bareFrames = () => {
      const keep = keepSet(); const saved = [];
      scene.traverse(ob => { if (ob === scene || ob.visible === undefined) return;
        let anc = ob, isFrame = false;
        while (anc) { if (keep.has(anc)) { isFrame = true; break; } anc = anc.parent; }
        if (!isFrame) { saved.push([ob, ob.visible]); ob.visible = false; } });
      const d = grab();
      for (const [ob, v] of saved) ob.visible = v;
      return d; };

    const rows = [];
    for (const deg of o.degs) {
      camera.position.set(dist * Math.tan(deg * Math.PI / 180), 0, dist);
      const d = grab(), bare = bareFrames(), P = corners();
      let outC = 0, outT = 0, inC = 0, inT = 0;
      for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const content = Math.abs(d[i] - bare[i]) + Math.abs(d[i+1] - bare[i+1]) +
                        Math.abs(d[i+2] - bare[i+2]) + Math.abs(d[i+3] - bare[i+3]) > 8;
        if (inQuad(P, x + 0.5, y + 0.5)) { inT++; if (content) inC++; }
        else { outT++; if (content) outC++; }
      }
      rows.push({ deg, outside: outC,
        outsidePct: +(100 * outC / Math.max(1, outT)).toFixed(3),
        insidePct: +(100 * inC / Math.max(1, inT)).toFixed(2), apertureAreaPx: inT });
    }
    camera.position.set(0, 0, dist); render();
    // A171: the arm MUST be shown to have diverged. If the outer matte is still
    // standing in the fullscreen arm then the containment number is the matte's,
    // not the crop's, and the whole change is inert while looking like a pass.
    return { rows, fs: !!document.fullscreenElement, embed: bgEmbedOffsetNow(),
             inner: innerVolumeDepth, outer: outerVolumeDepth,
             matte: (typeof bgOuterFrameMesh !== 'undefined' && !!bgOuterFrameMesh),
             // the EFFECTIVE uniform, read off a live material — not bgAperture.crop,
             // which is the build's intent and would mislabel an override arm
             crop: (function () { try {
                 return mediaLayers[0].mesh.material.uniforms.u_apertureCrop.value;
             } catch (e) { return null; } })(),
             pop: (typeof bgAperture !== 'undefined' && bgAperture) ? (bgAperture.popExtra || 0) : 0,
             // A174: with the taper the near extent AT THE FRAME CENTRE is
             // exactly popExtra (the request equals the centre's own bound, so
             // the clamp is tight there); at the border it is 0 by construction.
             nearestZOff: bgEmbedOffsetNow() + Math.max(0, innerVolumeDepth) +
                          ((typeof bgAperture !== 'undefined' && bgAperture) ? (bgAperture.popExtra || 0) : 0) };
  }, { degs });

  const arms = [];
  arms.push(['windowed', await measure(DEGS)]);

  // real fullscreen, via a real click
  await page.mouse.click(5, 5);
  await new Promise(r => setTimeout(r, 600));
  const wentFs = await page.evaluate(() => !!document.fullscreenElement);
  if (!wentFs) {
    console.log('\n  *** requestFullscreen() was REFUSED by this headless shell.');
    console.log('  *** The fullscreen arms are NOT reported — a stubbed bgIsFullscreen would');
    console.log('  *** be testing the stub, not the build.');
  } else {
    await page.evaluate(() => { bgEnsureFishtank(); });
    arms.push(['FULLSCREEN', await measure(DEGS)]);
    // A172 THE CONTROL. With nothing protruding, "outside == 0" in fullscreen is
    // ALSO what you would measure if the apron simply were not there — so zero
    // on its own proves nothing. Force the crop OFF with the matte still gone:
    // if the crop is what bounds the apron, this must blow up to ~100%.
    await page.evaluate(() => {
      window.__realSync = bgSyncApertureUniforms;
      window.bgSyncApertureUniforms = function (u) {
        window.__realSync(u);
        if (u && u.u_apertureCrop) u.u_apertureCrop.value = 0.0;
      };
    });
    arms.push(['FS crop OFF', await measure(DEGS)]);
    await page.evaluate(() => { window.bgSyncApertureUniforms = window.__realSync; });
    // A174 ISOLATION. The shader gained a branch as well as a pop-out. If the
    // leak survives with the pop-out off, it is the branch (or the instrument);
    // if it vanishes, it is the pop-out.
    if (typeof (await page.evaluate(() => typeof bgPopOut)) === 'string') {
      await page.evaluate(() => { bgPopOut = false; _bgFishtankKey = ''; bgEnsureFishtank(); });
      arms.push(['FS pop=0', await measure(DEGS)]);
      await page.evaluate(() => { bgPopOut = true; _bgFishtankKey = ''; bgEnsureFishtank(); });
    }
  }

  const pad = (s, n) => String(s).padStart(n);
  const a0 = arms[0][1];
  console.log('\n' + ASSET + '  mode=' + MODE + '   inner=' + a0.inner + ' outer=' + a0.outer);
  console.log('\n  arm            deg   embed   popExtra  near zOff  matte  crop   content OUTSIDE   % out   inside fill%');
  for (const [name, a] of arms) for (const r of a.rows)
    console.log('  ' + pad(name, 12) + pad(r.deg, 6) + pad(a.embed.toFixed(4), 9) +
                pad((a.pop || 0).toFixed(5), 10) + pad(a.nearestZOff.toFixed(4), 11) +
                pad(a.matte ? 'on' : 'GONE', 7) +
                pad(a.crop === null ? '-' : a.crop, 6) + pad(r.outside, 18) +
                pad(r.outsidePct, 9) + pad(r.insidePct, 15));
  console.log('\n  "matte GONE + crop 1" is the a171 arm: the frame is removed and the aperture');
  console.log('  crop is the only thing bounding the apron. If matte reads "on" in the');
  console.log('  fullscreen rows, the containment number belongs to the matte and a171 is inert.');
  console.log('\n  A172: the embed is unconditional, so nearest zOff is 0.0000 in BOTH modes and');
  console.log('  nothing is in front of the glass to cross the frame. windowed and FULLSCREEN');
  console.log('  must both be 0 outside; "FS crop OFF" must be LARGE. Zero with the crop on is');
  console.log('  only evidence if turning the crop off puts the apron back.');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
