// fourd/make_synthetic_splat.js — synthetic 4D splat sequence generator.
//
// No GPU exists in this environment to train real 3DGS/4DGS, so the PoC's
// test asset is generated: a walking humanoid built from gaussian-sampled
// capsules (the same primitive family a real person-splat decomposes into),
// plus a ground disc and THREE DEPTH MARKERS used by the harness to verify
// off-axis parallax numerically:
//   - magenta post  IN FRONT of the subject (z = +0.35 from subject center)
//   - cyan post     BEHIND the subject      (z = -0.60)
// Under a lateral eye move their screen shift must straddle the subject's
// (nearer shifts more against the eye through a fixed portal).
//
// Output: fourd/assets/frame_00.splat ... frame_23.splat + manifest.json.
// Format: antimatter15 .splat — 32 bytes/record: float32 xyz pos, float32
// xyz scale, uint8 rgba (a = opacity), uint8 quat wxyz as c*128+128.
//   node fourd/make_synthetic_splat.js
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'assets');
const FRAMES = 24, FPS = 12;

// Deterministic RNG (mulberry32) — reproducible assets, no Date/Math.random
// coupling to the run.
let seed = 0x4d4d;
function rnd() {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function gauss() { return (rnd() + rnd() + rnd() + rnd() - 2) * Math.SQRT2; }

const splats = []; // per frame: array of {p:[3], s:[3], c:[4 0..1], q:[4 wxyz]}

function capsule(list, a, b, radius, color, density, jitter) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    const count = Math.max(2, Math.round(len * density));
    for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        const p = [a[0] + dx * t + gauss() * radius * 0.35,
                   a[1] + dy * t + gauss() * radius * 0.35,
                   a[2] + dz * t + gauss() * radius * 0.35];
        const s = radius * (0.55 + 0.25 * rnd());
        const shade = 1 - jitter * rnd();
        list.push({ p, s: [s, s, s], q: [1, 0, 0, 0],
            c: [color[0] * shade, color[1] * shade, color[2] * shade, 0.85] });
    }
}

function blob(list, center, radius, color, count, alpha) {
    for (let i = 0; i < count; i++) {
        const p = [center[0] + gauss() * radius * 0.5,
                   center[1] + gauss() * radius * 0.5,
                   center[2] + gauss() * radius * 0.5];
        const s = radius * (0.25 + 0.2 * rnd());
        const shade = 1 - 0.25 * rnd();
        list.push({ p, s: [s, s, s], q: [1, 0, 0, 0],
            c: [color[0] * shade, color[1] * shade, color[2] * shade, alpha] });
    }
}

// flattened ground: splats sampled in a horizontal disc with thin vertical
// extent (a spherical blob here fogs the whole portal — measured, first
// harness run: the "ground" occluded both parallax markers)
function groundDisc(list, centerY, radius, color, count) {
    for (let i = 0; i < count; i++) {
        const p = [gauss() * radius * 0.5, centerY + gauss() * 0.01, gauss() * radius * 0.5];
        const s = radius * (0.06 + 0.05 * rnd());
        const shade = 1 - 0.3 * rnd();
        list.push({ p, s: [s, s * 0.12, s], q: [1, 0, 0, 0],
            c: [color[0] * shade, color[1] * shade, color[2] * shade, 0.8] });
    }
}

