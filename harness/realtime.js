// A118: WHAT DOES THE REALTIME (UNBAKED) PATH ACTUALLY LOOK LIKE, AND WHERE
// EXACTLY IS THE SHIMMER?
//
// User: "the realtime inpainted version *is not that bad*... for color it's
// really not that bad aside from the shimmering". So the target is not a
// better fill — it is THE SAME fill, frozen. Before freezing anything, the
// shimmer needs a number, because "it flickers" is not something you can
// regress against.
//
// SHIMMER = TEMPORAL VARIANCE AT A STATIC POSE. Park the camera, render N
// frames without moving, and diff them. A view-independent fill is bit-stable
// and scores 0. Anything that re-derives per frame, accumulates across frames,
// or depends on the previous frame's buffer, shows up here and nowhere else.
// Reported two ways:
//   shimmerMean  mean |frame_n - frame_n-1| over lit pixels, 0-255
//   shimmerMax   worst single pixel step
//   settleFrames how many frames until consecutive frames stop changing
//                (if it never settles, the fill is not converging, it is
//                 oscillating — a different defect with a different fix)
//
// Also measures, at each pose:
//   black%   holes in the frame
//   gap%     what the gap/SD mask claims, so "spilling over into places where
//            there are no disocclusions" can be compared against the black
//            that actually appears.
//
//   node harness/realtime.js [troll|star|warrior]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const OUTD = '/workspace/moebiusv2/harness/val';
const SRC = { troll:   ['defaultImgColor.png', 'defaultImgDepth.png'],
              star:    ['starwatcher_color.png', 'starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png', 'silverwarrior_depth.png'] };
const ASSET = process.argv[2] || 'troll';
const POSES = [ { nm: 'rest',   x: 0,     y: 0 },
                { nm: '0.30xR', x: 0.104, y: 0 },
                { nm: '0.52xR', x: 0.178, y: 0.021 },
                { nm: '0.85xR', x: 0.293, y: 0.005 },
                { nm: '0.85xU', x: 0.005, y: -0.293 } ];

(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 140)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  const info = await page.evaluate(() => ({
    useInpainting: (typeof useInpainting !== 'undefined') ? useInpainting : null,
    quickBaked: !!window._bgQuickBaked,
    plate: (typeof bgLayerMesh !== 'undefined' && !!bgLayerMesh),
    buildStamp: (typeof bgBuildStamp !== 'undefined') ? bgBuildStamp : null,
    isAccum: (typeof isAccumulatingGaps !== 'undefined') ? isAccumulatingGaps : null,
  }));
  console.log('NO BAKE. ' + JSON.stringify(info));
  const rows = await page.evaluate(async (poses) => {
    isSweeping = true;
    const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
    const W = 480, Hh = 300, N = 12;
    const grab = () => { const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh;
      const cx = cv.getContext('2d'); cx.drawImage(renderer.domElement, 0, 0, W, Hh);
      return cx.getImageData(0, 0, W, Hh).data; };
    const out = [];
    for (const p of poses) {
      camera.position.set(p.x, p.y, dist);
      // settle the pose first, then hold perfectly still and watch
      for (let n = 0; n < 4; n++) render();
      const frames = [];
      for (let n = 0; n < N; n++) { render(); frames.push(grab()); }
      let sum = 0, cnt = 0, mx = 0, settle = -1;
      for (let f = 1; f < N; f++) {
        let fsum = 0, fcnt = 0, fmax = 0;
        const a = frames[f-1], b = frames[f];
        for (let i = 0; i < W*Hh; i++) { const j = i*4;
          const la = 0.299*a[j]+0.587*a[j+1]+0.114*a[j+2];
          const lb = 0.299*b[j]+0.587*b[j+1]+0.114*b[j+2];
          if (la < 4 && lb < 4) continue;
          const d = Math.abs(la - lb); fsum += d; fcnt++; if (d > fmax) fmax = d;
        }
        const fm = fsum / Math.max(1, fcnt);
        sum += fm; cnt++; if (fmax > mx) mx = fmax;
        if (settle < 0 && fm < 0.05) settle = f;
      }
      const last = frames[N-1];
      let black = 0;
      for (let i = 0; i < W*Hh; i++) { const j = i*4; if (last[j]+last[j+1]+last[j+2] < 24) black++; }
      out.push({ nm: p.nm, shimmerMean: +(sum/Math.max(1,cnt)).toFixed(3),
                 shimmerMax: +mx.toFixed(1), settleFrames: settle,
                 black: +(100*black/(W*Hh)).toFixed(2),
                 png: renderer.domElement.toDataURL('image/png') });
    }
    camera.position.set(0, 0, dist); render();
    return out;
  }, POSES);
  for (const r of rows) {
    try { fs.writeFileSync(path.join(OUTD, 'RT_' + ASSET + '_' + r.nm + '.png'),
          Buffer.from(r.png.split(',')[1], 'base64')); } catch (e) {}
    delete r.png;
  }
  console.log('\n' + ASSET + '  REALTIME (no bake), 12 frames held still at each pose');
  console.log('  pose      black%   shimmerMean   shimmerMax   settleFrame');
  for (const r of rows) console.log('  ' + r.nm.padEnd(9) + String(r.black).padStart(7) +
    String(r.shimmerMean).padStart(13) + String(r.shimmerMax).padStart(13) +
    String(r.settleFrames < 0 ? 'NEVER' : r.settleFrames).padStart(14));
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
