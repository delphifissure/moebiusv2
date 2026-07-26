// A136 precondition: WHICH BAKE MODES ACTUALLY RUN THE BACKSTOP SWEEP?
//
// REPLY02 §3: "The clamp's value is 60 seconds of bake, and that is only
// realised when the sweep is deleted." Before deleting anything, establish
// which path pays that 60 s. a114 already found the scene extension is v1-only
// because quick and v2 return before it, and bgBackstopSweep() is called from
// the same region of the file — so the payoff may not exist on the shipped
// default at all. Measured, not read off the line numbers.
//
// Per mode: does '[RUNG-PLUG] backstop sweep' appear, what does it report, and
// what does the bake cost?
//
//   node harness/sweepwhere.js [troll|star|warrior]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const ASSET = process.argv[2] || 'troll';
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star: ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };
const MODES = [['quick (shipped default for preview)', { q: true, v2: false }],
               ['v2 depth layers (shipped default)',   { q: false, v2: true }],
               ['v1 plug bake (UI-disabled, a129)',    { q: false, v2: false, skip: process.env.SKIPV1 === '1' }]];

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const out = [];
  for (const [tag, m] of MODES) {
    if (m.skip) continue;
    const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
    const sweepLines = [], clampLines = [];
    page.on('console', mm => { const t = mm.text();
      if (/backstop sweep/.test(t)) sweepLines.push(t);
      if (/a13[56] ordering clamp|a149 skirt/.test(t)) clampLines.push(t); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 40; t++) {
      const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
      if (ok) break; await new Promise(r => setTimeout(r, 1000));
    }
    const ms = await page.evaluate(async (mm) => {
      window._rayReproject = true;
      bgQuickBake = mm.q; bgMPIFullPlanes = mm.v2; bgMPIMode = mm.v2;
      const t0 = performance.now();
      bgBuildStamp = null; buildBackgroundLayer();
      return Math.round(performance.now() - t0);
    }, m).catch(e => -1);
    out.push({ tag, ms, sweepLines, clampLines });
    await page.close();
  }
  console.log('\n' + ASSET + '  DOES THE BACKSTOP SWEEP RUN?');
  for (const r of out) {
    console.log('\n=== ' + r.tag + '  (bake ' + r.ms + 'ms) ===');
    console.log('   backstop sweep: ' + (r.sweepLines.length ? '' : 'NOT REACHED — this mode never calls it'));
    for (const l of r.sweepLines) console.log('     | ' + l.slice(0, 170));
    for (const l of r.clampLines) console.log('     | ' + l.slice(0, 170));
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
