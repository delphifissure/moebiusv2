// AUTO-BUILD smoke + v2 bundle emission + live plane reimport
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('console', m => { const t=m.text(); if (/MPI-V2|SD-BUNDLE|AUTO-BUILD/i.test(t)) console.log('  [pg]', t.slice(0,150)); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  // wait for AUTO-build (no manual call!)
  let built = false;
  for (let t = 0; t < 90; t++) {
    built = await page.evaluate(() => !!(typeof mpiFullMeshes !== 'undefined' && mpiFullMeshes && mpiFullMeshes.length)).catch(()=>false);
    if (built) break; await new Promise(r => setTimeout(r, 2000));
  }
  console.log('auto-build produced planes:', built);
  if (!built) { process.exit(1); }
  // bundle: exercise the v2 emission block directly (zip path needs the debug sheet)
  const bundleInfo = await page.evaluate(() => {
    const files = []; const meta = { files: {} };
    // replicate exportSDBundle's v2 block via its own data
    let emitted = 0, names = [];
    for (const R of bgMPIV2Export) {
      let nClm = 0; for (let i = 0; i < R.clm.length; i++) nClm += R.clm[i];
      if (!nClm) continue;
      emitted++; names.push('v2_' + R.tag + '_bin' + R.k + ' (' + nClm + 'px claim, ' + R.bw + 'x' + R.bh + ')');
    }
    return { planes: bgMPIV2Export.length, emitted, names };
  });
  console.log('v2 export records:', JSON.stringify(bundleInfo, null, 0));
  // reimport: magenta into the largest-claim plane, verify texture + render
  const imp = await page.evaluate(() => {
    let best = null, bestN = 0;
    for (const R of bgMPIV2Export) { let n = 0; for (let i = 0; i < R.clm.length; i++) n += R.clm[i];
      if (n > bestN) { bestN = n; best = R; } }
    const cv = document.createElement('canvas'); cv.width = best.bw; cv.height = best.bh;
    const cc = cv.getContext('2d'); cc.fillStyle = '#ff00ff'; cc.fillRect(0, 0, best.bw, best.bh);
    const n = applyMPIV2PlaneImage(best, cv);
    return { tag: best.tag, k: best.k, applied: n, expected: bestN };
  });
  console.log('reimport:', JSON.stringify(imp));
  // render at a pose: magenta should appear in reveals
  const d = await page.evaluate(async () => {
    isSweeping = true; camera.position.x = 0.123; camera.position.y = -0.055;
    await new Promise(res => { let n=0; const tick=()=>{ camera.position.x=0.123; camera.position.y=-0.055; n++; n<5?requestAnimationFrame(tick):res(); }; requestAnimationFrame(tick); });
    return document.getElementById('canvas').toDataURL('image/png');
  });
  fs.writeFileSync('v2rt_shot.png', Buffer.from(d.split(',')[1], 'base64'));
  console.log('done');
  await browser.close(); srv.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
