// S61 §12: the APP's bgPlainFill (source extracted from ../moebius.js) against harness/sheet_ab_fields.py's arm C and
// wash on the troll's A/B inputs. node plainfill_verify.js
'use strict';
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const src = fs.readFileSync(path.join(__dirname, '..', 'moebius.js'), 'utf8');
const a = src.indexOf('function bgPlainFill('), b = src.indexOf('\n// S61 §12: THE POST-BAKE FILL OPTIONS', a);
const bgPlainFill = new Function(src.slice(a, b) + '\nreturn bgPlainFill;')();
const D = '/home/user/moebiusv2/harness/shots/streakclass/ab_troll', F = D + '/ab_fields', step = 1.760e-3;
const { pw, ph } = JSON.parse(fs.readFileSync(D + '/size.json')); const N = pw * ph;
const f32 = (p) => { const x = fs.readFileSync(p); return new Float32Array(x.buffer, x.byteOffset, x.byteLength / 4); };
const band = fs.readFileSync(D + '/disocc.u8'), dQ = f32(D + '/dQ.f32'), law = f32(D + '/farField.f32');
const rj = fs.readFileSync(F + '/rimJ.i32'); const rimJ = new Int32Array(rj.buffer, rj.byteOffset, rj.byteLength / 4); const rimW = f32(F + '/rimW.f32');
const rgb = execSync(`python3 -c "import sys,numpy as np;from PIL import Image;sys.stdout.buffer.write(np.asarray(Image.open('${D}/color.png').convert('RGB'),np.uint8).tobytes())"`, { maxBuffer: 64 << 20 });
const t0 = Date.now(); const r = bgPlainFill({ pw, ph, band, dQ, law, step, rimJ, rimW, rgb }); const ms = Date.now() - t0;
const C = f32(F + '/fieldC.f32'); let mx = 0; for (let i = 0; i < N; i++) if (band[i]) mx = Math.max(mx, Math.abs(C[i] - r.depth[i]));
const W = execSync(`python3 -c "import sys,numpy as np;from PIL import Image;sys.stdout.buffer.write(np.asarray(Image.open('${F}/wash.png').convert('RGB'),np.uint8).tobytes())"`, { maxBuffer: 64 << 20 });
let cm = 0; for (let i = 0; i < N; i++) if (band[i]) for (let c = 0; c < 3; c++) cm = Math.max(cm, Math.abs(W[3 * i + c] - r.colour[3 * i + c]));
const ok = mx / step < 1e-3 && cm <= 1;
console.log(JSON.stringify({ ms, ...r.stats, maxDepthDiffSteps: mx / step, maxWashDiff: cm }), ok ? 'APP PLAIN FILL VERIFIED' : 'MISMATCH'); process.exit(ok ? 0 : 1);
