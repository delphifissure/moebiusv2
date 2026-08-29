// MIRROR — the CANONICAL copy of this code is embedded in moebius.js
// (A227). This file exists only for the standalone PoC pages (splat.html,
// fourd.html) and node-side tools. Fix bugs in moebius.js FIRST, then sync.
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
        // headerLen is rarely 4-aligned; typed views need alignment, so slice
        const f = new Float32Array(buffer.slice(headerLen));
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
    // Dynamic (SpacetimeGaussians) vertex shader: the covariance cannot be
    // CPU-precomputed because rotation is time-varying, so R(t) S is built
    // per vertex from the quaternion polynomial; everything after Sigma is
    // the same EWA block as the static path. ES 1.0-safe.
    const DYN_VERT = `
        precision highp float;
        attribute vec2 corner;
        attribute vec3 iCenter;
        attribute vec3 iScale;
        attribute vec4 iQuat;    // (x,y,z,w) at t = trbf center
        attribute vec4 iOmega;   // same component order
        attribute vec3 iMotA;    // dt coefficients
        attribute vec3 iMotB;    // dt^2
        attribute vec3 iMotC;    // dt^3
        attribute vec2 iTrbf;    // (center, exp(scale))
        attribute vec4 iColor;
        uniform vec2 uViewport;
        uniform vec2 uFocal;
        uniform float uTime;
        varying vec4 vColor;
        varying vec2 vCorner;
        void main() {
            float dt = uTime - iTrbf.x;
            float tw = exp(-(dt * dt) / max(iTrbf.y * iTrbf.y, 1e-12));
            vec3 p = iCenter + iMotA * dt + iMotB * (dt * dt) + iMotC * (dt * dt * dt);
            vec4 cam = modelViewMatrix * vec4(p, 1.0);
            vec4 clip = projectionMatrix * cam;
            if (cam.z > -0.05 || tw < 0.0039) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
            vec4 q = iQuat + dt * iOmega;
            q /= max(length(q), 1e-9);
            float xx = q.x * q.x, yy = q.y * q.y, zz = q.z * q.z;
            float xy = q.x * q.y, xz = q.x * q.z, yz = q.y * q.z;
            float wx = q.w * q.x, wy = q.w * q.y, wz = q.w * q.z;
            mat3 R = mat3(
                vec3(1.0 - 2.0 * (yy + zz), 2.0 * (xy + wz), 2.0 * (xz - wy)),
                vec3(2.0 * (xy - wz), 1.0 - 2.0 * (xx + zz), 2.0 * (yz + wx)),
                vec3(2.0 * (xz + wy), 2.0 * (yz - wx), 1.0 - 2.0 * (xx + yy)));
            mat3 M = mat3(R[0] * iScale.x, R[1] * iScale.y, R[2] * iScale.z);
            mat3 Mt = mat3(vec3(M[0].x, M[1].x, M[2].x),
                           vec3(M[0].y, M[1].y, M[2].y),
                           vec3(M[0].z, M[1].z, M[2].z));
            mat3 S = M * Mt;
            mat3 W = mat3(modelViewMatrix[0].xyz, modelViewMatrix[1].xyz, modelViewMatrix[2].xyz);
            mat3 Wt = mat3(vec3(W[0].x, W[1].x, W[2].x),
                           vec3(W[0].y, W[1].y, W[2].y),
                           vec3(W[0].z, W[1].z, W[2].z));
            mat3 V = W * S * Wt;
            float iz = 1.0 / -cam.z;
            float tx = cam.x * iz, ty = cam.y * iz;
            vec3 J0 = vec3(uFocal.x * iz, 0.0, uFocal.x * tx * iz);
            vec3 J1 = vec3(0.0, uFocal.y * iz, uFocal.y * ty * iz);
            float c00 = dot(J0, V * J0) + 0.3;
            float c11 = dot(J1, V * J1) + 0.3;
            float c01 = dot(J0, V * J1);
            float mid = 0.5 * (c00 + c11);
            float rad = sqrt(max(0.0001, mid * mid - (c00 * c11 - c01 * c01)));
            float l1 = mid + rad, l2 = max(0.02, mid - rad);
            vec2 e1 = normalize(vec2(c01, l1 - c00));
            if (abs(c01) < 1e-6) e1 = (c00 >= c11) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
            vec2 e2 = vec2(-e1.y, e1.x);
            vec2 px = corner.x * e1 * 3.0 * sqrt(l1) + corner.y * e2 * 3.0 * sqrt(l2);
            gl_Position = clip;
            gl_Position.xy += px * 2.0 / uViewport * clip.w;
            vColor = vec4(iColor.rgb, iColor.a * tw);
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
        constructor(THREE, capacity, dynamic) {
            this.THREE = THREE;
            this.capacity = capacity;
            this.dynamic = !!dynamic;   // SpacetimeGaussians single-file 4D
            this.time = 0;              // dynamic only: normalized clip time
            this.frames = [];       // array of allocFrame results (>=1)
            this.frameIndex = 0;
            this.order = new Uint32Array(capacity);
            this._depth = new Float32Array(capacity);
            this._buckets = new Uint32Array(65536 + 1);
            const geo = new THREE.InstancedBufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0,0,0, 0,0,0, 0,0,0, 0,0,0]), 3)); // unused, three needs it
            geo.setAttribute('corner', new THREE.BufferAttribute(new Float32Array([-1,-1, 1,-1, 1,1, -1,1]), 2));
            geo.setIndex([0, 1, 2, 0, 2, 3]);
            const mk = (w) => {
                const a = new THREE.InstancedBufferAttribute(new Float32Array(capacity * w), w);
                a.setUsage(THREE.DynamicDrawUsage); return a;
            };
            const uniforms = { uViewport: { value: new THREE.Vector2(1, 1) }, uFocal: { value: new THREE.Vector2(1, 1) } };
            if (this.dynamic) {
                this.aCenter = mk(3); this.aScale = mk(3); this.aQuat = mk(4); this.aOmega = mk(4);
                this.aMotA = mk(3); this.aMotB = mk(3); this.aMotC = mk(3);
                this.aTrbf = mk(2); this.aColor = mk(4);
                geo.setAttribute('iCenter', this.aCenter); geo.setAttribute('iScale', this.aScale);
                geo.setAttribute('iQuat', this.aQuat); geo.setAttribute('iOmega', this.aOmega);
                geo.setAttribute('iMotA', this.aMotA); geo.setAttribute('iMotB', this.aMotB);
                geo.setAttribute('iMotC', this.aMotC); geo.setAttribute('iTrbf', this.aTrbf);
                geo.setAttribute('iColor', this.aColor);
                uniforms.uTime = { value: 0 };
                this._dynPos = new Float32Array(capacity * 3);
            } else {
                this.aCenter = mk(3); this.aCovA = mk(3); this.aCovB = mk(3); this.aColor = mk(4);
                geo.setAttribute('iCenter', this.aCenter);
                geo.setAttribute('iCovA', this.aCovA);
                geo.setAttribute('iCovB', this.aCovB);
                geo.setAttribute('iColor', this.aColor);
            }
            this.material = new THREE.ShaderMaterial({
                vertexShader: this.dynamic ? DYN_VERT : VERT, fragmentShader: FRAG,
                uniforms,
                transparent: true, depthTest: true, depthWrite: false,
                blending: THREE.CustomBlending,
                blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
                blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
            });
            this.mesh = new THREE.Mesh(geo, this.material);
            this.mesh.frustumCulled = false;
            this._geo = geo;
        }

        setTime(t) {   // dynamic only
            this.time = t;
            if (this.material.uniforms.uTime) this.material.uniforms.uTime.value = t;
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
        // into the instanced attributes. Call on eye move, frame change, or
        // (dynamic) time change — dynamic positions are evaluated at
        // this.time with the same polynomial the shader uses.
        sortAndUpload(camera) {
            const fr = this.frame(); if (!fr) return;
            const n = Math.min(fr.n, this.capacity);
            const m = camera.matrixWorldInverse.elements; // view matrix
            const zx = m[2], zy = m[6], zz = m[10], zw = m[14];
            const depth = this._depth;
            let srcPos = fr.center;
            if (this.dynamic) { evalDynamicPositions(fr, this.time, this._dynPos); srcPos = this._dynPos; }
            let mn = Infinity, mx = -Infinity;
            for (let i = 0; i < n; i++) {
                const d = zx * srcPos[i * 3] + zy * srcPos[i * 3 + 1] + zz * srcPos[i * 3 + 2] + zw;
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
            if (this.dynamic) {
                const c = this.aCenter.array, s = this.aScale.array, q = this.aQuat.array,
                      w = this.aOmega.array, ma = this.aMotA.array, mb = this.aMotB.array,
                      mc = this.aMotC.array, tb = this.aTrbf.array, col = this.aColor.array;
                for (let k = 0; k < n; k++) {
                    const i = order[k];
                    for (let a = 0; a < 3; a++) {
                        c[k * 3 + a] = fr.center[i * 3 + a];
                        s[k * 3 + a] = fr.scale[i * 3 + a];
                        ma[k * 3 + a] = fr.motion[i * 9 + a];
                        mb[k * 3 + a] = fr.motion[i * 9 + 3 + a];
                        mc[k * 3 + a] = fr.motion[i * 9 + 6 + a];
                    }
                    for (let a = 0; a < 4; a++) {
                        q[k * 4 + a] = fr.quat[i * 4 + a];
                        w[k * 4 + a] = fr.omega[i * 4 + a];
                        col[k * 4 + a] = fr.color[i * 4 + a];
                    }
                    tb[k * 2] = fr.trbf[i * 2]; tb[k * 2 + 1] = fr.trbf[i * 2 + 1];
                }
                for (const a of [this.aCenter, this.aScale, this.aQuat, this.aOmega,
                                 this.aMotA, this.aMotB, this.aMotC, this.aTrbf, this.aColor]) a.needsUpdate = true;
            } else {
                const c = this.aCenter.array, ca = this.aCovA.array, cb = this.aCovB.array, col = this.aColor.array;
                for (let k = 0; k < n; k++) {
                    const i = order[k];
                    c[k * 3] = fr.center[i * 3]; c[k * 3 + 1] = fr.center[i * 3 + 1]; c[k * 3 + 2] = fr.center[i * 3 + 2];
                    ca[k * 3] = fr.covA[i * 3]; ca[k * 3 + 1] = fr.covA[i * 3 + 1]; ca[k * 3 + 2] = fr.covA[i * 3 + 2];
                    cb[k * 3] = fr.covB[i * 3]; cb[k * 3 + 1] = fr.covB[i * 3 + 1]; cb[k * 3 + 2] = fr.covB[i * 3 + 2];
                    col[k * 4] = fr.color[i * 4]; col[k * 4 + 1] = fr.color[i * 4 + 1];
                    col[k * 4 + 2] = fr.color[i * 4 + 2]; col[k * 4 + 3] = fr.color[i * 4 + 3];
                }
                this.aCenter.needsUpdate = true; this.aCovA.needsUpdate = true;
                this.aCovB.needsUpdate = true; this.aColor.needsUpdate = true;
            }
            this._geo.instanceCount = n;
            if (this._geo._maxInstanceCount !== undefined) this._geo._maxInstanceCount = n; // r128 quirk
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
            if (fr.dynamic) {
                // motion coefficients are DISPLACEMENTS — they scale, they do
                // not translate; linear scales likewise; trbf is pure time.
                for (let i = 0; i < fr.motion.length; i++) fr.motion[i] *= s;
                for (let i = 0; i < fr.scale.length; i++) fr.scale[i] *= s;
            } else {
                const s2 = s * s;
                for (let i = 0; i < fr.covA.length; i++) { fr.covA[i] *= s2; fr.covB[i] *= s2; }
            }
        }
        return { scale: s };
    }

    // ---- SpacetimeGaussians (single-file 4D) ---------------------------
    // Li et al., oppo-us-research/SpacetimeGaussians. One persistent gaussian
    // set; per splat: cubic position polynomial, linear rotation, and a
    // temporal opacity window. Evaluation law VERIFIED against their
    // renderer/__init__.py and scene/oursfull.py:
    //   dt   = t - trbf_center                     (t normalized over clip)
    //   pos  = p0 + m[0:3] dt + m[3:6] dt^2 + m[6:9] dt^3
    //   q    = normalize(q0 + dt * omega)
    //   op   = sigmoid(opacity_logit) * exp(-(dt / exp(trbf_scale))^2)
    //   scales log-stored, f_dc DC band (the full model's f_t feature/MLP
    //   color path is NOT rendered — DC approximation, same as our .ply).
    function parseSpacetimePly(buffer) {
        const head = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 8192)));
        const end = head.indexOf('end_header');
        if (end < 0) throw new Error('stg ply: no end_header');
        const headerLen = end + 'end_header'.length + 1;
        const lines = head.slice(0, end).split('\n');
        let n = 0; const props = [];
        for (const line of lines) {
            const t = line.trim().split(/\s+/);
            if (t[0] === 'element' && t[1] === 'vertex') n = parseInt(t[2]);
            else if (t[0] === 'property') props.push(t[2]);
        }
        const stride = props.length;
        // headerLen is rarely 4-aligned; typed views need alignment, so slice
        const f = new Float32Array(buffer.slice(headerLen));
        const idx = {}; props.forEach((p, i) => { idx[p] = i; });
        const need = ['x', 'y', 'z', 'trbf_center', 'trbf_scale', 'opacity',
                      'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3',
                      'f_dc_0', 'f_dc_1', 'f_dc_2'];
        for (const k of need) if (!(k in idx)) throw new Error('stg ply: missing ' + k);
        for (let m = 0; m < 9; m++) if (!(('motion_' + m) in idx)) throw new Error('stg ply: missing motion_' + m);
        for (let m = 0; m < 4; m++) if (!(('omega_' + m) in idx)) throw new Error('stg ply: missing omega_' + m);
        const out = {
            n, dynamic: true,
            center: new Float32Array(n * 3),
            scale: new Float32Array(n * 3),        // LINEAR (exp applied)
            quat: new Float32Array(n * 4),         // (x, y, z, w)
            omega: new Float32Array(n * 4),        // (x, y, z, w) — same reorder as quat
            motion: new Float32Array(n * 9),       // m1.xyz, m2.xyz, m3.xyz
            trbf: new Float32Array(n * 2),         // center, exp(scale)
            color: new Float32Array(n * 4),
        };
        for (let i = 0; i < n; i++) {
            const o = i * stride;
            out.center[i * 3] = f[o + idx.x]; out.center[i * 3 + 1] = f[o + idx.y]; out.center[i * 3 + 2] = f[o + idx.z];
            for (let k = 0; k < 3; k++) out.scale[i * 3 + k] = Math.exp(f[o + idx['scale_' + k]]);
            // 3DGS rot_0 = w; attribute order (x,y,z,w). omega reordered
            // IDENTICALLY — q + dt*omega is linear, pairing must match.
            out.quat[i * 4] = f[o + idx.rot_1]; out.quat[i * 4 + 1] = f[o + idx.rot_2];
            out.quat[i * 4 + 2] = f[o + idx.rot_3]; out.quat[i * 4 + 3] = f[o + idx.rot_0];
            out.omega[i * 4] = f[o + idx.omega_1]; out.omega[i * 4 + 1] = f[o + idx.omega_2];
            out.omega[i * 4 + 2] = f[o + idx.omega_3]; out.omega[i * 4 + 3] = f[o + idx.omega_0];
            for (let m = 0; m < 9; m++) out.motion[i * 9 + m] = f[o + idx['motion_' + m]];
            out.trbf[i * 2] = f[o + idx.trbf_center];
            out.trbf[i * 2 + 1] = Math.exp(f[o + idx.trbf_scale]);
            out.color[i * 4] = clamp01(0.5 + SH_C0 * f[o + idx.f_dc_0]);
            out.color[i * 4 + 1] = clamp01(0.5 + SH_C0 * f[o + idx.f_dc_1]);
            out.color[i * 4 + 2] = clamp01(0.5 + SH_C0 * f[o + idx.f_dc_2]);
            out.color[i * 4 + 3] = 1 / (1 + Math.exp(-f[o + idx.opacity]));
        }
        return out;
    }

    // 180° about X (y,z negated): 3DGS content is conventionally y-DOWN
    // (COLMAP/OpenCV heritage) and the portal is y-up, so this is the
    // DEFAULT import orientation — the same flip every canonical splat
    // viewer bakes into its view matrix. Some producers author y-up
    // (e.g. PlayCanvas spz exports); those disable it per layer/URL.
    // Measured basis: nianticlabs spz_to_ply output matches our raw decode
    // element-exactly (no hidden conversion in any container), so
    // orientation is pure producer convention, not a format property.
    function flipFrameRDF(fr) {
        for (let i = 0; i < fr.n; i++) {
            fr.center[i * 3 + 1] = -fr.center[i * 3 + 1];
            fr.center[i * 3 + 2] = -fr.center[i * 3 + 2];
        }
        if (fr.dynamic) {
            for (let i = 0; i < fr.n; i++) {
                for (const off of [1, 2, 4, 5, 7, 8]) fr.motion[i * 9 + off] = -fr.motion[i * 9 + off];
                // q' = r180x ⊗ q : (x,y,z,w) -> (w, -z, y, -x); omega same map
                for (const arr of [fr.quat, fr.omega]) {
                    const x = arr[i * 4], y = arr[i * 4 + 1], z = arr[i * 4 + 2], w = arr[i * 4 + 3];
                    arr[i * 4] = w; arr[i * 4 + 1] = -z; arr[i * 4 + 2] = y; arr[i * 4 + 3] = -x;
                }
            }
        } else {
            // C' = F C F^T, F = diag(1,-1,-1): xy and xz negate, yz keeps
            for (let i = 0; i < fr.n; i++) {
                fr.covA[i * 3 + 1] = -fr.covA[i * 3 + 1];
                fr.covA[i * 3 + 2] = -fr.covA[i * 3 + 2];
            }
        }
        return fr;
    }

    // Evaluate a dynamic frame's positions at time t (CPU, for sorting).
    function evalDynamicPositions(fr, t, dst) {
        for (let i = 0; i < fr.n; i++) {
            const dt = t - fr.trbf[i * 2], dt2 = dt * dt, dt3 = dt2 * dt;
            const m = i * 9;
            dst[i * 3]     = fr.center[i * 3]     + fr.motion[m] * dt     + fr.motion[m + 3] * dt2 + fr.motion[m + 6] * dt3;
            dst[i * 3 + 1] = fr.center[i * 3 + 1] + fr.motion[m + 1] * dt + fr.motion[m + 4] * dt2 + fr.motion[m + 7] * dt3;
            dst[i * 3 + 2] = fr.center[i * 3 + 2] + fr.motion[m + 2] * dt + fr.motion[m + 5] * dt2 + fr.motion[m + 8] * dt3;
        }
    }

    // ---- splaTV .splatv (antimatter15 dynamic container) ---------------
    // Layout VERIFIED against antimatter15/splaTV hybrid.js:
    //   u32 magic 0x674b, u32 jsonLen, JSON chunk table, then 64 bytes/splat:
    //   [0..2] f32 xyz; [3][4] half2 (rot_0,rot_1)(rot_2,rot_3) — 3DGS
    //   (w,x,y,z); [5][6] half2 LINEAR scales (exp already applied);
    //   [7] rgba8 color+opacity (final bytes, no SH transform);
    //   [8..12] half2 motion_0..8; [13][14] half2 omega_0..3;
    //   [15] half2 (trbf_center, exp(trbf_scale)).
    // Same SpacetimeGaussians evaluation law as parseSpacetimePly.
    function halfToFloat(h) {
        const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
        if (e === 0) return s * m * Math.pow(2, -24);
        if (e === 31) return m ? NaN : s * Infinity;
        return s * (1 + m / 1024) * Math.pow(2, e - 15);
    }
    function parseSplatv(buffer) {
        const dv = new DataView(buffer);
        if (dv.getUint32(0, true) !== 0x674b) throw new Error('splatv: bad magic');
        const jsonLen = dv.getUint32(4, true);
        const dataOff = 8 + jsonLen;
        const n = Math.floor((buffer.byteLength - dataOff) / 64);
        if (n < 1) throw new Error('splatv: no splats');
        const u32 = new Uint32Array(buffer.slice(dataOff, dataOff + n * 64));
        const f32 = new Float32Array(u32.buffer);
        const u8 = new Uint8Array(u32.buffer);
        const out = {
            n, dynamic: true,
            center: new Float32Array(n * 3), scale: new Float32Array(n * 3),
            quat: new Float32Array(n * 4), omega: new Float32Array(n * 4),
            motion: new Float32Array(n * 9), trbf: new Float32Array(n * 2),
            color: new Float32Array(n * 4),
        };
        const lo = (v) => halfToFloat(v & 0xffff), hi = (v) => halfToFloat(v >>> 16);
        for (let i = 0; i < n; i++) {
            const b = i * 16;
            out.center[i * 3] = f32[b]; out.center[i * 3 + 1] = f32[b + 1]; out.center[i * 3 + 2] = f32[b + 2];
            const r0 = lo(u32[b + 3]), r1 = hi(u32[b + 3]), r2 = lo(u32[b + 4]), r3 = hi(u32[b + 4]);
            out.quat[i * 4] = r1; out.quat[i * 4 + 1] = r2; out.quat[i * 4 + 2] = r3; out.quat[i * 4 + 3] = r0;
            out.scale[i * 3] = lo(u32[b + 5]); out.scale[i * 3 + 1] = hi(u32[b + 5]); out.scale[i * 3 + 2] = lo(u32[b + 6]);
            out.color[i * 4] = u8[(b + 7) * 4] / 255; out.color[i * 4 + 1] = u8[(b + 7) * 4 + 1] / 255;
            out.color[i * 4 + 2] = u8[(b + 7) * 4 + 2] / 255; out.color[i * 4 + 3] = u8[(b + 7) * 4 + 3] / 255;
            out.motion[i * 9] = lo(u32[b + 8]); out.motion[i * 9 + 1] = hi(u32[b + 8]);
            out.motion[i * 9 + 2] = lo(u32[b + 9]); out.motion[i * 9 + 3] = hi(u32[b + 9]);
            out.motion[i * 9 + 4] = lo(u32[b + 10]); out.motion[i * 9 + 5] = hi(u32[b + 10]);
            out.motion[i * 9 + 6] = lo(u32[b + 11]); out.motion[i * 9 + 7] = hi(u32[b + 11]);
            out.motion[i * 9 + 8] = lo(u32[b + 12]);
            const o0 = lo(u32[b + 13]), o1 = hi(u32[b + 13]), o2 = lo(u32[b + 14]), o3 = hi(u32[b + 14]);
            out.omega[i * 4] = o1; out.omega[i * 4 + 1] = o2; out.omega[i * 4 + 2] = o3; out.omega[i * 4 + 3] = o0;
            out.trbf[i * 2] = lo(u32[b + 15]); out.trbf[i * 2 + 1] = Math.max(1e-6, hi(u32[b + 15]));
        }
        return out;
    }

    // ---- SPZ (Niantic) ------------------------------------------------
    // Versions 1-3: 16-byte header + attribute sections, whole body gzipped.
    // Section order VERIFIED against nianticlabs/spz load-spz.cc
    // serializePackedGaussians: positions, alphas, colors, scales,
    // rotations, sh. Decodes: pos 24-bit LE signed fixed / 2^fractionalBits;
    // scale exp(byte/16 - 10); alpha byte/255 (sigmoid already applied);
    // color rgb = 0.5 + SH_C0 * ((byte/255 - 0.5) / 0.15).
    // Version 4 restructured the container to per-stream ZSTD — no native
    // browser decoder, so it is REJECTED with a clear message rather than
    // half-parsed. v3's smallest-three rotation decode follows the spec text
    // (2-bit largest index in the top bits, 3 x 10-bit signed components,
    // range ±1/√2); it has not yet been validated against a reference v3
    // file — v2 (what Scaniverse emits) is the verified path.
    async function parseSpz(buffer) {
        let bytes = new Uint8Array(buffer);
        if (bytes[0] === 0x1f && bytes[1] === 0x8b) { // gzip container (v1-3)
            const ds = new DecompressionStream('gzip');
            const out = await new Response(new Blob([buffer]).stream().pipeThrough(ds)).arrayBuffer();
            bytes = new Uint8Array(out);
        }
        let dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (dv.getUint32(0, true) !== 0x5053474e) throw new Error('spz: bad magic');
        const version = dv.getUint32(4, true);
        let n, shDegree, fracBits, posB, alphaB, colorB, scaleB, rotB;
        if (version >= 4) {
            // v4 container (VERIFIED against load-spz.cc): 32-byte header
            // {magic u32, version u32, numPoints u32, shDegree u8,
            // fractionalBits u8, flags u8, numStreams u8, tocByteOffset u32,
            // reserved 12B}; TOC at tocByteOffset = numStreams x {u64
            // compressedSize, u64 uncompressedSize}; streams follow the TOC,
            // each independently ZSTD, in order positions, alphas, colors,
            // scales, rotations, sh (only non-empty streams present).
            // ZSTD via the vendored pure-JS fzstd (fourd/vendor/fzstd.umd.js).
            const zstd = (typeof fzstd !== 'undefined') ? fzstd
                : (typeof require === 'function' ? (() => { try { return require('fzstd'); } catch (e) { return null; } })() : null);
            if (!zstd) throw new Error('spz v' + version + ' uses per-stream ZSTD — fzstd not loaded (fourd/vendor/fzstd.umd.js)');
            n = dv.getUint32(8, true);
            shDegree = bytes[12]; fracBits = bytes[13];
            const numStreams = bytes[15];
            const toc = dv.getUint32(16, true);
            const shDim4 = [0, 3, 8, 15][shDegree] || 0;
            const expect = [n * 9, n, n * 3, n * 3, n * 4, n * shDim4 * 3].filter(s => s > 0);
            if (numStreams !== expect.length)
                throw new Error('spz v4: ' + numStreams + ' streams, expected ' + expect.length);
            let dataOff = toc + numStreams * 16;
            const parts = [];
            for (let s = 0; s < numStreams; s++) {
                const cs = Number(dv.getBigUint64(toc + s * 16, true));
                const us = Number(dv.getBigUint64(toc + s * 16 + 8, true));
                const out2 = zstd.decompress(bytes.subarray(dataOff, dataOff + cs));
                if (out2.length !== us) throw new Error('spz v4: stream ' + s + ' decompressed ' + out2.length + ' != ' + us);
                parts.push(out2); dataOff += cs;
            }
            // stitch a flat legacy-style buffer so the decode loop below is shared
            const flat = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
            let fo = 0; for (const p of parts) { flat.set(p, fo); fo += p.length; }
            bytes = flat; dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            let o = 0;
            posB = o; o += n * 9;
            alphaB = o; o += n;
            colorB = o; o += n * 3;
            scaleB = o; o += n * 3;
            rotB = o; o += n * 4;
        } else {
            n = dv.getUint32(8, true);
            shDegree = bytes[12]; fracBits = bytes[13];
            const shDim = [0, 3, 8, 15][shDegree] || 0;
            let o = 16;
            posB = o; o += n * 9;
            alphaB = o; o += n;
            colorB = o; o += n * 3;
            scaleB = o; o += n * 3;
            rotB = o; o += n * (version >= 3 ? 4 : 3);
            // + sh section (n * shDim * 3), read for length check only — DC-only renderer
            if (o + n * shDim * 3 > bytes.length) throw new Error('spz: truncated');
        }
        const out = allocFrame(n);
        const posScale = 1 / (1 << fracBits);
        const INV_SQRT2 = Math.SQRT1_2;
        for (let i = 0; i < n; i++) {
            for (let a = 0; a < 3; a++) {
                const b0 = posB + (i * 3 + a) * 3;
                let f = bytes[b0] | (bytes[b0 + 1] << 8) | (bytes[b0 + 2] << 16);
                if (f & 0x800000) f |= 0xff000000; // sign extend
                out.center[i * 3 + a] = (f | 0) * posScale;
            }
            out.color[i * 4 + 3] = bytes[alphaB + i] / 255;
            for (let a = 0; a < 3; a++)
                out.color[i * 4 + a] = clamp01(0.5 + SH_C0 * ((bytes[colorB + i * 3 + a] / 255 - 0.5) / 0.15));
            const sx = Math.exp(bytes[scaleB + i * 3] / 16 - 10);
            const sy = Math.exp(bytes[scaleB + i * 3 + 1] / 16 - 10);
            const sz = Math.exp(bytes[scaleB + i * 3 + 2] / 16 - 10);
            let qw, qx, qy, qz;
            if (version >= 3) {
                // VERIFIED against load-spz.cc packQuaternionSmallestThree:
                // comp = [iLargest:2][f0:10][f1:10][f2:10], each field =
                // SIGN-MAGNITUDE (negbit<<9 | mag, mag = 511*|q|/sqrt(1/2)),
                // fields in xyzw order skipping the largest, which is made
                // positive. (First cut used 10-bit two's-complement — caught
                // by the reference-CLI cross-check on biker.spz: positions
                // exact, covariance 2.5x off.)
                const w32 = dv.getUint32(rotB + i * 4, true);
                const idx = (w32 >>> 30) & 3;
                const c = [0, 0, 0];
                for (let k = 0; k < 3; k++) {
                    const v = (w32 >>> (20 - k * 10)) & 0x3ff;
                    const mag = ((v & 0x1ff) / 511) * INV_SQRT2;
                    c[k] = (v & 0x200) ? -mag : mag;
                }
                const rest = Math.sqrt(Math.max(0, 1 - c[0] * c[0] - c[1] * c[1] - c[2] * c[2]));
                const q = [0, 0, 0, 0]; // x y z w
                let ci = 0;
                for (let k = 0; k < 4; k++) { if (k === idx) q[k] = rest; else q[k] = c[ci++]; }
                qx = q[0]; qy = q[1]; qz = q[2]; qw = q[3];
            } else {
                qx = bytes[rotB + i * 3] / 127.5 - 1;
                qy = bytes[rotB + i * 3 + 1] / 127.5 - 1;
                qz = bytes[rotB + i * 3 + 2] / 127.5 - 1;
                qw = Math.sqrt(Math.max(0, 1 - qx * qx - qy * qy - qz * qz));
            }
            covFromScaleQuat(sx, sy, sz, qw, qx, qy, qz, out.covA, out.covB, i);
        }
        return out;
    }

    // ---- dispatcher ----------------------------------------------------
    // Sniffs by content first (magic/header), extension second. Async
    // because spz decompresses through DecompressionStream.
    async function parseAny(buffer, name) {
        const lower = (name || '').toLowerCase();
        const head = new Uint8Array(buffer, 0, Math.min(16, buffer.byteLength));
        const isGzip = head[0] === 0x1f && head[1] === 0x8b;
        const magic = head.length >= 4 ? (head[0] | (head[1] << 8) | (head[2] << 16) | (head[3] << 24)) >>> 0 : 0;
        if (lower.endsWith('.ksplat'))
            throw new Error('.ksplat is not supported yet — convert to .ply or .splat (GaussianSplats3D can export both)');
        if (magic === 0x674b || lower.endsWith('.splatv')) return parseSplatv(buffer);
        if (isGzip || magic === 0x5053474e || lower.endsWith('.spz')) return parseSpz(buffer);
        const asText = String.fromCharCode(...head.slice(0, 4));
        if (asText === 'ply\n' || asText.startsWith('ply') || lower.endsWith('.ply')) {
            // SpacetimeGaussians single-file 4D ply carries trbf_center;
            // plain 3DGS ply does not
            const hdr = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 8192)));
            return hdr.includes('trbf_center') ? parseSpacetimePly(buffer) : parsePly(buffer);
        }
        if (lower.endsWith('.splat') || buffer.byteLength % 32 === 0) return parseSplat(buffer);
        throw new Error('unrecognized splat container: ' + name);
    }

    const api = { parseSplat, parsePly, parseSpz, parseSpacetimePly, parseSplatv, parseAny,
                  evalDynamicPositions, flipFrameRDF, SplatCloud, normalizeFrames, allocFrame };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else global.FourDSplats = api;
})(typeof window !== 'undefined' ? window : globalThis);
