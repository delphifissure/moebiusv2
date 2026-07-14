// A55: measure the cone-erosion FLOOR (ground beneath content) per region,
// to find a threshold that separates the party (mislocated onto FAR
// ground) from the astronaut (legit on NEAR ground). Also dumps standing
// mask fraction + saves the standing mask + floor as images.
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
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate(() => {
    // read the RAW depth to compute floor exactly like the bake (pre-bake)
    // use shipped depth image2d instead — close enough for floor geometry
    bgMPIFullPlanes=false; bgMPIMode=true; bgPlugMode='directional'; bgValidMode='auto';
    buildBackgroundLayer();
    const L = mediaLayers[0];
    const oc = L.textures.depth.image2d;
    const w = oc.width, h = oc.height, N = w*h;
    const px = oc.getContext('2d').getImageData(0,0,w,h).data;
    const S = new Float32Array(N);
    for (let i=0;i<N;i++) S[i]=px[i*4]/255;
    const sCone = 0.0015 * 1920 / w;
    const floor = S.slice();
    for (let y=0;y<h;y++){const r=y*w; for(let x=0;x<w;x++){const i=r+x;let v=floor[i];
      if(x>0&&floor[i-1]+sCone<v)v=floor[i-1]+sCone; if(y>0&&floor[i-w]+sCone<v)v=floor[i-w]+sCone; floor[i]=v;}}
    for (let y=h-1;y>=0;y--){const r=y*w; for(let x=w-1;x>=0;x--){const i=r+x;let v=floor[i];
      if(x<w-1&&floor[i+1]+sCone<v)v=floor[i+1]+sCone; if(y<h-1&&floor[i+w]+sCone<v)v=floor[i+w]+sCone; floor[i]=v;}}
    const region = (x0,x1,y0,y1) => { let sf=0,sl=0,n=0,stand=0;
      for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=y*w+x;n++;sf+=floor[i];const lift=S[i]-floor[i];sl+=lift;if(lift>0.05)stand++;}
      return { floorMean:+(sf/n).toFixed(3), liftMean:+(sl/n).toFixed(3), standFrac:+(stand/n).toFixed(2) }; };
    // floor percentiles over whole frame
    const fs2 = Array.from(floor); fs2.sort((a,b)=>a-b);
    const pct = p => +fs2[Math.floor(p*N)].toFixed(3);
    return {
      party:  region(1180,1520,900,1120),
      astro:  region(430,720,560,1050),
      mtn:    region(1150,1600,300,650),
      groundBare: region(820,1080,900,1000),
      floorPct: { p10:pct(0.1), p30:pct(0.3), p50:pct(0.5), p70:pct(0.7), p90:pct(0.9) },
    };
  });
  console.log(JSON.stringify(res, null, 1));
  await browser.close(); srv.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
