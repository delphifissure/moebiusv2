// A147: what does the web platform ACTUALLY expose about the camera? Run it,
// do not recall it. navigator.mediaDevices requires a secure context, so this
// goes through the local server rather than about:blank.
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const path = require('path');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: path.join('/workspace/mm','harness'), stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const b = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'] });
  const p = await b.newPage();
  await p.goto('http://localhost:8099/blank.html').catch(async () => { await p.goto('http://localhost:8099/scratch_moebius.html'); });
  const r = await p.evaluate(async () => {
    const sup = navigator.mediaDevices.getSupportedConstraints();
    let settings = null, caps = null, label = null, err = null;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true });
      const t = s.getVideoTracks()[0];
      label = t.label; settings = t.getSettings(); caps = t.getCapabilities ? t.getCapabilities() : null;
    } catch (e) { err = e.name + ': ' + e.message; }
    return { ua: navigator.userAgent, sup, label, settings, caps, err };
  });
  console.log('UA:', r.ua.slice(0, 110));
  console.log('\ngetSupportedConstraints() keys:');
  console.log('  ' + Object.keys(r.sup).filter(k => r.sup[k]).join(', '));
  const fovish = Object.keys(r.sup).filter(k => /fov|field|focal|zoom|pan|tilt|frame/i.test(k));
  console.log('\n  FOV / framing related:', fovish.length ? fovish.join(', ') : 'NONE');
  console.log('\ntrack.label:', JSON.stringify(r.label));
  console.log('getSettings():', JSON.stringify(r.settings));
  console.log('getCapabilities():', JSON.stringify(r.caps));
  if (r.err) console.log('getUserMedia error:', r.err);
  await b.close(); srv.kill(); process.exit(0);
})();
