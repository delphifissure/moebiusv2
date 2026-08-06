// A214 THE PLUG-VISIBILITY CONTRACT — EVIDENCE RUN
//
// User directive: "the background plug should ONLY be visible in the
// disocclusion holes, nowhere else. it should be transparent in any places
// where disocclusions won't happen."
//
// Arms:
//   1. bake log capture (the a214 mask line: how much of the plate the plug
//      now covers vs the old full-frame backstop + skirt)
//   2. frames at the user's three sheet poses (rest / 10.7deg / 34deg) + 52deg
//   3. the user's own demonstration: FG hidden, plug alone — should be
//      figure-shaped hole-fills floating in transparency, NOT a background copy
//
//   node harness/a214_contract.js
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const OUT = '/tmp/claude-0/-home-user-moebius/989b3965-28fd-58c7-96b5-b4b22c709919/scratchpad/a214';
const POSES = [
  { tag: 'rest',    x: 0.013, y: 0.011 },   // user's sheet 3 stamp
  { tag: '34deg',   x: 0.133, y: 0.006 },   // A216: the user's "mess" sheet pose (33.7deg, 0.67x rim)
  { tag: '52deg',   x: 0.219, y: 0.138 },   // a161's far pose
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
  page.on('console', m => { const t = m.text();
    if (t.includes('[QUICK-BAKE]') || t.includes('[BUILD]')) console.log('  [page] ' + t.slice(0, 240)); });
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
    const W = 912, Hh = 513;
    const grab = () => { for (let n = 0; n < 3; n++) render();
      const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const cx = cv.getContext('2d');
      cx.fillStyle = '#181818'; cx.fillRect(0, 0, W, Hh);   // neutral backdrop so transparency reads as dark grey, not undefined
      cx.drawImage(renderer.domElement, 0, 0, W, Hh);
      return cv.toDataURL('image/png'); };
    const out = { png: {} };
    const L = mediaLayers[0];
    for (const p of o.poses) {
      camera.position.set(p.x, p.y, 0.2);
      out.png['full_' + p.tag] = grab();
      // the user's demonstration: FG hidden, plug alone
      const vis = [];
      scene.traverse(m => { if (m.isMesh && m !== bgLayerMesh) { vis.push([m, m.visible]); m.visible = false; } });
      out.png['plugonly_' + p.tag] = grab();
      for (const [m, v] of vis) m.visible = v;
      // A216: FG only — its holes are the plug demand
      const vis2 = [];
      scene.traverse(m => { if (m.isMesh && m !== L.mesh) { vis2.push([m, m.visible]); m.visible = false; } });
      out.png['fgonly_' + p.tag] = grab();
      for (const [m, v] of vis2) m.visible = v;
    }
    return out;
  }, { poses: POSES });
  for (const [tag, png] of Object.entries(res.png))
    fs.writeFileSync(path.join(OUT, tag + '.png'), Buffer.from(png.split(',')[1], 'base64'));
  console.log('frames -> ' + OUT);
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
