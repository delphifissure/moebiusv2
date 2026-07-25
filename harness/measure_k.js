// Measure k — px of screen displacement per unit of depth at the fade end —
// from the LIVE scene, not from a comment. Everything derived since a88
// (fill slope, tear threshold, tie-break, seed reveal) scales as 1/k, so if k
// is wrong they are all wrong together and coherently.
// Method: take the vertex-shader's own displacement law, place a point at each
// depth, project it through the real camera at the rest pose and at the fade-end
// pose, and difference the screen positions. No image analysis, no tracking.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const WT='/workspace/arc73', H=path.join(WT,'harness');

(async () => {
  // reuse an already-running harness server if there is one (the suite holds
  // the port); only spawn when nothing answers.
  let srv = { kill(){} };
  const alive = await fetch('http://localhost:8099/fp_test.html').then(r=>r.ok).catch(()=>false);
  if (!alive) { srv = spawn('node',['scratch_server.js'],{cwd:H,stdio:'ignore'}); await new Promise(r=>setTimeout(r,1200)); }
  else console.error('(reusing running server; asset is whatever it currently serves)');
  const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
    headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const p = await b.newPage({viewport:{width:933,height:525}});
  await p.goto('http://localhost:8099/fp_test.html',{waitUntil:'load',timeout:90000});
  for(let t=0;t<40;t++){const ok=await p.evaluate(()=>{try{return !!(mediaLayers[0]?.mesh);}catch(e){return false;}}).catch(()=>false); if(ok)break; await new Promise(r=>setTimeout(r,1000));}
  const out = await p.evaluate(() => {
    const L = mediaLayers[0], u = L.mesh.material.uniforms;
    const outer = u.u_worldOuterVolumeDepth.value, inner = u.u_worldInnerVolumeDepth.value;
    const pn = u.u_portalPlaneDepthNorm ? u.u_portalPlaneDepthNorm.value : 0.5;
    const ss = (a,b,x)=>{ const t=Math.min(1,Math.max(0,(x-a)/(b-a))); return t*t*(3-2*t); };
    const zOff = (d) => d < pn ? (-outer + (0 - -outer) * ss(0,pn,d))
                               : (0 + (inner - 0) * ss(pn,1,d));
    const W = renderer.domElement.width, srcW = (L.textures.color.image||L.elements.color).naturalWidth;
    const geo = L.mesh.geometry.parameters || {};
    const proj = (d, camx) => {
      const v = new THREE.Vector3(0, 0, L.mesh.position.z + zOff(d));
      const old = camera.position.x; camera.position.x = camx;
      camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
      const q = v.clone().project(camera);
      camera.position.x = old; camera.updateMatrixWorld(true);
      return (q.x * 0.5 + 0.5) * W;                     // screen px on the canvas
    };
    const rows = [];
    for (const d of [0.1,0.3,0.5,0.7,0.9]) {
      const dd = 0.02;
      const dx = (proj(d+dd, 0.2) - proj(d-dd, 0.2)) - (proj(d+dd, 0) - proj(d-dd, 0));
      rows.push({ d, kCanvas: Math.abs(dx)/(2*dd) });    // px per depth unit at ex=0.2
    }
    return { rows, canvasW: W, srcW, planeW: geo.width, camZ: camera.position.z, outer, inner, pn };
  });
  console.log(JSON.stringify(out));
  await b.close(); srv.kill(); process.exit(0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
