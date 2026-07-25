// A119b: WHERE are the rest-pose interior gaps? Stop guessing at causes
// (band cut: falsified, identical on/off) and dump the classified mask as an
// image. R = interior gap, G = marked FG occluder, B = out-of-mesh void.
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
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0,140)));
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  const shots = await page.evaluate(async () => {
    isSweeping = true;
    const dist = Math.abs(camera.position.z - portalPlaneWorldZ) || 0.2;
    const q = postProcessScene.children[0];
    const mat = new THREE.ShaderMaterial({
      uniforms: { tMask: { value: null } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position,1.0); }',
      fragmentShader: `uniform sampler2D tMask; varying vec2 vUv; const float BN=64.0;
        void main(){ vec4 c=texture2D(tMask,vUv); float g=0.0,o=0.0,b=0.0;
          if(c.a>0.5){ if(c.b<(0.5/BN)) g=1.0; else if(c.b>0.995) b=1.0; else o=1.0; }
          gl_FragColor=vec4(g,o,b,1.0); }`,
      depthWrite:false, depthTest:false });
    const out = [];
    for (const [nm, fx] of [['rest',0],['0.85xR',0.85]]) {
      camera.position.set(fx*dist*Math.tan(60*Math.PI/180), 0, dist);
      for (let n=0;n<3;n++) render();
      renderNormalizedDepthPass();
      const thr = parseFloat(document.getElementById('fgSubThresholdSlider')?.value || '0.05');
      if (!runFGSubtraction(pingPongRenderTargetB?.texture || null, true, thr)) continue;
      const w = fgMaskTargetA.width, h = fgMaskTargetA.height;
      const rt = new THREE.WebGLRenderTarget(w,h,{minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,format:THREE.RGBAFormat,type:THREE.UnsignedByteType});
      const prev=q.material; q.material=mat; mat.uniforms.tMask.value=fgMaskTargetA.texture;
      renderer.setRenderTarget(rt); renderer.clear(); renderer.render(postProcessScene, postProcessCamera);
      const buf = new Uint8Array(w*h*4);
      renderer.readRenderTargetPixels(rt,0,0,w,h,buf);
      renderer.setRenderTarget(null); q.material=prev; rt.dispose();
      // readRenderTargetPixels is bottom-up; flip for a human-readable png
      const cv=document.createElement('canvas'); cv.width=w; cv.height=h;
      const cx=cv.getContext('2d'); const id=cx.createImageData(w,h);
      for(let y=0;y<h;y++) for(let x=0;x<w;x++){ const s=((h-1-y)*w+x)*4, d2=(y*w+x)*4;
        id.data[d2]=buf[s]?255:0; id.data[d2+1]=buf[s+1]?255:0; id.data[d2+2]=buf[s+2]?255:0; id.data[d2+3]=255; }
      cx.putImageData(id,0,0);
      out.push({ nm, png: cv.toDataURL('image/png') });
    }
    camera.position.set(0,0,dist); render();
    return out;
  });
  for (const s of shots) {
    fs.writeFileSync(path.join(OUTD,'GW_'+ASSET+'_'+s.nm+'.png'), Buffer.from(s.png.split(',')[1],'base64'));
    console.log('wrote GW_'+ASSET+'_'+s.nm+'.png');
  }
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
