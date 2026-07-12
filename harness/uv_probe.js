// Replace plate fill with UV gradient; read blob pixels -> which texels render there.
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
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  await page.evaluate(() => { bgMPIFullPlanes=false; bgPlugMode='directional'; bgValidMode='auto'; buildBackgroundLayer(); });
  await page.waitForTimeout(800);
  const res = await page.evaluate(async () => {
    // UV gradient texture, 512x512: R=u, G=v, B=128, opaque
    const W=512, d=new Uint8Array(W*W*4);
    for (let y=0;y<W;y++) for (let x=0;x<W;x++){ const o=(y*W+x)*4; d[o]=x/(W-1)*255|0; d[o+1]=y/(W-1)*255|0; d[o+2]=128; d[o+3]=255; }
    const dt = new THREE.DataTexture(d, W, W, THREE.RGBAFormat, THREE.UnsignedByteType);
    dt.needsUpdate=true; dt.flipY=false;
    const prevMap = bgLayerMesh.material.uniforms.map.value;
    bgLayerMesh.material.uniforms.map.value = dt;
    isSweeping = true;
    camera.position.x = 0.123; camera.position.y = -0.055;
    await new Promise(r2 => { let n=0; const tick=()=>{ camera.position.x=0.123; camera.position.y=-0.055; n++; n<4?requestAnimationFrame(tick):r2(); }; requestAnimationFrame(tick); });
    const c = document.getElementById('canvas');
    const t = document.createElement('canvas'); t.width=c.width; t.height=c.height;
    const cx = t.getContext('2d'); cx.drawImage(c,0,0);
    const pts = [];
    for (const [x,y] of [[380,300],[370,320],[390,310],[420,280],[200,460],[600,240]]) {
      const sx=Math.round(x*c.width/860), sy=Math.round(y*c.height/484);
      const p = cx.getImageData(sx,sy,1,1).data;
      pts.push({x,y,r:p[0],g:p[1],b:p[2]});
    }
    const shotUV = t.toDataURL('image/png');
    bgLayerMesh.material.uniforms.map.value = prevMap;
    return { pts, shotUV };
  });
  fs.writeFileSync('uvprobe_shot.png', Buffer.from(res.shotUV.split(',')[1],'base64'));
  for (const p of res.pts) {
    // if B==128 it's the plate; u=r/255, v=g/255 in EXTENDED texture space (EPW=2764, EPH=1477)
    const u=p.r/255, v=p.g/255;
    console.log(`(${p.x},${p.y}) rgb=(${p.r},${p.g},${p.b})` + (Math.abs(p.b-128)<25 ?
      ` PLATE uv=(${u.toFixed(3)},${v.toFixed(3)}) ext=(${Math.round(u*2764)},${Math.round((1-v)*1477)}) src=(${Math.round(u*2764)-422},${Math.round((1-v)*1477)-77})` : ' NOT-PLATE'));
  }
  await browser.close(); srv.kill();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
