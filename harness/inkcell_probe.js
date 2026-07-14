// A56 viability: does the INK isolate the party into cells? Flood non-ink
// regions (ink = L._strokeMask, optionally dilated D px to seal gaps);
// report the component census in the party window vs astronaut window vs
// whole frame. Viable if party -> several SMALL cells and astronaut -> few
// LARGE cells (or is dominated by one big cell). Also saves an overlay:
// each cell a random-ish grey, ink black, so we can SEE the segmentation.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const OUT = process.argv[2] || '.';
const DIL = parseInt(process.argv[3] || '1');
fs.copyFileSync('../starwatcher_color.png', 'defaultImgColor.png');
fs.copyFileSync('../starwatcher_depth.png', 'defaultImgDepth.png');
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 2000)); }
  const res = await page.evaluate((DIL) => {
    window._srCapture = true;
    bgMPIFullPlanes=false; bgMPIMode=true; bgPlugMode='directional'; bgValidMode='auto';
    buildBackgroundLayer();
    window._srCapture = false;
    const L = mediaLayers[0];
    if (!L._strokeMask) return { err: 'no strokeMask' };
    const w = L._strokeMaskW, h = L._strokeMaskH, N = w*h;
    let ink = new Uint8Array(N);
    for (let i=0;i<N;i++) if (L._strokeMask[i]) ink[i]=1;
    // also add strong luma-dark thin pixels as ink (the classifier may miss faint party outlines)
    const cImg = (L.textures.color && L.textures.color.image) || (L.elements && L.elements.color);
    const cc = document.createElement('canvas'); cc.width=w; cc.height=h; const ctx=cc.getContext('2d');
    ctx.drawImage(cImg,0,0,w,h); const cpx=ctx.getImageData(0,0,w,h).data;
    for (let i=0;i<N;i++){ const l=(0.299*cpx[i*4]+0.587*cpx[i*4+1]+0.114*cpx[i*4+2]); if (l<70) ink[i]=1; }
    for (let d=0; d<DIL; d++){ const nb=ink.slice();
      for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x; if(!ink[i]&&(ink[i-1]||ink[i+1]||ink[i-w]||ink[i+w]))nb[i]=1;} ink=nb; }
    // flood non-ink cells
    const lab = new Int32Array(N).fill(-1);
    const q = new Int32Array(N);
    const sizes=[]; let nextLab=0;
    for (let s=0;s<N;s++){ if(ink[s]||lab[s]>=0)continue; let qt=0,qh=0; q[qt++]=s; lab[s]=nextLab; let n=0;
      while(qh<qt){ const i=q[qh++]; n++; const x=i%w,y=(i/w)|0;
        if(x>0&&!ink[i-1]&&lab[i-1]<0){lab[i-1]=nextLab;q[qt++]=i-1;}
        if(x<w-1&&!ink[i+1]&&lab[i+1]<0){lab[i+1]=nextLab;q[qt++]=i+1;}
        if(y>0&&!ink[i-w]&&lab[i-w]<0){lab[i-w]=nextLab;q[qt++]=i-w;}
        if(y<h-1&&!ink[i+w]&&lab[i+w]<0){lab[i+w]=nextLab;q[qt++]=i+w;} }
      sizes.push(n); nextLab++; }
    // census in windows
    const winCells = (x0,x1,y0,y1) => { const set=new Map();
      for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const l=lab[y*w+x]; if(l<0)continue; set.set(l,(set.get(l)||0)+1);}
      const arr=[...set.entries()].map(([l,c])=>({size:sizes[l],inWin:c})).sort((a,b)=>b.inWin-a.inWin);
      return { nCells:set.size, top:arr.slice(0,8) }; };
    // save overlay crop of the party
    const oc=document.createElement('canvas'); oc.width=w; oc.height=h; const octx=oc.getContext('2d');
    const id=octx.createImageData(w,h);
    for(let i=0;i<N;i++){ const o=i*4; if(ink[i]){id.data[o]=0;id.data[o+1]=0;id.data[o+2]=0;}
      else { const l=lab[i]; const g=((l*2654435761)>>>16)&0xff; id.data[o]=g;id.data[o+1]=(g*3)&0xff;id.data[o+2]=(g*7)&0xff; } id.data[o+3]=255; }
    octx.putImageData(id,0,0);
    const crop=document.createElement('canvas'); crop.width=340; crop.height=220; crop.getContext('2d').drawImage(oc,1180,900,340,220,0,0,340,220);
    return { w,h, totalCells:nextLab, DIL,
      party: winCells(1180,1520,900,1120), astro: winCells(430,720,560,1050),
      png: crop.toDataURL('image/png') };
  }, DIL);
  if (res.err) { console.log('ERR', res.err); process.exit(1); }
  fs.writeFileSync(OUT+'/inkcells_party.png', Buffer.from(res.png.split(',')[1],'base64'));
  console.log(JSON.stringify({ w:res.w, totalCells:res.totalCells, DIL:res.DIL, party:res.party, astro:res.astro }, null, 1));
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
