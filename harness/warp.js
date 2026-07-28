// W1-b THE CPU WARP RENDERER — poses in milliseconds, no browser.
//
// WHY THIS IS EXACT RATHER THAN AN APPROXIMATION. Under the a104 ray law a
// texel's screen position is
//     screen(x, d) = f * ( x/D  -  ex * g(d) )
// The first term is depth-free — that is why the rest pose is the identity —
// and the second is LINEAR in the eye offset. Writing the rim displacement the
// shift LUT already tabulates as S(d), an eye at fraction t of the cone rim
// puts texel (x, y, d) at
//     X = x + t_x * S_x(d),   Y = y + t_y * S_y(d)
// So the whole render is a per-texel warp by a tabulated function of depth. No
// matrices, no rasteriser state, no GPU. And it uses the LUT DUMPED FROM THE
// BAKE rather than a reimplementation, so it cannot drift from the shader.
//
// WHAT IT RENDERS. Two surfaces, both on the source texel grid:
//   the FOREGROUND, torn by the a160 criterion (folds AND depth span above one
//   source quantum), and
//   the PLATE, solid, at the depth the bake finished with.
// Each surviving cell is filled as a quad with a z-buffer, so coverage and
// occlusion come out of the same geometry the GPU sees.
//
// WHAT IT ANSWERS. Coverage (holes), ordering violations (plate in front of the
// foreground), and the fold statistics — the three questions this project keeps
// asking, at ~1s a pose instead of ~150s.
//
// WHAT IT DOES NOT DO. It does not bake. The plate's construction, the wash and
// the flood stay in the browser; harness/bakedump.js runs that once and this
// consumes the result. So a sweep over 20 poses costs one bake, not twenty.
//
// VALIDATION AGAINST THE REAL RENDERER, and its envelope. Ordering violations
// (plate in front of the foreground), troll, same poses, warp vs the browser's
// depth-buffer measurement (a164):
//
//     pose    warp      browser
//     rest    0.622%    0.000%     <- UNEXPLAINED, see below
//     35      0.000%    0.000%
//     43      0.005%    0.000%
//     45      0.006%    0.000%
//     47      0.424%    0.005%
//     55      8.495%    0.222%
//
// INSIDE THE CONE — the operating range — it agrees: 0.000 to 0.006 against
// 0.000. Outside the cone it EXAGGERATES by an order of magnitude, because the
// linear-in-eye-offset model is the shift LUT's own calibration and the LUT is
// built for the cone; past the rim the foreground's stretch cut and band cut,
// which this does not model, are doing work in the real renderer.
//
// THE REST-POSE 0.622% IS NOT EXPLAINED AND SHOULD NOT BE TRUSTED. At t = 0 the
// warp is the identity, so the comparison reduces to plateF against dQ at the
// same texel, and the a135 clamp guarantees plate <= dQ - one quantum there —
// the answer has to be zero. The most likely cause is tie-breaking in this
// rasteriser's edge rules rather than anything in the data, but I have not
// proven that, so the rest pose is outside the validated envelope too.
//
// THE COVERAGE COLUMN MEASURES A DIFFERENT QUANTITY from the browser's and the
// two are not comparable: this renders the foreground and the plate only, with
// no skirt and no frame, so its "uncovered" includes the beyond-frame region
// that the real renderer fills with the skirt. Browser uncovered at 35 deg is
// 0.00%; this reports 14.27%. Both are correct about what they measure.
//
// USE IT FOR: sweeping many poses cheaply to find WHERE something happens, and
// for the ordering invariant inside the cone. CONFIRM ON THE BROWSER before
// reporting any number as the render's behaviour.
//
//   node harness/warp.js <cache.json> [--poses 0,15,25,35,43,45,47,55]
const fs = require('fs');

