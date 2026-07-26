// A150 diagnostic: dump the skirt's own bake log lines from a quick bake.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
(async () => {
  fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
  page.on('pageerror', e => console.log('[PAGEERR] ' + e.message.slice(0, 200)));
  page.on('console', m => { const t = m.text();
    if (/a149|a150|skirt/i.test(t)) console.log('  | ' + t.slice(0, 400)); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  const info = await page.evaluate(async (ed) => {
    window._rayReproject = true;
    bgViewFadeStartDeg = 35; bgViewFadeEndDeg = 45;
    if (ed) window._skirtEdgeDepth = true;
    bgQuickBake = true; bgMPIFullPlanes = false; bgMPIMode = false;
    bgBuildStamp = null; buildBackgroundLayer();
    const s = bgSkirtMesh;
    if (!s) return { skirt: null };
    const p = s.geometry.getAttribute('position');
    let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i);
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
    const gp = mediaLayers[0].mesh.geometry.parameters || {};
    return { skirt: true, tris: s.geometry.index.count / 3, verts: p.count,
      bbox: [minx, maxx, miny, maxy], plate: [gp.width, gp.height],
      visible: s.visible, inScene: !!s.parent, ownsMat: !!s.userData.ownsMaterial,
      renderOrder: s.renderOrder, bgOrder: bgLayerMesh.renderOrder,
      matSame: s.material === bgLayerMesh.material,
      dispSame: s.material.uniforms.displacementMap.value === bgLayerMesh.material.uniforms.displacementMap.value };
  }, process.env.EDGEDEPTH === '1');
  console.log(JSON.stringify(info, null, 1));
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
