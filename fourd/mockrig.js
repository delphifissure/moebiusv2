// Generate the mock 4DAnyone rig: 8-view frontal arc (their README's
// "8-view frontal arc" layout: start_yaw -90, yaw_span 180), one pitch layer,
// 16-frame walk loop, PNG frame sequences + cameras.json in the 4DAnyone
// output schema (plus a frame_sequence field per camera — this container's
// chromium decodes no H.264, so the mock ships frames; real 4DAnyone output
// uses the mp4 path in the viewer unchanged).
//   node fourd/mockrig.js
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path');
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'data', 'mock');
const VIEWS = 8, START_YAW = -90, YAW_SPAN = 180, PITCHES = [0];
const FRAMES = 16, FPS = 12;

(async () => {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const srv = spawn('node', [path.join(__dirname, 'server.js')], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 400, height: 700 } });
  page.on('pageerror', e => console.log('[PAGEERR] ' + e.message.slice(0, 200)));
  await page.goto('http://localhost:8098/fourd/mockrig.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 20; t++) {
    if (await page.evaluate(() => !!window._rigReady).catch(() => false)) break;
    await new Promise(r => setTimeout(r, 500));
  }

  const step = YAW_SPAN / VIEWS;
  const cameras = [];
  let camId = 0;
  for (let li = 0; li < PITCHES.length; li++) {
    for (let v = 0; v < VIEWS; v++) {
      const yaw = START_YAW + step * (v + 0.5);   // views centred in their span bins
      const pitch = PITCHES[li];
      const info = await page.evaluate(([y, p]) => window._rigInfo(y, p), [yaw, pitch]);
      const dir = 'videos/dense/' + String(camId).padStart(2, '0');
      fs.mkdirSync(path.join(OUT, dir), { recursive: true });
      for (let f = 0; f < FRAMES; f++) {
        const png = await page.evaluate(([y, p, fr, F]) => window._shot(y, p, fr, F), [yaw, pitch, f, FRAMES]);
        fs.writeFileSync(path.join(OUT, dir, String(f).padStart(3, '0') + '.png'),
          Buffer.from(png.split(',')[1], 'base64'));
      }
      cameras.push({
        camera_id: camId, layer_index: li, pitch: pitch, yaw: yaw,
        K: info.K, camera_to_world: info.c2w,
        image_width: info.W, image_height: info.H,
        video: 'videos/dense/' + String(camId).padStart(2, '0') + '.mp4',   // schema slot; no mp4 in the mock
        skeleton_video: 'skeletons/' + String(camId).padStart(2, '0') + '.mp4',
        frame_sequence: { dir, count: FRAMES, fps: FPS }                    // mock extension
      });
      console.log('view ' + camId + '  yaw=' + yaw.toFixed(1) + ' pitch=' + pitch + '  (' + FRAMES + ' frames)');
      camId++;
    }
  }
  const rig = {
    camera_model: 'OPENCV',
    world_frame: 'mock: subject-centred, y-up, metres',
    camera_frame: 'opencv (x right, y down, z forward)',
    front_camera_ids: [Math.floor(VIEWS / 2) - 1, Math.floor(VIEWS / 2)],
    framing: { pivot: [0, 0.95, 0], radius: 2.6 },
    cameras
  };
  fs.writeFileSync(path.join(OUT, 'cameras.json'), JSON.stringify(rig, null, 2));
  console.log('rig -> ' + OUT + '  (' + cameras.length + ' views x ' + FRAMES + ' frames)');
  await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
