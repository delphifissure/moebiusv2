// S62 §9: see-through pixels on screen. Bakes one picture in source mode (optionally with a moebius.js variant, MB=<path>)
// and renders poses over the envelope; a pixel the canvas leaves at alpha 0 inside the rest frame's picture rectangle is
// see-through (nothing drawn: neither the source mesh, the plates nor the margin). Writes counts and PNGs (see-through red).
//   COLOR= DEPTH= TAG= [PORT=8099] [MB=<variant moebius.js>] [SEL=...] node harness/app_black.js
'use strict';
const { chromium } = require('playwright-core'); const { spawn } = require('child_process'); const fs = require('fs'); const path = require('path');
const H = __dirname, PORT = +(process.env.PORT || 8099); const OUT = path.join(__dirname, 'shots', 'app_black', process.env.TAG || 'x'); fs.mkdirSync(OUT, { recursive: true });
const WT = path.resolve(__dirname, '..');
(async () => {
    fs.copyFileSync(path.resolve(WT, process.env.COLOR || 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); fs.copyFileSync(path.resolve(WT, process.env.DEPTH || 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png'));
    process.on('exit', () => { try { fs.copyFileSync(path.join(WT, 'defaultImgDepth.png'), path.join(H, 'defaultImgDepth.png')); fs.copyFileSync(path.join(WT, 'defaultImgColor.png'), path.join(H, 'defaultImgColor.png')); } catch (e) {} });
    let PAGE = 'scratch_moebius.html'; if (process.env.MB) { fs.mkdirSync(path.join(H, '_var'), { recursive: true }); const tag = (process.env.TAG || 'x').replace(/[^\w-]/g, '_'); fs.copyFileSync(path.resolve(process.env.MB), path.join(H, '_var', 'mb_' + tag + '.js')); fs.writeFileSync(path.join(H, '_var_' + tag + '.html'), fs.readFileSync(path.join(H, 'scratch_moebius.html'), 'utf8').replace('src="moebius.js"', 'src="_var/mb_' + tag + '.js"')); PAGE = '_var_' + tag + '.html'; }
    const srv = spawn('node', ['scratch_server.js'], { cwd: H, stdio: 'ignore', env: Object.assign({}, process.env, { PORT: String(PORT) }) }); await new Promise(r => setTimeout(r, 1500));
    { const r = await fetch('http://localhost:' + PORT + '/__root').then(x => x.text()).catch(() => ''); if (r !== H) { console.error('ABORT: port ' + PORT + ' is served from ' + (r.slice(0, 80) || 'nothing') + ', not this tree (' + H + ')'); srv.kill(); process.exit(4); } }
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell', headless: true, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'] });
    const page = await browser.newPage({ viewport: { width: 912, height: 513 } }); const logs = [];
    page.on('console', m => { const t = m.text(); if (/\[S62\]/.test(t)) logs.push(t.slice(0, 600)); });
    page.on('pageerror', e => logs.push('PAGEERR ' + e.message.slice(0, 300)));
    await page.goto('http://localhost:' + PORT + '/' + PAGE, { waitUntil: 'load', timeout: 90000 });
    for (let t = 0; t < 45; t++) { const ok = await page.evaluate(() => { try { return !!(mediaLayers[0]?.mesh && mediaLayers[0]?.textures?.depth && mediaLayers[0]._depth16); } catch (e) { return false; } }).catch(() => false); if (ok) break; await new Promise(r => setTimeout(r, 1000)); }
    await page.evaluate(([noW, sel]) => {
        try { localStorage.clear(); } catch (e) {}
        if (noW) window.Worker = undefined;
        if (sel.__depth) { const dm = sel.__depth; if (dm.outer !== undefined) outerVolumeDepth = dm.outer; if (dm.inner !== undefined) innerVolumeDepth = dm.inner; if (dm.pn !== undefined) currentNormPortalPlane = dm.pn; delete sel.__depth; }
        const fS = bgSourceHoleInWorker, fF = bgFinishSourceHole;
        bgSourceHoleInWorker = function (o) { window._tSolve0 = performance.now(); return fS(o); };
        bgFinishSourceHole = function (r, c) { window._tSolve1 = performance.now(); return fF(r, c); };
        window._hb = []; setInterval(() => window._hb.push(performance.now()), 50);
        window._tl = []; for (const k of ['log', 'warn']) { const f = console[k].bind(console); console[k] = (...a) => { try { window._tl.push([performance.now(), String(a[0]).slice(0, 90)]); } catch (e) {} return f(...a); }; }
        for (const [id, v] of Object.entries(Object.assign({ bgPlateHoleSel: 'source', bgPlateRampSel: 'off' }, sel))) { const el = document.getElementById(id); if (el) { el.value = v; el.dispatchEvent(new Event('change')); } }
    }, [!!process.env.NOWORKER, Object.assign(JSON.parse(process.env.SEL || '{}'), process.env.DEPTH_OUTER ? { __depth: { outer: +process.env.DEPTH_OUTER, inner: +(process.env.DEPTH_INNER || 0.0001), pn: +(process.env.DEPTH_PN || 0.5) } } : {})]);
    const t0 = Date.now(); await page.evaluate(() => document.getElementById('bgLayerBuildBtn').click());
    for (let t = 0; t < 1600; t++) { if (await page.evaluate(() => !!window._bgQuickBaked && !!window._qbPlateF && !!window._qbSourceHole)) break; await new Promise(r => setTimeout(r, 500)); }
    const bakeMs = Date.now() - t0;
    const grab = async (x, y) => page.evaluate(([x, y]) => { isSweeping = true; camera.position.set(x, y, 0.2); updateCameraAndProjection(); render(); updateCameraAndProjection(); render(); return renderer.domElement.toDataURL('image/png').split(',')[1]; }, [x, y]);
    const poses = [['rest', 0, 0.008], ['R42', 0.18, 0.008], ['L42', -0.18, 0.008], ['RU', 0.18, 0.1], ['LD', -0.18, -0.1]];
    const out = { bakeMs, stats: await page.evaluate(() => window._qbSourceHole), poses: {} };
    for (const [n, x, y] of poses) { fs.writeFileSync(path.join(OUT, n + '.png'), Buffer.from(await grab(x, y), 'base64')); }
    const py = `
import numpy as np, json, sys
from PIL import Image
d=sys.argv[1]; names=sys.argv[2].split(',')
r=np.asarray(Image.open(d+'/rest.png'))[...,3]>0; ys,xs=np.nonzero(r); y0,y1,x0,x1=ys.min(),ys.max()+1,xs.min(),xs.max()+1
res={'rect':[int(x0),int(y0),int(x1),int(y1)]}
for n in names:
    a=np.asarray(Image.open(d+'/'+n+'.png')).copy(); hole=a[...,3]==0; inr=np.zeros_like(hole); inr[y0:y1,x0:x1]=1
    # the frame band: see-through pixels 4-connected to the rectangle's border are the margin's business, the rest are interior
    from scipy import ndimage as nd
    lab,_=nd.label(hole&inr); b=np.zeros_like(hole); b[y0,x0:x1]=1; b[y1-1,x0:x1]=1; b[y0:y1,x0]=1; b[y0:y1,x1-1]=1
    edge=set(np.unique(lab[b&(lab>0)])); inter=(lab>0)&~np.isin(lab,list(edge))
    res[n]={'seeThrough':int((hole&inr).sum()),'interior':int(inter.sum()),'blobs':int(len(set(np.unique(lab[inter]))-{0}))}
    v=a[...,:3].copy(); v[hole&inr]=[255,0,0]; v[inter]=[255,0,255]; Image.fromarray(v).save(d+'/'+n+'_see.png')
print(json.dumps(res))`;
    out.poses = JSON.parse(require('child_process').execFileSync('python3', ['-c', py, OUT, poses.map(p => p[0]).join(',')]).toString());
    fs.writeFileSync(path.join(OUT, 'black.json'), JSON.stringify(out, null, 1)); console.log(JSON.stringify(out.poses));
    await browser.close(); srv.kill(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
