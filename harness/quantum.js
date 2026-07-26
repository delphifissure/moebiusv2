// A133: IS a99's FLOAT DEPTH INGEST ACTUALLY LIVE ON THE PLATE PATH?
//
// REPLY02 §4, and it may reverse a128: "if the plate is still built from an
// 8-bit source, the fold-correct step will over-flatten by construction and can
// never win... if float ingest is live and the quantum is genuinely 0.00392,
// then the source itself is 8-bit upstream of the ingest, which is a different
// and larger finding."
//
// Two separable questions, and the arc has been conflating them:
//   CONTAINER  does the 16-bit PNG decoder fire when handed a 16-bit file?
//   CONTENT    how many distinct depth levels does the data actually carry?
//
// This driver answers both. Arm 1 is the shipped 8-bit troll depth. Arm 2 is
// `troll_depth16.png` — the SAME data re-encoded as 16-bit greyscale by exact
// x257 scaling, so it adds no information whatsoever. Predictions, stated
// before the run so they can fail:
//   - arm 2 must log a99's "16-bit precision" line (the container is decoded)
//   - arm 2 must STILL detect a 1/255 quantum (a89 measures the information,
//     not the format). If it reports 1/65535 instead, a89 is measuring the
//     container and every "source quanta" figure in this arc is wrong.
//   - the a133 precision line must be identical in both arms.
//
//   node harness/quantum.js
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');

// container bit depth straight out of the PNG header, no browser involved
function ihdr(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), bitDepth: b[24], colorType: b[25] };
}

const ARMS = [
  ['8-bit source (shipped)', path.join(WT, 'defaultImgDepth.png')],
  ['16-bit container, same data', path.join(H, 'troll_depth16.png')]
];

(async () => {
  console.log('CONTAINER (PNG IHDR, read directly — no renderer involved)');
  for (const f of ['defaultImgDepth.png', 'starwatcher_depth.png', 'silverwarrior_depth.png', 'roomDepth1.png']) {
    const i = ihdr(path.join(WT, f));
    console.log('  ' + f.padEnd(26) + i.w + 'x' + i.h + '  bitDepth=' + i.bitDepth +
                '  -> container quantum 1/' + ((1 << i.bitDepth) - 1));
  }
  const i16 = ihdr(path.join(H, 'troll_depth16.png'));
  console.log('  ' + 'troll_depth16.png'.padEnd(26) + i16.w + 'x' + i16.h + '  bitDepth=' + i16.bitDepth +
              '  -> container quantum 1/' + ((1 << i16.bitDepth) - 1) + '   (synthesised, x257 of the 8-bit source)');

  fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

  for (const [tag, src] of ARMS) {
    fs.copyFileSync(src, path.join(H, 'defaultImgDepth.png'));
    const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
    const logs = [];
    page.on('console', m => { const t = m.text(); if (/a99|a89|a127b|a133/.test(t)) logs.push(t); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 40; t++) {
      const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
      if (ok) break; await new Promise(r => setTimeout(r, 1000));
    }
    // Independent of any app log: count the DISTINCT depth values the renderer
    // actually holds. That is the content question, answered by counting.
    const content = await page.evaluate(async () => {
      window._rayReproject = true;
      bgQuickBake = true; bgMPIFullPlanes = false; bgMPIMode = false;
      bgBuildStamp = null; buildBackgroundLayer();
      const L = mediaLayers[0];
      // Load the depth FILE fresh rather than reading L.textures.depth.image:
      // the bake replaces that texture's image with a canvas/DataTexture, so
      // reading it would measure the bake's output and call it the source.
      const im = await new Promise((res, rej) => {
        const i = new Image(); i.onload = () => res(i); i.onerror = rej;
        i.src = 'defaultImgDepth.png?t=' + Math.random();
      });
      const w = im.naturalWidth || im.width, h = im.naturalHeight || im.height;
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const cc = cv.getContext('2d', { willReadFrequently: true });
      cc.drawImage(im, 0, 0, w, h);
      const d = cc.getImageData(0, 0, w, h).data;
      const seen = new Uint8Array(256);
      for (let i = 0; i < w * h; i++) seen[d[i * 4]] = 1;
      let n8 = 0; for (let i = 0; i < 256; i++) n8 += seen[i];
      const f16 = !!(L._depth16 && L._depth16.data);
      let n16 = null, sub = 0;
      if (f16) {
        const set = new Set();
        for (let i = 0; i < L._depth16.data.length; i += Math.max(1, (L._depth16.data.length / 400000) | 0)) {
          const v = Math.round(L._depth16.data[i] * 65535);
          set.add(v);
          if (v % 257 !== 0) sub++;     // not on the 8-bit grid
        }
        n16 = set.size;
      }
      return { w, h, distinct8: n8, float16Present: f16, distinct16: n16, offGridSamples: sub };
    });

    console.log('\n=== ' + tag + ' ===');
    for (const l of logs) console.log('   | ' + l.slice(0, 190));
    console.log('   distinct 8-bit values in the decoded image: ' + content.distinct8 + ' of 256');
    console.log('   L._depth16 float buffer present: ' + content.float16Present +
      (content.float16Present ? ('  | distinct 16-bit levels sampled: ' + content.distinct16 +
        '  | samples OFF the 8-bit grid: ' + content.offGridSamples) : ''));
    await page.close();
  }
  // leave the tree as we found it
  fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
