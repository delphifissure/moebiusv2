// fourd/make_synthetic_spacetime.js — synthetic SpacetimeGaussians test clip.
//
// No GPU here to train a real spacetime splat, so the test asset is built to
// EXERCISE every channel of the format (property list and evaluation law
// verified against oppo-us-research/SpacetimeGaussians):
//   - static body/ground: zero motion, wide temporal window
//   - MAGENTA marker: linear x-motion (order-1 coefficients)
//   - CYAN marker: quadratic+cubic y-wiggle (orders 2 and 3)
//   - ORANGE pop blob: narrow trbf window centered at t=0.75 — exists only
//     near that time (temporal opacity)
//   - spinner bar: elongated splats rotating via omega (linear quaternion)
// Output: fourd/assets/spacetime_test.ply (binary_little_endian)
//   node fourd/make_synthetic_spacetime.js
'use strict';
const fs = require('fs');
const path = require('path');
const SH_C0 = 0.28209479177387814;

let seed = 0x57a7;
function rnd() {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function gauss() { return (rnd() + rnd() + rnd() + rnd() - 2) * Math.SQRT2; }

const pts = [];
// rec: p, scale (linear), rgb, alpha, trbfC, trbfS (linear), motion[9], quat wxyz, omega wxyz
function add(p, s, rgb, a, o) {
    pts.push(Object.assign({
        p, s: Array.isArray(s) ? s : [s, s, s], rgb, a,
        trbfC: 0.5, trbfS: 10,               // wide window ~ always on
        motion: [0, 0, 0, 0, 0, 0, 0, 0, 0], // dt, dt^2, dt^3 xyz groups
        quat: [1, 0, 0, 0], omega: [0, 0, 0, 0],
    }, o || {}));
}

function blob(center, radius, rgb, count, a, extra) {
    for (let i = 0; i < count; i++) {
        add([center[0] + gauss() * radius * 0.5,
             center[1] + gauss() * radius * 0.5,
             center[2] + gauss() * radius * 0.5],
            radius * (0.25 + 0.2 * rnd()), rgb, a, extra);
    }
}

// static figure (simplified: torso + head) and ground
blob([0, 1.25, 0], 0.16, [0.75, 0.3, 0.22], 220, 0.85);
blob([0, 1.78, 0], 0.11, [0.85, 0.68, 0.55], 90, 0.9);
for (let i = 0; i < 400; i++) {
    add([gauss() * 0.5, -0.02 + gauss() * 0.01, gauss() * 0.5],
        [0.06 + 0.04 * rnd(), 0.012, 0.06 + 0.04 * rnd()], [0.42, 0.38, 0.33], 0.8);
}
// MAGENTA: linear x sweep, -0.3 -> +0.3 over the clip (order 1)
blob([-0.3 - 0.5 * (-0.5), 0.55, 0.45], 0.09, [1.0, 0.05, 0.9], 90, 1.0,
    { motion: [0.6, 0, 0, 0, 0, 0, 0, 0, 0] });     // dx/dt = 0.6 per unit t
// CYAN: y wiggle via dt^2 and dt^3
blob([0.55, 1.3, -0.7], 0.09, [0.05, 0.95, 1.0], 90, 1.0,
    { motion: [0, 0, 0, 0, 1.2, 0, 0, -1.6, 0] });
// ORANGE pop: only alive near t = 0.75 (narrow temporal gaussian)
blob([-0.45, 1.55, -0.2], 0.11, [1.0, 0.5, 0.05], 120, 1.0,
    { trbfC: 0.75, trbfS: 0.08 });
// spinner: elongated splats, omega rotation about z
for (let i = 0; i < 40; i++) {
    add([0.02 * gauss(), 0.7 + 0.02 * gauss(), 0.35 + 0.02 * gauss()],
        [0.12, 0.015, 0.015], [0.9, 0.9, 0.2], 0.95,
        { omega: [0, 0, 0, 2.0] });                  // dq/dt in z component
}

// ---- write the ply (verified property order; nx/ny/nz zero like theirs)
const props = ['x','y','z','trbf_center','trbf_scale','nx','ny','nz',
    ...Array.from({length:9},(_,i)=>'motion_'+i), 'f_dc_0','f_dc_1','f_dc_2','opacity',
    'scale_0','scale_1','scale_2','rot_0','rot_1','rot_2','rot_3',
    ...Array.from({length:4},(_,i)=>'omega_'+i)];
const stride = props.length;
const buf = Buffer.alloc(pts.length * stride * 4);
pts.forEach((pt, i) => {
    const v = [];
    v.push(pt.p[0], pt.p[1], pt.p[2], pt.trbfC, Math.log(pt.trbfS), 0, 0, 0);
    v.push(...pt.motion);
    v.push(...pt.rgb.map(c => (c - 0.5) / SH_C0));
    const aCl = Math.min(0.999, Math.max(0.001, pt.a));
    v.push(Math.log(aCl / (1 - aCl)));
    v.push(...pt.s.map(s => Math.log(s)));
    v.push(...pt.quat);      // rot_0..3 = (w, x, y, z), 3DGS convention
    v.push(...pt.omega);     // omega_0..3, same component order
    v.forEach((x, k) => buf.writeFloatLE(x, (i * stride + k) * 4));
});
const head = 'ply\nformat binary_little_endian 1.0\nelement vertex ' + pts.length + '\n'
    + props.map(p => 'property float ' + p).join('\n') + '\nend_header\n';
const out = path.join(__dirname, 'assets', 'spacetime_test.ply');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.concat([Buffer.from(head, 'ascii'), buf]));
console.log('wrote ' + pts.length + ' spacetime splats -> ' + out);
