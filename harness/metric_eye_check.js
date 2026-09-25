// S67 §7 check: bgMetricEye (verbatim from moebius.js) recovers known eye positions exactly, and the error of the
// webcam-angle mapping calibrated at one rest distance (today's behaviour) when the viewer leans. Webcam at the top-centre
// edge of a 15.6" 1440x900 screen (the app's default diagonal), 640x480 frames, 80 deg horizontal field of view (the
// user-measured Mac value), IPD 63 mm, portal = the screen (fullscreen).   node harness/metric_eye_check.js
'use strict';
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'moebius.js'), 'utf8');
const grab = (name) => { const i = SRC.indexOf('function ' + name + '('); let d = 0; for (let k = SRC.indexOf('{', i); k < SRC.length; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (!d) return SRC.slice(i, k + 1); } } };
const bgMetricEye = eval('(' + grab('bgMetricEye') + ')');
const W = 640, Hf = 480, fx = (W / 2) / Math.tan(40 * Math.PI / 180), cx = W / 2, cy = Hf / 2, IPD = 0.063;
const pitch = 15.6 * 0.0254 / Math.hypot(1440, 900), Hs = 900 * pitch, cam = { x: 0, y: Hs / 2 };
const project = (P) => { const X = P.x - cam.x, Y = P.y - cam.y; return { u: cx - fx * X / P.z, v: cy - fx * Y / P.z, span: fx * IPD / P.z }; };
let worst = 0;
for (const x of [-0.2, 0, 0.2]) for (const y of [-0.1, 0, 0.1]) for (const z of [0.35, 0.5, 0.7]) {
    const im = project({ x, y, z }); const P = bgMetricEye({ u: im.u, v: im.v, span: im.span, fx, cx, cy, ipdM: IPD, camX: cam.x, camY: cam.y, portalX: 0, portalY: 0 });
    worst = Math.max(worst, Math.abs(P.x - x), Math.abs(P.y - y), Math.abs(P.z - z)); }
console.log('metric eye: 27 known eye positions (x +-0.2, y +-0.1, z 0.35-0.7 m) recovered, worst error ' + worst.toExponential(1) + ' m');
// today's mapping: the face's image offset from its rest position, i.e. the angle from the WEBCAM, zeroed at a rest pose
const rest = { x: 0, y: 0, z: 0.5 }, imR = project(rest);
console.log('eye on the portal axis (x = y = 0), leaning in and out; rest calibrated at 0.50 m:');
for (const z of [0.3, 0.35, 0.4, 0.5, 0.6, 0.7]) {
    const im = project({ x: 0, y: 0, z });
    const tanV = -(im.v - imR.v) / fx;                      // what the rest-calibrated webcam mapping reads as the vertical angle
    console.log('  d ' + z.toFixed(2) + ' m: true vertical angle from the portal centre 0.00 deg; webcam-angle mapping reads ' + (Math.atan(tanV) * 180 / Math.PI).toFixed(2) + ' deg');
}
