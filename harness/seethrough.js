// S62 §10: see-through pixels at head offset h (hx, hy in envelope units; hy scaled by the envelope's aspect), the meshes
// drawn as the app draws them: the foreground (two triangles per cell, kept where the rim law joins all three edges),
// plate 1 (bgRetearPlate: joined, or bridged by the backstop rule; all-sky triangles left to the sky layer), plate 2
// (bgSourcePlate2: a corner carries plate 2, joined on plate 2's depth, which is plate 1 elsewhere). Counts every pixel
// nothing covers and those not connected to the frame's edge (interior); writes see_<hx>_<hy>.u8 (interior) into the dir.
//   node harness/seethrough.js <moebius.js> <dir from srchole_offline.js> <hx> <hy> [nobridge: builds before S62 §10]
//   DIAG=1: classify the interior pixels by the plate triangle that belongs there
'use strict';
const fs = require('fs'), path = require('path');
const [SRC, D, HX, HY, NOB] = process.argv.slice(2); const src = fs.readFileSync(SRC, 'utf8');
const grab = (name) => { const a = src.indexOf('function ' + name + '('); const b = src.indexOf('\nfunction ', a + 10); return src.slice(a, b); };
const meta = JSON.parse(fs.readFileSync(path.join(D, 'meta.json'))); const { pw, ph } = meta, N = pw * ph;
const TW = meta.terrariumWidth || 0.16, TH = meta.terrariumHeight || 0.09, layerW = (pw / ph > TW / TH) ? TW : TH * pw / ph;
const step = 1 / (meta.D * Math.max(meta.outer / (meta.D + meta.outer), meta.inner / (meta.D - meta.inner)) * (pw / layerW));
const SKY = !!meta.sky, sq = 0.5 / 65535;
const G = { window: { _qbSrcQuantum: step, _qbSrcGrid: 1 / 65535 }, currentNormPortalPlane: meta.pn, portalPlaneWorldZ: 0, camera: { position: { z: meta.D } },
            innerVolumeDepth: meta.inner, outerVolumeDepth: meta.outer, terrariumWidth: TW, terrariumHeight: TH, bgSkyInfOn: () => SKY, bgSkyQ: () => sq, _bgRimLaw: null, console: { log: () => {} } };
const lib = new Function(...Object.keys(G), 'let _bgRimLawL = null;\n' + ['bgRimLawFor', 'bgRimLawAtStep'].map(grab).join('\n').replace(/_bgRimLaw\b/g, '_bgRimLawL') + '\nreturn { bgRimLawFor };')(...Object.values(G));
const rl = lib.bgRimLawFor(pw, ph);
const f32 = (n) => { const x = fs.readFileSync(path.join(D, n)); return new Float32Array(x.buffer, x.byteOffset, N); };
const dQ = f32('dQ.f32'), plate = f32('plate.f32'), p2 = f32('plate2.f32'), hole = fs.readFileSync(path.join(D, 'hole.u8')), has2 = fs.readFileSync(path.join(D, 'has2.u8'));
const ex = meta.D * Math.tan(Math.PI / 4), ppm = pw / layerW, env = Math.tan(Math.PI / 6);
const shf = (d) => (SKY && d < rl.sky) ? -ex * ppm : (() => { const ze = rl.zeAt(d); return ex * (meta.D - ze) / ze * ppm; })();
const hx = +HX, hy = +HY * env;
const J = (dep) => (i, j) => rl.joinedIdx(i, j, dep, pw);
const tris = (keep) => { const T = new Uint8Array(N); for (let i = 0; i < N - pw; i++) { if (i % pw === pw - 1) continue; if (keep(i, i + pw, i + 1)) T[i] |= 1; if (keep(i + pw, i + pw + 1, i + 1)) T[i] |= 2; } return T; };
const jF = J(dQ), TF = tris((a, b, c) => jF(a, b) && jF(b, c) && jF(a, c));
const j1 = J(plate), bridge = (A, B, C) => { if (NOB) return false; const V = [A, B, C]; let nf = Infinity, any = false;
  if (hole[A] && hole[B] && hole[C] && !(SKY && (plate[A] < sq || plate[B] < sq || plate[C] < sq))) return true;   // fill to fill (§10)
  for (const v of V) { if (has2[v]) return false; if (SKY && plate[v] < sq) return false; if (hole[v]) { any = true; if (plate[v] < nf) nf = plate[v]; } }
  if (!any) return false; for (const v of V) if (!hole[v] && plate[v] > nf) return false; return true; };
