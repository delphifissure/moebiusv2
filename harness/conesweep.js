// A132: THE CHEAP SWEEP (REPLY01 §5).
//
// a128 found bgConeSlopePerPx returning 0.00564 at BOTH 45 and 60 degrees
// while the true 1/k moved 0.00176 -> 0.00102 — a stale constant sitting
// between k and its only consumer, silently defeating a whole class of change.
// REPLY01: "for every constant that is supposed to be cone-derived, print its
// value at 45 and at 60 and assert it moved. Anything that doesn't move is
// either genuinely cone-independent — in which case say so in its name — or it
// is a second bgConeSlopePerPx."
//
// One line each. No hypotheses, no interpretation in the code: print, compare,
// label. VERDICTS:
//   MOVES      the quantity tracks the cone, as its use implies
//   CONE-BLIND identical at both cones while its consumer treats it as derived
//   BY DESIGN  genuinely cone-independent, and its name/comment says so
//
//   node harness/conesweep.js
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const H = path.join('/workspace/mm', 'harness');

(async () => {
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
  const rows = await page.evaluate(() => {
    const im = mediaLayers[0].textures.depth.image;
    const pw = im.naturalWidth || im.width, ph = im.naturalHeight || im.height;
    const at = (cone) => {
      bgViewFadeStartDeg = cone - 10; bgViewFadeEndDeg = cone;
      const L = bgShiftLUTFor(pw, ph);
      const k = Math.max(Math.abs(L.m0), Math.abs(L.m1));
      const dist = Math.max(1e-3, Math.abs(camera.position.z - portalPlaneWorldZ));
      const prof = bgDeviceFovProfile();
      window._coneSlopeDerived = true;
      const slopeDerived = bgConeSlopePerPx(pw);
      window._coneSlopeDerived = false;
      const slopeShipped = bgConeSlopePerPx(pw);
      // a113 extension margin: the shift envelope in source px, isotropic
      const marginPx = Math.min(pw, Math.ceil(Math.max(Math.abs(L.m0), Math.abs(L.m1))));
      return {
        'k = max|shift| at the rim (px)               [bgShiftLUTFor]': k,
        'fold limit sqrt(2)/k (depth)                 [derived from k]': Math.SQRT2 / k,
        'hidden-depth precision 1/k (depth)           [derived from k]': 1 / k,
        'a113 extension margin (source px)            [shift envelope]': marginPx,
        'a80/a121 scan radius = D*tan(cone) (world)   [viewpoint scan]': dist * Math.tan(cone * Math.PI / 180),
        'bgConeSlopeAtDepth d=0.20 (depth/texel)      [per-depth cone]': bgConeSlopeAtDepth(pw, ph, 0.20),
        'bgConeSlopeAtDepth d=0.50 (depth/texel)      [per-depth cone]': bgConeSlopeAtDepth(pw, ph, 0.50),
        'bgConeSlopeAtDepth d=0.80 (depth/texel)      [per-depth cone]': bgConeSlopeAtDepth(pw, ph, 0.80),
        'bgConeSlopePerPx OPT-IN derived branch       [_coneSlopeDerived]': slopeDerived,
        'bgConeSlopePerPx SHIPPED branch              [a128 plate step]': slopeShipped,
        'fgTearStep (the cliff criterion)             [module constant]': fgTearStep,
        'device camera hfov (deg)                     [physical LUT]': prof.hfov,
        'FG mark-reach ceiling (texels)               [shader clamp]': 63
      };
    };
    const a = at(45), b = at(60);
    bgViewFadeStartDeg = 35; bgViewFadeEndDeg = 45;
    return Object.keys(a).map(k => ({ name: k, v45: a[k], v60: b[k] }));
  });

  // Named as cone-independent on purpose. Anything else that does not move is
  // a finding, not a footnote.
  const BY_DESIGN = ['device camera hfov', 'FG mark-reach ceiling'];
  console.log('\nCONE-DERIVED CONSTANT SWEEP — every quantity a consumer treats as derived from the cone');
  console.log('  ' + 'quantity'.padEnd(62) + 'at 45deg'.padStart(14) + 'at 60deg'.padStart(14) + '   ratio   verdict');
  let blind = 0;
  for (const r of rows) {
    const moved = Math.abs(r.v60 - r.v45) > 1e-9 * Math.max(1, Math.abs(r.v45));
    const design = BY_DESIGN.some(s => r.name.includes(s));
    const verdict = design ? 'BY DESIGN' : (moved ? 'MOVES' : 'CONE-BLIND  <--');
    if (!design && !moved) blind++;
    const fmt = (v) => (Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(5));
    console.log('  ' + r.name.padEnd(62) + fmt(r.v45).padStart(14) + fmt(r.v60).padStart(14) +
                (r.v45 ? (r.v60 / r.v45).toFixed(3) : '  -').padStart(9) + '   ' + verdict);
  }
  console.log('\n  ' + blind + ' quantity(ies) are CONE-BLIND while a consumer treats them as cone-derived.');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
