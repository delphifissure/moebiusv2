// resolve-intrinsics.js — camera intrinsics for the head-Z path.
//
// CONSUMER AND ACCURACY BAR. The head tracker recovers viewer position from
// face landmarks. With pixel eye separation d and image position (u,v):
//     Z = fx * IPD / d
//     X = (u - cx) * IPD / d
//     Y = (v - cy) * IPD / d
// fx appears only in Z. X and Y are independent of it — a wrong FOV shifts the
// depth axis and leaves lateral parallax untouched. dZ/Z = dfx/fx exactly, so
// a 15% FOV error is a 15% depth-gain error and nothing else. The target is
// about +/-5% on recognised devices against about +/-15% blind.
//
// ASSUMPTIONS, STATED IN THE CODE AND NOT ONLY IN THE DOCS:
//   - square pixels, so fy = fx. Non-square sensor pixels exist but no consumer
//     webcam in the roster is believed to ship them, and the web platform gives
//     no way to detect it.
//   - principal point at the image centre: cx = W/2, cy = H/2. Real principal
//     points sit within a few percent of centre; that offset moves X and Y by
//     the same few percent and is below the bar for this consumer.
//   - no skew.
//   - NO LENS DISTORTION MODEL. Out of scope by the brief. Radial distortion on
//     a wide webcam displaces a face at the frame edge by several percent, which
//     lands on X and Y rather than Z. Flagged in warnings when the resolved FOV
//     is wide enough for it to matter, so the caller can decide.
//
// The table is data. This file never contains a field-of-view number: if a
// value is not in the table it is not in the product.

'use strict';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// identity
// ---------------------------------------------------------------------------

// VID:PID is the only genuinely stable key. Chromium appends it to the label as
// a "(vvvv:pppp)" suffix on some platforms. Extracting it is cheap and, when
// present, outranks everything else.
function extractVidPid(label) {
    if (!label) return null;
    const m = /\(([0-9a-f]{4}):([0-9a-f]{4})\)\s*$/i.exec(label.trim());
    return m ? (m[1] + ':' + m[2]).toLowerCase() : null;
}

