// A123: can the SD bundle be exported WITHOUT opening the Debug Sheet first?
// exportSDBundle used to bail with "Open the Debug Sheet once first
// (initializes shared material)" because it borrowed a material the sheet
// exporter builds lazily. This calls it cold, on a fresh page, with alert()
// captured, and reports which files the bundle contains.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const WT = '/workspace/mm', H = path.join(WT, 'harness');
const ASSET = process.argv[2] || 'troll';
const SRC = { troll: ['defaultImgColor.png','defaultImgDepth.png'],
              star: ['starwatcher_color.png','starwatcher_depth.png'],
              warrior: ['silverwarrior_color.png','silverwarrior_depth.png'] };
(async () => {
  fs.copyFileSync(path.join(WT, SRC[ASSET][0]), path.join(H, 'defaultImgColor.png'));
  fs.copyFileSync(path.join(WT, SRC[ASSET][1]), path.join(H, 'defaultImgDepth.png'));
  const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1500));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 720, height: 450 }, acceptDownloads: true });
  page.on('pageerror', e => console.log('  [PAGEERR] ' + e.message.slice(0,200)));
  page.on('console', m => { const t = m.text(); if (/SD-BUNDLE|SD-VIEW/.test(t)) console.log('  [PAGE] ' + t.slice(0,300)); });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 90000 });
  for (let t = 0; t < 40; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 1000));
  }
  const res = await page.evaluate(async () => {
    const alerts = [];
    const realAlert = window.alert; window.alert = (m) => alerts.push(String(m));
    // NO debug sheet opened, NO bake — cold call, exactly as a user would hit it
    let threw = null;
    try { exportSDBundle(); } catch (e) { threw = String(e && e.message || e); }
    window.alert = realAlert;
    return { alerts, threw, panelMaterial: !!_dbgPanelMaterial };
  });
  console.log('\ncold exportSDBundle (no debug sheet, no bake):');
  console.log('  threw          : ' + (res.threw || 'no'));
  console.log('  alerts         : ' + (res.alerts.length ? res.alerts.join(' | ') : 'none'));
  console.log('  panel material : ' + res.panelMaterial);
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
