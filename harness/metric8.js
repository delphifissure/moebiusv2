const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const H='/workspace/arc73/harness', TAG=process.argv[2];
fs.copyFileSync(`/workspace/moebiusv2/harness/invA_${TAG}_color.png`, path.join(H,'defaultImgColor.png'));
fs.copyFileSync(`/workspace/moebiusv2/harness/invA_${TAG}_depth.png`, path.join(H,'defaultImgDepth.png'));
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r=>setTimeout(r,1200));
  const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
    headless:true, args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport:{width:600,height:400} });
  const G = {};
  p.on('console', m => { const t = m.text();
    let x;
    if ((x = /cliff tear: (\d+) spanning triangles dropped of (\d+); (\d+) orphaned/.exec(t))) { G.fgTorn=+x[1]; G.fgTris=+x[2]; G.orphans=+x[3]; }
    if ((x = /plate tear: (\d+) spanning triangles dropped at plate cliffs \(([\d.]+)%/.exec(t))) { G.plateTorn=+x[1]; G.platePct=+x[2]; }
    if ((x = /a91 per-cell tear threshold = ([\d.]+)/.exec(t))) { G.cellThr=+x[1]; }
    if ((x = /dequantize: (\d+)px/.exec(t))) { G.deq=+x[1]; }
  });
  await p.goto('http://localhost:8099/fp_test.html',{waitUntil:'load',timeout:90000});
  for (let t=0;t<40;t++){const ok=await p.evaluate(()=>{try{return !!(mediaLayers[0]?.mesh&&mediaLayers[0]?.textures?.depth);}catch(e){return false;}}).catch(()=>false); if(ok)break; await new Promise(r=>setTimeout(r,1000));}
  await p.evaluate(()=>{window._noVpScan=true;window._srCapture=true;bgQuickBake=true;window._bgQuickBaked=false;buildBackgroundLayer();});
  await p.waitForFunction(()=>window._bgQuickBaked===true,null,{timeout:600000,polling:2000});
  const m = await p.evaluate(()=>{const D=window._qbDbg; if(!D) return null;
    const {plate,d,pw,ph}=D; let mask=0,cells=0; const k=396*(pw/1920);
    // classify every folded cell by WHERE it comes from
    let fSrc=0, fCrease=0, fSlope=0, fold=0;
    const thr = 1.0/k;                       // per-texel fold limit in depth
    for(let y=0;y<ph;y++)for(let x=0;x+1<pw;x++){const i=y*pw+x;
      const claimed = plate[i] < d[i]-0.001;
      if(claimed) mask++;
      cells++;
      const g=Math.abs(plate[i+1]-plate[i]);
      if(g*k < 1) continue;
      fold++;
      const gs=Math.abs(d[i+1]-d[i]);
      if (gs*k >= 1) fSrc++;                 // the SOURCE also folds here: inherited
      else if (claimed || plate[i+1] < d[i+1]-0.001) fCrease++;   // inside the fill: crease
      else fSlope++;                          // unclaimed, source smooth: fill vs surface step
    }
    return {pw,ph,mask:100*mask/(pw*ph),fold:fold/pw,fSrc:fSrc/pw,fCrease:fCrease/pw,fSlope:fSlope/pw};});
  console.log(JSON.stringify({tag:TAG,...m,...G,fgTornPct:G.fgTris?100*G.fgTorn/G.fgTris:null,orphanPct:G.orphans&&m?100*G.orphans/(m.pw*m.ph):null}));
  await b.close(); srv.kill(); process.exit(0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
