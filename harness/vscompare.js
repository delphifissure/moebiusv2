// TAKE STOCK: render SEVERAL HISTORICAL BUILDS side by side, each from its own
// checked-out tree, and measure the artifact the user is actually reporting.
//
// The user's screenshot shows WHITE silhouette-shaped regions. White is not
// black: in the app the clear shows the page background, so an uncovered pixel
// reads WHITE on device and BLACK (or alpha 0) in my harness captures. Every
// number I have reported in this arc counted black% and ABSENT%, and ABSENT is
// the same quantity as the user's white — but I have only ever measured it on
// the BAKED paths, and only inside a content polygon. This measures:
//
//   * each build in its DEFAULT on-load state (realtime, no bake), and
//   * each build after the bake its own UI would run,
//
// over the WHOLE canvas, so nothing can hide outside a polygon.
//
//   node harness/vscompare.js <asset> <rev:label> [rev:label ...]
const { chromium } = require('playwright-core');
const { spawn, execSync } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm';
const TMP = '/tmp/claude-0/-home-user-moebius/989b3965-28fd-58c7-96b5-b4b22c709919/scratchpad/vs';
const ASSET = process.argv[2] || 'star';
const REVS = process.argv.slice(3);
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star: ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };
const DEGS = (process.env.DEGS || '0,25,45').split(',').map(Number);
const ARMS = (process.env.ARMS || 'realtime,quick,v2').split(',');

const materialise = (rev, dir) => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  execSync(`git archive ${rev} | tar -x -C ${dir}`, { cwd: WT });
  // the asset under test replaces the built-in default pair
  for (let i = 0; i < 2; i++) {
    const s = path.join(WT, SRC[ASSET][i]);
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(dir, ['defaultImgColor.png', 'defaultImgDepth.png'][i]));
  }
  fs.copyFileSync(path.join(WT, 'harness', 'scratch_server.js'), path.join(dir, 'scratch_server.js'));
  // The shipped page pulls three.js and the face models from CDNs and there is
  // no egress here, so the harness page swaps in the vendored three and drops
  // the tracker. Do the same edit to whatever page this revision shipped,
  // rather than serving one build's HTML to another build's JS.
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
    const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
    page.on('pageerror', e => console.log('  [' + label + ' PAGEERR] ' + e.message.slice(0, 140)));
    let stamp = '';
    page.on('console', m => { const t = m.text(); if (/\[BUILD\]/.test(t)) stamp = (t.match(/v3\.\d+\.\d+-\w+/) || [''])[0]; });
    try {
      await page.goto('http://localhost:8099/moebius.html', { waitUntil: 'load', timeout: 90000 });
      for (let t = 0; t < 40; t++) {
        const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
        if (ok) break; await new Promise(r => setTimeout(r, 1000));
      }
      const res = await page.evaluate(async (o) => {
        const has = (n) => { try { return typeof eval(n) !== 'undefined'; } catch (e) { return false; } };
        const caps = { quick: has('bgQuickBake'), v2: has('bgMPIFullPlanes'), skirt: has('bgSkirtMesh'),
                       ray: has('_rayReprojectNow'), build: has('MOEBIUS_BUILD') ? MOEBIUS_BUILD : '?' };
        
        const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
        const W = 600, Hh = 375;
        const grab = () => { for (let n = 0; n < 3; n++) render();
          const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
          const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
          return cx.getImageData(0, 0, W, Hh); };
        const out = { caps, arms: {} };
        const run = (tag) => {
          const a = {};
          for (const deg of o.degs) {
            camera.position.set(dist * Math.tan(deg * Math.PI / 180), 0, dist);
            const im = grab(); const d = im.data;
            let absent = 0, black = 0;
            for (let i = 0; i < d.length; i += 4) {
              if (d[i + 3] < 8) absent++;
              else if (d[i] + d[i + 1] + d[i + 2] < 24) black++;
            }
            a[deg] = { absentPct: +(100 * absent / (W * Hh)).toFixed(2),
                       blackPct: +(100 * black / (W * Hh)).toFixed(2) };
            if (deg === o.shotDeg) a.shot = document.createElement('canvas');
          }
          camera.position.set(dist * Math.tan(o.shotDeg * Math.PI / 180), 0, dist);
          for (let n = 0; n < 3; n++) render();
          a.png = renderer.domElement.toDataURL('image/png');
          camera.position.set(0, 0, dist); for (let n = 0; n < 3; n++) render();
          a.png0 = renderer.domElement.toDataURL('image/png');
          delete a.shot;
          out.arms[tag] = a;
        };
        if (o.arms.includes('realtime')) run('realtime');                       // the default on-load state
        if (caps.quick && o.arms.includes('quick')) {
          try { bgQuickBake = true; if (caps.v2) { bgMPIFullPlanes = false; bgMPIMode = false; }
                bgBuildStamp = null; buildBackgroundLayer(); run('quick'); } catch (e) { out.quickErr = e.message; }
        }
        if (caps.v2 && o.arms.includes('v2')) {
          try { bgQuickBake = false; bgMPIFullPlanes = true; bgMPIMode = true;
                bgBuildStamp = null; buildBackgroundLayer(); run('v2'); } catch (e) { out.v2Err = e.message; }
        }
        return out;
      }, { degs: DEGS, shotDeg: 25, arms: ARMS, embed: process.env.EMBED === '1' });
      rows.push({ label, rev, stamp, res });
      const sd = path.join(TMP, 'shots'); fs.mkdirSync(sd, { recursive: true });
      for (const [tag, a] of Object.entries(res.arms)) {
        fs.writeFileSync(path.join(sd, label + '_' + tag + '_25deg.png'), Buffer.from(a.png.split(',')[1], 'base64'));
        fs.writeFileSync(path.join(sd, label + '_' + tag + '_0deg.png'), Buffer.from(a.png0.split(',')[1], 'base64'));
      }
    } catch (e) { rows.push({ label, rev, stamp, err: e.message.slice(0, 200) }); }
    await page.close(); srv.kill();
    await new Promise(r => setTimeout(r, 800));
  }
  console.log('\n' + ASSET + '  UNCOVERED PIXELS OVER THE WHOLE CANVAS (what shows as WHITE on device)');
  for (const r of rows) {
    console.log('\n=== ' + r.label + '  ' + (r.stamp || r.res?.caps?.build || '?') + ' ===');
    if (r.err) { console.log('   FAILED: ' + r.err); continue; }
    for (const [tag, a] of Object.entries(r.res.arms)) {
      const cells = DEGS.map(d => String(a[d].absentPct).padStart(6)).join('');
      const blk = DEGS.map(d => String(a[d].blackPct).padStart(6)).join('');
      console.log('   ' + tag.padEnd(9) + ' absent%' + cells + '     black%' + blk);
    }
    if (r.res.quickErr) console.log('   quick bake threw: ' + r.res.quickErr.slice(0, 120));
    if (r.res.v2Err) console.log('   v2 bake threw: ' + r.res.v2Err.slice(0, 120));
  }
  console.log('\n   columns are ' + DEGS.join(', ') + ' degrees. shots -> ' + path.join(TMP, 'shots'));
  await browser.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
