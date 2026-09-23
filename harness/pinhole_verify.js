// S61 §10: the APP's bgPinholeFilledMask (source extracted from ../moebius.js) on the four A/B dump bands; the joined /
// kept counts must reproduce the offline classification (troll 928 / 962, vermeer 588 / 606, sunflowers 352 / 373,
// starwatcher 432 / 449). node pinhole_verify.js
'use strict';
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'moebius.js'), 'utf8');
const a = src.indexOf('function bgPinholeFilledMask('), b = src.indexOf('\n}\n', a) + 2;
const f = new Function(src.slice(a, b) + '\nreturn bgPinholeFilledMask;')();
const S = '/home/user/moebiusv2/harness/shots/streakclass'; const EXP = { troll: [962, 928], vermeer: [606, 588], sunflowers: [373, 352], starwatcher: [449, 432] };
const STEP = { troll: 1.760e-3, vermeer: 1.786e-3, sunflowers: 2.679e-3, starwatcher: 2.571e-3 }; let ok = true;
for (const p of Object.keys(EXP)) {
    const { pw, ph } = JSON.parse(fs.readFileSync(path.join(S, 'ab_' + p, 'size.json'))); const band = fs.readFileSync(path.join(S, 'ab_' + p, 'disocc.u8'));
    const db = fs.readFileSync(path.join(S, 'ab_' + p, 'dQ.f32')); const dQ = new Float32Array(db.buffer, db.byteOffset, db.byteLength / 4);
    const t0 = Date.now(); const r = f(band, dQ, pw, ph, STEP[p]); const ms = Date.now() - t0;
    const good = r.holes === EXP[p][0] && r.joined === EXP[p][1]; if (!good) ok = false;
    console.log(p, 'holes', r.holes, 'joined', r.joined, 'kept', r.kept, 'texels filled', r.filled, '| expected', EXP[p].join(' / '), good ? 'OK' : 'MISMATCH', ms + ' ms');
}
console.log(ok ? 'PINHOLE RULE VERIFIED' : 'PINHOLE MISMATCH'); process.exit(ok ? 0 : 1);