function load(file) {
  const J = JSON.parse(fs.readFileSync(file, 'utf8'));
  // plateF is the TEXTURE UPLOAD buffer and is ROW-FLIPPED against dQ: image
  // texel (x, y) is plateF[(ph-1-y)*pw + x]. Indexing both the same way puts the
  // plate in upside down, which reads as the backstop being systematically in
  // front — the first run of this renderer reported 41.5% ordering violations
  // AT REST, which is impossible, and that was the cause.
  const _pw = J.pw, _ph = J.ph;
  let plate = null;
  if (J.plateF) {
    plate = new Float32Array(_pw * _ph);
    for (let y = 0; y < _ph; y++) {
      const src = (_ph - 1 - y) * _pw, dst = y * _pw;
      for (let x = 0; x < _pw; x++) plate[dst + x] = J.plateF[src + x];
    }
  }
  return { pw: J.pw, ph: J.ph, dQ: Float32Array.from(J.dQ),
           plateF: plate,
           vol: J.vol, lut: { N: J.lut.N, m0: J.lut.m0, m1: J.lut.m1, fwd: Float32Array.from(J.lut.fwd) },
           build: J.build, asset: J.asset, bakeMs: J.bakeMs, stretch: J.stretch };
}
const shiftPxAt = (L, d) => {
  const t = Math.min(1, Math.max(0, d)) * L.N, i = t | 0;
  return (i >= L.N) ? L.fwd[L.N] : L.fwd[i] + (L.fwd[i + 1] - L.fwd[i]) * (t - i);
};
// world z offset for a normalised depth, the same smoothstep split the vertex
// shader uses, plus the a167 embed offset the bake recorded
function zOffAt(vol, d) {
  const pn = vol.pn;
  let z;
  if (d < pn) { const t = d / pn;             z = -vol.outer + vol.outer * (t * t * (3 - 2 * t)); }
  else        { const t = (d - pn) / (1 - pn); z =  vol.inner * (t * t * (3 - 2 * t)); }
  return z + (vol.embed || 0);
}

// Rasterise one surface into (zbuf, own) by filling each cell's warped quad.
// `tear` decides per cell; null means solid (the plate).
function raster(S, field, tx, ty, zbuf, own, tag, tear) {
  const { pw, ph, vol, lut } = S;
  const aspect = (vol.H0 > 0 && vol.W0 > 0) ? (pw / vol.W0) / (ph / vol.H0) : 1;
  const X = new Float32Array(pw * ph), Y = new Float32Array(pw * ph), Z = new Float32Array(pw * ph);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const i = y * pw + x, d = field[i], s = shiftPxAt(lut, d);
    X[i] = x + tx * s; Y[i] = y + ty * s / Math.max(1e-6, aspect); Z[i] = zOffAt(vol, d);
  }
  let kept = 0, dropped = 0;
  const q = new Float64Array(8);
  for (let y = 0; y + 1 < ph; y++) for (let x = 0; x + 1 < pw; x++) {
    const i0 = y * pw + x, i1 = i0 + 1, i2 = i0 + pw, i3 = i2 + 1;
    if (tear && tear(field[i0], field[i1], field[i2], field[i3])) { dropped++; continue; }
    kept++;
    q[0] = X[i0]; q[1] = Y[i0]; q[2] = X[i1]; q[3] = Y[i1];
    q[4] = X[i3]; q[5] = Y[i3]; q[6] = X[i2]; q[7] = Y[i2];
    let mnx = q[0], mxx = q[0], mny = q[1], mxy = q[1];
    for (let k = 2; k < 8; k += 2) { if (q[k] < mnx) mnx = q[k]; if (q[k] > mxx) mxx = q[k];
                                    if (q[k+1] < mny) mny = q[k+1]; if (q[k+1] > mxy) mxy = q[k+1]; }
    const x0 = Math.max(0, Math.ceil(mnx)), x1 = Math.min(pw - 1, Math.floor(mxx));
    const y0 = Math.max(0, Math.ceil(mny)), y1 = Math.min(ph - 1, Math.floor(mxy));
    if (x1 < x0 || y1 < y0) continue;
    // TWO TRIANGLES WITH BARYCENTRIC z, not one quad at its average depth. The
    // first version used the cell's mean z for every pixel it covered, and at a
    // silhouette that lets a plate cell whose AVERAGE is nearer win where the
    // interpolated surface would not — it reported 0.698% ordering violations
    // at REST, where the GPU reports zero and where zero is the only possible
    // answer. Flat-shaded depth was the whole error.
    const tri = (ax, ay, az, bx, by, bz, cx2, cy2, cz) => {
      const den = (by - cy2) * (ax - cx2) + (cx2 - bx) * (ay - cy2);
      if (Math.abs(den) < 1e-12) return;
      const tx0 = Math.max(x0, Math.ceil(Math.min(ax, bx, cx2)));
      const tx1 = Math.min(x1, Math.floor(Math.max(ax, bx, cx2)));
      const ty0 = Math.max(y0, Math.ceil(Math.min(ay, by, cy2)));
      const ty1 = Math.min(y1, Math.floor(Math.max(ay, by, cy2)));
      for (let py = ty0; py <= ty1; py++) for (let px = tx0; px <= tx1; px++) {
        const l1 = ((by - cy2) * (px - cx2) + (cx2 - bx) * (py - cy2)) / den;
        if (l1 < -1e-9 || l1 > 1 + 1e-9) continue;
        const l2 = ((cy2 - ay) * (px - cx2) + (ax - cx2) * (py - cy2)) / den;
        if (l2 < -1e-9) continue;
        const l3 = 1 - l1 - l2;
        if (l3 < -1e-9) continue;
        const z = l1 * az + l2 * bz + l3 * cz;
        const p = py * pw + px;
        if (z > zbuf[p]) { zbuf[p] = z; own[p] = tag; }
      }
    };
    tri(q[0], q[1], Z[i0], q[2], q[3], Z[i1], q[4], q[5], Z[i3]);
    tri(q[0], q[1], Z[i0], q[4], q[5], Z[i3], q[6], q[7], Z[i2]);
  }
  return { kept, dropped };
}

