// S62: the APP's bgEdgeSharpen + bgSourceHole (source extracted from ../moebius.js, with the app's own bgRimLawFor,
// bgPinholeFilledMask and bgMGSolve) against harness/srcfill.py's output on the same A/B dump.
//   node srchole_verify.js <dump dir> <srcfill out dir>
'use strict';
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const [DUMP, FILL] = process.argv.slice(2);
const src = fs.readFileSync(path.join(__dirname, '..', 'moebius.js'), 'utf8');
const grab = (name) => { const a = src.indexOf('function ' + name + '('); const b = src.indexOf('\nfunction ', a + 10); return src.slice(a, b); };
const meta = JSON.parse(fs.readFileSync(path.join(DUMP, 'meta.json'))); const { pw, ph } = meta, N = pw * ph;
const TW = 0.16, TH = 0.09, layerW = (pw / ph > TW / TH) ? TW : TH * pw / ph;
const step = 1 / (meta.D * Math.max(meta.outer / (meta.D + meta.outer), meta.inner / (meta.D - meta.inner)) * (pw / layerW));   // bgShiftLUTFor's 1/k
// the app's globals as the bake sees them for this picture (the visible step is the effective quantum on DA3's maps, S10)
const G = { window: { _qbSrcQuantum: step, _qbSrcGrid: 1 / 65535 }, currentNormPortalPlane: meta.pn, portalPlaneWorldZ: 0, camera: { position: { z: meta.D } },
            innerVolumeDepth: meta.inner, outerVolumeDepth: meta.outer, terrariumWidth: TW, terrariumHeight: TH, bgViewFadeEndDeg: 45, bgViewFadeEndDegV: 30,
            bgSkyInfOn: () => false, bgSkyQ: () => 0, _bgRimLaw: null, console: { log: () => {}, warn: console.warn } };
const body = ['bgRimLawFor', 'bgPinholeFilledMask', 'bgMGSolve', 'bgEdgeSharpen', 'bgSourceHole', 'bgEnvAspect'].map(grab).join('\n');
const lib = new Function(...Object.keys(G), 'let _bgRimLawL = null;\n' + body.replace(/_bgRimLaw\b/g, '_bgRimLawL') + '\nreturn { bgRimLawFor, bgEdgeSharpen, bgSourceHole };')(...Object.values(G));
const f32 = (p) => { const x = fs.readFileSync(p); return new Float32Array(x.buffer, x.byteOffset, x.byteLength / 4); };
const dQ0 = f32(path.join(DUMP, 'dQ.f32'));
const rgb = execSync(`python3 -c "import sys,numpy as np;from PIL import Image;sys.stdout.buffer.write(np.asarray(Image.open('${DUMP}/color.png').convert('RGB'),np.uint8).tobytes())"`, { maxBuffer: 64 << 20 });
const py = (expr) => execSync(`python3 -c "import sys,numpy as np;from PIL import Image;sys.stdout.buffer.write(${expr})"`, { maxBuffer: 256 << 20 });
const rl = lib.bgRimLawFor(pw, ph);
let t0 = Date.now(); const es = lib.bgEdgeSharpen(dQ0, rgb, pw, ph, rl); const msE = Date.now() - t0;
const pyD = new Float64Array(N); { const b = py(`(np.asarray(Image.open('${FILL}/depthD16.png')).astype(np.float64)/65535).tobytes()`); pyD.set(new Float64Array(b.buffer, b.byteOffset, N)); }
let eDiff = 0; for (let i = 0; i < N; i++) if (Math.abs(es.out[i] - pyD[i]) > step) eDiff++;
t0 = Date.now(); const r = lib.bgSourceHole({ dQ: es.out, rgb, pw, ph, rl, step, D: meta.D, layerW }); const msH = Date.now() - t0;
const pyHole = fs.readFileSync(path.join(FILL, 'hole.u8')), pyPlate = f32(path.join(FILL, 'plateD.f32'));
let hDiff = 0, hApp = 0, hPy = 0; for (let i = 0; i < N; i++) { if (r.hole[i]) hApp++; if (pyHole[i]) hPy++; if (!!r.hole[i] !== !!pyHole[i]) hDiff++; }
let pBig = 0, pMax = 0; for (let i = 0; i < N; i++) if (r.hole[i] && pyHole[i]) { const d = Math.abs(r.plate[i] - pyPlate[i]) / step; pMax = Math.max(pMax, d); if (d > 1) pBig++; }
const out = { picture: path.basename(DUMP), step, edge: { ...es.stats, texelsDifferingFromPythonOverOneStep: eDiff, ms: msE }, hole: { app: hApp, python: hPy, texelsDiffering: hDiff },
              plateWhereBothHole: { overOneStep: pBig, maxSteps: +pMax.toFixed(3) }, stats: r.stats, msHole: msH };
console.log(JSON.stringify(out));
