// A137: DOES THE O(N) INEQUALITY LEAVE THE O(poses x pixels) SEARCH NOTHING TO
// FIND?
//
// a135 landed the ordering clamp on the assertion that "searching rendered
// poses for violations of an invariant is strictly worse than enforcing the
// invariant". That is an argument, not a measurement. v1 is the only path that
// runs BOTH — the clamp (a137) and bgBackstopSweep(), which finds the same
// violations by rendering four extreme poses and back-projecting on-screen
// protrusions to the backstop. The sweep shares no code with the clamp.
//
// So the sweep becomes a TEST of the clamp, from an independent instrument:
//   clamp OFF  the sweep should find violations (it did: 12627 plate texels,
//              63465 ms on troll)
//   clamp ON   if the inequality is right, the sweep should report CLEAN
//
// A residue would mean the clamp's formulation is incomplete — most likely
// that "the surface it backs" is not the same thing at a rendered pose as it
// is at the authoring texel, which would be worth knowing.
//
// NOTE ON THE 63 s. It is v1-only, and v1 has been UI-disabled since a129, so
// deleting the sweep banks nothing on a shipped path. The cross-validation is
// the reason to run this, not the saving.
//
//   node harness/sweepvsclamp.js [troll|star|warrior]     (~6 min: v1 is slow)
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const { armWitness, assertArmsDiffer } = require('./abguard');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const ASSET = process.argv[2] || 'troll';
const SRC = { troll: ['defaultImgColor.png', 'defaultImgDepth.png'],
              star: ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };
const ARMS = [['clamp OFF + sweep ON (pre-a137)', { _noOrderClamp: true }],
              ['clamp ON  + sweep ON (the test)', {}],
              ['clamp ON  + sweep OFF',           { _bsNoSweep: true }]];

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const out = [];
  for (const [tag, flags] of ARMS) {
    const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
    const logs = [];
    page.on('console', m => { const t = m.text(); if (/backstop sweep|a137 ordering clamp|backstop contract/.test(t)) logs.push(t); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 120000 });
    for (let t = 0; t < 40; t++) {
      const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
      if (ok) break; await new Promise(r => setTimeout(r, 1000));
    }
    const ms = await page.evaluate(async (f) => {
      window._rayReproject = true;
      if (f._noOrderClamp) window._noOrderClamp = true;
      if (f._bsNoSweep) window._bsNoSweep = true;
      bgQuickBake = false; bgMPIFullPlanes = false; bgMPIMode = false;   // v1
      const t0 = performance.now();
      bgBuildStamp = null; buildBackgroundLayer();
      return Math.round(performance.now() - t0);
    }, flags).catch(() => -1);
    out.push({ tag, ms, logs });
    await page.close();
  }
  // A134: the arms must diverge downstream of the flag before any number is read.
  assertArmsDiffer(out.map(r => [r.tag, armWitness(r.logs)]));

  console.log('\n' + ASSET + '  v1: THE CLAMP AGAINST THE SWEEP');
  for (const r of out) {
    console.log('\n=== ' + r.tag + '   (full v1 bake ' + r.ms + 'ms) ===');
    for (const l of r.logs) console.log('   | ' + l.slice(0, 185));
  }
  const sweepOf = (r) => (r.logs.find(l => /backstop sweep/.test(l)) || '(sweep did not run)');
  console.log('\n  VERDICT');
  console.log('   clamp OFF: ' + sweepOf(out[0]).replace(/^\[RUNG-PLUG\] /, ''));
  console.log('   clamp ON : ' + sweepOf(out[1]).replace(/^\[RUNG-PLUG\] /, ''));
  console.log('   If the second line says "clean", the O(N) inequality left the rendered');
  console.log('   search nothing to find, from an instrument that shares no code with it.');
  console.log('   Bake time with the sweep off: ' + out[2].ms + 'ms vs ' + out[1].ms + 'ms with it.');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { if (!e.abGuard) console.error('ERR', e.stack || e.message); process.exit(1); });
