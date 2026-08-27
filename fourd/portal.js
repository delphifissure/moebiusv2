// fourd/portal.js — THE OFF-AXIS SPATIAL NORMALIZATION, EXTRACTED.
//
// This module is the moebius head->eye->frustum law, lifted verbatim from
// moebius.js updateCameraAndProjection() so the 4D PoCs (splat portal, rig
// portal) run on the SAME normalization as the shipped 2.5D portal:
//
//   1. HEAD -> EYE (moebius.js ~17580): eye lateral offset =
//        -(headDeviation) * camOff * scalar * lensGain
//      with camOff = 0.2 (the shipped head-to-eye coupling, portal-widths per
//      unit of normalized head deviation) and
//        lensGain = tan(lensFovDeg/2 in radians)
//      (A65: FOV-normalized interaction — 90deg -> 1.0 identity, so a longer
//      content lens scales head reach instead of changing the cut).
//
//   2. EYE -> FRUSTUM: generalized perspective projection against the FIXED
//      portal rect (Kooima). The portal rect NEVER moves with the eye; that
//      is the invariant that pins portal-plane content exactly for any eye
//      (measured 0.000px portal-plane drift in moebius, Addendum ~a196 era).
//      The moebius corner-adjustment/dolly extensions (a208) are NOT ported
//      yet — no dolly in the PoC; the hook is applyToCamera's rect override.
//
// Axis conventions match moebius: portal rect axis-aligned in world X/Y at
// z = portalZ, eye on +z side looking -z.

(function (global) {
    'use strict';

    function createState(opts) {
        const o = opts || {};
        return {
            portalWidth: o.portalWidth ?? 1.0,     // world units
            portalHeight: o.portalHeight ?? 1.0,
            portalZ: o.portalZ ?? 0.0,
            viewDistance: o.viewDistance ?? 1.0,    // rest eye distance from portal
            lensFovDeg: o.lensFovDeg ?? 90,         // A65 content lens (90 = identity)
            scalar: o.scalar ?? 1.0,                // facetracking scalar slider equivalent
            camOff: 0.2,                            // moebius.js shipped constant (~17584)
            near: o.near ?? 0.01,
            far: o.far ?? 100.0,
            headDevX: 0, headDevY: 0,               // normalized head deviation (combined - baseline)
        };
    }

    function lensGain(state) {
        return Math.tan((state.lensFovDeg * Math.PI / 180) / 2);
    }

    function setHeadDeviation(state, devX, devY) {
        state.headDevX = devX; state.headDevY = devY;
    }

    // The moebius law, sign included: deviation right -> eye left (the portal
    // behaves as a window; content parallax runs opposite the head).
    function eyeFromState(state) {
        const g = lensGain(state);
        return {
            x: -state.headDevX * state.camOff * state.scalar * g,
            y: -state.headDevY * state.camOff * state.scalar * g,
            z: state.portalZ + state.viewDistance,
        };
    }

    // Kooima generalized perspective against the fixed axis-aligned rect.
    // Identical to moebius frameCorners(camera, pbl, pbr, ptl) with the fixed
    // portal rect (moebius.js ~17700). rectOverride {hw, hh, cx, cy} is the
    // a208 corner-adjustment hook; omitted = fixed rect.
    function applyToCamera(state, camera, rectOverride) {
        const eye = eyeFromState(state);
        camera.position.set(eye.x, eye.y, eye.z);
        camera.quaternion.set(0, 0, 0, 1);          // portal is axis-aligned; view = translate only
        camera.updateMatrixWorld(true);

        const hw = rectOverride?.hw ?? state.portalWidth / 2;
        const hh = rectOverride?.hh ?? state.portalHeight / 2;
        const cx = rectOverride?.cx ?? 0;
        const cy = rectOverride?.cy ?? 0;
        const d = eye.z - state.portalZ;            // eye -> portal plane distance
        const n = state.near;
        const l = (cx - hw - eye.x) * n / d;
        const r = (cx + hw - eye.x) * n / d;
        const b = (cy - hh - eye.y) * n / d;
        const t = (cy + hh - eye.y) * n / d;
        camera.projectionMatrix.makePerspective(l, r, t, b, n, state.far);
        if (camera.projectionMatrixInverse) {
            camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        }
        return eye;
    }

    // Map the eye to a viewing direction THROUGH the portal at a subject
    // anchored subjectDepth BEHIND the portal plane — the rig portal's
    // eye -> (yaw, pitch) parameterization. Same ray the reprojection path
    // uses: from the eye through the portal center to the subject.
    function rigAnglesFromState(state, subjectDepth) {
        const eye = eyeFromState(state);
        const dz = (eye.z - state.portalZ) + subjectDepth;
        return {
            yawDeg: Math.atan2(eye.x, dz) * 180 / Math.PI,
            pitchDeg: Math.atan2(eye.y, dz) * 180 / Math.PI,
        };
    }

    const api = { createState, setHeadDeviation, eyeFromState, applyToCamera, rigAnglesFromState, lensGain };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else global.FourDPortal = api;
})(typeof window !== 'undefined' ? window : globalThis);
