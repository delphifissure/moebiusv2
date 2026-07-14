// A56: figure-island test. ink = strokeMask ∪ dark-luma (dilate 1).
// Label non-ink cells. The two largest cells = ground + sky. figureMask =
// everything not in ground/sky (ink + figure interiors). Connected-
// component figureMask (8-conn) => ISLANDS (whole figures). Report which
// islands overlap the party vs astronaut windows + their sizes + floor.
// Saves an overlay: small standing islands green (seat), large islands
// red (keep), ground/sky grey.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const OUT = process.argv[2] || '.';
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
  const res = await page.evaluate(() => {
    window._srCapture = true;
    bgMPIFullPlanes=false; bgMPIMode=true; bgPlugMode='directional'; bgValidMode='auto';
    buildBackgroundLayer();
    window._srCapture = false;
    const L = mediaLayers[0];
    const w=L._strokeMaskW, h=L._strokeMaskH, N=w*h;
    const oc2=L.textures.depth.image2d; const dp=oc2.getContext('2d').getImageData(0,0,w,h).data;
    const S=new Float32Array(N); for(let i=0;i<N;i++)S[i]=dp[i*4]/255;
    // floor via cone erosion
    const sCone=0.0015*1920/w; const floor=S.slice();
    for(let y=0;y<h;y++){const r=y*w;for(let x=0;x<w;x++){const i=r+x;let v=floor[i];if(x>0&&floor[i-1]+sCone<v)v=floor[i-1]+sCone;if(y>0&&floor[i-w]+sCone<v)v=floor[i-w]+sCone;floor[i]=v;}}
    for(let y=h-1;y>=0;y--){const r=y*w;for(let x=w-1;x>=0;x--){const i=r+x;let v=floor[i];if(x<w-1&&floor[i+1]+sCone<v)v=floor[i+1]+sCone;if(y<h-1&&floor[i+w]+sCone<v)v=floor[i+w]+sCone;floor[i]=v;}}
    // ink
    const cImg=(L.textures.color&&L.textures.color.image)||(L.elements&&L.elements.color);
    const cc=document.createElement('canvas');cc.width=w;cc.height=h;const ctx=cc.getContext('2d');ctx.drawImage(cImg,0,0,w,h);const cpx=ctx.getImageData(0,0,w,h).data;
    let ink=new Uint8Array(N);
    for(let i=0;i<N;i++){if(L._strokeMask[i])ink[i]=1; const l=0.299*cpx[i*4]+0.587*cpx[i*4+1]+0.114*cpx[i*4+2]; if(l<70)ink[i]=1;}
    {const nb=ink.slice();for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x;if(!ink[i]&&(ink[i-1]||ink[i+1]||ink[i-w]||ink[i+w]))nb[i]=1;}ink=nb;}
    // cells
    const lab=new Int32Array(N).fill(-1);const q=new Int32Array(N);const csz=[];let nl=0;
    for(let s=0;s<N;s++){if(ink[s]||lab[s]>=0)continue;let qt=0,qh=0;q[qt++]=s;lab[s]=nl;let n=0;
      while(qh<qt){const i=q[qh++];n++;const x=i%w,y=(i/w)|0;
        if(x>0&&!ink[i-1]&&lab[i-1]<0){lab[i-1]=nl;q[qt++]=i-1;}
        if(x<w-1&&!ink[i+1]&&lab[i+1]<0){lab[i+1]=nl;q[qt++]=i+1;}
        if(y>0&&!ink[i-w]&&lab[i-w]<0){lab[i-w]=nl;q[qt++]=i-w;}
        if(y<h-1&&!ink[i+w]&&lab[i+w]<0){lab[i+w]=nl;q[qt++]=i+w;}}
      csz.push(n);nl++;}
    // two largest cells = ground + sky
    const order=[...csz.keys()].sort((a,b)=>csz[b]-csz[a]);
    const big=new Set([order[0],order[1]]);
    // figureMask = not in a big cell (ink counts as figure)
    const fig=new Uint8Array(N);
    for(let i=0;i<N;i++){ if(ink[i])fig[i]=1; else if(!big.has(lab[i]))fig[i]=1; }
    // islands (8-conn)
    const isl=new Int32Array(N).fill(-1);const isz=[];const ifloor=[];const ilift=[];let ni=0;
    for(let s=0;s<N;s++){if(!fig[s]||isl[s]>=0)continue;let qt=0,qh=0;q[qt++]=s;isl[s]=ni;let n=0,fsum=0,lsum=0;
      while(qh<qt){const i=q[qh++];n++;fsum+=floor[i];lsum+=(S[i]-floor[i]);const x=i%w,y=(i/w)|0;
        for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=w||yy>=h)continue;const j=yy*w+xx;if(fig[j]&&isl[j]<0){isl[j]=ni;q[qt++]=j;}}}
      isz.push(n);ifloor.push(fsum/n);ilift.push(lsum/n);ni++;}
    const win=(x0,x1,y0,y1)=>{const m=new Map();for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const l=isl[y*w+x];if(l<0)continue;m.set(l,(m.get(l)||0)+1);}
      return [...m.entries()].map(([l,c])=>({size:isz[l],floor:+ifloor[l].toFixed(3),lift:+ilift[l].toFixed(3),inWin:c})).sort((a,b)=>b.inWin-a.inWin).slice(0,6);};
    // overlay
    const CAP=Math.round(N*0.02);
    const o=document.createElement('canvas');o.width=w;o.height=h;const octx=o.getContext('2d');const id=octx.createImageData(w,h);
    for(let i=0;i<N;i++){const oo=i*4;const l=isl[i];
      if(l<0){id.data[oo]=90;id.data[oo+1]=90;id.data[oo+2]=90;}
      else if(isz[l]<CAP && ilift[l]>0.04){id.data[oo]=30;id.data[oo+1]=230;id.data[oo+2]=60;}
      else {id.data[oo]=230;id.data[oo+1]=40;id.data[oo+2]=40;}
      id.data[oo+3]=255;}
    octx.putImageData(id,0,0);
    const crop=document.createElement('canvas');crop.width=960;crop.height=540;crop.getContext('2d').drawImage(o,0,0,w,h,0,0,960,540);
    return { w,h,nIslands:ni,CAP, party:win(1180,1520,900,1120), astro:win(430,720,560,1050), png:crop.toDataURL('image/png') };
  });
  fs.writeFileSync(OUT+'/islands.png', Buffer.from(res.png.split(',')[1],'base64'));
  console.log('nIslands', res.nIslands, 'CAP', res.CAP);
  console.log('PARTY islands:', JSON.stringify(res.party));
  console.log('ASTRO islands:', JSON.stringify(res.astro));
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
