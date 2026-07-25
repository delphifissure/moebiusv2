// A105: does the backstop protrusion sweep miss protrusions because its four
// poses are all diagonal and short of the rim?
//
// Two bakes in one page, legacy poses vs derived rim poses, capturing the
// [RUNG-PLUG] counters from the console. A protrusion the legacy sweep never
// saw is a texel where the backstop pokes through the FG at a head pose the
// user CAN reach — so if the derived sweep flattens materially more, the
// hardcoded set was blind, and the extra repairs are real defects that were
// shipping.
//
// Then renders at pure-up / pure-down / pure-left cams, which the legacy set
// never sampled, so the two builds can be compared where the blind arcs are.
//   node harness/a105_poses.js [star|troll]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/arc73';
const H = path.join(WT, 'harness');
const OUTD = '/workspace/moebiusv2/harness/val';
const ASSET = process.argv[2] || 'star';
const SRC = ASSET === 'star' ? ['starwatcher_color.png', 'starwatcher_depth.png']
                             : ['defaultImgColor.png', 'defaultImgDepth.png'];

// the rim of the supported disc at shipped settings: dist 0.2 x tan(45) = 0.200
const CAMS = [['up', 0.0, 0.19], ['down', 0.0, -0.19], ['left', -0.19, 0.0]];

(async () => {
  fs.copyFileSync(path.join(WT, SRC[0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 933, height: 525 } });
  const logs = [];
  page.on('console', m => { const t = m.text(); if (/RUNG-PLUG|A105/.test(t)) logs.push(t); });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 140)));
  await page.goto('http://localhost:8099/fp_test.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  for (const [tag, legacy] of [['legacy 4 diagonals', true], ['derived 8 on the rim', false]]) {
    logs.length = 0;
    await page.evaluate((lg) => { window._scanLegacyPoses = lg; window._bsVerbose = false;
      bgQuickBake = true; window._bgQuickBaked = false; buildBackgroundLayer(); }, legacy);
    await page.waitForFunction(() => window._bgQuickBaked === true, null, { timeout: 480000, polling: 2000 });
    await new Promise(r => setTimeout(r, 400));
    const line = tag.padEnd(22) + ' | ' + (logs.length ? logs.join(' ; ') : '(no protrusions reported)');
    console.log(line);
    fs.appendFileSync('/workspace/moebiusv2/harness/a105_poses.result', ASSET + '  ' + line + '\n');
    for (const [ct, px, py] of CAMS) {
      const png = await page.evaluate(async ({ px, py }) => {
        isSweeping = true;
        await new Promise(r2 => { let n = 0; const tick = () => { camera.position.set(px, py, 0.2); n++; n < 8 ? requestAnimationFrame(tick) : r2(); }; requestAnimationFrame(tick); });
        camera.position.set(px, py, 0.2); render();
        return renderer.domElement.toDataURL('image/png');
      }, { px, py });
      const f = `A105_${ASSET}_${ct}_${legacy ? 'legacy' : 'derived'}.png`;
      fs.writeFileSync(path.join(OUTD, f), Buffer.from(png.split(',')[1], 'base64'));
      console.log('  wrote ' + f);
    }
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
