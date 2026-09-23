// S62 §6: the app's bgEdgeSharpen -> bgInkAdopt -> bgSourceHole on an A/B dump, offline (NOINK=1 skips the ink step).
//   node srchole_ink.js <dump dir> <out dir>   -> wash.rgb, hole.u8, adopted.u8, dQ.f32, stats.json
'use strict';
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const [DUMP, OUT, SRC] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const src = fs.readFileSync(SRC || path.join(__dirname, '..', 'moebius.js'), 'utf8');
const grab = (name) => { const a = src.indexOf('function ' + name + '('); if (a < 0) throw new Error('no ' + name); const b = src.indexOf('\nfunction ', a + 10); return src.slice(a, b); };
const meta = JSON.parse(fs.readFileSync(path.join(DUMP, 'meta.json'))); const { pw, ph } = meta, N = pw * ph;
const TW = 0.16, TH = 0.09, layerW = (pw / ph > TW / TH) ? TW : TH * pw / ph;
const step = 1 / (meta.D * Math.max(meta.outer / (meta.D + meta.outer), meta.inner / (meta.D - meta.inner)) * (pw / layerW));
const G = { window: { _qbSrcQuantum: step, _qbSrcGrid: 1 / 65535 }, currentNormPortalPlane: meta.pn, portalPlaneWorldZ: 0, camera: { position: { z: meta.D } },
            innerVolumeDepth: meta.inner, outerVolumeDepth: meta.outer, terrariumWidth: TW, terrariumHeight: TH, bgViewFadeEndDeg: 45, bgViewFadeEndDegV: 30,
            bgSkyInfOn: () => false, bgSkyQ: () => 0, _bgRimLaw: null, console: { log: () => {}, warn: console.warn } };
const body = ['bgRimLawFor', 'bgRimLawAtStep', 'bgPinholeFilledMask', 'bgMGSolve', 'bgEdgeSharpen', 'bgInkAdopt', 'bgSourceHole', 'bgEnvAspect'].map(grab).join('\n');
const lib = new Function(...Object.keys(G), 'let _bgRimLawL = null;\n' + body.replace(/_bgRimLaw\b/g, '_bgRimLawL') + '\nreturn { bgRimLawFor, bgEdgeSharpen, bgSourceHole, bgInkAdopt };')(...Object.values(G));
const f32 = (p) => { const x = fs.readFileSync(p); return new Float32Array(x.buffer, x.byteOffset, x.byteLength / 4); };
const dQ0 = f32(path.join(DUMP, 'dQ.f32'));
const rgb = execSync(`python3 -c "import sys,numpy as np;from PIL import Image;sys.stdout.buffer.write(np.asarray(Image.open('${DUMP}/color.png').convert('RGB'),np.uint8).tobytes())"`, { maxBuffer: 64 << 20 });
const rl = lib.bgRimLawFor(pw, ph);
let t0 = Date.now(); const es = lib.bgEdgeSharpen(dQ0, rgb, pw, ph, rl, step); const msE = Date.now() - t0;
t0 = Date.now(); const ink = lib.bgInkAdopt(es.out, rgb, pw, ph, rl, step); const msI = Date.now() - t0;
const dQ = process.env.NOINK ? es.out : ink.out;
t0 = Date.now(); const r = lib.bgSourceHole({ dQ, rgb, pw, ph, rl, step, D: meta.D, layerW }); const msH = Date.now() - t0;
fs.writeFileSync(path.join(OUT, 'wash.rgb'), Buffer.from(r.wash.buffer));
fs.writeFileSync(path.join(OUT, 'hole.u8'), Buffer.from(r.hole.buffer));
const adopted = new Uint8Array(N); for (let i = 0; i < N; i++) if (ink.out[i] !== es.out[i]) adopted[i] = 1;
fs.writeFileSync(path.join(OUT, 'adopted.u8'), Buffer.from(adopted.buffer));
fs.writeFileSync(path.join(OUT, 'dQ.f32'), Buffer.from(Float32Array.from(dQ).buffer));
const out = { picture: path.basename(DUMP), pw, ph, step, edge: { ...es.stats, ms: msE }, ink: { ...ink.stats, ms: msI }, stats: r.stats, msHole: msH };
fs.writeFileSync(path.join(OUT, 'stats.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out));
