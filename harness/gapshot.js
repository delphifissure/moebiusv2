// A118c: WHAT DOES THE GAP MASK CLAIM, AND WHERE?
// shimmer2 says the mask claims 4.11% of the frame AT REST, where the
// reprojection is identity and there can be no disocclusion by construction —
// and that the claim barely grows with angle (4.11% rest -> 4.35% at 0.85x
// rim) when true reveal area should grow strongly. Dump the mask itself.
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
(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  const shots = await page.evaluate(async () => {
    isSweeping = true;
    const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
    const sel = document.getElementById('debugViewSelect');
    const out = [];
    for (const [nm, fx] of [['rest',0],['0.85xR',0.85]]) {
      camera.position.set(fx * dist * Math.tan(60*Math.PI/180), 0, dist);
      for (const view of ['final','gaps','sd_gap_mask']) {
        if (sel) sel.value = view;
        for (let n=0;n<3;n++) render();
        out.push({ nm, view, png: renderer.domElement.toDataURL('image/png') });
      }
    }
    if (sel) sel.value = 'final';
    camera.position.set(0,0,dist); render();
    return out;
  });
  for (const s of shots) {
    fs.writeFileSync(path.join(OUTD, 'GAP_' + ASSET + '_' + s.nm + '_' + s.view + '.png'),
      Buffer.from(s.png.split(',')[1], 'base64'));
    console.log('wrote GAP_' + ASSET + '_' + s.nm + '_' + s.view + '.png');
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
