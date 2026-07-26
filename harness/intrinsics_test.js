// Stage 5, the runnable half: does the resolver read back the FOV that was
// authored, and does the fallback chain do what it claims?
//
// The brief's synthetic check is "a rendered head at known FOV pushed through
// the pipeline, confirming the resolver reads the authored value back". No
// render is needed to test that: the quantity under test is the algebra from a
// quoted FOV, through the mode rule and the live resolution, to fx — and then
// back out through Z = fx*IPD/d. A rendered head would exercise the landmark
// model, which is a different component and unavailable here (no CDN egress).
// So this authors a synthetic camera, authors a head at a known distance,
// computes the pixel IPD that camera would produce, and requires the pipeline
// to recover the distance.
//
//   node harness/intrinsics_test.js
const path = require('path');
const M = require(path.join('/workspace/mm', 'camera', 'resolve-intrinsics.js'));
const LUT = require(path.join('/workspace/mm', 'camera', 'camera-fov-lut.json'));

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
    if (cond) { pass++; console.log('  PASS  ' + name + (detail ? '   ' + detail : '')); }
    else { fail++; console.log('  FAIL  ' + name + (detail ? '   ' + detail : '')); }
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

console.log('\n1. FOV algebra — a quoted figure converts to horizontal correctly');
{
    // A 90 deg horizontal field is its own answer.
    ok('horizontal passthrough', near(M.toHorizontal(90, 'horizontal', '16:9'), 90, 1e-9));
    // Vertical -> horizontal at 16:9: tan(h/2) = tan(v/2)*a
    const v = 40, a = 16 / 9;
    const expect = 2 * Math.atan(Math.tan(v / 2 * Math.PI / 180) * a) * 180 / Math.PI;
    ok('vertical -> horizontal', near(M.toHorizontal(v, 'vertical', '16:9'), expect, 1e-9),
       '(' + expect.toFixed(3) + ' deg)');
    // Diagonal -> horizontal: the diagonal half-tangent splits in the aspect.
    // Round-trip check: build a diagonal FROM a known horizontal and recover it.
    const h0 = 78, t = Math.tan(h0 / 2 * Math.PI / 180);
    const diag = 2 * Math.atan(t * Math.hypot(a, 1) / a) * 180 / Math.PI;
    ok('diagonal -> horizontal round-trip', near(M.toHorizontal(diag, 'diagonal', '16:9'), h0, 1e-6),
       '(diag ' + diag.toFixed(2) + ' -> h ' + M.toHorizontal(diag, 'diagonal', '16:9').toFixed(3) + ')');
    // The trap the brief names: quoting a diagonal AS horizontal overstates it.
    ok('diagonal misread as horizontal overstates', diag > h0,
       '(' + diag.toFixed(1) + ' vs ' + h0 + ' — ' + (diag - h0).toFixed(1) + ' deg of error if mislabelled)');
}

console.log('\n2. Mode rules — a 16:9 stream from a 4:3 sensor');
{
    const r = M.applyModeRule(70, '4:3', 16 / 9, 'crop-v');
    ok('crop-v preserves horizontal', near(r.hFovDeg, 70, 1e-9));
    const tanH = Math.tan(35 * Math.PI / 180);
    ok('crop-v vertical follows the live aspect',
       near(r.vFovDeg, 2 * Math.atan(tanH / (16 / 9)) * 180 / Math.PI, 1e-9),
       '(v = ' + r.vFovDeg.toFixed(2) + ' deg)');
    const rn = M.applyModeRule(70, '4:3', 4 / 3, 'crop-v');
    const vNative = 2 * Math.atan(tanH / (4 / 3)) * 180 / Math.PI;
    ok('native aspect keeps the native vertical', near(rn.vFovDeg, vNative, 1e-9),
       '(v = ' + rn.vFovDeg.toFixed(2) + ' deg; the 16:9 stream lost ' + (vNative - r.vFovDeg).toFixed(1) + ' deg)');
    const rh = M.applyModeRule(70, '4:3', 16 / 9, 'crop-h');
    ok('crop-h preserves vertical instead', near(rh.vFovDeg, vNative, 1e-9) && rh.hFovDeg > 70,
       '(h = ' + rh.hFovDeg.toFixed(2) + ' deg)');
    const ru = M.applyModeRule(70, '4:3', 16 / 9, 'unknown');
    ok('unknown mode warns and assumes crop-v',
       ru.warnings.some(w => /assuming crop-v/.test(w)) && near(ru.hFovDeg, 70, 1e-9));
}