const T1 = tris((a, b, c) => { if (SKY && plate[a] < sq && plate[b] < sq && plate[c] < sq) return false; return (j1(a, b) && j1(b, c) && j1(a, c)) || bridge(a, b, c); });
const j2 = J(p2), T2 = tris((a, b, c) => { if (!(has2[a] || has2[b] || has2[c])) return false; if (SKY && p2[a] < sq && p2[b] < sq && p2[c] < sq) return false; return j2(a, b) && j2(b, c) && j2(a, c); });
const cov = new Uint8Array(N);
const draw = (dep, T) => { const S = new Float64Array(N); for (let i = 0; i < N; i++) S[i] = shf(dep[i]);
  const tri = (a, b, c) => { const ax = a % pw, ay = (a - ax) / pw, bx = b % pw, by = (b - bx) / pw, cx = c % pw, cy = (c - cx) / pw;
    const Ax = ax + S[a] * hx, Ay = ay + S[a] * hy, Bx = bx + S[b] * hx, By = by + S[b] * hy, Cx = cx + S[c] * hx, Cy = cy + S[c] * hy;
    const area = (Bx - Ax) * (Cy - Ay) - (By - Ay) * (Cx - Ax); if (area === 0) return; const sg = area > 0 ? 1 : -1, eps = 1e-7;
    const x0 = Math.max(0, Math.ceil(Math.min(Ax, Bx, Cx) - eps)), x1 = Math.min(pw - 1, Math.floor(Math.max(Ax, Bx, Cx) + eps)), y0 = Math.max(0, Math.ceil(Math.min(Ay, By, Cy) - eps)), y1 = Math.min(ph - 1, Math.floor(Math.max(Ay, By, Cy) + eps));
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
      if (sg * ((Bx - Ax) * (yy - Ay) - (By - Ay) * (xx - Ax)) < -eps || sg * ((Cx - Bx) * (yy - By) - (Cy - By) * (xx - Bx)) < -eps || sg * ((Ax - Cx) * (yy - Cy) - (Ay - Cy) * (xx - Cx)) < -eps) continue;
      cov[yy * pw + xx] = 1; } };
  for (let i = 0; i < N - pw; i++) { if (T[i] & 1) tri(i, i + pw, i + 1); if (T[i] & 2) tri(i + pw, i + pw + 1, i + 1); } };
