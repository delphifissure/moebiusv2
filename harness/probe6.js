// Pure-displacement probe: render the FG with a minimal material (no discards
// at all) and count holes in the head box. Also dump the image.
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
  page.on('console', m => { const t=m.text(); if (/probe6|error/i.test(t)) console.log('  [page]', t); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && fgMarkDilationMaterial && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate(async () => {
    const L = mediaLayers[0];
    bgMPIFullPlanes=false; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer();   // torn, baked+halo, cut off
    const mu = L.mesh.material.uniforms;
    const pure = new THREE.ShaderMaterial({
      uniforms: {
        displacementMap: { value: mu.displacementMap.value },
        u_portalPlaneDepthNorm: { value: mu.u_portalPlaneDepthNorm.value },
        u_worldOuterVolumeDepth: { value: mu.u_worldOuterVolumeDepth.value },
        u_worldInnerVolumeDepth: { value: mu.u_worldInnerVolumeDepth.value },
        displacementBias: { value: mu.displacementBias.value }
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
    const prevMat = L.mesh.material;
    L.mesh.material = pure;
    if (bgLayerMesh) bgLayerMesh.visible = false;
    camera.position.x = 0; camera.position.y = 0;
    const W = renderer.domElement.width, H = renderer.domElement.height;
    const tmpRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat });
    renderer.setRenderTarget(tmpRT);
    renderer.setClearColor(new THREE.Color(0,0,0), 0.0);
    renderer.clear();
    renderer.render(scene, camera);
    const px = new Uint8Array(W*H*4);
    renderer.readRenderTargetPixels(tmpRT, 0, 0, W, H, px);
    renderer.setRenderTarget(null); tmpRT.dispose();
    L.mesh.material = prevMat;
    if (bgLayerMesh) bgLayerMesh.visible = true;
    let holes = 0;
    for (let y = 120; y < 300; y++) for (let x = 230; x < 360; x++) {
      const gy = H - 1 - y; if (px[(gy*W+x)*4+3] < 128) holes++;
    }
    // dump image
    const c = document.createElement('canvas'); c.width=W; c.height=H;
    const cx = c.getContext('2d'); const id = cx.createImageData(W,H);
    for (let yy=0; yy<H; yy++) for (let xx=0; xx<W; xx++) {
      const s=((H-1-yy)*W+xx)*4, d=(yy*W+xx)*4;
      if (px[s+3] < 128) { id.data[d]=255; id.data[d+1]=0; id.data[d+2]=255; }
      else { const v=px[s]; id.data[d]=v; id.data[d+1]=v; id.data[d+2]=v; }
      id.data[d+3]=255;
    }
    cx.putImageData(id,0,0);
    return { holes, img: c.toDataURL('image/png') };
  });
  fs.writeFileSync('probe6_pure.png', Buffer.from(res.img.split(',')[1],'base64'));
  console.log('PROBE6 holes:', res.holes);
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
