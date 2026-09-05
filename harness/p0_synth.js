// PHASE 0.1 SYNTHETIC TRUTH SCENES (Addendum 184). Two-layer RGB-D scenes whose hidden
// layer is KNOWN: a far layer defined everywhere (depth + colour, including under the
// occluder) and a near occluder. Written as the app's inputs (colour PNG + depth PNG) in
// two depth grades — 16-bit perfect, and 8-bit degraded the way an estimator degrades it
// (silhouette blur sigma = RWD = 4/1200 of the width, the measured smear of Addendum 93;
// 8-bit quantisation; a low-frequency bias) — plus the truth as raw arrays the metric
// harness (p0_truth.js) reads: far depth (Float32, 0 = far .. 1 = near, the app's
// convention), far colour (RGB8), near mask (1 under the occluder at rest).
//   node harness/p0_synth.js            -> harness/synth/<scene>_{color,depth16,depth8}.png + truth
// Scenes: figure (figure on ground before a textured wall), screen (porous screen before a
// textured wall), pole (thin pole before a smooth gradient). No third-party assets.
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const OUT = path.join(__dirname, 'synth'); fs.mkdirSync(OUT, { recursive: true });
const W = 1024, H = 768;

// --- PNG writer (zlib only): 8-bit RGB or 16-bit grey, filter 0 ---
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; } return t; })();
const crc32 = (buf) => { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type, 'ascii'), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
function writePNG(file, w, h, kind, px) {   // kind 'rgb8' (px Uint8Array 3N) | 'grey16' (px Uint16Array N) | 'grey8' (Uint8Array N)
    const bpp = kind === 'rgb8' ? 3 : (kind === 'grey16' ? 2 : 1), ct = kind === 'rgb8' ? 2 : 0, bd = kind === 'grey16' ? 16 : 8;
    const raw = Buffer.alloc(h * (1 + w * bpp)); let o = 0;
    for (let y = 0; y < h; y++) { raw[o++] = 0;
        for (let x = 0; x < w; x++) { const i = y * w + x;
            if (kind === 'rgb8') { raw[o++] = px[i * 3]; raw[o++] = px[i * 3 + 1]; raw[o++] = px[i * 3 + 2]; }
            else if (kind === 'grey16') { raw[o++] = px[i] >> 8; raw[o++] = px[i] & 255; }
            else raw[o++] = px[i]; } }
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = bd; ihdr[9] = ct; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]));
}

// --- degradation (8-bit grade): Gaussian blur sigma = RWD, low-frequency bias, quantise ---
function gauss1D(sigma) { const r = Math.ceil(3 * sigma); const k = new Float32Array(2 * r + 1); let s = 0; for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-i * i / (2 * sigma * sigma)); s += k[i + r]; } for (let i = 0; i < k.length; i++) k[i] /= s; return { k, r }; }
function blur(src, w, h, sigma) { const { k, r } = gauss1D(sigma); const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let i = -r; i <= r; i++) { const xx = Math.min(w - 1, Math.max(0, x + i)); s += src[y * w + xx] * k[i + r]; } tmp[y * w + x] = s; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let i = -r; i <= r; i++) { const yy = Math.min(h - 1, Math.max(0, y + i)); s += tmp[yy * w + x] * k[i + r]; } out[y * w + x] = s; }
    return out; }

// --- textures (far layer colour): designed so colour error is informative ---
const checker = (x, y, p, a, b) => (((Math.floor(x / p) + Math.floor(y / p)) & 1) ? a : b);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp01 = (v) => Math.max(0, Math.min(1, v));

// scene: far(x,y) -> {d, rgb}; near(x,y) -> {d, rgb} | null
function build(name, far, near, notes) {
    const N = W * H;
    const farD = new Float32Array(N), farC = new Uint8Array(N * 3), nearM = new Uint8Array(N);
    const compD = new Float32Array(N), compC = new Uint8Array(N * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x;
        const f = far(x, y); farD[i] = clamp01(f.d); farC[i * 3] = f.rgb[0]; farC[i * 3 + 1] = f.rgb[1]; farC[i * 3 + 2] = f.rgb[2];
        const n = near(x, y);
        if (n && n.d > f.d) { nearM[i] = 1; compD[i] = clamp01(n.d); compC[i * 3] = n.rgb[0]; compC[i * 3 + 1] = n.rgb[1]; compC[i * 3 + 2] = n.rgb[2]; }
        else { compD[i] = farD[i]; compC[i * 3] = farC[i * 3]; compC[i * 3 + 1] = farC[i * 3 + 1]; compC[i * 3 + 2] = farC[i * 3 + 2]; } }
    // perfect grade: 16 bits of the composite depth
    const d16 = new Uint16Array(N); for (let i = 0; i < N; i++) d16[i] = Math.round(compD[i] * 65535);
    // degraded grade: silhouette blur (RWD), low-frequency bias (2% of range, one period across the frame), 8-bit quantisation
    const RWD = Math.max(1, Math.round(4 * W / 1200));
    const bl = blur(compD, W, H, RWD);
    const d8 = new Uint8Array(N); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x;
        const bias = 0.02 * Math.sin(2 * Math.PI * x / W) * Math.cos(Math.PI * y / H);
        d8[i] = Math.round(clamp01(bl[i] + bias) * 255); }
    writePNG(path.join(OUT, name + '_color.png'), W, H, 'rgb8', compC);
    writePNG(path.join(OUT, name + '_depth16.png'), W, H, 'grey16', d16);
    writePNG(path.join(OUT, name + '_depth8.png'), W, H, 'grey8', d8);
    fs.writeFileSync(path.join(OUT, name + '_far_depth.f32'), Buffer.from(farD.buffer));
    fs.writeFileSync(path.join(OUT, name + '_far_rgb.u8'), Buffer.from(farC.buffer));
    fs.writeFileSync(path.join(OUT, name + '_near_mask.u8'), Buffer.from(nearM.buffer));
    fs.writeFileSync(path.join(OUT, name + '_comp_depth.f32'), Buffer.from(compD.buffer));   // the true composite depth (near where the occluder is, far elsewhere)
    let nNear = 0; for (let i = 0; i < N; i++) nNear += nearM[i];
    fs.writeFileSync(path.join(OUT, name + '_truth.json'), JSON.stringify({ name, w: W, h: H, rwd: RWD, nearTexels: nNear, notes, files: { color: name + '_color.png', depth16: name + '_depth16.png', depth8: name + '_depth8.png', farDepth: name + '_far_depth.f32', farRGB: name + '_far_rgb.u8', nearMask: name + '_near_mask.u8' } }, null, 1));
    console.log(name + ': ' + W + 'x' + H + ', occluder ' + nNear + ' texels (' + (100 * nNear / N).toFixed(1) + '%), RWD ' + RWD);
}

