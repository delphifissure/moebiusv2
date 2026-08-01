// A187: SPLIT THE SIMULATED VIEWER IN TWO AND ASK WHICH HALF LOSES THE CONTENT.
//
// The user sees the astronaut and the dune party wash out ONLY in simulated
// mode, worse with vertical offset. The a130 simulated viewer is two passes:
//
//   pass 1  renders the portal, pre-distortion, from svEye() into an offscreen
//           buffer. This is the ordinary render path with a different eye.
//   pass 2  draws that buffer on a quad at the panel rect, seen from a pass-2
//           camera also at svEye() with a locked lens.
//
// A defect in pass 1 is a portal defect that the plain path would also show at
// the same eye. A defect in pass 2 is unique to this mode. Everything measured
// in a184-a186 drove the plain path, so pass 2 has never been measured at all.
//
// THE SPLIT IS ALREADY IN THE CODE. svState.pipShowsRaw=false makes the MAIN
// view drawRaw(): the same pass-1 buffer drawn through an ORTHOGRAPHIC camera,
// head-on, no falloff. So:
//
//   RAW    = pass-1 content, undistorted   -> isolates pass 1
//   SIM    = pass-1 content through pass 2 -> adds pass 2
//   PLAIN  = ordinary render at the SAME eye
//
// RAW vs PLAIN convicts or clears pass 1. SIM vs RAW convicts or clears pass 2.
//
// TWO INSTRUMENT RULES THIS FILE OBEYS AND svvert.js DID NOT:
//  1. svState.pip is turned OFF. The picture-in-picture is an in-canvas 28%-wide
//     inset in the top-right; leaving it on puts the other arm's pixels inside
//     the frame being measured.
//  2. svState.falloff is turned OFF. The Lambertian dim is a real part of the
//     mode but it darkens everything uniformly, which reads as detail loss on a
//     luma-std metric and would fake exactly the finding being looked for.
//
// Metric is a184's, per-tile luma standard deviation against each arm's OWN rest
// frame, because a152 established that black% and ABSENT% read 0.00 while an
// object quietly loses its texture. dark% is carried alongside as the honest
// hole count. SIM's panel foreshortens off-axis, so its tiles do not align with
// its own rest frame and its numbers are EXPECTED to move for purely geometric
// reasons; that is why the conviction rests on RAW, whose framing is fixed by
// the orthographic camera at every pitch.
//
//   node harness/svsplit.js [star|troll|warrior] [quick|v2]
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
const PITCH = [0, 10, 20, 27, 35, -20, -27, -35];
const SHEET = [0, 20, 27, 35];

