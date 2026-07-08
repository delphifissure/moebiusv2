/* plug_port.js — faithful port of the v5 plug algorithm.
   Requires: sharpened depth (Float32Array), band (Uint8Array), valid (Uint8Array).
   The valid mask = ~fillset, excluding all foreground from anchor selection.
   THIS is the variable that was wrong in every previous attempt. */
(function(root){
'use strict';
function clampi(v,lo,hi){return v<lo?lo:(v>hi?hi:v);}
function boxMinSep(src,W,H,r){
  const N=W*H,tmp=new Float32Array(N),out=new Float32Array(N);
  for(let y=0;y<H;y++){const row=y*W;
    for(let x=0;x<W;x++){let m=Infinity;
      for(let k=-r;k<=r;k++)m=Math.min(m,src[row+clampi(x+k,0,W-1)]);
      tmp[row+x]=m;}}
  for(let x=0;x<W;x++)for(let y=0;y<H;y++){let m=Infinity;
    for(let k=-r;k<=r;k++)m=Math.min(m,tmp[clampi(y+k,0,H-1)*W+x]);
    out[y*W+x]=m;}
  return out;
}
function buildPlugFromValid(depth, band, valid, W, H, sweeps){
  sweeps = sweeps || 220;
  const N=W*H;
  // Step A: locally-far anchors (only from VALID pixels)
  const vinf=new Float32Array(N);
  for(let i=0;i<N;i++) vinf[i]=valid[i]?depth[i]:2.0;
  const far=boxMinSep(vinf,W,H,21);
  const anchor=new Uint8Array(N);
  for(let i=0;i<N;i++) anchor[i]=(valid[i]&&depth[i]<=far[i]+0.08)?1:0;
  // Step B: nearest-anchor depth via 2-pass chamfer
  const extA=new Float32Array(N), dst=new Float32Array(N);
  for(let i=0;i<N;i++){dst[i]=anchor[i]?0:1e9; extA[i]=anchor[i]?depth[i]:0;}
  // forward
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;
    if(x>0){const j=i-1; if(dst[j]+1<dst[i]){dst[i]=dst[j]+1;extA[i]=extA[j];}}
    if(y>0){const j=i-W; if(dst[j]+1<dst[i]){dst[i]=dst[j]+1;extA[i]=extA[j];}}}
  // backward
  for(let y=H-1;y>=0;y--)for(let x=W-1;x>=0;x--){const i=y*W+x;
    if(x<W-1){const j=i+1; if(dst[j]+1<dst[i]){dst[i]=dst[j]+1;extA[i]=extA[j];}}
    if(y<H-1){const j=i+W; if(dst[j]+1<dst[i]){dst[i]=dst[j]+1;extA[i]=extA[j];}}}
  // ring = band pixels 4-adjacent to non-band
  const ring=new Uint8Array(N);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x; if(!band[i])continue;
    if((x>0&&!band[i-1])||(x<W-1&&!band[i+1])||(y>0&&!band[i-W])||(y<H-1&&!band[i+W]))ring[i]=1;}
  // Step C: 220-sweep Jacobi, ring pinned
  let D=new Float32Array(N),D2=new Float32Array(N);
  for(let i=0;i<N;i++) D[i]=band[i]?extA[i]:depth[i];
  for(let i=0;i<N;i++) if(ring[i]) D[i]=extA[i];
  for(let s=0;s<sweeps;s++){
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;
      if(!band[i]||ring[i]){D2[i]=D[i];continue;}
      D2[i]=0.25*(D[y*W+clampi(x-1,0,W-1)]+D[y*W+clampi(x+1,0,W-1)]
                  +D[clampi(y-1,0,H-1)*W+x]+D[clampi(y+1,0,H-1)*W+x]);}
    const t=D;D=D2;D2=t;
    for(let i=0;i<N;i++) if(ring[i]) D[i]=extA[i];
  }
  const plug=new Float32Array(N);
  for(let i=0;i<N;i++) plug[i]=band[i]?D[i]:depth[i];
  return plug;
}
const API={buildPlugFromValid,boxMinSep};
if(typeof module!=='undefined'&&module.exports) module.exports=API;
root.MoebiusPlug=API;
})(typeof self!=='undefined'?self:this);