// S1 FIGURE: ground plane (depth rises toward the bottom), textured wall above the horizon, a figure
// standing on the ground (feet in contact: the figure's depth equals the ground's at its base).
{
    const horizon = 0.58 * H, dWall = 0.18, dGroundNear = 0.62;
    const groundD = (y) => dWall + (dGroundNear - dWall) * clamp01((y - horizon) / (H - 1 - horizon));
    const far = (x, y) => {
        if (y < horizon) { const c = checker(x, y, 48, [200, 170, 120], [120, 90, 60]); const t = 0.5 + 0.5 * Math.sin(x / 90); return { d: dWall, rgb: mix(c, [90, 120, 170], 0.35 * t).map(Math.round) }; }
        const stripe = ((Math.floor((x + 3 * (y - horizon)) / 40)) & 1) ? [70, 110, 70] : [110, 150, 90];
        return { d: groundD(y), rgb: stripe };
    };
    const cx = 0.5 * W, feetY = 0.88 * H, topY = 0.22 * H, halfW = 0.10 * W;
    const near = (x, y) => {
        // body: rounded column; head: disc
        const inBody = (y >= 0.42 * H && y <= feetY && Math.abs(x - cx) <= halfW * (0.75 + 0.25 * Math.sin(Math.PI * (y - 0.42 * H) / (feetY - 0.42 * H))));
        const headR = 0.085 * W, hy = topY + headR; const inHead = (x - cx) * (x - cx) + (y - hy) * (y - hy) <= headR * headR;
        const neckY = 0.42 * H; const inNeck = (y > hy && y < neckY + 2 && Math.abs(x - cx) <= 0.035 * W);
        if (!(inBody || inHead || inNeck)) return null;
        const d = groundD(feetY) + 0.002 * (feetY - y) / H;   // the figure stands at its contact depth, leaning back a hair
        const shade = 150 + 60 * Math.sin(x / 7) * Math.sin(y / 9);
        return { d, rgb: [Math.round(shade), Math.round(shade * 0.55), Math.round(shade * 0.5)] };
    };
    build('figure', far, near, 'figure on ground before a textured wall; hidden = wall + ground behind the figure; contact at the feet');
}
// S2 SCREEN: porous screen (bars, thin) at one depth before a textured wall with a gentle recession
{
    const far = (x, y) => { const d = 0.30 - 0.08 * (x / W); const c = checker(x, y, 36, [180, 200, 220], [60, 80, 120]); const warm = 0.5 + 0.5 * Math.sin(y / 60); return { d, rgb: mix(c, [220, 160, 80], 0.4 * warm).map(Math.round) }; };
    const near = (x, y) => { const p = 96, bw = 14; const inBar = ((x % p) < bw) || ((y % p) < bw); if (!inBar) return null; if (x < 0.06 * W || x > 0.94 * W || y < 0.06 * H || y > 0.94 * H) return null;
        return { d: 0.74, rgb: [40 + 20 * ((x + y) % 3), 36, 30] }; };
    build('screen', far, near, 'porous screen (bars) before a textured wall; many small disocclusions; every bar hides a strip');
}
// S3 POLE: a thin pole before a smooth depth and colour gradient (the membrane's best case)
{
    const far = (x, y) => { const d = 0.12 + 0.30 * (x / W) + 0.05 * (y / H); const t = x / W, u = y / H; return { d, rgb: [Math.round(60 + 150 * t), Math.round(90 + 100 * u), Math.round(200 - 120 * t)] }; };
    const near = (x, y) => { const cx = 0.46 * W, hw = 5; if (Math.abs(x - cx) > hw || y < 0.05 * H) return null; return { d: 0.82, rgb: [30, 30, 34] }; };
    build('pole', far, near, 'thin pole before a smooth gradient; hidden = a 11-px strip of a smooth surface');
}
