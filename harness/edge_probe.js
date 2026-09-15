// which mesh draws the streaks off the frame edge at 26.5 deg with margin off: FG only / plate only / both
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const H = __dirname; const OUT = path.join(H, 'shots', 'liverepro', 'edgeprobe'); fs.mkdirSync(OUT, { recursive: true });
(async () => {
  fs.copyFileSync(path.join(H, '..', 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' }); await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
  await page.evaluate(() => document.getElementById('bgLayerBuildBtn').click());
  for (let t = 0; t < 320; t++) { if (await page.evaluate(() => !!window._bgQuickBaked && !!window._qbPlateF)) break; await new Promise(r => setTimeout(r, 1000)); }
  const shot = async (name) => { const r = await page.evaluate(() => { updateCameraAndProjection(); render(); updateCameraAndProjection(); render(); const W = renderer.domElement.width, Hh = renderer.domElement.height; const cv = document.createElement('canvas'); cv.width = W; cv.height = Hh; cv.getContext('2d').drawImage(renderer.domElement, 0, 0, W, Hh); return cv.toDataURL('image/png'); }); fs.writeFileSync(path.join(OUT, name), Buffer.from(r.split(',')[1], 'base64')); };
  await page.evaluate(() => { isSweeping = true; camera.position.set(-0.097, 0.023, 0.2); });
  const info = await page.evaluate(() => ({ plate2: !!(bgLayerMesh.userData.plate2), ring: (window._qbMargin || null), children: scene.children.filter(o => o.visible && o.isMesh).map(o => (o.name || o.userData.tag || o.material?.type) + ':' + (o.geometry?.attributes?.position?.count)) }));
  console.log(JSON.stringify(info).slice(0, 600));
  await shot('both.png');
  await page.evaluate(() => { bgLayerMesh.visible = false; for (const m of (bgLayerMesh.userData.ring || [])) m.visible = false; if (bgLayerMesh.userData.plate2) bgLayerMesh.userData.plate2.visible = false; }); await shot('fg_only.png');
  await page.evaluate(() => { bgLayerMesh.visible = true; for (const m of (bgLayerMesh.userData.ring || [])) m.visible = true; if (bgLayerMesh.userData.plate2) bgLayerMesh.userData.plate2.visible = true; mediaLayers[0].mesh.visible = false; }); await shot('plate_only.png');
  await browser.close(); srv.kill(); console.log('done');
})();
