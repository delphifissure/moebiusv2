// OFF-AXIS DOLLY INVARIANT: portal-plane points must stay screen-pinned across
// eye z sweeps at any lateral offset (the asymmetric-frustum correctness test);
// behind-portal points must breathe monotonically (the dolly-zoom effect).
const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const CHROME = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
(async () => {
  const srv = spawn('node', ['scratch_server.js'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true,
    args: ['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto('http://localhost:8099/scratch_moebius.html', { waitUntil: 'load', timeout: 60000 });
  for (let t = 0; t < 60; t++) {
    const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh); } catch(e){ return false; } }).catch(()=>false);
    if (ok) break; await new Promise(r => setTimeout(r, 2000));
  }
  const res = await page.evaluate(async () => {
    const out = { portalZ: portalPlaneWorldZ, subjZ: subjectFocalPlaneWorldZ, cases: [] };
    const W = renderer.domElement.width, H = renderer.domElement.height;
    const proj = (x, y, z) => { const v = new THREE.Vector3(x, y, z).project(camera);
      return [ (v.x*0.5+0.5)*W, (0.5-v.y*0.5)*H ]; };
    for (const h of [0, 0.1, 0.2]) {
      const rows = [];
      for (const zz of [0.12, 0.2, 0.3, 0.42]) {
        window.setViewOffset(h, 0);
        camera.position.z = zz;
        isSweeping = false;   // let the tracked path run (applies manual offset + frameCorners)
        await new Promise(res2 => { let n=0; const tick=()=>{ camera.position.z = zz; n++; n<4?requestAnimationFrame(tick):res2(); }; requestAnimationFrame(tick); });
        const pA = proj(0.02, 0.01, portalPlaneWorldZ);       // portal-plane point (must be pinned)
        const pB = proj(-0.03, -0.02, portalPlaneWorldZ);     // portal-plane point 2
        const pC = proj(0.02, 0.01, portalPlaneWorldZ - 0.1); // behind-portal (must breathe)
        rows.push({ z: zz, A: pA.map(v=>+v.toFixed(2)), B: pB.map(v=>+v.toFixed(2)), C: pC.map(v=>+v.toFixed(2)) });
      }
      out.cases.push({ h, rows });
    }
    window.setViewOffset(0, 0);

    // PART 2: SUBJECT LOCK OFF THE PORTAL PLANE. Move the subject plane
    // behind the portal (q = -0.05), run the dolly, and verify a content
    // point ATTACHED TO A MESH whose base world position lies on the
    // subject plane stays screen-pinned — via the mesh's real matrixWorld,
    // not the lock formula. A second attached point at portal depth must
    // breathe (that's the dolly-zoom effect on non-subject content).
    const q = -0.05;
    subjectFocalPlaneWorldZ = q;
    subjectLockActive = true;
    const m0 = mediaLayers[0].mesh;
    const base = { sx: m0.scale.x, sy: m0.scale.y, sz: m0.scale.z,
                   px: m0.position.x, py: m0.position.y, pz: m0.position.z };
    const vSubj = new THREE.Vector3((0.02 - base.px)/base.sx, (0.01 - base.py)/base.sy, (q - base.pz)/base.sz);
    const vPort = new THREE.Vector3((0.02 - base.px)/base.sx, (0.01 - base.py)/base.sy, (portalPlaneWorldZ - base.pz)/base.sz);
    dollyZoomActive = true;
    out.lock = [];
    for (const h of [0, 0.1, 0.2]) {
      window.setViewOffset(h, 0);
      const rows = [];
      // dollyZoomSpeed/min/max are const — steer via dollyZoomTime (let).
      // dist = 0.05 + 0.30*0.5*(1+sin(t)); these t values spread the sweep
      // while keeping the eye in front of the portal (e = q + dist > 0).
      for (const T of [-0.5236, 0, 0.5236, 1.5708]) {
        dollyZoomTime = T;
        await new Promise(res2 => { let n=0; const tick=()=>{ n++; n<3?requestAnimationFrame(tick):res2(); }; requestAnimationFrame(tick); });
        m0.updateMatrixWorld(true);
        const wS = m0.localToWorld(vSubj.clone());
        const wP = m0.localToWorld(vPort.clone());
        rows.push({ z: +camera.position.z.toFixed(4), s: +(m0.scale.x/base.sx).toFixed(4),
          A: proj(wS.x, wS.y, wS.z).map(v=>+v.toFixed(2)),
          C: proj(wP.x, wP.y, wP.z).map(v=>+v.toFixed(2)),
          dbg: { cam: [camera.position.x, camera.position.y, camera.position.z].map(v=>+v.toFixed(5)),
                 mp: [m0.position.x, m0.position.y, m0.position.z].map(v=>+v.toFixed(5)),
                 wS: [wS.x, wS.y, wS.z].map(v=>+v.toFixed(5)) } });
      }
      out.lock.push({ h, rows });
    }
    window.setViewOffset(0, 0);
    dollyZoomActive = false;
    await new Promise(res2 => { let n=0; const tick=()=>{ n++; n<3?requestAnimationFrame(tick):res2(); }; requestAnimationFrame(tick); });
    out.restored = Math.abs(m0.scale.x - base.sx) < 1e-9 &&
                   Math.abs(m0.position.x - base.px) < 1e-9 &&
                   Math.abs(m0.position.z - base.pz) < 1e-9;
    return out;
  });
  console.log('portalZ', res.portalZ, 'subjectZ(at load)', res.subjZ);
  const driftOf = (rows, key) => {
    let mx = 0; const r0 = rows[0][key];
    for (const r of rows) mx = Math.max(mx, Math.hypot(r[key][0]-r0[0], r[key][1]-r0[1]));
    return +mx.toFixed(3);
  };
  for (const c of res.cases)
    console.log('offset', c.h, '| portal-point A drift(px):', driftOf(c.rows,'A'), '| B drift:', driftOf(c.rows,'B'), '| behind-point C travel(px):', driftOf(c.rows,'C'));
  console.log('--- subject lock (q=-0.05, mesh-transform verified) ---');
  for (const c of res.lock) {
    console.log('offset', c.h, '| subject-point drift(px):', driftOf(c.rows,'A'),
      '| portal-content travel(px):', driftOf(c.rows,'C'),
      '| scales:', c.rows.map(r=>r.s).join(','));
  }
  console.log('restore after dolly-off:', res.restored ? 'OK' : 'FAILED');
  if (process.env.DBG) for (const c of res.lock) for (const r of c.rows)
    console.log('h', c.h, 'z', r.z, 's', r.s, 'A', r.A, 'dbg', JSON.stringify(r.dbg));
  await browser.close(); srv.kill();
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
