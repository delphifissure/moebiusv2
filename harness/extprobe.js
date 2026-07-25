// A114b: WHERE DOES THE EXTENDED PLATE GO?
//
// platecover2.js ran a real v1 bake and the [A113] line printed, so the
// scene-extension block DID execute and bgExtGeom WAS built — at 851x1023
// margin under a113 vs 691x60 under the legacy law. Two facts say it never
// reached the screen:
//   * every black% identical to 2dp across a 17x difference in margin
//   * rest footprint 226/480 px in BOTH, which is the ORIGINAL layer width
//     (origW 0.0749 of terrariumWidth 0.16 -> 0.0749/0.16*480 = 225 px).
//     An extended plate is 0.2247 world wide and would light the full frame.
//
// One bake (v1 is slow under swiftshader), then report the scene-graph facts
// instead of guessing from the source: does bgLayerMesh exist, is it visible,
// what geometry is it actually holding, is it in the scene, and what does the
// frame look like with ONLY it visible.
//
//   node harness/extprobe.js [troll|star|warrior]
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
  page.on('console', m => { const t = m.text();
    if (/\[A113\]|RUNG-PLUG\] scene|\[PERF\]|plate geometry|BG-RESET/.test(t)) console.log('  ' + t.slice(0, 190)); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  console.log('--- v1 full bake ---');
  await page.evaluate(() => { window._rayReproject = true;
    bgQuickBake = false; bgMPIFullPlanes = false; bgMPIMode = false;
    bgBuildStamp = null; buildBackgroundLayer(); });
  await page.waitForFunction(() => !!bgBuildStamp, null, { timeout: 900000, polling: 2000 })
    .catch(() => console.log('  [WARN] bgBuildStamp never set'));
  await new Promise(r => setTimeout(r, 800));

  const r = await page.evaluate(async () => {
    const L = mediaLayers[0];
    const gp = (m) => { const p = m && m.geometry && m.geometry.parameters;
      return p ? { w: +p.width.toFixed(4), h: +p.height.toFixed(4),
                   sw: p.widthSegments, sh: p.heightSegments } : null; };
    const inScene = (m) => { let n = m; while (n) { if (n === scene) return true; n = n.parent; } return false; };
    const info = {
      fg:    { present: !!L.mesh, visible: !!(L.mesh && L.mesh.visible), geom: gp(L.mesh), inScene: inScene(L.mesh) },
      plate: (typeof bgLayerMesh !== 'undefined' && bgLayerMesh)
             ? { present: true, visible: bgLayerMesh.visible, geom: gp(bgLayerMesh),
                 inScene: inScene(bgLayerMesh), renderOrder: bgLayerMesh.renderOrder,
                 mapSize: (() => { const t = bgLayerMesh.material?.uniforms?.map?.value;
                            return t && t.image ? [t.image.width, t.image.height] : null; })(),
                 dispSize: (() => { const t = bgLayerMesh.material?.uniforms?.displacementMap?.value;
                            return t && t.image ? [t.image.width, t.image.height] : null; })() }
             : { present: false },
      cards: (typeof bgCardMesh !== 'undefined' && bgCardMesh) ? { visible: bgCardMesh.visible } : null,
      extExport: (typeof bgExtendExport !== 'undefined' && bgExtendExport)
                 ? { mx: bgExtendExport.mx, my: bgExtendExport.my, EPW: bgExtendExport.EPW, EPH: bgExtendExport.EPH } : null,
      useInpainting: (typeof useInpainting !== 'undefined') ? useInpainting : null,
      debugView: (typeof debugView !== 'undefined') ? debugView : null,
      quickBaked: !!window._bgQuickBaked,
      terrarium: [terrariumWidth, terrariumHeight],
      camZ: +camera.position.z.toFixed(4), portalZ: portalPlaneWorldZ,
    };
    // lit-width test: render with only the plate visible, and with everything.
    isSweeping = true;
    const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
    camera.position.set(0, 0, dist);
    const W = 480, Hh = 300;
    const litBox = () => { for (let n = 0; n < 3; n++) render();
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
      const d = cx.getImageData(0, 0, W, Hh).data;
      let x0 = W, x1 = -1, y0 = Hh, y1 = -1, n = 0;
      for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) { const i = (y*W+x)*4;
        if (d[i]+d[i+1]+d[i+2] > 24) { n++; if (x<x0) x0=x; if (x>x1) x1=x; if (y<y0) y0=y; if (y>y1) y1=y; } }
      return n ? { box: [x1-x0+1, y1-y0+1], x: [x0, x1], lit: +(100*n/(W*Hh)).toFixed(2) } : { box: [0,0], lit: 0 }; };
    info.litAll = litBox();
    const pv = bgLayerMesh ? bgLayerMesh.visible : null;
    L.mesh.visible = false;
    info.litPlateOnly = litBox();
    if (bgLayerMesh) { bgLayerMesh.visible = false; info.litNeitherFGnorPlate = litBox(); bgLayerMesh.visible = pv; }
    L.mesh.visible = true;
    for (let n = 0; n < 3; n++) render();   // the "neither" pass left a black canvas
    info.png = renderer.domElement.toDataURL('image/png');
    return info;
  });
  const png = r.png; delete r.png;
  console.log('\n' + JSON.stringify(r, null, 2));
  try { fs.writeFileSync(path.join(OUTD, 'EXTPROBE_' + ASSET + '.png'), Buffer.from(png.split(',')[1], 'base64')); } catch (e) {}
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
