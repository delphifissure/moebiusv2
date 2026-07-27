// A159 REPRODUCE THE USER'S ACTUAL CONFIGURATION, THEN BISECT IT.
//
// Every number I have reported was taken at DEFAULT slider values and at poses
// on the x axis. The user's contact sheets are neither: fgReach=60 (default
// 120), fgThresh=0.03 (default 0.05), seed=2, relax=harmonic, and the second
// pose is off-axis in BOTH x and y and outside the cone. So "0.33% edge black,
// zero absence" and "huge figure-shaped holes" can both be true of the same
// build — of different configurations of it.
//
// This sets the sheet's controls, bakes quick, renders the sheet's two camera
// positions, and reports what fraction of the frame is UNCOVERED (alpha 0) and
// what fraction is black. Run across revisions, it answers the only question
// worth asking right now: did this week make it worse, or has it always been
// this at these settings?
//
//   node harness/usercfg.js <rev:label> [rev:label ...]
const { chromium } = require('playwright-core');
const { spawn, execSync } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm';
const TMP = '/tmp/claude-0/-home-user-moebius/989b3965-28fd-58c7-96b5-b4b22c709919/scratchpad/ucfg';
const REVS = process.argv.slice(2);
// straight off the two sheets
const POSES = [{ tag: '35deg', x: 0.140, y: 0.002 }, { tag: '52deg', x: 0.219, y: 0.138 }];
const CTRL = { fgReachSlider: '60', fgSubThresholdSlider: '0.03',
               bgSeedModeSel: '2', bgRelaxModeSel: 'harmonic' };

const materialise = (rev, dir) => {
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  execSync(`git archive ${rev} | tar -x -C ${dir}`, { cwd: WT });
  fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(dir, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(dir, 'defaultImgDepth.png'));
  fs.copyFileSync(path.join(WT, 'harness', 'scratch_server.js'), path.join(dir, 'scratch_server.js'));
  fs.cpSync(path.join(WT, 'harness', 'vendor'), path.join(dir, 'vendor'), { recursive: true });
  const hp = path.join(dir, 'moebius.html');
  let html = fs.readFileSync(hp, 'utf8');
  html = html.replace(/^.*<script src="https?:\/\/[^"]*"[^>]*><\/script>.*$/gm,
                      (m) => (/three(\.min)?\.js/.test(m) ? '  <script src="vendor/three.min.js"></script>' : ''));
  fs.writeFileSync(hp, html);
};

(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const rows = [];
  for (const spec of REVS) {
    const [rev, label] = spec.split(':');
    const dir = path.join(TMP, label);
    materialise(rev, dir);
    const srv = spawn('node', ['scratch_server.js'], { cwd: dir, stdio: 'ignore' });
    await new Promise(r => setTimeout(r, 1500));
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [' + label + ' PAGEERR] ' + e.message.slice(0, 140)));
    try {
      await page.goto('http://localhost:8099/moebius.html', { waitUntil: 'load', timeout: 90000 });
      for (let t = 0; t < 45; t++) {
        const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
        if (ok) break; await new Promise(r => setTimeout(r, 1000));
      }
      const out = await page.evaluate(async (o) => {
        // set the sheet's controls, firing the events the app listens for
        const set = (id, v) => { const el = document.getElementById(id); if (!el) return false;
          el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true })); return true; };
        const applied = {};
        for (const [k, v] of Object.entries(o.ctrl)) applied[k] = set(k, v);
        window._rayReproject = true;
        try { isSweeping = true; } catch (e) {}
        if (typeof bgQuickBake !== 'undefined') bgQuickBake = true;
        if (typeof bgMPIFullPlanes !== 'undefined') { bgMPIFullPlanes = false; bgMPIMode = false; }
        bgBuildStamp = null; buildBackgroundLayer();
        const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
        const W = 600, Hh = 337;
        const res = { applied, poses: {}, png: {} };
        // A159b THE TANK BLINDS THE COVERAGE METRIC. a153 puts an opaque black
        // box behind everything, so a hole no longer reads as alpha 0 — it
        // reads as black paint, and "uncovered%" collapses to zero while the
        // hole is still there. Hide it, so every build is scored on the same
        // question: did the geometry cover this pixel?
        if (typeof bgFishtankMesh !== 'undefined' && bgFishtankMesh) bgFishtankMesh.visible = false;
        for (const p of o.poses) {
          camera.position.set(p.x, p.y, 0.2);
          for (let n = 0; n < 3; n++) render();
          const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
          const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
          const d = cx.getImageData(0, 0, W, Hh).data;
          let absent = 0, black = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] < 8) absent++;
            else if (d[i] + d[i + 1] + d[i + 2] < 24) black++;
          }
          res.poses[p.tag] = { absentPct: +(100 * absent / (W * Hh)).toFixed(2),
                               blackPct: +(100 * black / (W * Hh)).toFixed(2) };
          res.png[p.tag] = renderer.domElement.toDataURL('image/png');
        }
        return res;
      }, { poses: POSES, ctrl: CTRL });
      rows.push({ label, out });
      for (const [tag, png] of Object.entries(out.png))
        fs.writeFileSync(path.join(TMP, label + '_' + tag + '.png'), Buffer.from(png.split(',')[1], 'base64'));
    } catch (e) { rows.push({ label, err: e.message.slice(0, 200) }); }
    await page.close(); srv.kill();
    await new Promise(r => setTimeout(r, 800));
  }
  console.log('\nTROLL, QUICK, THE USER\'S CONTROLS (fgReach 60, fgThresh 0.03, seed 2, relax harmonic)');
  console.log('  build        pose      uncovered%   black%');
  for (const r of rows) {
    if (r.err) { console.log('  ' + r.label.padEnd(12) + ' FAILED: ' + r.err); continue; }
    for (const [tag, v] of Object.entries(r.out.poses))
      console.log('  ' + r.label.padEnd(12) + ' ' + tag.padEnd(9) + String(v.absentPct).padStart(10) + String(v.blackPct).padStart(9));
    const miss = Object.entries(r.out.applied).filter(([, ok]) => !ok).map(([k]) => k);
    if (miss.length) console.log('        (controls absent in this build: ' + miss.join(', ') + ')');
  }
  console.log('\n  shots -> ' + TMP);
  await browser.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
