// S48 — THE UNPAINTED-PIXEL ASSERTION.
//
// From S47, the one thing worth taking from the splat proposal regardless of representation:
//
//     NO PIXEL SHOULD BE BOTH UNPAINTED AND SURROUNDED BY PAINTED NEIGHBOURS CLOSER THAN T.
//
// That single sentence separates, mechanically, the two things this project has never been able to tell apart:
//
//   a GAP WE SHOULD HAVE COVERED   — a crack between two displaced texels that are still adjacent on the surface. Nothing
//                                    was revealed there; the representation simply failed to span its own sample spacing.
//                                    It shows as a thin unpainted run with painted pixels close on BOTH sides.
//   a GENUINE DISOCCLUSION         — the viewer has moved far enough to see past an edge, and there is truly nothing
//                                    behind it in the picture. It shows as an unpainted region wider than any spanning
//                                    rule could legitimately close.
//
// Every number this project reports about holes ("dark %", "hole area at 45 degrees") sums the two together, so a change
// that halves the cracks and a change that halves the reveals read identically. They are not the same problem and they do
// not have the same fix: the first is a bug in the renderer, the second is work for the fill stage.
//
// The test, on a rendered frame: a pixel is UNPAINTED if the backdrop shows through it (nothing was drawn). For each
// maximal unpainted run along a row, if the run has painted pixels at both ends and is at most T pixels long, every pixel
// in it is a LEAK — a gap a spanning rule of reach T would have closed. Same along columns. A pixel that leaks on either
// axis is a leak. Everything else unpainted is a genuine disocclusion.
//
// T is not a tuning constant. It is the reach of whatever rule is being asserted about: 1 for "adjacent samples must
// stay adjacent", 2 and 4 for the splat sizes S47 priced.
//
// The counter runs in the PAGE (it needs the framebuffer), so it is exported as source and injected by each harness.
'use strict';

const UNPAINTED_FN = `function (d, W, Hh, rect, T, darkCut) {
    const x0 = rect[0], y0 = rect[1], x1 = rect[2], y1 = rect[3];
    const w = x1 - x0 + 1, h = y1 - y0 + 1, n = w * h;
    // unpainted = nothing was drawn here; the backdrop (near-black) shows through
    const U = new Uint8Array(n);
    let hole = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y + y0) * W + (x + x0);
        if (d[i * 4] < darkCut && d[i * 4 + 1] < darkCut && d[i * 4 + 2] < darkCut) { U[y * w + x] = 1; hole++; }
    }
    const out = { area: n, hole: hole, T: T, leak: [], genuine: [], unbounded: 0, leakMask: null };
    for (let k = 0; k < T.length; k++) { out.leak.push(0); out.genuine.push(0); }
    if (!hole) return out;
    const Tmax = Math.max.apply(null, T);
    // runH[p] / runV[p] = the length of the BOUNDED unpainted run through p on that axis, or 1e9 when the run reaches the
    // edge of the rectangle (unbounded: no painted neighbour on that side, so the assertion says nothing about it)
    const runH = new Int32Array(n).fill(1 << 29), runV = new Int32Array(n).fill(1 << 29);
    for (let y = 0; y < h; y++) {
        let s = -1;
        for (let x = 0; x <= w; x++) {
            const inside = x < w && U[y * w + x];
            if (inside) { if (s < 0) s = x; continue; }
            if (s >= 0) { const len = x - s; if (s > 0 && x < w) for (let q = s; q < x; q++) runH[y * w + q] = len; s = -1; }
        }
    }
    for (let x = 0; x < w; x++) {
        let s = -1;
        for (let y = 0; y <= h; y++) {
            const inside = y < h && U[y * w + x];
            if (inside) { if (s < 0) s = y; continue; }
            if (s >= 0) { const len = y - s; if (s > 0 && y < h) for (let q = s; q < y; q++) runV[q * w + x] = len; s = -1; }
        }
    }
    const lm = new Uint8Array(n);
    for (let p = 0; p < n; p++) {
        if (!U[p]) continue;
        const m = Math.min(runH[p], runV[p]);
        // UNBOUNDED: the run reaches the edge of the rectangle on both axes, so there is no painted neighbour on either
        // side and the assertion says nothing about it. On a bake with the margin strips off this is the beyond-frame
        // region, which is not a disocclusion at all -- counting it as one would inflate the genuine class.
        if (m >= (1 << 29)) { out.unbounded++; lm[p] = 4; }
        for (let k = 0; k < T.length; k++) { if (m <= T[k]) out.leak[k]++; else out.genuine[k]++; }
        if (m <= Tmax) lm[p] = m <= T[0] ? 3 : 2; else if (lm[p] !== 4) lm[p] = 1;
    }
    out.leakMask = lm; out.rectW = w; out.rectH = h;
    return out;
}`;

module.exports = { UNPAINTED_FN };
