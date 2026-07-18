// A73 fold-value probe: drive the REAL arc-fix page on the TROLL (shipped
// default asset), quick mode, with bgDirectionalPlate instrumented
// (window._foldProbe): per-pixel winning anchor value/position, fold flag,
// and whether the a63b descent floor determined the claim value. Dumps
// diagnostic maps + offset shots, then A/B repeats with the floor disabled
// (window._noDescFloor) to test the bisect's a63b conviction.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = process.argv[2];              // arc-fix worktree (instrumented moebius.js)
const OUT = process.argv[3] || 'val';
const H = path.join(WT, 'harness');
fs.mkdirSync(H, { recursive: true });
let src = fs.readFileSync(path.join(WT, 'moebius.html'), 'utf8');
src = src.replace(/\s*<script src="https:\/\/[^"]+"[^>]*><\/script>/g, '');
src = src.replace('<script src="moebius.js"></script>',
  '<script src="vendor/three.min.js"></script>\n<script>window.tf={setBackend:async()=>{},ready:async()=>{}};window.faceLandmarksDetection={SupportedModels:{MediaPipeFaceMesh:"m"},createDetector:async()=>({estimateFaces:async()=>[]})};</script>\n<script src="moebius.js"></script>');
fs.writeFileSync(path.join(H, 'fp_test.html'), src);
for (const f of ['scratch_server.js']) fs.copyFileSync(path.join('/workspace/moebiusv2/harness', f), path.join(H, f));
try { fs.cpSync('/workspace/moebiusv2/harness/vendor', path.join(H, 'vendor'), { recursive: true }); } catch (e) {}
try { fs.symlinkSync('../moebius.js', path.join(H, 'moebius.js')); } catch (e) {}
try { fs.copyFileSync(path.join(WT, 'styles.css'), path.join(H, 'styles.css')); } catch (e) {}
// troll IS the shipped default asset
fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png'));
fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
const OUTD = path.join('/workspace/moebiusv2/harness', OUT);

const buildAndDump = async (page, tag) => {
  await page.evaluate(() => {
    window._bgQuickBaked = false;
    const s = document.getElementById('bgModeSel');
    if (s) { s.value = 'quick'; s.dispatchEvent(new Event('change')); }
    document.getElementById('bgLayerBuildBtn').click();
  });
  await page.waitForFunction(() => window._bgQuickBaked === true, null, { timeout: 300000 });
  await new Promise(r => setTimeout(r, 500));
  const stats = await page.evaluate(() => {
    const d = window._fpData; if (!d) return null;
    const N = d.pw * d.ph;
    let nCl = 0, nFlr = 0, nFold = 0, sP = 0, sD = 0, sAv = 0;
    let nNearAv = 0, nNearP = 0;   // claims whose winning anchor / final value is NEAR (>0.35)
    for (let i = 0; i < N; i++) {
      if (!d.claimedF[i]) continue;
      nCl++; sP += d.P[i]; sD += d.dQ[i]; sAv += d.carAv[i];
      if (d.flrF && d.flrF[i]) nFlr++;
      if (d.foldF[i]) nFold++;
      if (d.carAv[i] > 0.35) nNearAv++;
      if (d.P[i] > 0.35) nNearP++;
    }
    let nG = 0; if (d.ground) for (let i = 0; i < N; i++) if (d.ground[i]) nG++;
    return { pw: d.pw, ph: d.ph, tearStep: d.tearStep, claimed: nCl,
             groundPct: +(nG / N * 100).toFixed(1),
             floorPct: nCl ? +(nFlr / nCl * 100).toFixed(1) : 0,
             foldPct: nCl ? +(nFold / nCl * 100).toFixed(1) : 0,
             meanP: +(sP / Math.max(1, nCl)).toFixed(3), meanSrc: +(sD / Math.max(1, nCl)).toFixed(3),
             meanAnchor: +(sAv / Math.max(1, nCl)).toFixed(3),
             nearAnchorPct: nCl ? +(nNearAv / nCl * 100).toFixed(1) : 0,
             nearPlatePct: nCl ? +(nNearP / nCl * 100).toFixed(1) : 0 };
  });
  console.log('STATS_' + tag + ' ' + JSON.stringify(stats));
  const dump = async (name, mode) => {
    const png = await page.evaluate((mode) => {
      const d = window._fpData;
      const c = document.createElement('canvas'); c.width = d.pw; c.height = d.ph;
      const ctx = c.getContext('2d'); const im = ctx.createImageData(d.pw, d.ph);
      for (let i = 0; i < d.pw * d.ph; i++) {
        let r = 0, g = 0, b = 0;
        if (mode === 'plate') { const v = Math.round(d.P[i] * 255); r = g = b = v; }
        else if (mode === 'src') { const v = Math.round(d.dQ[i] * 255); r = g = b = v; }
        else if (mode === 'anchor') {
          if (d.claimedF[i]) { const v = Math.round(d.carAv[i] * 255);
            r = (d.flrF && d.flrF[i]) ? 255 : v; g = v; b = d.foldF[i] ? 255 : 0; }
          else { const v = Math.round(d.dQ[i] * 90); r = g = b = v; }
        } else if (mode === 'lift') {
          // how far the claim LOWERED vs source: bright = big lowering (good far carry)
          if (d.claimedF[i]) { const v = Math.round(Math.min(1, (d.dQ[i] - d.P[i]) / 0.5) * 255); g = v; r = 255 - v; }
        }
        im.data[i*4] = r; im.data[i*4+1] = g; im.data[i*4+2] = b; im.data[i*4+3] = 255;
      }
      ctx.putImageData(im, 0, 0);
      return c.toDataURL('image/png');
    }, mode);
    fs.writeFileSync(path.join(OUTD, name), Buffer.from(png.split(',')[1], 'base64'));
    console.log('wrote ' + name);
  };
  await dump('FP_plate_' + tag + '.png', 'plate');
  if (tag === 'on') { await dump('FP_src.png', 'src'); }
  await dump('FP_anchor_' + tag + '.png', 'anchor');
  await dump('FP_lift_' + tag + '.png', 'lift');
  for (const [ptag, px, py] of [['c1', 0.217, 0.026], ['c2', 0.179, 0.015]]) {
    const png = await page.evaluate(async ({ px, py }) => {
      isSweeping = true;
      await new Promise(r2 => { let n = 0; const tick = () => { camera.position.set(px, py, 0.2); n++; n < 8 ? requestAnimationFrame(tick) : r2(); }; requestAnimationFrame(tick); });
      camera.position.set(px, py, 0.2); render();
      return renderer.domElement.toDataURL('image/png');
    }, { px, py });
    fs.writeFileSync(path.join(OUTD, 'FP_shot_' + ptag + '_' + tag + '.png'), Buffer.from(png.split(',')[1], 'base64'));
    console.log('wrote FP_shot_' + ptag + '_' + tag + '.png');
  }
};

(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 851, height: 1023 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 140)));
  page.on('console', m => { const t = m.text(); if (t.indexOf('QUICK-BAKE') >= 0 || t.indexOf('DIR-PLATE') >= 0) console.log('  [pg] ' + t.slice(0, 130)); });
  await page.goto('http://localhost:8099/fp_test.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
  await page.evaluate(() => { window._foldProbe = true; });
  await buildAndDump(page, 'on');                       // arc-fix as shipped (descent floor ON)
  await page.evaluate(() => { window._noDescFloor = true; });
  await buildAndDump(page, 'off');                      // A/B: floor OFF (pre-a63b law)
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