draw(dQ, TF); draw(plate, T1); draw(p2, T2);
// see-through connected to the frame's edge (the letterbox as the picture slides) vs interior
const blk = new Uint8Array(N); let n = 0; for (let c = 0; c < N; c++) if (!cov[c] && !(SKY)) { blk[c] = 1; n++; }
const edge = new Uint8Array(N), q = []; for (let c = 0; c < N; c++) { const x = c % pw, y = (c - x) / pw; if (blk[c] && (x === 0 || y === 0 || x === pw - 1 || y === ph - 1)) { edge[c] = 1; q.push(c); } }
while (q.length) { const c = q.pop(), x = c % pw; for (const j of [x > 0 ? c - 1 : -1, x < pw - 1 ? c + 1 : -1, c >= pw ? c - pw : -1, c < N - pw ? c + pw : -1]) if (j >= 0 && blk[j] && !edge[j]) { edge[j] = 1; q.push(j); } }
let inter = 0; const im = new Uint8Array(N); for (let c = 0; c < N; c++) if (blk[c] && !edge[c]) { inter++; im[c] = 1; }
fs.writeFileSync(path.join(D, `see_${HX}_${HY}.u8`), Buffer.from(im.buffer));
if (process.env.DIAG) { const all = tris(() => true), zz = new Float32Array(N).fill(-1), idd = new Int32Array(N).fill(-1);
  const S = new Float64Array(N); for (let i = 0; i < N; i++) S[i] = shf(plate[i]);
  const tri = (a, b, c, tag) => { const ax = a % pw, ay = (a - ax) / pw, bx = b % pw, by = (b - bx) / pw, cx = c % pw, cy = (c - cx) / pw;
    const Ax = ax + S[a] * hx, Ay = ay + S[a] * hy, Bx = bx + S[b] * hx, By = by + S[b] * hy, Cx = cx + S[c] * hx, Cy = cy + S[c] * hy;
    const area = (Bx - Ax) * (Cy - Ay) - (By - Ay) * (Cx - Ax); if (area === 0) return; const sg = area > 0 ? 1 : -1, eps = 1e-7;
    const x0 = Math.max(0, Math.ceil(Math.min(Ax, Bx, Cx) - eps)), x1 = Math.min(pw - 1, Math.floor(Math.max(Ax, Bx, Cx) + eps)), y0 = Math.max(0, Math.ceil(Math.min(Ay, By, Cy) - eps)), y1 = Math.min(ph - 1, Math.floor(Math.max(Ay, By, Cy) + eps));
    const dz = Math.min(plate[a], plate[b], plate[c]);   // the FARTHEST corner: what a stretched sheet would show last
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
      if (sg * ((Bx - Ax) * (yy - Ay) - (By - Ay) * (xx - Ax)) < -eps || sg * ((Cx - Bx) * (yy - By) - (Cy - By) * (xx - Bx)) < -eps || sg * ((Ax - Cx) * (yy - Cy) - (Ay - Cy) * (xx - Cx)) < -eps) continue;
      const q = yy * pw + xx; if (idd[q] < 0 || dz < zz[q]) { zz[q] = dz; idd[q] = tag; } } };
  for (let i = 0; i < N - pw; i++) { if (i % pw === pw - 1) continue; tri(i, i + pw, i + 1, 2 * i); tri(i + pw, i + pw + 1, i + 1, 2 * i + 1); }
  const tv = (t) => { const i = t >> 1; return (t & 1) ? [i + pw, i + pw + 1, i + 1] : [i, i + pw, i + 1]; };
  const cls = {}; for (let c = 0; c < N; c++) { if (!im[c]) continue; const t = idd[c]; let k;
    if (t < 0) k = 'no plate triangle at all'; else { const V = tv(t), nh = V.filter(v => hole[v]).length, n2 = V.filter(v => has2[v]).length;
      k = 'hole corners ' + nh + '/3' + (n2 ? ', plate2 ' + n2 : '');
      if (nh === 0) { let dmin = 99; for (const v of V) { const vx = v % pw, vy = (v - vx) / pw; for (let r = 1; r < 20 && r < dmin; r++) { let f = false; for (let dy = -r; dy <= r && !f; dy++) for (let dx = -r; dx <= r; dx++) { const xx = vx + dx, yy = vy + dy; if (xx < 0 || yy < 0 || xx >= pw || yy >= ph) continue; if (hole[yy * pw + xx]) { f = true; break; } } if (f) { dmin = r; break; } } }
        k += dmin >= 20 ? ' (no hole within 20)' : dmin > 8 ? ' (hole 9-19 away)' : ' (hole within 8)';
        const tornFG = !(rl.joinedIdx(V[0], V[1], dQ, pw) && rl.joinedIdx(V[1], V[2], dQ, pw) && rl.joinedIdx(V[0], V[2], dQ, pw)); k += tornFG ? ', torn in the source' : ', joined in the source'; }
      if (nh === 3) { const joinedP = rl.joinedIdx(V[0], V[1], plate, pw) && rl.joinedIdx(V[1], V[2], plate, pw) && rl.joinedIdx(V[0], V[2], plate, pw); k += joinedP ? ', joined (kept?)' : ', torn in the fill'; } }
    cls[k] = (cls[k] || 0) + 1; }
  console.log('DIAG ' + JSON.stringify(cls)); }
console.log(JSON.stringify({ hx: HX, hy: HY, seeThrough: n, interior: inter }));