(async () => {
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
  const onDisk = (fs.readFileSync(path.join(WT, 'moebius.js'), 'utf8')
                    .match(/MOEBIUS_BUILD\s*=\s*'([^']+)'/) || [])[1] || null;
  const served = await page.evaluate(() => (typeof MOEBIUS_BUILD === 'string') ? MOEBIUS_BUILD : null);
  console.log('served build = ' + served + (served === onDisk ? ' (matches this tree)' : '  *** TREE SAYS ' + onDisk + ' ***'));
  const hasSV = await page.evaluate(() => typeof svRenderFrame === 'function' && typeof svState === 'object');
  if (!hasSV) { console.log('*** no simulated viewer in this build'); await browser.close(); srv.kill(); process.exit(1); }

  const r = await page.evaluate(async (o) => {
    window._rayReproject = true;
    bgViewFadeStartDeg = 35; bgViewFadeEndDeg = 45;
    bgQuickBake = (o.mode === 'quick');
    bgMPIFullPlanes = (o.mode === 'v2'); bgMPIMode = (o.mode === 'v2');
    bgBuildStamp = null; buildBackgroundLayer();
    const W = 720, Hh = 450, T = 16;
    const shot = () => { const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const g = cv.getContext('2d'); g.drawImage(renderer.domElement, 0, 0, W, Hh);
      return { data: g.getImageData(0, 0, W, Hh).data, url: cv.toDataURL('image/png') };
    };
    const stats = (d) => {
      const tx = (W/T)|0, ty = (Hh/T)|0, sd = [];
      let dark = 0;
      for (let i = 0; i < W*Hh; i++) { const l = 0.299*d[i*4] + 0.587*d[i*4+1] + 0.114*d[i*4+2];
        if (d[i*4+3] >= 8 && l < 8) dark++; }
      for (let by = 0; by < ty; by++) for (let bx = 0; bx < tx; bx++) {
        let s = 0, s2 = 0, n = 0;
        for (let y = by*T; y < (by+1)*T; y++) for (let x = bx*T; x < (bx+1)*T; x++) {
          const i = (y*W+x)*4; if (d[i+3] < 8) continue;
          const l = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2]; s += l; s2 += l*l; n++;
        }
        sd.push(n > 8 ? Math.sqrt(Math.max(0, s2/n - (s/n)*(s/n))) : -1);
      }
      return { sd, darkPct: 100*dark/(W*Hh) };
    };
    const lossVs = (base, s) => {
      let lost = 0, had = 0, sum = 0;
      for (let i = 0; i < base.sd.length; i++) {
        if (base.sd[i] < 4) continue; had++;
        const now = s.sd[i] < 0 ? 0 : s.sd[i];
        const drop = (base.sd[i] - now) / base.sd[i];
        if (drop > 0.5) lost++; sum += Math.max(0, drop);
      }
      return { lostPct: +(100*lost/Math.max(1,had)).toFixed(2),
               meanDrop: +(100*sum/Math.max(1,had)).toFixed(2), had };
    };

    // instrument hygiene, stated in the header
    svState.active = true;
    svState.pip = false;          // the inset would put the other arm inside the frame
    svState.showHud = false;
    svState.falloff = false;      // the Lambertian dim would read as detail loss
    svState.yawDeg = 0; svState.pitchDeg = 0;

    const armShot = (raw) => { svState.pipShowsRaw = !raw; svRenderFrame(); svRenderFrame(); return shot(); };

    const rawBase = stats(armShot(true).data);
    const simBase = stats(armShot(false).data);

    const rows = [], eyes = [], sheets = [];
    for (const p of o.pitch) {
      svState.pitchDeg = p;
      const rawS = armShot(true), simS = armShot(false);
      const E = svEye();
      eyes.push({ p, x: E.x, y: E.y, z: E.z });
      const rw = stats(rawS.data), sm = stats(simS.data);
      rows.push({ pitch: p,
        raw: Object.assign({ darkPct: +rw.darkPct.toFixed(2) }, lossVs(rawBase, rw)),
        sim: Object.assign({ darkPct: +sm.darkPct.toFixed(2) }, lossVs(simBase, sm)),
        vp: svState.vp ? (svState.vp.w + 'x' + svState.vp.h) : 'null',
        fade: +svState.lastFade.toFixed(2) });
      if (o.sheet.indexOf(p) >= 0) sheets.push({ p, raw: rawS.url, sim: simS.url });
    }
    svState.pitchDeg = 0; svState.active = false; svState.pip = true; svState.showHud = true;

    // ---- PLAIN PATH AT THE SV'S OWN EYES ----
    isSweeping = true;
    const z0 = eyes.length ? eyes[0].z : 0.2;
    camera.position.set(0, 0, z0);
    for (let n = 0; n < 3; n++) render();
    const plBase = stats(shot().data);
    const plRows = [], plSheet = {};
    for (const e of eyes) {
      camera.position.set(e.x, e.y, e.z);
      for (let n = 0; n < 3; n++) render();
      const sh = shot(); const s = stats(sh.data);
      plRows.push(Object.assign({ pitch: e.p, darkPct: +s.darkPct.toFixed(2) }, lossVs(plBase, s)));
      if (o.sheet.indexOf(e.p) >= 0) plSheet[e.p] = sh.url;
    }
    camera.position.set(0, 0, z0); render();
    return { rows, plRows, eyes, sheets, plSheet };
  }, { pitch: PITCH, mode: MODE, sheet: SHEET });

  const pad = (s, n) => String(s).padStart(n);
  console.log('\n' + ASSET + '  mode=' + MODE +
    '  —  RAW (pass 1 only) / SIM (pass 1+2) / PLAIN (ordinary path), all at the SAME eye');
  console.log('\n  pitch      eye(x,y,z)         RAW lost% drop% dark%  |   SIM lost% drop% dark%  |  PLAIN lost% drop% dark%   fade   vp');
  for (let i = 0; i < r.rows.length; i++) {
    const a = r.rows[i], b = r.plRows[i], e = r.eyes[i];
    console.log('  ' + pad(a.pitch + '°', 6) +
      pad('(' + e.x.toFixed(3) + ',' + e.y.toFixed(3) + ',' + e.z.toFixed(3) + ')', 24) +
      pad(a.raw.lostPct, 9) + pad(a.raw.meanDrop, 7) + pad(a.raw.darkPct, 7) + '  |' +
      pad(a.sim.lostPct, 10) + pad(a.sim.meanDrop, 7) + pad(a.sim.darkPct, 7) + '  |' +
      pad(b.lostPct, 11) + pad(b.meanDrop, 7) + pad(b.darkPct, 7) +
      pad(a.fade, 8) + pad(a.vp, 12));
  }
  console.log('\n  RAW vs PLAIN: same eye, same content, both undistorted. If RAW loses detail');
  console.log('  and PLAIN does not, the defect is in pass 1 driven the way the SV drives it.');
  console.log('  SIM vs RAW: the extra loss pass 2 adds. SIM\'s panel foreshortens off-axis, so');
  console.log('  some SIM movement is geometry, not content — RAW carries the conviction.');
  console.log('  pip and falloff are OFF: both would otherwise fake the finding.');

  // labelled contact sheet, RAW | SIM | PLAIN per pitch
  const sharp = (() => { try { return require('sharp'); } catch (e) { return null; } })();
  const files = [];
  for (const s of r.sheets) {
    for (const [tag, url] of [['raw', s.raw], ['sim', s.sim], ['plain', r.plSheet[s.p]]]) {
      if (!url) continue;
      const f = path.join(H, 'sv_' + ASSET + '_' + MODE + '_p' + s.p + '_' + tag + '.png');
      fs.writeFileSync(f, Buffer.from(url.split(',')[1], 'base64'));
      files.push(f);
    }
  }
  console.log('\n  wrote ' + files.length + ' frames to harness/sv_' + ASSET + '_' + MODE + '_p*_{raw,sim,plain}.png');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
