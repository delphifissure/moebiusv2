// fourd/splat_renderer.js — minimal gaussian-splat renderer for the 4D portal PoC.
//
// Scope (PoC-honest):
//  - Loads .splat (antimatter15 32-byte records) and 3DGS binary .ply
//    (DC color band only — no view-dependent SH; noted, not hidden).
//  - Per-splat 3D covariance built CPU-side from scale+quaternion; the vertex
//    shader does the standard EWA projection (Zwicker) to a screen-space 2D
//    gaussian and stretches an instanced quad to its 3-sigma ellipse.
//  - Correct compositing: CPU depth sort back-to-front, premultiplied
//    over-blending, no depth write. Sorting is a 16-bit counting sort with a
//    typed-array gather — O(N), fine at PoC scale (tens of thousands).
//  - 4D: a sequence is an array of frames sharing one splat COUNT budget;
//    setFrame() gathers the frame's arrays through the current sort order.
//
// Off-axis note: the EWA Jacobian below uses the focal terms of the
// projection matrix; with the portal's asymmetric frustum the skew terms
// land in the projected CENTER (via projectionMatrix), while J keeps the
// focal scale — exact for the center, first-order for the ellipse shape,
// which is the standard approximation every WebGL splat viewer makes.
// Recorded here so nobody mistakes it for exactness.

