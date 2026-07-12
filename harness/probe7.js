// Two decisive checks in one session:
//  A) depth pass with a PURE depth material injected via depthMaterialCache
//     (no discards) -> holes gone = hidden discard; holes remain = geometry.
//  B) GPU readback of the baked displacement texture vs CPU canvas values
//     along a line through the head -> upload/VTF corruption check.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('console', m => { const t=m.text(); if (/probe7|error/i.test(t)) console.log('  [page]', t); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && fgMarkDilationMaterial && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate(async () => {
    const L = mediaLayers[0];
    bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer();
    const mu = L.mesh.material.uniforms;
    // A) pure depth material into the cache
    const pure = new THREE.ShaderMaterial({
      uniforms: {
        displacementMap: { value: null },   // wired via shared uniforms? no — set explicitly each use
        u_portalPlaneDepthNorm: mu.u_portalPlaneDepthNorm,
        u_worldOuterVolumeDepth: mu.u_worldOuterVolumeDepth,
        u_worldInnerVolumeDepth: mu.u_worldInnerVolumeDepth,
        displacementBias: mu.displacementBias
      },
      vertexShader: `
        varying float vD;
        uniform sampler2D displacementMap;
        uniform float u_portalPlaneDepthNorm, u_worldOuterVolumeDepth, u_worldInnerVolumeDepth, displacementBias;
        void main() {
          float nd = texture2D(displacementMap, uv).r; vD = nd;
          float displacement;
          if (nd < u_portalPlaneDepthNorm) { float t = smoothstep(0.0, u_portalPlaneDepthNorm, nd); displacement = mix(-u_worldOuterVolumeDepth, 0.0, t); }
          else { float t = smoothstep(u_portalPlaneDepthNorm, 1.0, nd); displacement = mix(0.0, u_worldInnerVolumeDepth, t); }
          vec4 vp = modelViewMatrix * vec4(position, 1.0);
          vp.z += displacement + displacementBias;
          gl_Position = projectionMatrix * vp;
        }`,
      fragmentShader: `varying float vD; void main() { gl_FragColor = vec4(vec3(vD), 1.0); }`,
      side: THREE.DoubleSide
    });
    pure.uniforms.displacementMap = mu.displacementMap;   // share the live binding
    depthMaterialCache.set(L.mesh.material, pure);
    const holeCount = () => {
      isSweeping = true;
      camera.position.x = 0; camera.position.y = 0;
      if (bgLayerMesh) bgLayerMesh.visible = false;
      renderNormalizedDepthPass();
      if (bgLayerMesh) bgLayerMesh.visible = true;
      const rt = screenNormalizedDepthTarget, W = rt.width, H = rt.height;
      const tmpRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat });
      const q = postProcessScene.children[0]; const prev = q.material;
      q.material = copyMaterial; copyMaterial.uniforms.tDiffuse.value = rt.texture;
      renderer.setRenderTarget(tmpRT); renderer.setViewport(0,0,W,H); renderer.clear();
      renderer.render(postProcessScene, postProcessCamera);
      const px = new Uint8Array(W*H*4);
      renderer.readRenderTargetPixels(tmpRT, 0, 0, W, H, px);
      renderer.setRenderTarget(null); q.material = prev; tmpRT.dispose();
      let holes = 0;
      for (let y = 120; y < 300; y++) for (let x = 230; x < 360; x++) {
        const gy = H - 1 - y; if (px[(gy*W+x)*4+3] < 128) holes++;
      }
      return holes;
    };
    const holesPure = holeCount();
    // B) GPU vs CPU texture values along x=630, y=280..600 step 40 (source px)
    const tex = mu.displacementMap.value;
    const img = tex.image; const pw = img.width, ph = img.height;
    const rt2 = new THREE.WebGLRenderTarget(pw, ph, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat });
    const q = postProcessScene.children[0]; const prev = q.material;
    const sampMat = new THREE.ShaderMaterial({
      uniforms: { t: { value: tex } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position,1.0); }',
      fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = texture2D(t, vec2(vUv.x, 1.0-vUv.y)); }'
    });
    q.material = sampMat;
    renderer.setRenderTarget(rt2); renderer.setViewport(0,0,pw,ph); renderer.clear();
    renderer.render(postProcessScene, postProcessCamera);
    const gp = new Uint8Array(pw*ph*4);
    renderer.readRenderTargetPixels(rt2, 0, 0, pw, ph, gp);
    renderer.setRenderTarget(null); q.material = prev; rt2.dispose();
    const cv = document.createElement('canvas'); cv.width = pw; cv.height = ph;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(img, 0, 0);
    const cp = cx.getImageData(0, 0, pw, ph).data;
    const pairs = [];
    for (let y = 280; y <= 600; y += 40) {
      const sx = 630;
      const gi = ((ph - 1 - y) * pw + sx) * 4;   // GL flip in readback
      pairs.push({ y, cpu: cp[(y*pw+sx)*4], gpu: gp[gi] });
    }
    return { holesPure, pairs };
  });
  console.log('PROBE7', JSON.stringify(res));
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
