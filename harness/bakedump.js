// W1-a THE BAKE, DUMPED ONCE.
//
// Every measurement in this project has paid for a full headless bake — 1.5 to
// 3 minutes in software GL — even when the only thing varying was the CAMERA.
// The bake is expensive; posing is not. This runs the bake once and writes the
// only state a pose question needs:
//
//   dQ      source depth, image order, Float32
//   plateF  the finished plate depth (post a126/a135/a162), row-flipped, Float32
//   the volume mapping and the shift LUT's own parameters
//
// Everything downstream (harness/warp.js) then answers poses from this file in
// milliseconds, on the CPU, with no browser.
//
//   node harness/bakedump.js <asset> [outfile]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const ASSET = process.argv[2] || 'troll';
const OUT = process.argv[3] || path.join(H, 'cache', ASSET + '.bake.json');
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star: ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };

(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
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
  const t0 = Date.now();
  const dump = await page.evaluate(async (o) => {
    const set = (id, v) => { const el = document.getElementById(id); if (!el) return;
      el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true })); };
    if (o.userCtrl) { set('fgReachSlider', '60'); set('fgSubThresholdSlider', '0.03');
                      set('bgSeedModeSel', '2'); set('bgRelaxModeSel', 'harmonic'); }
    window._rayReproject = true;
    window._srCapture = true;                 // makes the bake stash _qbDbg
    try { isSweeping = true; } catch (e) {}
    bgQuickBake = true; bgMPIFullPlanes = false; bgMPIMode = false;
    bgBuildStamp = null; buildBackgroundLayer();
    const dbg = window._qbDbg;
    if (!dbg) return { err: 'bake did not stash _qbDbg (window._srCapture)' };
    const pw = dbg.pw, ph = dbg.ph;
    // the finished plate, read back off the texture the plate actually renders
    const plateTex = bgLayerMesh && bgLayerMesh.material.uniforms.displacementMap.value;
    const plateF = (plateTex && plateTex.image && plateTex.image.data)
                 ? Array.from(plateTex.image.data) : null;
    const L = mediaLayers[0];
    const gp = L.mesh.geometry.parameters || {};
    const lut = bgShiftLUTFor(pw, ph);
    return {
      pw, ph,
      dQ: Array.from(dbg.d),
      plateF,
      stretch: window._qbStretch || null,
      // the volume mapping, read from the live globals rather than assumed
      vol: { pn: currentNormPortalPlane, inner: innerVolumeDepth, outer: outerVolumeDepth,
             embed: (typeof bgEmbedOffsetNow === 'function') ? bgEmbedOffsetNow() : 0,
             D: Math.abs(camera.position.z - portalPlaneWorldZ),
             cone: bgViewFadeEndDeg, W0: gp.width, H0: gp.height,
             quantum: window._qbSrcQuantum || (1 / 255) },
      // the shift LUT itself, so the CPU side uses the SAME table rather than a
      // reimplementation that could drift from it
      lut: { N: lut.N, m0: lut.m0, m1: lut.m1, fwd: Array.from(lut.fwd) },
      build: MOEBIUS_BUILD
    };
  }, { userCtrl: process.env.USERCTRL !== '0' });
  const bakeMs = Date.now() - t0;
  if (dump.err) { console.error('ERR ' + dump.err); process.exit(1); }
  dump.bakeMs = bakeMs; dump.asset = ASSET;
  fs.writeFileSync(OUT, JSON.stringify(dump));
  const mb = (fs.statSync(OUT).size / 1048576).toFixed(1);
  console.log('baked ' + ASSET + ' (' + dump.build + ') in ' + bakeMs + 'ms -> ' + OUT + '  (' + mb + ' MB)');
  console.log('  ' + dump.pw + 'x' + dump.ph + ', plate ' + (dump.plateF ? 'captured' : 'MISSING') +
              ', quantum 1/' + Math.round(1 / dump.vol.quantum) + ', cone ' + dump.vol.cone + 'deg');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