(function (global) {
    'use strict';

    const SH_C0 = 0.28209479177387814;

    // ---- parsers ------------------------------------------------------
    // .splat: 32 bytes/record: float32 pos xyz, float32 scale xyz,
    // uint8 rgba (a = opacity), uint8 quat (w,x,y,z) as c*128+128.
    function parseSplat(buffer) {
        const n = Math.floor(buffer.byteLength / 32);
        const f = new Float32Array(buffer);
        const u = new Uint8Array(buffer);
        const out = allocFrame(n);
        for (let i = 0; i < n; i++) {
            const fo = i * 8, uo = i * 32;
            out.center[i * 3] = f[fo]; out.center[i * 3 + 1] = f[fo + 1]; out.center[i * 3 + 2] = f[fo + 2];
            const sx = f[fo + 3], sy = f[fo + 4], sz = f[fo + 5];
            out.color[i * 4] = u[uo + 24] / 255; out.color[i * 4 + 1] = u[uo + 25] / 255;
            out.color[i * 4 + 2] = u[uo + 26] / 255; out.color[i * 4 + 3] = u[uo + 27] / 255;
            const qw = (u[uo + 28] - 128) / 128, qx = (u[uo + 29] - 128) / 128,
                  qy = (u[uo + 30] - 128) / 128, qz = (u[uo + 31] - 128) / 128;
            covFromScaleQuat(sx, sy, sz, qw, qx, qy, qz, out.covA, out.covB, i);
        }
        return out;
    }

    // 3DGS .ply (binary_little_endian): x,y,z, f_dc_0..2, opacity(logit),
    // scale_0..2 (log), rot_0..3 (wxyz, unnormalized). Extra props skipped.
    function parsePly(buffer) {
        const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 4096)));
        const end = head.indexOf('end_header');
        if (end < 0) throw new Error('ply: no end_header');
        const headerLen = end + 'end_header'.length + 1;
        const lines = head.slice(0, end).split('\n');
        let n = 0; const props = [];
        for (const line of lines) {
            const t = line.trim().split(/\s+/);
            if (t[0] === 'element' && t[1] === 'vertex') n = parseInt(t[2]);
            else if (t[0] === 'property' && props !== null) props.push(t[2]);
        }
        const stride = props.length; // all float32 in 3DGS exports
        const f = new Float32Array(buffer, headerLen);
        const idx = {}; props.forEach((p, i) => { idx[p] = i; });
        const need = ['x', 'y', 'z', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3', 'opacity', 'f_dc_0', 'f_dc_1', 'f_dc_2'];
        for (const k of need) if (!(k in idx)) throw new Error('ply: missing ' + k);
        const out = allocFrame(n);
        for (let i = 0; i < n; i++) {
            const o = i * stride;
            out.center[i * 3] = f[o + idx.x]; out.center[i * 3 + 1] = f[o + idx.y]; out.center[i * 3 + 2] = f[o + idx.z];
            const sx = Math.exp(f[o + idx.scale_0]), sy = Math.exp(f[o + idx.scale_1]), sz = Math.exp(f[o + idx.scale_2]);
            let qw = f[o + idx.rot_0], qx = f[o + idx.rot_1], qy = f[o + idx.rot_2], qz = f[o + idx.rot_3];
            const ql = Math.hypot(qw, qx, qy, qz) || 1; qw /= ql; qx /= ql; qy /= ql; qz /= ql;
            out.color[i * 4] = clamp01(0.5 + SH_C0 * f[o + idx.f_dc_0]);
            out.color[i * 4 + 1] = clamp01(0.5 + SH_C0 * f[o + idx.f_dc_1]);
            out.color[i * 4 + 2] = clamp01(0.5 + SH_C0 * f[o + idx.f_dc_2]);
            out.color[i * 4 + 3] = 1 / (1 + Math.exp(-f[o + idx.opacity]));
            covFromScaleQuat(sx, sy, sz, qw, qx, qy, qz, out.covA, out.covB, i);
        }
        return out;
    }

    function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

    function allocFrame(n) {
        return {
            n,
            center: new Float32Array(n * 3),
            covA: new Float32Array(n * 3),   // xx, xy, xz
            covB: new Float32Array(n * 3),   // yy, yz, zz
            color: new Float32Array(n * 4),
        };
    }

    // Sigma = R S S^T R^T
    function covFromScaleQuat(sx, sy, sz, qw, qx, qy, qz, covA, covB, i) {
        const r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qw * qz), r02 = 2 * (qx * qz + qw * qy);
        const r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx);
        const r20 = 2 * (qx * qz - qw * qy), r21 = 2 * (qy * qz + qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy);
        const sx2 = sx * sx, sy2 = sy * sy, sz2 = sz * sz;
        covA[i * 3]     = r00 * r00 * sx2 + r01 * r01 * sy2 + r02 * r02 * sz2;
        covA[i * 3 + 1] = r00 * r10 * sx2 + r01 * r11 * sy2 + r02 * r12 * sz2;
        covA[i * 3 + 2] = r00 * r20 * sx2 + r01 * r21 * sy2 + r02 * r22 * sz2;
        covB[i * 3]     = r10 * r10 * sx2 + r11 * r11 * sy2 + r12 * r12 * sz2;
        covB[i * 3 + 1] = r10 * r20 * sx2 + r11 * r21 * sy2 + r12 * r22 * sz2;
        covB[i * 3 + 2] = r20 * r20 * sx2 + r21 * r21 * sy2 + r22 * r22 * sz2;
    }

    // ---- renderer -------------------------------------------------------
    const VERT = `
        precision highp float;
        attribute vec2 corner;
        attribute vec3 iCenter;
        attribute vec3 iCovA;   // xx xy xz
        attribute vec3 iCovB;   // yy yz zz
        attribute vec4 iColor;
        uniform vec2 uViewport;  // px
        uniform vec2 uFocal;     // fx fy in px
        varying vec4 vColor;
        varying vec2 vCorner;
        void main() {
            vec4 cam = modelViewMatrix * vec4(iCenter, 1.0);
            vec4 clip = projectionMatrix * cam;
            if (cam.z > -0.05) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
            float iz = 1.0 / -cam.z;
            float fx = uFocal.x, fy = uFocal.y;
            // EWA: J W Sigma W^T J^T  (ES 1.0-safe: no transpose(), no mat3(mat4))
            mat3 S = mat3(iCovA.x, iCovA.y, iCovA.z,
                          iCovA.y, iCovB.x, iCovB.y,
                          iCovA.z, iCovB.y, iCovB.z);
            mat3 W = mat3(modelViewMatrix[0].xyz, modelViewMatrix[1].xyz, modelViewMatrix[2].xyz);
            mat3 Wt = mat3(vec3(W[0].x, W[1].x, W[2].x),
                           vec3(W[0].y, W[1].y, W[2].y),
                           vec3(W[0].z, W[1].z, W[2].z));
            mat3 V = W * S * Wt;
            float tx = cam.x * iz, ty = cam.y * iz;
            // rows of J (2x3), z negated into iz form
            vec3 J0 = vec3(fx * iz, 0.0, fx * tx * iz);
            vec3 J1 = vec3(0.0, fy * iz, fy * ty * iz);
            float c00 = dot(J0, V * J0) + 0.3;
            float c11 = dot(J1, V * J1) + 0.3;
            float c01 = dot(J0, V * J1);
            // eigen of [[c00 c01][c01 c11]]
            float mid = 0.5 * (c00 + c11);
            float rad = sqrt(max(0.0001, mid * mid - (c00 * c11 - c01 * c01)));
            float l1 = mid + rad, l2 = max(0.02, mid - rad);
            vec2 e1 = normalize(vec2(c01, l1 - c00));
            if (abs(c01) < 1e-6) e1 = (c00 >= c11) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
            vec2 e2 = vec2(-e1.y, e1.x);
            vec2 px = corner.x * e1 * 3.0 * sqrt(l1) + corner.y * e2 * 3.0 * sqrt(l2);
            gl_Position = clip;
            gl_Position.xy += px * 2.0 / uViewport * clip.w;
            vColor = iColor;
            vCorner = corner * 3.0;
        }`;
    const FRAG = `
        precision highp float;
        varying vec4 vColor;
        varying vec2 vCorner;
        void main() {
            float r2 = dot(vCorner, vCorner);
            if (r2 > 9.0) discard;
            float a = vColor.a * exp(-0.5 * r2);
            if (a < 0.0039) discard;
            gl_FragColor = vec4(vColor.rgb * a, a);   // premultiplied over
        }`;

    class SplatCloud {
        constructor(THREE, capacity) {
            this.THREE = THREE;
            this.capacity = capacity;
            this.frames = [];       // array of allocFrame results (>=1)
            this.frameIndex = 0;
            this.order = new Uint32Array(capacity);
            this._depth = new Float32Array(capacity);
            this._buckets = new Uint32Array(65536 + 1);
            const geo = new THREE.InstancedBufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0,0,0, 0,0,0, 0,0,0, 0,0,0]), 3)); // unused, three needs it
            geo.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([-1,-1, 1,-1, 1,1, -1,1]), 2));
            geo.setIndex([0, 1, 2, 0, 2, 3]);
            this.aCenter = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
            this.aCovA = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
            this.aCovB = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
            this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
            for (const a of [this.aCenter, this.aCovA, this.aCovB, this.aColor]) a.setUsage(THREE.DynamicDrawUsage);
            geo.setAttribute('iCenter', this.aCenter);
            geo.setAttribute('iCovA', this.aCovA);
            geo.setAttribute('iCovB', this.aCovB);
            geo.setAttribute('iColor', this.aColor);
            this.material = new THREE.ShaderMaterial({
                vertexShader: VERT, fragmentShader: FRAG,
                uniforms: { uViewport: { value: new THREE.Vector2(1, 1) }, uFocal: { value: new THREE.Vector2(1, 1) } },
                transparent: true, depthTest: true, depthWrite: false,
                blending: THREE.CustomBlending,
                blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
                blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
            });
            this.mesh = new THREE.Mesh(geo, this.material);
            this.mesh.frustumCulled = false;
            this._geo = geo;
        }

        setFrames(frames) {
            this.frames = frames;
            this.frameIndex = 0;
        }

        frame() { return this.frames[this.frameIndex]; }

        setFrame(i) {
            this.frameIndex = ((i % this.frames.length) + this.frames.length) % this.frames.length;
        }

        // Sort the CURRENT frame back-to-front for the given camera and gather
        // into the instanced attributes. Call on eye move or frame change.
        sortAndUpload(camera) {
            const fr = this.frame(); if (!fr) return;
            const n = Math.min(fr.n, this.capacity);
            const m = camera.matrixWorldInverse.elements; // view matrix
            const zx = m[2], zy = m[6], zz = m[10], zw = m[14];
            const depth = this._depth;
            let mn = Infinity, mx = -Infinity;
            for (let i = 0; i < n; i++) {
                const d = zx * fr.center[i * 3] + zy * fr.center[i * 3 + 1] + zz * fr.center[i * 3 + 2] + zw;
                depth[i] = d;
                if (d < mn) mn = d; if (d > mx) mx = d;
            }
            const buckets = this._buckets; buckets.fill(0);
            const scale = (mx > mn) ? 65535 / (mx - mn) : 0;
            for (let i = 0; i < n; i++) buckets[(((depth[i] - mn) * scale) | 0) + 1]++;
            for (let b = 0; b < 65536; b++) buckets[b + 1] += buckets[b];
            const order = this.order;
            for (let i = 0; i < n; i++) order[buckets[((depth[i] - mn) * scale) | 0]++] = i;
            // back-to-front: view z is NEGATIVE in front of the camera, so the
            // most negative (farthest) has the SMALLEST key — order[] is
            // already far -> near. Gather.
            const c = this.aCenter.array, ca = this.aCovA.array, cb = this.aCovB.array, col = this.aColor.array;
            for (let k = 0; k < n; k++) {
                const i = order[k];
                c[k * 3] = fr.center[i * 3]; c[k * 3 + 1] = fr.center[i * 3 + 1]; c[k * 3 + 2] = fr.center[i * 3 + 2];
                ca[k * 3] = fr.covA[i * 3]; ca[k * 3 + 1] = fr.covA[i * 3 + 1]; ca[k * 3 + 2] = fr.covA[i * 3 + 2];
                cb[k * 3] = fr.covB[i * 3]; cb[k * 3 + 1] = fr.covB[i * 3 + 1]; cb[k * 3 + 2] = fr.covB[i * 3 + 2];
                col[k * 4] = fr.color[i * 4]; col[k * 4 + 1] = fr.color[i * 4 + 1];
                col[k * 4 + 2] = fr.color[i * 4 + 2]; col[k * 4 + 3] = fr.color[i * 4 + 3];
            }
            this._geo.instanceCount = n;
            if (this._geo._maxInstanceCount !== undefined) this._geo._maxInstanceCount = n; // r128 quirk
            this.aCenter.needsUpdate = true; this.aCovA.needsUpdate = true;
            this.aCovB.needsUpdate = true; this.aColor.needsUpdate = true;
        }

        // Focal terms from the (possibly asymmetric) projection matrix.
        updateViewportUniforms(camera, widthPx, heightPx) {
            const p = camera.projectionMatrix.elements;
            this.material.uniforms.uViewport.value.set(widthPx, heightPx);
            this.material.uniforms.uFocal.value.set(p[0] * widthPx / 2, p[5] * heightPx / 2);
        }
    }

    // Normalize a frame set to portal space: recenter on the SUBJECT centroid,
    // uniform-scale so the SUBJECT height fits fitHeight, then put the subject
    // centroid AT the portal plane (z = portalZ) — the same portal-plane
    // pinning the 2.5D layers get. One transform for ALL frames (the subject
    // must not re-normalize per frame or the animation swims).
    // `subject` = {center:[x,y,z], height} from the asset's own metadata (the
    // generator/rig knows its subject — 4DAnyone ships `framing` the same
    // way); without it the union bbox is the fallback, which lets a large
    // environment (ground plane, backdrop) dominate the fit.
    function normalizeFrames(frames, portalZ, fitHeight, subject) {
        let cx, cy, cz, h;
        if (subject && subject.center && subject.height) {
            cx = subject.center[0]; cy = subject.center[1]; cz = subject.center[2];
            h = subject.height;
        } else {
            let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
            for (const fr of frames) for (let i = 0; i < fr.n; i++)
                for (let a = 0; a < 3; a++) {
                    const v = fr.center[i * 3 + a];
                    if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v;
                }
            cx = (mn[0] + mx[0]) / 2; cy = (mn[1] + mx[1]) / 2; cz = (mn[2] + mx[2]) / 2;
            h = Math.max(1e-6, mx[1] - mn[1]);
        }
        const s = fitHeight / h;
        for (const fr of frames) {
            for (let i = 0; i < fr.n; i++) {
                fr.center[i * 3] = (fr.center[i * 3] - cx) * s;
                fr.center[i * 3 + 1] = (fr.center[i * 3 + 1] - cy) * s;
                fr.center[i * 3 + 2] = (fr.center[i * 3 + 2] - cz) * s + portalZ;
            }
            const s2 = s * s;
            for (let i = 0; i < fr.covA.length; i++) { fr.covA[i] *= s2; fr.covB[i] *= s2; }
        }
        return { scale: s };
    }

    const api = { parseSplat, parsePly, SplatCloud, normalizeFrames, allocFrame };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else global.FourDSplats = api;
})(typeof window !== 'undefined' ? window : globalThis);
