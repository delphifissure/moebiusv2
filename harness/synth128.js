// A138: DOES THE FOLD-CORRECT PLATE STEP WIN ONCE THE CONSTRAINT IS
// EXPRESSIBLE?
//
// a128 measured the fold-correct step (1/k = 0.00176) losing to the stale
// bgConeSlopePerPx, and a131 confirmed it on comb energy as well as black%.
// a133 then found the MECHANISM: at 8 bits one quantum is 0.00392, so the
// fold-correct step is 0.45 of the smallest step the source can express.
// Enforcing it cannot preserve structure — it flattens (71% of the troll plate
// lowered, by up to half the depth range).
//
// That explains the result but leaves the interesting question open, and the
// repository cannot answer it: no float depth exists anywhere, no estimator is
// named, the PNGs carry no metadata. So this uses a SYNTHETIC asset with
// analytically-known float depth (harness/mksynth.py), quantised to 8 bits to
// make the pair. Ground truth is synthesised; nothing is reconstructed.
//
// THE FIELD IS BUILT TO SEPARATE THE HYPOTHESES. Measured by the generator:
//     ground ramp slope 0.000702 depth/texel
//       = 0.18 of an 8-bit quantum  -> 8-bit renders it as terraces whose
//         risers are a full 0.00392 = 2.23x the fold limit, so a fold-correct
//         limiter MUST lower them
//       = 0.40 of the fold limit    -> genuinely fold-safe at 16-bit, so the
//         same limiter should leave it alone
// Same geometry, same colour, same resolution as troll (so k = 568 and the
// numbers sit next to the a131 table). Only expressibility changes.
//
// PREDICTIONS, STATED BEFORE THE RUN:
//   P1  a89 reports 1/255 on the 8-bit arm and 1/65535 (or continuous) on the
//       16-bit arm. If not, the synthetic carries no sub-8-bit information and
//       the whole test is void.
//   P2  8-bit: the fold-correct step lowers a large fraction of the plate and
//       measures WORSE — reproducing a131 on synthetic content.
//   P3  16-bit: the fold-correct step lowers far less and measures the same or
//       BETTER. This is the claim under test. If it still loses at 16-bit, the
//       quantum was not the reason and a128's stale constant is right on its
//       own merits.
//
//   node harness/synth128.js
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const { armWitness, assertArmsDiffer } = require('./abguard');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const DEGS = [0, 15, 25, 32, 38];
const ARMS = [
  ['8-bit  + stale step (shipped)',  { depth: 'synth_depth8.png',  env: false }],
  ['8-bit  + fold-correct 1/k',      { depth: 'synth_depth8.png',  env: true  }],
  ['16-bit + stale step (shipped)',  { depth: 'synth_depth16.png', env: false }],
  ['16-bit + fold-correct 1/k',      { depth: 'synth_depth16.png', env: true  }]
];

(async () => {
  fs.copyFileSync(path.join(H, 'synth_color.png'), path.join(H, 'defaultImgColor.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const all = {}, notes = {};
  for (const [tag, f] of ARMS) {
    fs.copyFileSync(path.join(H, f.depth), path.join(H, 'defaultImgDepth.png'));
    const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
    const logs = [];
    page.on('console', m => { const t = m.text();
      if (/a89:|a99:|a127b k =|a133 |slope-limited|a135 ordering/.test(t)) logs.push(t); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 40; t++) {
      const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
      if (ok) break; await new Promise(r => setTimeout(r, 1000));
    }
    const rows = await page.evaluate(async (o) => {
      window._rayReproject = true;
      bgViewFadeStartDeg = 35; bgViewFadeEndDeg = 45;
      if (o.env) window._envelopePlateStep = true;
      bgQuickBake = true; bgMPIFullPlanes = false; bgMPIMode = false;
      bgBuildStamp = null; buildBackgroundLayer();
      isSweeping = true;
      const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
      const W = 480, Hh = 300;
      const grab = () => { for (let n = 0; n < 3; n++) render();
        const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
        const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
        return cx.getImageData(0, 0, W, Hh).data; };
      const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      camera.position.set(0, 0, dist);
      const d0 = grab();
      let x0 = W, x1 = -1, y0 = Hh, y1 = -1;
      for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4;
        if (d0[i] + d0[i + 1] + d0[i + 2] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      const out = [];
      for (const deg of o.degs) {
        camera.position.set(dist * Math.tan(deg * Math.PI / 180), 0, dist);
        const d = grab();
        let blk = 0, tot = 0, cx_ = 0, nx = 0, cy_ = 0, ny = 0;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          const i = (y * W + x) * 4; tot++;
          if ((d[i] + d[i + 1] + d[i + 2]) < 24) { blk++; continue; }
          if (x > x0 && x < x1) { const a = (y * W + x - 1) * 4, b = (y * W + x + 1) * 4;
            if ((d[a] + d[a + 1] + d[a + 2]) >= 24 && (d[b] + d[b + 1] + d[b + 2]) >= 24) { cx_ += Math.abs(lum(d, a) - 2 * lum(d, i) + lum(d, b)); nx++; } }
          if (y > y0 && y < y1) { const a = ((y - 1) * W + x) * 4, b = ((y + 1) * W + x) * 4;
            if ((d[a] + d[a + 1] + d[a + 2]) >= 24 && (d[b] + d[b + 1] + d[b + 2]) >= 24) { cy_ += Math.abs(lum(d, a) - 2 * lum(d, i) + lum(d, b)); ny++; } }
        }
        out.push({ deg, black: +(100 * blk / Math.max(1, tot)).toFixed(2),
                   combX: +(cx_ / Math.max(1, nx)).toFixed(3), combY: +(cy_ / Math.max(1, ny)).toFixed(3) });
      }
      camera.position.set(0, 0, dist); render();
      return out;
    }, Object.assign({ degs: DEGS }, f));
    all[tag] = rows; notes[tag] = logs;
    await page.close();
  }
  assertArmsDiffer(ARMS.map(([tag]) => [tag, armWitness(notes[tag])]));

  const pad = (s, n) => String(s).padStart(n);
  console.log('\nSYNTHETIC ASSET — does the fold-correct step win once it is expressible?');
  for (const [tag] of ARMS) {
    console.log('\n=== ' + tag + ' ===');
    for (const l of notes[tag]) console.log('   | ' + l.slice(0, 180));
    console.log('   deg      black%     comb X     comb Y');
    for (const r of all[tag]) console.log('   ' + pad(r.deg, 3) + pad(r.black, 11) + pad(r.combX, 11) + pad(r.combY, 11));
  }
  const diff = (a, b, label) => {
    const A = all[a], B = all[b];
    console.log('\n  ' + label + '   (negative = fold-correct wins)');
    console.log('   deg     d black     d combX     d combY');
    for (let i = 0; i < DEGS.length; i++)
      console.log('   ' + pad(DEGS[i], 3) + pad((A[i].black - B[i].black).toFixed(2), 12) +
        pad((A[i].combX - B[i].combX).toFixed(3), 12) + pad((A[i].combY - B[i].combY).toFixed(3), 12));
  };
  diff(ARMS[1][0], ARMS[0][0], '8-bit:  fold-correct MINUS stale');
  diff(ARMS[3][0], ARMS[2][0], '16-bit: fold-correct MINUS stale');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { if (!e.abGuard) console.error('ERR', e.stack || e.message); process.exit(1); });
