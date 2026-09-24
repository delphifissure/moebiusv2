// S62 §10: bgSourceHole from <moebius.js> on the depth the app held (a DUMP=1 srchole_worker_check dir: meta.json with
// outer/inner/pn/D, dQ.f32; add color.png at pw x ph for the wash). Reproduces the app's hole and plate exactly (troll: 0
// texels differ). Writes <out>/{dQ,plate,hole,has2,plate2}, read by seethrough.js.
//   node harness/srchole_offline.js <moebius.js> <dump dir> <out dir> [sky 0|1]
'use strict';
const fs = require('fs'), path = require('path');
const [SRC, DUMP, OUT, SKYA] = process.argv.slice(2); fs.mkdirSync(OUT, { recursive: true });
const src = fs.readFileSync(SRC, 'utf8');
const grab = (name) => { const a = src.indexOf('function ' + name + '('); const b = src.indexOf('\nfunction ', a + 10); return src.slice(a, b); };
const meta = JSON.parse(fs.readFileSync(path.join(DUMP, 'meta.json'))); const { pw, ph } = meta, N = pw * ph;
const TW = meta.terrariumWidth || 0.16, TH = meta.terrariumHeight || 0.09, layerW = (pw / ph > TW / TH) ? TW : TH * pw / ph;
const step = 1 / (meta.D * Math.max(meta.outer / (meta.D + meta.outer), meta.inner / (meta.D - meta.inner)) * (pw / layerW));
const SKY = SKYA === '1';
const G = { window: { _qbSrcQuantum: step, _qbSrcGrid: 1 / 65535 }, currentNormPortalPlane: meta.pn, portalPlaneWorldZ: 0, camera: { position: { z: meta.D } },
            innerVolumeDepth: meta.inner, outerVolumeDepth: meta.outer, terrariumWidth: TW, terrariumHeight: TH, bgViewFadeEndDeg: 45, bgViewFadeEndDegV: 30,
            bgSkyInfOn: () => SKY, bgSkyQ: () => 0.5 / 65535, _bgRimLaw: null, console: { log: () => {}, warn: console.warn } };
const body = ['bgRimLawFor', 'bgRimLawAtStep', 'bgPinholeFilledMask', 'bgMGSolve', 'bgSourceHole', 'bgEnvAspect'].map(grab).join('\n');
const lib = new Function(...Object.keys(G), 'let _bgRimLawL = null;\n' + body.replace(/_bgRimLaw\b/g, '_bgRimLawL') + '\nreturn { bgRimLawFor, bgSourceHole };')(...Object.values(G));
const x = fs.readFileSync(path.join(DUMP, 'dQ.f32')); const dQ = Float32Array.from(new Float32Array(x.buffer, x.byteOffset, N));
const rgb = require('child_process').execSync(`python3 -c "import sys,numpy as np;from PIL import Image;sys.stdout.buffer.write(np.asarray(Image.open('${DUMP}/color.png').convert('RGB'),np.uint8).tobytes())"`, { maxBuffer: 64 << 20 });
const t0 = Date.now(); const r = lib.bgSourceHole({ dQ, rgb, pw, ph, rl: lib.bgRimLawFor(pw, ph), step, D: meta.D, layerW, tol: 1e-8 });
const w = (n, a) => fs.writeFileSync(path.join(OUT, n), Buffer.from(a.buffer));
w('dQ.f32', dQ); w('plate.f32', r.plate); w('hole.u8', r.hole); w('has2.u8', r.has2 || new Uint8Array(N)); w('plate2.f32', r.plate2 || r.plate);
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify(Object.assign({}, meta, { sky: SKY })));
console.log(JSON.stringify({ hole: r.stats.hole, l2: r.stats.secondLayerTexels, seen: r.stats.seen, shown: r.stats.shown, patch: r.stats.patch, rescued: r.stats.rescued, ms: Date.now() - t0 }));
