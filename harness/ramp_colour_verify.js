// Verifies the APP's bgRampColourCollapse (its source extracted from ../moebius.js, so what is tested is what ships)
// against harness/ramp_colour.py on the same inputs (ramp_colour_verify.py writes them). node ramp_colour_verify.js <dir>
'use strict';
const fs = require('fs'), path = require('path'); const dir = process.argv[2];
const src = fs.readFileSync(path.join(__dirname, '..', 'moebius.js'), 'utf8');
const a = src.indexOf('function bgRampColourCollapse('), b = src.indexOf('\nfunction bgRimLawFor(', a);
const bgRampColourCollapse = new Function(src.slice(a, b) + '\nreturn bgRampColourCollapse;')();
const ref = JSON.parse(fs.readFileSync(path.join(dir, 'ref.json')));
const f32 = (p) => { const x = fs.readFileSync(p); return new Float32Array(x.buffer, x.byteOffset, x.byteLength / 4); };
let ok = true;
for (const p of ['troll', 'vermeer', 'sunflowers', 'starwatcher']) {
    const { pw, ph, step } = ref[p]; const d = f32(path.join(dir, 'in_' + p + '.f32')); const rgba = fs.readFileSync(path.join(dir, 'rgba_' + p + '.u8'));
    for (const mode of ['strong', 'safe']) {
        const t0 = Date.now(); const r = bgRampColourCollapse(d, rgba, pw, ph, { outer: 0.02, inner: 0.04, pn: 0.5, D: 0.2 }, step, mode === 'safe'); const ms = Date.now() - t0;
        const py = f32(path.join(dir, 'ref_' + p + '_' + mode + '.f32')); let mx = 0, nd = 0; for (let i = 0; i < py.length; i++) { const e = Math.abs(py[i] - r.out[i]); if (e > mx) mx = e; if (e > 0) nd++; }
        const pr = ref[p + '_' + mode]; const same = pr.changed === r.changed && JSON.stringify(Object.keys(pr.stats).sort().map(k => pr.stats[k])) === JSON.stringify(Object.keys(pr.stats).sort().map(k => r.stats[k] || 0));
        console.log(p, mode, 'changed js', r.changed, 'py', pr.changed, '| stats equal', same, '| max |js-py|', mx.toExponential(2), 'in steps', (mx / step).toExponential(2), '| texels differing', nd, '|', ms, 'ms');
        if (!same || mx / step > 1e-3) ok = false;
    }
}
console.log(ok ? 'PORT VERIFIED' : 'PORT MISMATCH'); process.exit(ok ? 0 : 1);
