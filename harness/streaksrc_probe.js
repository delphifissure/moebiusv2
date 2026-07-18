// A57: isolate the source of the staff/astronaut streaks. Quick bake,
// pose, then render 3 ways and crop the staff region: composite,
// FG-only (plate hidden), plate-only (FG hidden). If the streak is in
// FG-only it's mesh taffy/cap-cards; if in plate-only it's the wash ghost.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const OUT = process.argv[2] || '.';
fs.copyFileSync('../starwatcher_color.png', 'defaultImgColor.png');
fs.copyFileSync('../starwatcher_depth.png', 'defaultImgDepth.png');
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false); if (ok) break; await new Promise(r => setTimeout(r, 2000)); }
  const shots = await page.evaluate(async () => {
    bgQuickBake = true; buildBackgroundLayer();
    const L = mediaLayers[0];
    const pose = async () => { isSweeping = true;
      await new Promise(r2 => { let n=0; const tick=()=>{ camera.position.x=0.064; camera.position.y=0.065; camera.position.z=0.2; n++; n<8?requestAnimationFrame(tick):r2(); }; requestAnimationFrame(tick); }); render(); };
    const grab = () => renderer.domElement.toDataURL('image/png');
    await pose(); const comp = grab();
    // FG only: hide plate + cards
    const bgVis = bgLayerMesh ? bgLayerMesh.visible : null;
    const cardVis = (typeof bgCardMesh!=='undefined' && bgCardMesh) ? bgCardMesh.visible : null;
    if (bgLayerMesh) bgLayerMesh.visible = false;
    render(); const fg = grab();
    if (bgLayerMesh) bgLayerMesh.visible = (bgVis===null?true:bgVis);
    // plate only: hide FG source
    const fgVis = L.mesh.visible; const cVis2 = (typeof bgCardMesh!=='undefined'&&bgCardMesh)?bgCardMesh.visible:null;
    L.mesh.visible = false; if (typeof bgCardMesh!=='undefined'&&bgCardMesh) bgCardMesh.visible=false;
    render(); const plate = grab();
    L.mesh.visible = fgVis; if (typeof bgCardMesh!=='undefined'&&bgCardMesh&&cVis2!==null) bgCardMesh.visible=cVis2;
    // cards only (hide plate + L.mesh, show cards)
    let cardsImg = null;
    if (typeof bgCardMesh!=='undefined' && bgCardMesh) {
      if (bgLayerMesh) bgLayerMesh.visible=false; L.mesh.visible=false; bgCardMesh.visible=true;
      render(); cardsImg = grab();
      if (bgLayerMesh) bgLayerMesh.visible=(bgVis===null?true:bgVis); L.mesh.visible=fgVis;
    }
    // mesh only (hide plate + cards, show L.mesh)
    if (bgLayerMesh) bgLayerMesh.visible=false; if (typeof bgCardMesh!=='undefined'&&bgCardMesh) bgCardMesh.visible=false;
    render(); const meshImg = grab();
    if (bgLayerMesh) bgLayerMesh.visible=(bgVis===null?true:bgVis); if (typeof bgCardMesh!=='undefined'&&bgCardMesh) bgCardMesh.visible=(cardVis===null?true:cardVis);
    return { comp, fg, plate, cards: cardsImg, mesh: meshImg };
  });
  for (const [k, u] of Object.entries(shots)) {
    if (!u) continue;
    fs.writeFileSync(OUT + '/ss_' + k + '.png', Buffer.from(u.split(',')[1], 'base64'));
  }
  console.log('wrote comp/fg/plate');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
