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
    return info;
  });
  console.log(JSON.stringify(out,null,1));
  await b.close(); srv.kill(); process.exit(0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
