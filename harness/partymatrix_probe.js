// A55 comprehensive: in ONE page load, render the party under every
// config so they can be compared apples-to-apples. Order matters
// (realtime first, before any bake mutates state).
//   0 realtime  = no bake, multipass inpaint (the "acceptable" reference)
//   1 quick     = current default (a55: seat + cards + discards off)
//   2 quickRaw  = quick but bake sharpening bypassed (window._rawPass)
//   3 quickDisc = quick but per-fragment gap discards forced ON
//   4 quickNoSeat = quick, seat-on-floor disabled
// Each saved full-frame; caller crops. Star asset. Pose (0.064,0.065,0.2).
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
  const logs=[]; page.on('console', m=>{const t=m.text(); if(/SEAT|RAW passthrough/.test(t))logs.push(t);});
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 2000)); }

  const pose = async () => { await page.evaluate(async () => { isSweeping = true;
    await new Promise(r2 => { let n=0; const tick=()=>{ camera.position.x=0.064; camera.position.y=0.065; camera.position.z=0.2; n++; n<8?requestAnimationFrame(tick):r2(); }; requestAnimationFrame(tick); });
    render();
  }); };
  const grab = async (name) => { const u = await page.evaluate(()=>renderer.domElement.toDataURL('image/png'));
    fs.writeFileSync(OUT+'/pm_'+name+'.png', Buffer.from(u.split(',')[1],'base64')); console.log('wrote', name); };

  // 0 realtime: ensure inpainting ON, no bake yet
  await page.evaluate(()=>{ const cb=document.getElementById('useInpaintingCheckbox'); if(cb){cb.checked=true;} useInpainting=true; window._bgQuickBaked=false;
    const dv=document.getElementById('debugViewSelect'); if(dv)dv.value='final'; });
  await pose(); await grab('0realtime');

  // helper to force a fresh bake with flags
  const bake = async (flags) => page.evaluate((flags)=>{
    const L=mediaLayers[0];
    window._rawPass = !!flags.rawPass; window._noSeatFloor = !!flags.noSeat; window._qbForceDiscards = !!flags.disc;
    L._liveBaked=false; L._seatedFloor=false;
    if (typeof applyLiveBake==='function') applyLiveBake(L);
    bgQuickBake=true; buildBackgroundLayer();
  }, flags);

  await bake({}); await pose(); await grab('1quick');
  await bake({ rawPass:true }); await pose(); await grab('2quickRaw');
  await bake({ disc:true }); await pose(); await grab('3quickDisc');
  await bake({ noSeat:true }); await pose(); await grab('4quickNoSeat');

  console.log(logs.join('\n'));
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