// Walking-figure forward kinematics (viewed from +z; walk in place).
// Proportions in meters-ish; subject faces the viewer.
function figureFrame(list, phase) {
    const hipY = 0.95, kneeL = 0.45, shinL = 0.45;
    const shoulderY = 1.55, upperArm = 0.32, foreArm = 0.30;
    const swingLeg = 0.55 * Math.sin(phase);          // radians, sagittal (z)
    const swingArm = 0.45 * Math.sin(phase + Math.PI); // arms counter-swing
    const bob = 0.03 * Math.cos(2 * phase);
    const SKIN = [0.85, 0.68, 0.55], SHIRT = [0.75, 0.30, 0.22], PANTS = [0.25, 0.30, 0.55];

    const y0 = bob;
    // torso + head
    capsule(list, [0, hipY + y0, 0], [0, shoulderY + y0, 0], 0.13, SHIRT, 90, 0.3);
    blob(list, [0, shoulderY + 0.23 + y0, 0], 0.11, SKIN, 60, 0.9);
    // legs: hip -> knee -> ankle, sagittal swing about the hip/knee
    for (const side of [-1, 1]) {
        const ph = side < 0 ? swingLeg : -swingLeg;
        const hx = side * 0.10;
        const kz = Math.sin(ph) * kneeL, ky = hipY - Math.cos(ph) * kneeL;
        const kneeBend = Math.max(0, -Math.sin(ph)) * 0.9 + 0.1;
        const az = kz + Math.sin(ph - kneeBend) * shinL;
        const ay = ky - Math.cos(ph - kneeBend) * shinL;
        capsule(list, [hx, hipY + y0, 0], [hx, ky + y0, kz], 0.075, PANTS, 110, 0.25);
        capsule(list, [hx, ky + y0, kz], [hx, ay + y0, az], 0.06, PANTS, 110, 0.25);
        blob(list, [hx, ay + y0 - 0.03, az + 0.05], 0.06, [0.15, 0.12, 0.1], 25, 0.9);
    }
    // arms
    for (const side of [-1, 1]) {
        const ph = side < 0 ? swingArm : -swingArm;
        const sx = side * 0.22;
        const ez = Math.sin(ph) * upperArm, ey = shoulderY - Math.cos(ph) * upperArm;
        const elbowBend = 0.35;
        const wz = ez + Math.sin(ph + elbowBend) * foreArm;
        const wy = ey - Math.cos(ph + elbowBend) * foreArm;
        capsule(list, [sx, shoulderY + y0, 0], [sx, ey + y0, ez], 0.055, SHIRT, 110, 0.3);
        capsule(list, [sx, ey + y0, ez], [sx, wy + y0, wz], 0.045, SKIN, 110, 0.2);
    }
}

for (let f = 0; f < FRAMES; f++) {
    const phase = (f / FRAMES) * Math.PI * 2;
    seed = 0x4d4d; // SAME seed every frame: splat identity is stable, only the
                   // skeleton moves — matching how a deformed 4DGS behaves.
    const list = [];
    figureFrame(list, phase);
    // static environment (regenerated identically per frame via fixed seed)
    groundDisc(list, -0.02, 0.9, [0.42, 0.38, 0.33], 500);                  // ground (thin disc)
    blob(list, [-0.55, 0.55, 0.45], 0.09, [1.0, 0.05, 0.9], 90, 1.0);       // MAGENTA front marker
    blob(list, [0.55, 1.30, -0.70], 0.09, [0.05, 0.95, 1.0], 90, 1.0);      // CYAN back marker
    blob(list, [0.0, 1.1, -1.3], 0.5, [0.35, 0.55, 0.35], 250, 0.6);        // far foliage
    splats.push(list);
}

fs.mkdirSync(OUT, { recursive: true });
const frames = [];
splats.forEach((list, f) => {
    const buf = Buffer.alloc(list.length * 32);
    list.forEach((sp, i) => {
        const o = i * 32;
        buf.writeFloatLE(sp.p[0], o); buf.writeFloatLE(sp.p[1], o + 4); buf.writeFloatLE(sp.p[2], o + 8);
        buf.writeFloatLE(sp.s[0], o + 12); buf.writeFloatLE(sp.s[1], o + 16); buf.writeFloatLE(sp.s[2], o + 20);
        buf[o + 24] = Math.round(sp.c[0] * 255); buf[o + 25] = Math.round(sp.c[1] * 255);
        buf[o + 26] = Math.round(sp.c[2] * 255); buf[o + 27] = Math.round(sp.c[3] * 255);
        buf[o + 28] = Math.round(sp.q[0] * 128 + 128); buf[o + 29] = Math.round(sp.q[1] * 128 + 128);
        buf[o + 30] = Math.round(sp.q[2] * 128 + 128); buf[o + 31] = Math.round(sp.q[3] * 128 + 128);
    });
    const name = 'frame_' + String(f).padStart(2, '0') + '.splat';
    fs.writeFileSync(path.join(OUT, name), buf);
    frames.push(name);
});
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
    kind: 'splat-sequence', fps: FPS, frames,
    // the generator KNOWS its subject — the viewer frames by this, not by the
    // union bbox (environment splats would dominate the fit otherwise)
    subject: { center: [0, 0.95, 0], height: 1.9 },
    note: 'synthetic walking figure + parallax markers; generator: make_synthetic_splat.js',
}, null, 2));
console.log('wrote ' + FRAMES + ' frames, ' + splats[0].length + ' splats/frame -> ' + OUT);
