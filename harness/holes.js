// A125: WHERE DO THE 0.85x-RIM HOLES COME FROM?
//
// User grid at cam(0.294,-0.004,0.200), 55.7deg, 0.85x rim, mode=quick:
// "tons of stretching and holes". The panels localise it: MESH FOOTPRINT has
// large BLACK regions (FG not covering) and SCENE COLOR (pre-inpaint) has the
// same holes, so the plate is not reaching behind them.
//
// Two candidate mechanisms, both testable:
//   cut   the a72 stretch-cut discards FG fragments whose UV rate exceeds
//         u_cutSharp (stamp says cut=0.008). Those texels are NOT part of
//         `disocc`, so the plate island never covers them.
//   band  the plate island is `disocc` alone — the TIGHT silhouette footprint
//         (a59c). Its comment claims "the FG sliding over a complete
//         background reveals no hole at any angle". _bgPlugBand restores the
//         wider bud-scaled band.
//
// black% is measured INSIDE the rest-pose layer footprint, so the letterbox
// (53% of the canvas, and not a hole) cannot flatter or dominate the number.
//
//   node harness/holes.js [troll|star|warrior]
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const OUTD = '/workspace/moebiusv2/harness/val';
const ASSET = process.argv[2] || 'troll';
const SRC = { troll: ['defaultImgColor.png','defaultImgDepth.png'],
              star: ['starwatcher_color.png','starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png','silverwarrior_depth.png'] };
// Round 1 falsified the stretch-cut and the plate band: all four arms were
// identical to 2dp (0 / 1.68 / 2.87 / 4.06 / 5.21). Round 2 goes after the
// bigger number in the same log — the PLATE is torn too:
//   [QUICK-BAKE] a87 plate tear: 71072 spanning triangles dropped at plate
//   cliffs (4.09% of the plate)
// 4.09% of the plate removed is close to the 5.21% black measured at 0.85x
// rim, and a hole in the PLATE is a hole in the frame by construction.
// Round 3: a126 replaces the plate TEAR with a plate SLOPE LIMIT. Compare
// against the old tear and against simply not tearing, so the slope limit has
// to beat both to earn the default.
const ARMS = [ ['a126 slope-limit', {}],
               ['a87 tear (old)',   { _legacyPlateTear: true }],
               ['no plate tear',    { _legacyPlateTear: true, _noPlateTear: true }] ];
(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const all = {};
  for (const [tag, flags] of ARMS) {
    const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0,160)));
    const logs = [];
    page.on('console', m => { const t = m.text(); if (/plate plugs|cliff tear|plate tear|slope-limited/.test(t)) logs.push(t); });
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 40; t++) {
      const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
      if (ok) break; await new Promise(r => setTimeout(r, 1000));
    }
    const rows = await page.evaluate(async (f) => {
      window._rayReproject = true; Object.assign(window, f);
      bgQuickBake = true; bgMPIFullPlanes = false; bgMPIMode = false;
      bgBuildStamp = null; buildBackgroundLayer();
      if (f._noCut) setAllLayerUniforms('u_cutSharp', false);
      isSweeping = true;
      const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
      const W = 480, Hh = 300;
      const grab = () => { for (let n=0;n<3;n++) render();
        const cv=document.createElement('canvas'); cv.width=W; cv.height=Hh;
        const cx=cv.getContext('2d'); cx.drawImage(renderer.domElement,0,0,W,Hh);
        return cx.getImageData(0,0,W,Hh).data; };
      // footprint from the REST pose: the layer box, letterbox excluded
      camera.position.set(0,0,dist);
      const d0 = grab();
      let x0=W,x1=-1,y0=Hh,y1=-1;
      for (let y=0;y<Hh;y++) for (let x=0;x<W;x++){ const i=(y*W+x)*4;
        if (d0[i]+d0[i+1]+d0[i+2] > 24){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; } }
      const out=[];
      for (const frac of [0.0, 0.30, 0.52, 0.70, 0.85]) {
        camera.position.set(frac*dist*Math.tan(60*Math.PI/180), 0, dist);
        const d = grab();
        let n=0, tot=0;
        for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++){ const i=(y*W+x)*4; tot++;
          if (d[i]+d[i+1]+d[i+2] < 24) n++; }
        out.push({ frac, black: +(100*n/Math.max(1,tot)).toFixed(2),
                   png: (frac===0.85) ? renderer.domElement.toDataURL('image/png') : null });
      }
      camera.position.set(0,0,dist); render();
      return out;
    }, flags);
    for (const r of rows) { if (r.png) {
      try { fs.writeFileSync(path.join(OUTD,'HOLE_'+ASSET+'_'+tag.replace(/[^a-z]/gi,'')+'_085.png'),
            Buffer.from(r.png.split(',')[1],'base64')); } catch(e){} }
      delete r.png; }
    all[tag]=rows;
    console.log('\n=== ' + tag + ' ===');
    for (const l of logs) console.log('   | ' + l.slice(0,150));
    console.log('  black% inside footprint: ' + rows.map(r=>r.frac+'='+r.black).join('  '));
    await page.close();
  }
  console.log('\n' + ASSET + '  black% INSIDE the layer footprint (letterbox excluded)');
  console.log('  arm                 0.00    0.30    0.52    0.70    0.85');
  for (const [tag] of ARMS) console.log('  ' + tag.padEnd(18) + all[tag].map(r=>String(r.black).padStart(8)).join(''));
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