function renderPose(S, degX, degY) {
  const { pw, ph, vol, lut } = S;
  const rim = Math.tan((vol.cone || 45) * Math.PI / 180);
  const tx = Math.tan(degX * Math.PI / 180) / rim;
  const ty = Math.tan((degY || 0) * Math.PI / 180) / rim;
  const N = pw * ph;
  const zbuf = new Float32Array(N).fill(-1e30), own = new Uint8Array(N);
  const q = vol.quantum || 1 / 255;
  const cell = Math.SQRT2;   // one cell's own extent in texels at MESH_DENSITY 1
  const tear = (a, b, c, d) => {
    const mn = Math.min(a, b, c, d), mx = Math.max(a, b, c, d);
    if ((mx - mn) <= q) return false;                       // a160 noise floor
    return (shiftPxAt(lut, mx) - shiftPxAt(lut, mn)) > cell; // a102 fold test
  };
  const fg = raster(S, S.dQ, tx, ty, zbuf, own, 1, tear);
  let plate = null;
  if (S.plateF) plate = raster(S, S.plateF, tx, ty, zbuf, own, 2, null);
  // the foreground alone, to ask what the plate occluded
  const zf = new Float32Array(N).fill(-1e30), of_ = new Uint8Array(N);
  raster(S, S.dQ, tx, ty, zf, of_, 1, tear);
  let uncovered = 0, plateWins = 0, fgPx = 0;
  for (let i = 0; i < N; i++) {
    if (!own[i]) uncovered++;
    if (of_[i]) { fgPx++; if (own[i] === 2) plateWins++; }
  }
  return { uncoveredPct: +(100 * uncovered / N).toFixed(3),
           orderViolPct: +(100 * plateWins / Math.max(1, fgPx)).toFixed(3),
           fgKept: fg.kept, fgDropped: fg.dropped,
           tornPct: +(100 * fg.dropped / Math.max(1, fg.kept + fg.dropped)).toFixed(2) };
}

if (require.main === module) {
  const file = process.argv[2] || 'harness/cache/troll.bake.json';
  const arg = process.argv.indexOf('--poses');
  const poses = (arg > 0 ? process.argv[arg + 1] : '0,15,25,35,43,45,47,55').split(',').map(Number);
  const t0 = Date.now();
  const S = load(file);
  const loadMs = Date.now() - t0;
  console.log('\n' + S.asset + '  ' + S.build + '  ' + S.pw + 'x' + S.ph +
              '   (bake took ' + S.bakeMs + 'ms once; cache load ' + loadMs + 'ms)');
  console.log('  deg    uncovered%   plate-over-fg%   torn%    ms');
  for (const d of poses) {
    const t1 = Date.now();
    const r = renderPose(S, d, 0);
    console.log('  ' + String(d).padStart(3) + String(r.uncoveredPct).padStart(13) +
                String(r.orderViolPct).padStart(17) + String(r.tornPct).padStart(9) +
                String(Date.now() - t1).padStart(7));
  }
}
module.exports = { load, renderPose, shiftPxAt, zOffAt };
