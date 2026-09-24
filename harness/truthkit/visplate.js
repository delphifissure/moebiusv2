// plate texels some pose shows: the source mesh and the plate (hole at its fill, else source) each drawn at 32 poses over
// the envelope, stretched where the rim law joins; a plate texel drawn at a pixel the source mesh leaves uncovered is shown.
// node truthkit/visplate.js <moebius.js> <probe dir: meta.json dQ.f32 plateF.f32 (flipped) disocc.u8 [farField2.f32]> [SKY=1]; writes vis.u8 (plate 1), vis2.u8 (plate 2); scored by errvis.py and layers.py
'use strict';
const fs = require('fs'), path = require('path');
const [SRC, P] = process.argv.slice(2); const src = fs.readFileSync(SRC, 'utf8');
const grab = (name) => { const a = src.indexOf('function ' + name + '('); const b = src.indexOf('\nfunction ', a + 10); return src.slice(a, b); };
const meta = JSON.parse(fs.readFileSync(path.join(P, 'meta.json'))); const { pw, ph } = meta, N = pw * ph;
const TW = 0.16, TH = 0.09, layerW = (pw / ph > TW / TH) ? TW : TH * pw / ph;
const step = 1 / (meta.D * Math.max(meta.outer / (meta.D + meta.outer), meta.inner / (meta.D - meta.inner)) * (pw / layerW));
const SKY = !!meta.sky || process.env.SKY === '1';
const G = { window: { _qbSrcQuantum: step, _qbSrcGrid: 1 / 65535 }, currentNormPortalPlane: meta.pn, portalPlaneWorldZ: 0, camera: { position: { z: meta.D } },
            innerVolumeDepth: meta.inner, outerVolumeDepth: meta.outer, terrariumWidth: TW, terrariumHeight: TH, bgSkyInfOn: () => SKY, bgSkyQ: () => 0.5 / 65535, _bgRimLaw: null, console: { log: () => {} } };
const lib = new Function(...Object.keys(G), 'let _bgRimLawL = null;\n' + ['bgRimLawFor', 'bgRimLawAtStep'].map(grab).join('\n').replace(/_bgRimLaw\b/g, '_bgRimLawL') + '\nreturn { bgRimLawFor };')(...Object.values(G));
const rl = lib.bgRimLawFor(pw, ph);
const f32 = (p) => { const x = fs.readFileSync(p); return Float32Array.from(new Float32Array(x.buffer, x.byteOffset, x.byteLength / 4)); };
const dQ = f32(path.join(P, 'dQ.f32')), pF = f32(path.join(P, 'plateF.f32')), hole = fs.readFileSync(path.join(P, 'disocc.u8'));
const plate = new Float32Array(N); for (let i = 0; i < N; i++) plate[i] = pF[(ph - 1 - ((i / pw) | 0)) * pw + (i % pw)];
let p2 = null; if (fs.existsSync(path.join(P, 'farField2.f32'))) { p2 = f32(path.join(P, 'farField2.f32')); }
const ex = meta.D * Math.tan(Math.PI / 4), ppm = pw / layerW, env = Math.tan(Math.PI / 6);
const sh = (d) => (rl.sky >= 0 && d < rl.sky) ? -ex * ppm : (() => { const ze = rl.zeAt(d); return ex * (meta.D - ze) / ze * ppm; })();
const raster = (dep, hx, hy, zb, id) => { zb.fill(-1); const S = new Float64Array(N); for (let i = 0; i < N; i++) S[i] = dep[i] >= 0 ? sh(dep[i]) : 0;
  for (let i = 0; i < N; i++) { if (dep[i] < 0) continue; const x = i % pw, y = (i - x) / pw, X = x + S[i] * hx, Y = y + S[i] * hy; let x0 = X, x1 = X, y0 = Y, y1 = Y;
    if (x < pw - 1 && dep[i + 1] >= 0 && rl.joinedIdx(i, i + 1, dep, pw)) { const X2 = x + 1 + S[i + 1] * hx, Y2 = y + S[i + 1] * hy; x0 = Math.min(x0, X2); x1 = Math.max(x1, X2); y0 = Math.min(y0, Y2); y1 = Math.max(y1, Y2); }
    if (i < N - pw && dep[i + pw] >= 0 && rl.joinedIdx(i, i + pw, dep, pw)) { const X2 = x + S[i + pw] * hx, Y2 = y + 1 + S[i + pw] * hy; x0 = Math.min(x0, X2); x1 = Math.max(x1, X2); y0 = Math.min(y0, Y2); y1 = Math.max(y1, Y2); }
    for (let yy = Math.max(0, Math.round(y0)); yy <= Math.min(ph - 1, Math.round(y1)); yy++) for (let xx = Math.max(0, Math.round(x0)); xx <= Math.min(pw - 1, Math.round(x1)); xx++) { const c = yy * pw + xx; if (dep[i] > zb[c]) { zb[c] = dep[i]; if (id) id[c] = i; } } } };
const zf = new Float32Array(N), zp = new Float32Array(N), ip = new Int32Array(N), z2 = new Float32Array(N), i2 = new Int32Array(N), vis = new Uint8Array(N), vis2 = new Uint8Array(N);
const d2 = p2 ? Float32Array.from(p2) : null;   // plate 2: only where it exists (-1 elsewhere)
let nSee = 0;
for (const [ux, uy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) for (const m of [0.25, 0.5, 0.75, 1]) {
  const hx = ux * m, hy = uy * m * env; raster(dQ, hx, hy, zf, null); raster(plate, hx, hy, zp, ip); if (d2) raster(d2, hx, hy, z2, i2);
  for (let c = 0; c < N; c++) { if (zf[c] >= 0) continue; nSee++; const a = zp[c], b = d2 ? z2[c] : -1; if (a >= 0 && a >= b) vis[ip[c]] = 1; else if (b >= 0) vis2[i2[c]] = 1; }
}
fs.writeFileSync(path.join(P, 'vis.u8'), Buffer.from(vis.buffer)); fs.writeFileSync(path.join(P, 'vis2.u8'), Buffer.from(vis2.buffer));
let nv = 0, nvh = 0, nv2 = 0; for (let i = 0; i < N; i++) { nv += vis[i]; if (vis[i] && hole[i]) nvh++; nv2 += vis2[i]; }
console.log(JSON.stringify({ shown: nv, shownInHole: nvh, shown2: nv2, gapPx: nSee }));
