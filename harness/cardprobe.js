const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs=require('fs'), path=require('path');
const CHROME='/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT='/workspace/mm', H=path.join(WT,'harness');
(async()=>{
  fs.copyFileSync(path.join(WT,'defaultImgColor.png'), path.join(H,'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT,'defaultImgDepth.png'), path.join(H,'defaultImgDepth.png'));
  const srv=spawn('node',['scratch_server.js'],{cwd:H,stdio:'ignore'});
  await new Promise(r=>setTimeout(r,1500));
  const b=await chromium.launch({executablePath:CHROME,headless:true,
    args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
  const p=await b.newPage({viewport:{width:720,height:450}});
  p.on('pageerror',e=>console.log('  [PAGEERR] '+e.message.slice(0,140)));
  await p.goto('http://localhost:8099/scratch_moebius.html',{waitUntil:'load',timeout:90000});
  for(let t=0;t<40;t++){const ok=await p.evaluate(()=>{try{return !!(mediaLayers[0]?.mesh&&mediaLayers[0]?.textures?.depth);}catch(e){return false;}}).catch(()=>false); if(ok)break; await new Promise(r=>setTimeout(r,1000));}
  const out=await p.evaluate(async()=>{
    window._rayReproject=true; bgQuickBake=true; buildBackgroundLayer();
    isSweeping=true; const dist=Math.abs(camera.position.z-portalPlaneWorldZ)||0.2;
    camera.position.set(0,0,dist);
    const lit=()=>{ for(let n=0;n<3;n++) render();
      const W=360,Hh=225,cv=document.createElement('canvas');cv.width=W;cv.height=Hh;
      const cx=cv.getContext('2d');cx.drawImage(renderer.domElement,0,0,W,Hh);
      const d=cx.getImageData(0,0,W,Hh).data;let n2=0;
      for(let i=0;i<W*Hh;i++) if(d[i*4]+d[i*4+1]+d[i*4+2]>24) n2++;
      return 100*n2/(W*Hh); };
    const L=mediaLayers[0];
    const info={
      cardMeshExists: (typeof bgCardMesh !== 'undefined') && !!bgCardMesh,
      cardInScene: (typeof bgCardMesh !== 'undefined') && !!(bgCardMesh && bgCardMesh.parent),
      cardVisible: (typeof bgCardMesh !== 'undefined') && !!(bgCardMesh && bgCardMesh.visible),
      cardTris: (typeof bgCardMesh !== 'undefined' && bgCardMesh) ? (bgCardMesh.geometry.index ? bgCardMesh.geometry.index.count/3 : -1) : -1,
      sameParent: (typeof bgCardMesh !== 'undefined') && !!(bgCardMesh && L.mesh && bgCardMesh.parent === L.mesh.parent),
    };
    info.fgAttrs = Object.keys(L.mesh.geometry.attributes).sort();
    info.cardAttrs = (typeof bgCardMesh!=='undefined'&&bgCardMesh)?Object.keys(bgCardMesh.geometry.attributes).sort():[];
    info.fgMatType = L.mesh.material.type;
    info.cardMatType = (typeof bgCardMesh!=='undefined'&&bgCardMesh)?bgCardMesh.material.type:'-';
    info.cardBoundingSphere = (typeof bgCardMesh!=='undefined'&&bgCardMesh)?(bgCardMesh.geometry.boundingSphere?bgCardMesh.geometry.boundingSphere.radius:'null'):'-';
    info.cardFrustumCulled = (typeof bgCardMesh!=='undefined'&&bgCardMesh)?bgCardMesh.frustumCulled:'-';
    info.cardLayers = (typeof bgCardMesh!=='undefined'&&bgCardMesh)?bgCardMesh.layers.mask:'-';
    info.fgLayers = L.mesh.layers.mask;
    info.litAll = lit();
    if (L.mesh) L.mesh.visible = false;
    info.litNoFG = lit();
    if (typeof bgCardMesh !== 'undefined' && bgCardMesh) bgCardMesh.visible = false;
    info.litNoFGNoCards = lit();
    if (typeof bgCardMesh !== 'undefined' && bgCardMesh) bgCardMesh.visible = true;
    if (L.mesh) L.mesh.visible = true;
    info.litRestored = lit();
    // THE TEST: the card material is a clone of the FG material, and the FG
    // fragment shader ends with `if (isGap && !u_isBackgroundLayer) discard;`.
    // The clone never sets u_isBackgroundLayer, so it inherits false and every
    // card fragment flagged as gap is thrown away — and the cards sit exactly
    // in the torn region. Flip it at RUNTIME, change nothing else.
    if (typeof bgCardMesh !== 'undefined' && bgCardMesh) {
      const u = bgCardMesh.material.uniforms;
      info.cardIsBgUniformExists = !!u.u_isBackgroundLayer;
      info.cardIsBgWas = u.u_isBackgroundLayer ? u.u_isBackgroundLayer.value : '(absent)';
      if (u.u_isBackgroundLayer) u.u_isBackgroundLayer.value = true;
      bgCardMesh.material.needsUpdate = true;
    }
    info.litCardsAsBg = lit();
    if (L.mesh) L.mesh.visible = false;
    info.litCardsAsBgNoFG = lit();
    // DECISIVE: swap the card material for a plain unlit red, no shader, no
    // displacement, no discard. If red appears, the geometry and its place in
    // the scene are fine and the FG-derived material is what kills the draw.
    // If nothing appears, the geometry or its transform is wrong and no
    // material change will ever help.
    if (typeof bgCardMesh !== 'undefined' && bgCardMesh) {
      bgCardMesh.material = new THREE.MeshBasicMaterial({ color: 0xff0000, side: THREE.DoubleSide,
                                                          depthTest: false, depthWrite: false });
      bgCardMesh.renderOrder = 999;
    }
    info.litFlatRedNoFG = lit();
    // and count actual RED pixels, so 'lit' cannot be confused with the plate
    { for (let n=0;n<3;n++) render();
      const W=360,Hh=225,cv=document.createElement('canvas');cv.width=W;cv.height=Hh;
      const cx=cv.getContext('2d');cx.drawImage(renderer.domElement,0,0,W,Hh);
      const d=cx.getImageData(0,0,W,Hh).data;let red=0;
      for(let i=0;i<W*Hh;i++) if(d[i*4]>150 && d[i*4+1]<80 && d[i*4+2]<80) red++;
      info.redPct = 100*red/(W*Hh); }
    // ---- THE BISECT ----
    // FG VERTEX shader + trivial solid-green FRAGMENT shader, sharing the FG's
    // live uniforms so the vertex stage has every sampler and value it expects.
    // (A fragment shader need not declare varyings the vertex stage writes, so
    // this compiles.) Green present => the vertex stage places the cards fine
    // and the FG FRAGMENT stage is discarding them by some path other than
    // isGap. Green absent => the vertex stage is putting them somewhere
    // invisible, which is where the reprojection lives.
    if (typeof bgCardMesh !== 'undefined' && bgCardMesh) {
      const fgMat = L.mesh.material;
      try {
        bgCardMesh.material = new THREE.ShaderMaterial({
          uniforms: fgMat.uniforms,
          vertexShader: fgMat.vertexShader,
          fragmentShader: 'void main() { gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0); }',
          side: THREE.DoubleSide, depthTest: false, depthWrite: false
        });
        bgCardMesh.renderOrder = 999;
        info.bisectBuilt = true;
      } catch (e) { info.bisectBuilt = 'ERR ' + e.message; }
    }
    { for (let n=0;n<3;n++) render();
      const W=360,Hh=225,cv=document.createElement('canvas');cv.width=W;cv.height=Hh;
      const cx=cv.getContext('2d');cx.drawImage(renderer.domElement,0,0,W,Hh);
      const d=cx.getImageData(0,0,W,Hh).data;let g=0;
      for(let i=0;i<W*Hh;i++) if(d[i*4+1]>150 && d[i*4]<80 && d[i*4+2]<80) g++;
      info.greenPct_fgVertexShader = 100*g/(W*Hh); }
    // FG vertex shader + a fragment that PAINTS THE ALPHA the FG shader tests.
    // The FG fragment does `originalColor = texture2D(map, vUv)` then
    // `if (originalColor.a < 0.01) discard;`. Every cap card sits where a
    // triangle was dropped, i.e. at a depth cliff — if the colour texture
    // carries alpha = the FG mask, every card samples 0 and discards.
    if (typeof bgCardMesh !== 'undefined' && bgCardMesh) {
      const fgMat = L.mesh.material;
      try {
        bgCardMesh.material = new THREE.ShaderMaterial({
          uniforms: fgMat.uniforms, vertexShader: fgMat.vertexShader,
          fragmentShader: 'uniform sampler2D map; varying vec2 vUv;\n' +
            'void main() { float a = texture2D(map, vUv).a; gl_FragColor = vec4(a, a, a, 1.0); }',
          side: THREE.DoubleSide, depthTest: false, depthWrite: false });
        bgCardMesh.renderOrder = 999;
      } catch (e) { info.alphaProbe = 'ERR ' + e.message; }
    }
    { for (let n=0;n<3;n++) render();
      const W=360,Hh=225,cv=document.createElement('canvas');cv.width=W;cv.height=Hh;
      const cx=cv.getContext('2d');cx.drawImage(renderer.domElement,0,0,W,Hh);
      const d=cx.getImageData(0,0,W,Hh).data;
      let sum=0,n3=0,lowA=0;
      for(let i=0;i<W*Hh;i++){ const r=d[i*4],g2=d[i*4+1],b2=d[i*4+2];
        if (Math.abs(r-g2)<6 && Math.abs(g2-b2)<6) { sum+=r; n3++; if(r<3) lowA++; } }
      info.cardAlphaMean255 = n3? +(sum/n3).toFixed(1) : -1;
      info.cardAlphaGreyPx  = n3;
      info.cardAlphaNearZeroPct = n3? +(100*lowA/n3).toFixed(1) : -1; }
    if (L.mesh) L.mesh.visible = true;
    return info;
  });
  console.log(JSON.stringify(out,null,1));
  await b.close(); srv.kill(); process.exit(0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