// Labels differ across OS, browser and locale for the same physical camera.
// Normalisation strips what varies and keeps what identifies.
function normalizeLabel(label) {
    if (!label) return '';
    return label
        .toLowerCase()
        .replace(/\(([0-9a-f]{4}):([0-9a-f]{4})\)/gi, ' ')   // the VID:PID suffix, keyed separately
        .replace(/\((built-?in|integrated|internal|front|rear|back)\)/g, ' ')
        .replace(/[_\-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// ---------------------------------------------------------------------------
// FOV algebra
// ---------------------------------------------------------------------------

// A quoted FOV is meaningless without the aspect it applies to, so every
// conversion goes through the half-angle tangents of the aspect it was quoted
// against. Diagonal is the usual marketing form and the most error-prone.
function toHorizontal(raw, type, aspectStr) {
    const a = parseAspect(aspectStr);
    if (!(raw > 0) || !a) return null;
    const t = Math.tan(raw * 0.5 * DEG);
    if (type === 'horizontal') return raw;
    if (type === 'vertical') return 2 * Math.atan(t * a) / DEG;
    if (type === 'diagonal') {
        // the diagonal half-tangent splits between the axes in the aspect ratio
        const th = t * (a / Math.hypot(a, 1));
        return 2 * Math.atan(th) / DEG;
    }
    return null;
}

function parseAspect(s) {
    if (typeof s === 'number') return s > 0 ? s : null;
    if (!s) return null;
    const m = /^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/.exec(String(s).trim());
    if (m) return (+m[2] > 0) ? (+m[1] / +m[2]) : null;
    const v = parseFloat(s);
    return (v > 0) ? v : null;
}

// Apply the device's mode rule to get the FOV at the LIVE resolution. This is
// where naive tables go wrong: a 16:9 stream from a 4:3 sensor usually keeps
// the horizontal FOV and throws away vertical, so quoting the 4:3 number at a
// 16:9 stream overstates the vertical field by a large margin.
function applyModeRule(hFovNative, sensorAspect, liveAspect, modeRule) {
    const warnings = [];
    const nA = parseAspect(sensorAspect);
    if (!(hFovNative > 0)) return { hFovDeg: null, vFovDeg: null, warnings };
    if (!nA || !(liveAspect > 0)) {
        warnings.push('sensor aspect or live aspect unknown; FOV returned as quoted with no mode correction');
        return { hFovDeg: hFovNative, vFovDeg: null, warnings };
    }
    const tanH = Math.tan(hFovNative * 0.5 * DEG);
    const tanV = tanH / nA;                       // native vertical half-tangent
    let rule = modeRule;
    if (!rule || rule === 'unknown') {
        rule = 'crop-v';
        warnings.push('mode rule for this device is not established; assuming crop-v (the common UVC case). ' +
                      'If the device actually scales the full sensor this understates vertical FOV.');
    }
    if (Math.abs(liveAspect - nA) < 0.01) {
        return { hFovDeg: hFovNative, vFovDeg: 2 * Math.atan(tanV) / DEG, warnings };
    }
    if (rule === 'crop-v') {
        // wider output, vertical cropped: horizontal preserved
        return { hFovDeg: hFovNative, vFovDeg: 2 * Math.atan(tanH / liveAspect) / DEG, warnings };
    }
    if (rule === 'crop-h') {
        // vertical preserved, horizontal cropped
        return { hFovDeg: 2 * Math.atan(tanV * liveAspect) / DEG, vFovDeg: 2 * Math.atan(tanV) / DEG, warnings };
    }
    // 'scale': the whole sensor is mapped to the output; both fields preserved,
    // which means the output is anamorphic unless the aspects match. Rare, and
    // it breaks the square-pixel assumption, so say so.
    warnings.push('mode rule "scale" with a non-native aspect implies non-square pixels, which violates the fy = fx assumption');
    return { hFovDeg: hFovNative, vFovDeg: 2 * Math.atan(tanV) / DEG, warnings };
}

// ---------------------------------------------------------------------------
// the prior
// ---------------------------------------------------------------------------

// Derived from the assembled table, not chosen. Call this after populating the
// LUT and write the result back into lut.prior; it is deliberately NOT run at
// import time, because a prior derived from an empty table is a fabricated
// constant wearing a function's clothes.
function derivePrior(lut) {
    const vals = [];
    const walk = (e) => {
        if (!e || !e.value || e.generic) return;
        const h = toHorizontal(e.value.raw, e.value.type, e.value.aspect);
        if (h > 0) vals.push(h);
    };
    Object.values(lut.byVidPid || {}).forEach(walk);
    Object.values(lut.byLabel || {}).forEach(walk);
    (lut.byPattern || []).forEach(walk);
    if (vals.length < 8) {
        return { hFovDeg: null, errorBoundDeg: null, n: vals.length,
                 reason: 'fewer than 8 populated entries — a distribution over ' + vals.length +
                         ' values is not a basis for a prior. Populate the table first.' };
    }
    vals.sort((a, b) => a - b);
    const q = (p) => vals[Math.min(vals.length - 1, Math.max(0, Math.round(p * (vals.length - 1))))];
    const med = q(0.5);
    // bound from the interquartile spread rather than the extremes, so one
    // ultrawide action cam does not set the error bar for every laptop
    const bound = Math.max(med - q(0.25), q(0.75) - med);
    return { hFovDeg: med, errorBoundDeg: bound, n: vals.length,
             reason: 'median of ' + vals.length + ' sourced horizontal FOVs; bound is the larger IQR half-width' };
}

// ---------------------------------------------------------------------------
// resolver
// ---------------------------------------------------------------------------

function resolveIntrinsics(track, lut, opts) {
    opts = opts || {};
    const warnings = [];
    let settings = {}, caps = {}, label = '';
    try { settings = (track && track.getSettings) ? track.getSettings() : (opts.settings || {}); } catch (e) {}
    try { caps = (track && track.getCapabilities) ? track.getCapabilities() : (opts.capabilities || {}); } catch (e) {}
    try { label = (track && track.label) || opts.label || ''; } catch (e) {}

    const W = settings.width || opts.width || 0;
    const H = settings.height || opts.height || 0;
    const liveAspect = (W && H) ? (W / H) : (settings.aspectRatio || 0);

    if (!label) {
        warnings.push('track.label is empty. Before camera permission is granted the label is blank, so ' +
                      'the table cannot be consulted at page load — intrinsics resolve only after the stream opens.');
    }
    if (settings.resizeMode && settings.resizeMode !== 'none') {
        warnings.push('resizeMode is "' + settings.resizeMode + '": the browser is resampling, which composes ' +
                      'with the device sensor crop. Constrain resizeMode to "none" to pin one of the two.');
    }

    // --- the chain ---------------------------------------------------------
    let entry = null, matchedBy = 'fallback', deviceKey = null;
    const vidpid = extractVidPid(label);
    if (vidpid && lut.byVidPid && lut.byVidPid[vidpid]) {
        entry = lut.byVidPid[vidpid]; matchedBy = 'vidpid'; deviceKey = vidpid;
    }
    if (!entry) {
        const norm = normalizeLabel(label);
        if (norm && lut.byLabel && lut.byLabel[norm]) {
            entry = lut.byLabel[norm]; matchedBy = 'label'; deviceKey = norm;
        }
        if (!entry && norm) {
            for (const row of (lut.byPattern || [])) {
                let re;
                try { re = new RegExp(row.pattern, 'i'); } catch (e) { continue; }
                if (re.test(norm)) { entry = row; matchedBy = 'pattern'; deviceKey = row.family || row.pattern; break; }
            }
        }
    }

    // A generic label matches many unrelated modules. Falling through to the
    // prior is CORRECT here — a family value would be wrong for most machines
    // that match, which is the failure mode the table exists to avoid.
    if (entry && entry.generic) {
        warnings.push('label "' + label + '" is generic and shared across unrelated camera modules (' +
                      deviceKey + '); falling through to the prior rather than attaching a value to it.');
        entry = null; matchedBy = 'fallback'; deviceKey = null;
    }

    let hFovNative = null, confidence = 'prior', provenance = null;
    if (entry && entry.value && entry.value.raw > 0) {
        hFovNative = toHorizontal(entry.value.raw, entry.value.type, entry.value.aspect);
        confidence = ({ A: 'measured', B: 'spec', C: 'marketing' })[entry.value.tier] ||
                     (matchedBy === 'pattern' ? 'family' : 'spec');
        provenance = entry.value.source || null;
        if (entry.value.tier === 'C')
            warnings.push('value is marketing copy: diagonal FOV in marketing is routinely rounded and sometimes ' +
                          'describes a mode the device does not ship in by default');
        if (entry.value.conflicts && entry.value.conflicts.length)
            warnings.push('sources disagree for this device (' + entry.value.conflicts.length +
                          ' conflicting entries recorded); the chosen value is the highest tier, not a reconciliation');
    } else if (entry) {
        warnings.push('matched ' + deviceKey + ' but its value is null: ' + (entry.reasonNull || 'unsourced'));
        entry = null;
    }
    if (entry && entry.warn) warnings.push.apply(warnings, entry.warn);

    // --- fallback ----------------------------------------------------------
    if (hFovNative === null) {
        // Prefer a LIVE per-session measurement over any constant. The
        // face-derived estimate trades the camera-FOV guess for a viewing
        // distance guess grounded in a real pixel measurement; it is at least
        // responsive to the actual optics, which a class LUT is not.
        if (opts.faceDerivedHFovDeg > 20 && opts.faceDerivedHFovDeg < 120) {
            hFovNative = opts.faceDerivedHFovDeg;
            confidence = 'prior';
            provenance = { url: null, kind: 'face-derived estimate (assumed viewing distance)' };
            warnings.push('no table entry; using the per-session face-derived FOV estimate. Depth gain inherits ' +
                          'the viewing-distance assumption — expect roughly +/-15%.');
        } else if (lut.prior && lut.prior.hFovDeg > 0) {
            hFovNative = lut.prior.hFovDeg;
            provenance = { url: null, kind: 'derived prior over the populated table' };
            warnings.push('no table entry; using the derived prior (' +
                          (lut.prior.errorBoundDeg != null ? '+/-' + lut.prior.errorBoundDeg.toFixed(1) + ' deg' : 'bound unknown') + ')');
        } else {
            warnings.push('NO FOV AVAILABLE: no table entry, no face-derived estimate, and the prior is unsourced. ' +
                          'Returning null fx. The head-Z axis cannot be computed; X and Y are unaffected because fx ' +
                          'cancels out of them.');
            return { fx: null, fy: null, cx: W ? W / 2 : null, cy: H ? H / 2 : null, hFovDeg: null, vFovDeg: null,
                     confidence: 'prior', matchedBy: 'fallback', deviceKey: null, warnings };
        }
    }

    // --- live-mode corrections --------------------------------------------
    const mode = applyModeRule(hFovNative, entry ? entry.sensorAspect : null, liveAspect,
                               entry ? entry.modeRule : null);
    warnings.push.apply(warnings, mode.warnings);
    let hFovDeg = mode.hFovDeg, vFovDeg = mode.vFovDeg;

    // digital zoom narrows the field by exactly the zoom factor in tangent space
    const zoom = settings.zoom;
    if (typeof zoom === 'number' && zoom > 1.001) {
        hFovDeg = 2 * Math.atan(Math.tan(hFovDeg * 0.5 * DEG) / zoom) / DEG;
        if (vFovDeg) vFovDeg = 2 * Math.atan(Math.tan(vFovDeg * 0.5 * DEG) / zoom) / DEG;
        warnings.push('digital zoom ' + zoom + 'x applied to the field of view');
    }
    if (caps && caps.pan && caps.tilt) {
        warnings.push('device reports pan/tilt capability: if it is being driven (by the user or by subject ' +
                      'tracking) the optical axis moves and the tracker will read that as head motion');
    }
    if (hFovDeg > 85) {
        warnings.push('field of view is wide (' + hFovDeg.toFixed(0) + ' deg); radial distortion at the frame ' +
                      'edge is unmodelled by design and lands on X and Y, not Z');
    }

    const fx = (W > 0 && hFovDeg > 0) ? (W / 2) / Math.tan(hFovDeg * 0.5 * DEG) : null;
    return {
        fx, fy: fx,                                   // square pixels assumed
        cx: W ? W / 2 : null, cy: H ? H / 2 : null,   // principal point at centre assumed
        hFovDeg, vFovDeg,
        confidence, matchedBy, deviceKey,
        provenance, width: W, height: H,
        warnings
    };
}

// Head pose from landmarks, written exactly as the brief states it so the
// dependency is visible: fx enters Z and nothing else.
const IPD_M_DEFAULT = 0.063;   // adult population mean, Dodgson SPIE 5291 (2004), SD 3.5 mm
function headPoseFromFace(intr, ipdPx, u, v, ipdMeters) {
    const IPD = ipdMeters || IPD_M_DEFAULT;
    if (!(ipdPx > 0)) return null;
    const X = (u - intr.cx) * IPD / ipdPx;
    const Y = (v - intr.cy) * IPD / ipdPx;
    const Z = (intr.fx > 0) ? (intr.fx * IPD / ipdPx) : null;
    return { X, Y, Z, zAvailable: Z !== null };
}

const API = { resolveIntrinsics, headPoseFromFace, derivePrior,
              extractVidPid, normalizeLabel, toHorizontal, parseAspect, applyModeRule, IPD_M_DEFAULT };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.MoebiusIntrinsics = API;
