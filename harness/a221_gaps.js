// A221 ONE GAP AUTHORITY — decisive three-arm run, fresh contract at capture.
//   A  realtime, unbaked (reference)
//   B  baked, _oneGapAuthority (srcPath stays raw)
//   C  baked, shipped defaults (srcPath=sharp)
// Capture = the debug sheet's own recipe: refresh renderNormalizedDepthPass +
// runFGSubtraction at the CURRENT pose, dets off, BG hidden, scene into
// pingPongRenderTargetB with clearAlpha 0; alpha<thr = gap.
//   node harness/a221_gaps.js
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = process.env.WT || '/workspace/mm', H = path.join(WT, 'harness');
const OUT = '/tmp/claude-0/-home-user-moebius/989b3965-28fd-58c7-96b5-b4b22c709919/scratchpad/a221';
const POSE = { x: 0.100, y: -0.023, z: 0.200 };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });

  const newPage = async () => {
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } });
    page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0, 160)));
    await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) {
      const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch (e) { return false; } }).catch(() => false);
      if (ok) break; await new Promise(r2 => setTimeout(r2, 1000));
    }
    return page;
  };

  const capture = async (page, opts, tag) => {
    const r = await page.evaluate(async (o) => {
      window._rayReproject = true;
      if (o.authority) window._oneGapAuthority = true;
      if (o.bake) { bgQuickBake = true; buildBackgroundLayer(); }
      isSweeping = true;
      camera.position.set(o.pose.x, o.pose.y, o.pose.z);
      updateCameraAndProjection(); render(); render();
      // the sheet's pre-panel refresh, verbatim: contract at the CURRENT pose
      renderNormalizedDepthPass();
      const thrR = parseFloat(document.getElementById('fgSubThresholdSlider')?.value || '0.05');
      try { runFGSubtraction(pingPongRenderTargetB?.texture || null, true, thrR); } catch (e) {}
      // the sheet's gap capture
      const hiddenBG = [];
      scene.traverse((m) => {
        if (!m.isMesh || !m.visible) return;
        const u = m.material && m.material.uniforms;
        if (u && u.u_isBackgroundLayer && u.u_isBackgroundLayer.value && !m.userData.v2Plane) { hiddenBG.push(m); m.visible = false; }
      });
      for (const un of ['u_useDepthGrad','u_useSobel','u_useLuma','u_useChroma','u_useCrease','u_useCurvature','u_useUVStretch','u_useGrazingAngle','u_useEdgeMask'])
        setAllLayerUniforms(un, false);
      const prevRT = renderer.getRenderTarget();
      const prevCC = new THREE.Color(); renderer.getClearColor(prevCC);
      const prevCA = renderer.getClearAlpha();
      renderer.setClearColor(new THREE.Color(0, 0, 0), 0.0);
      renderer.setRenderTarget(pingPongRenderTargetB); renderer.clear();
      renderer.render(scene, camera);
      const W = pingPongRenderTargetB.width, Hh = pingPongRenderTargetB.height;
      const isFloat = pingPongRenderTargetB.texture.type === THREE.FloatType || pingPongRenderTargetB.texture.type === THREE.HalfFloatType;
      const buf = isFloat ? new Float32Array(W * Hh * 4) : new Uint8Array(W * Hh * 4);
      renderer.readRenderTargetPixels(pingPongRenderTargetB, 0, 0, W, Hh, buf);
      renderer.setRenderTarget(prevRT); renderer.setClearColor(prevCC, prevCA);
      for (const m of hiddenBG) m.visible = true;
      const thr = isFloat ? 0.03 : 8;
      const mask = new Uint8Array(W * Hh);
      let anyOpaque = 0;
      for (let i = 0; i < W * Hh; i++) { const a = buf[i*4+3]; if (a >= thr) anyOpaque++; mask[i] = a < thr ? 1 : 0; }
      if (!anyOpaque) return { dead: true };
      return { mask: Array.from(mask), W, Hh, stampSrc: (mediaLayers[0]._srcSharpApplied ? 'sharp' : 'raw') };
    }, Object.assign({ pose: POSE }, opts));
    if (r.dead) { console.log(tag + ': DEAD CAPTURE'); return r; }
    let n = 0, border = 0;
    const { mask, W, Hh } = r;
    for (let y = 1; y < Hh - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y*W + x; if (!mask[i]) continue; n++;
      if (!mask[i-1] || !mask[i+1] || !mask[i-W] || !mask[i+W]) border++;
    }
    console.log(tag + ': srcPath=' + r.stampSrc + '  gap px=' + n + '  boundary px=' + border + '  boundary/area=' + (border/Math.max(1,n)).toFixed(3));
    return r;
  };

  const xor = (a, b, tag) => {
    let un = 0, x = 0;
    for (let i = 0; i < a.mask.length; i++) { const p = a.mask[i], q = b.mask[i];
      if (p || q) un++; if (p !== q) x++; }
    console.log(tag + ': XOR=' + x + ' px = ' + (100*x/Math.max(1,un)).toFixed(1) + '% of union');
  };
  const savePng = (m, name) => {
    let PNG; try { PNG = require('pngjs').PNG; } catch (e) { return; }
    const png = new PNG({ width: m.W, height: m.Hh });
    for (let i = 0; i < m.W * m.Hh; i++) { const v = m.mask[i] ? 255 : 0;
      png.data[i*4] = v; png.data[i*4+1] = v; png.data[i*4+2] = v; png.data[i*4+3] = 255; }
    fs.writeFileSync(path.join(OUT, name), PNG.sync.write(png));
  };

  const p1 = await newPage();
  const A = await capture(p1, { bake: false }, 'A realtime raw     ');
  await p1.close();
  const p2 = await newPage();
  const B = await capture(p2, { bake: true, authority: true }, 'B baked authority  ');
  await p2.close();
  const p3 = await newPage();
  const C = await capture(p3, { bake: true }, 'C baked default    ');
  await p3.close();

  xor(A, B, 'A vs B (authority, fresh contract)');
  xor(A, C, 'A vs C (default,   fresh contract)');
  savePng(A, 'gaps_A_fresh.png'); savePng(B, 'gaps_B_fresh.png'); savePng(C, 'gaps_C_fresh.png');
  console.log('masks -> ' + OUT);
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