console.log('\n3. Identity — keying');
{
    ok('VID:PID extracted from a Chromium-style label',
       M.extractVidPid('Integrated Camera (04f2:b6dd)') === '04f2:b6dd');
    ok('no VID:PID -> null', M.extractVidPid('FaceTime HD Camera') === null);
    ok('label normalisation collapses the known variants',
       M.normalizeLabel('FaceTime HD Camera (Built-in)') === M.normalizeLabel('FaceTime_HD_Camera') &&
       M.normalizeLabel('FaceTime HD Camera (Built-in)') === 'facetime hd camera');
    ok('normalisation strips the VID:PID suffix so it does not defeat label matching',
       M.normalizeLabel('Integrated Camera (04f2:b6dd)') === 'integrated camera');
}

console.log('\n4. The chain, against the shipped (unpopulated) table');
{
    const mk = (label, w, h, extra) => ({ label,
        getSettings: () => Object.assign({ width: w, height: h, resizeMode: 'none' }, extra || {}),
        getCapabilities: () => ({}) });

    const generic = M.resolveIntrinsics(mk('Integrated Camera', 1280, 720), LUT, {});
    ok('generic label falls through to the prior rather than matching a family',
       generic.matchedBy === 'fallback' &&
       generic.warnings.some(w => /generic and shared across unrelated/.test(w)));

    const noFov = M.resolveIntrinsics(mk('FaceTime HD Camera', 1280, 720), LUT, {});
    ok('a matched-but-unsourced entry returns null fx and says why',
       noFov.fx === null && noFov.warnings.some(w => /value is null/.test(w)));
    ok('and X/Y are still resolvable because fx cancels out of them',
       noFov.cx === 640 && noFov.cy === 360);

    const withFace = M.resolveIntrinsics(mk('FaceTime HD Camera', 1280, 720), LUT,
                                         { faceDerivedHFovDeg: 70 });
    ok('the face-derived estimate is preferred over an unsourced prior',
       withFace.fx > 0 && withFace.confidence === 'prior' &&
       withFace.warnings.some(w => /face-derived/.test(w)),
       '(fx = ' + (withFace.fx ? withFace.fx.toFixed(1) : 'null') + ' px)');

    const noPerm = M.resolveIntrinsics(mk('', 1280, 720), LUT, { faceDerivedHFovDeg: 70 });
    ok('empty label (pre-permission) is called out',
       noPerm.warnings.some(w => /before camera permission/i.test(w)));

    const resized = M.resolveIntrinsics(mk('x', 1280, 720, { resizeMode: 'crop-and-scale' }), LUT,
                                        { faceDerivedHFovDeg: 70 });
    ok('resizeMode != none is flagged as composing with the sensor crop',
       resized.warnings.some(w => /resizeMode is "crop-and-scale"/.test(w)));

    const zoomed = M.resolveIntrinsics(mk('x', 1280, 720, { zoom: 2 }), LUT, { faceDerivedHFovDeg: 70 });
    ok('digital zoom narrows the field by the zoom factor in tangent space',
       near(Math.tan(zoomed.hFovDeg / 2 * Math.PI / 180),
            Math.tan(70 / 2 * Math.PI / 180) / 2, 1e-9),
       '(70 -> ' + zoomed.hFovDeg.toFixed(1) + ' deg at 2x)');
}

