// A116: WHERE DOES THE TIME GO, AND WHAT DOES EACH MODE ACTUALLY LOOK LIKE
// AT THE POSES THE USER IS SHOOTING?
//
// Two questions, one run.
//
// 1. COST. "quick bake hardly feels quick anymore." Capture every [PERF] /
//    stage line each mode emits, plus wall-clock, so the answer to "why is
//    this so compute heavy" is a per-stage table and not a guess.
//
// 2. REGRESSION CHECK ON MY OWN CHANGE. The user's v1 shot is at
//    cam(0.293, 0.005, 0.200) = 55.7deg = 0.85x rim. My a113 A/B stopped at
//    50deg (0.72x rim) and was almost entirely VERTICAL, while the user's
//    three shots are almost entirely HORIZONTAL (x large, y ~0). So a113 is
//    unverified at both the angle and the axis where the user reports the
//    mess. v1 is run BOTH ways here (window._legacyExtMargin) at the user's
//    own poses.
//
// Poses are taken from the three debug stamps:
//    quick  cam(0.178, 0.021, 0.200)  41.8deg  0.52x rim
//    v2     cam(0.276, 0.006, 0.200)  54.1deg  0.80x rim
//    v1     cam(0.293, 0.005, 0.200)  55.7deg  0.85x rim
// plus a matched vertical at 0.85x rim, because the horizontal/vertical
// asymmetry is the whole story of a113 and it should be visible here too.
//
//   node harness/modeprofile.js [troll|star|warrior]
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

const POSES = [
  { nm: '0.52xR', x: 0.178, y: 0.021 },
  { nm: '0.80xR', x: 0.276, y: 0.006 },
  { nm: '0.85xR', x: 0.293, y: 0.005 },
  { nm: '0.85xU', x: 0.005, y: -0.293 },
];

const MODES = [
  { tag: 'quick',      flags: { bgQuickBake: true,  bgMPIFullPlanes: false, bgMPIMode: false }, legacyExt: false },
  { tag: 'v2',         flags: { bgQuickBake: false, bgMPIFullPlanes: true,  bgMPIMode: true  }, legacyExt: false },
  { tag: 'v1-a113',    flags: { bgQuickBake: false, bgMPIFullPlanes: false, bgMPIMode: false }, legacyExt: false },
  { tag: 'v1-legacy',  flags: { bgQuickBake: false, bgMPIFullPlanes: false, bgMPIMode: false }, legacyExt: true  },
];

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const summary = {};
  for (const M of MODES) {
    const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 140)));
    const perf = [];
    page.on('console', m => { const t = m.text();
      if (/\[PERF\]|\[A113\]|scene extension:|all-viewpoint|viewpoint scan|backstop sweep|live plug computed|MPI-V2\] full planes|QUICK-BAKE\]/.test(t))
        perf.push(t); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 40; t++) {
      const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
      if (ok) break; await new Promise(r => setTimeout(r, 1000));
    }
    console.log('\n=== ' + M.tag + ' ===');
    const t0 = Date.now();
    await page.evaluate((cfg) => { window._rayReproject = true;
      window._legacyExtMargin = cfg.legacyExt;
      Object.assign(window, cfg.flags);
      for (const k in cfg.flags) { try { eval(k + ' = ' + JSON.stringify(cfg.flags[k])); } catch (e) {} }
      bgBuildStamp = null; buildBackgroundLayer(); }, M);
    const wall = Date.now() - t0;
    await new Promise(r => setTimeout(r, 600));
    const rows = await page.evaluate(async (poses) => {
      isSweeping = true;
      const L = mediaLayers[0];
      const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
      const W = 480, Hh = 300;
      const shot = () => { for (let n = 0; n < 3; n++) render();
        const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
        const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
        return cx.getImageData(0, 0, W, Hh).data; };
      const out = [];
      for (const p of poses) {
        camera.position.set(p.x, p.y, dist);
        const d = shot();
        let black = 0;
        for (let i = 0; i < W*Hh; i++) { const j = i*4; if (d[j]+d[j+1]+d[j+2] < 24) black++; }
        out.push({ nm: p.nm, black: +(100*black/(W*Hh)).toFixed(2),
                   png: renderer.domElement.toDataURL('image/png') });
      }
      camera.position.set(0, 0, dist); render();
      return out;
    }, POSES);
    for (const r of rows) {
      try { fs.writeFileSync(path.join(OUTD, 'MP_' + ASSET + '_' + M.tag + '_' + r.nm + '.png'),
            Buffer.from(r.png.split(',')[1], 'base64')); } catch (e) {}
      delete r.png;
    }
    summary[M.tag] = { wallMs: wall, black: rows, perf };
    console.log('  bake wall-clock ' + (wall/1000).toFixed(1) + 's');
    for (const l of perf) console.log('   | ' + l.slice(0, 230));
    console.log('  black%: ' + rows.map(r => r.nm + '=' + r.black).join('  '));
    await page.close();
  }
  console.log('\n\n===== SUMMARY (' + ASSET + ') =====');
  console.log('mode         bake s   ' + POSES.map(p => p.nm.padStart(8)).join(''));
  for (const M of MODES) { const s = summary[M.tag];
    console.log(M.tag.padEnd(12) + (s.wallMs/1000).toFixed(1).padStart(7) + '   ' +
      s.black.map(b => String(b.black).padStart(8)).join('')); }
  fs.writeFileSync(path.join(OUTD, 'MP_' + ASSET + '.json'), JSON.stringify(summary, null, 2));
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