console.log('\n5. The prior refuses to be invented');
{
    const p = M.derivePrior(LUT);
    ok('derivePrior returns null on an unpopulated table, with a reason',
       p.hFovDeg === null && /fewer than 8 populated/.test(p.reason), '(n = ' + p.n + ')');
    // and it works once there is a distribution
    const fake = { byVidPid: {}, byLabel: {}, byPattern: [] };
    for (const h of [58, 62, 65, 68, 70, 72, 78, 82, 90]) {
        fake.byPattern.push({ value: { raw: h, type: 'horizontal', aspect: '16:9', tier: 'B' } });
    }
    const p2 = M.derivePrior(fake);
    ok('derivePrior returns the median once 8+ entries exist',
       near(p2.hFovDeg, 70, 1e-9) && p2.n === 9, '(median ' + p2.hFovDeg + ', bound +/-' + p2.errorBoundDeg + ')');
}

console.log('\n6. SYNTHETIC ROUND TRIP — author a camera and a head, recover the head');
{
    // Author the ground truth.
    const W = 1280, H = 720, hFovTrue = 74, Ztrue = 0.55, IPD = M.IPD_M_DEFAULT;
    const fxTrue = (W / 2) / Math.tan(hFovTrue / 2 * Math.PI / 180);
    // What that camera would observe for a head at Ztrue, offset 8 cm right, 3 cm up.
    const Xtrue = 0.08, Ytrue = 0.03;
    const ipdPx = fxTrue * IPD / Ztrue;
    const u = W / 2 + fxTrue * Xtrue / Ztrue;
    const v = H / 2 + fxTrue * Ytrue / Ztrue;

    const lut = { byVidPid: { 'aaaa:0001': {
        sensorAspect: '16:9', modeRule: 'crop-v',
        value: { raw: hFovTrue, type: 'horizontal', aspect: '16:9', tier: 'A',
                 source: { url: 'synthetic', kind: 'calibration' } } } }, byLabel: {}, byPattern: [], prior: {} };
    const track = { label: 'Synthetic Cam (aaaa:0001)',
                    getSettings: () => ({ width: W, height: H, resizeMode: 'none' }),
                    getCapabilities: () => ({}) };
    const intr = M.resolveIntrinsics(track, lut, {});
    ok('authored FOV read back', near(intr.hFovDeg, hFovTrue, 1e-9) && intr.matchedBy === 'vidpid' &&
       intr.confidence === 'measured', '(' + intr.hFovDeg.toFixed(3) + ' deg, fx ' + intr.fx.toFixed(2) + ' px)');
    const pose = M.headPoseFromFace(intr, ipdPx, u, v);
    ok('head Z recovered', near(pose.Z, Ztrue, 1e-9), '(' + pose.Z.toFixed(6) + ' m vs ' + Ztrue + ')');
    ok('head X/Y recovered', near(pose.X, Xtrue, 1e-9) && near(pose.Y, Ytrue, 1e-9),
       '(' + pose.X.toFixed(6) + ', ' + pose.Y.toFixed(6) + ')');

    // The claim the whole table rests on: fx error lands on Z and nowhere else.
    const lutWrong = JSON.parse(JSON.stringify(lut));
    lutWrong.byVidPid['aaaa:0001'].value.raw = 60;      // 14 deg too narrow
    const intrW = M.resolveIntrinsics(track, lutWrong, {});
    const poseW = M.headPoseFromFace(intrW, ipdPx, u, v);
    ok('a wrong FOV leaves X and Y EXACTLY unchanged',
       near(poseW.X, Xtrue, 1e-12) && near(poseW.Y, Ytrue, 1e-12));
    const zErr = (poseW.Z - Ztrue) / Ztrue;
    const fErr = (intrW.fx - fxTrue) / fxTrue;
    ok('and dZ/Z equals dfx/fx exactly', near(zErr, fErr, 1e-12),
       '(74 -> 60 deg is ' + (100 * fErr).toFixed(1) + '% on fx and ' + (100 * zErr).toFixed(1) + '% on Z)');
}

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED') + '  (' + pass + ' passed)');
process.exit(fail === 0 ? 0 : 1);
