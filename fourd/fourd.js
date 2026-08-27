// ============================================================================
// 4DAnyone PORTAL PoC — head-tracked off-axis viewer for a 4DAnyone camera rig
// ============================================================================
// 4DAnyone (ant-research/4DAnyone) turns a monocular human video into an
// N-camera orbit rig of frame-synced videos (cameras.json, OPENCV model, one
// or more pitch layers of yaw-spaced views). This PoC is the CONSUMPTION side:
// it renders that rig behind a moebius-style portal with OUR off-axis spatial
// normalization instead of a mouse orbit.
//
// The two laws carried over from moebius.js:
//
//   1. OFF-AXIS FRUSTUM (frameCorners, the generalized-perspective law): the
//      projection is rebuilt every frame from the live eye against a FIXED
//      portal rect, so portal-plane points are pinned for any eye and
//      behind-portal content shows true window parallax. Ported verbatim
//      from moebius.js frameCorners().
//
//   2. SPATIAL NORMALIZATION OF THE RIG COORDINATE: the rig view direction is
//      the ANGLE THE EYE SUBTENDS AT THE SUBJECT PIVOT —
//         yaw   = atan2(eyeX - pivotX, eyeZ - pivotZ)
//         pitch = atan2(eyeY - pivotY, hypot(dx, dz))
//      No gain constant exists to tune: a head displacement maps to exactly
//      the orbit angle a real object behind the glass would present. The two
//      yaw-adjacent rig views bracketing that angle are blended linearly in
//      angle (single-layer rig: nearest pitch layer wins first).
//
// Data: ?rig=<dir> pointing at a 4DAnyone output folder ('cameras.json' +
// videos/dense/NN.mp4). The mock rig generator (mockrig.js) writes the same
// schema plus a 'frame_sequence' field per camera (PNG frames) because this
// container's chromium has no H.264; the viewer prefers mp4 and falls back
// to the sequence.
// ============================================================================
/* global THREE */
(() => {
    const Q = new URLSearchParams(location.search);
    const RIG_DIR = Q.get('rig') || '/fourd/data/mock';

    // --- portal geometry (world units; the moebius terrarium metaphor) ---
    const PORTAL_H = 1.0;                 // fixed rect height; width follows canvas aspect
    const EYE_Z0 = 1.8;                   // rest eye distance in front of the glass
    // Subject anchor just behind the glass — the moebius placement (content at
    // the portal plane). Deep placement shrinks the visible head range: the
    // sight-line must pass the portal OPENING, |eyeX| < halfW * (eyeZ - pivotZ)
    // / (-pivotZ), which at -0.9 was ±0.84 of head travel before the subject
    // left the window (the first far-left shot: correct physics, black frame).
    const PIVOT = new THREE.Vector3(0, 0, -0.35);

    const canvas = document.getElementById('stage');
    const hud = document.getElementById('hud');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0b0e);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 50);
    camera.position.set(0, 0, EYE_Z0);

    // ------------------------------------------------------------------
    // moebius.js frameCorners(), ported verbatim (Kooima generalized
    // perspective projection: eye + fixed portal rect -> asymmetric frustum).
    // ------------------------------------------------------------------
    const _vr = new THREE.Vector3(), _vu = new THREE.Vector3(), _vn = new THREE.Vector3();
    const _va = new THREE.Vector3(), _vb = new THREE.Vector3(), _vc = new THREE.Vector3();
    const _quat = new THREE.Quaternion(), _vec = new THREE.Vector3();
    function frameCorners(cameraInstance, pa, pb, pc) {
        const pe = cameraInstance.position;
        const n = cameraInstance.near; const f = cameraInstance.far;
        _vr.copy(pb).sub(pa).normalize(); _vu.copy(pc).sub(pa).normalize(); _vn.crossVectors(_vr, _vu).normalize();
        _va.copy(pa).sub(pe); _vb.copy(pb).sub(pe); _vc.copy(pc).sub(pe);
        const d = -_va.dot(_vn);
        if (Math.abs(d) < 0.00001) { return; }
        const l = _vr.dot(_va) * n / d; const r = _vr.dot(_vb) * n / d;
        const b = _vu.dot(_va) * n / d; const t = _vu.dot(_vc) * n / d;
        if (Math.abs(r - l) < 0.00001 || Math.abs(t - b) < 0.00001) { return; }
        _quat.setFromUnitVectors(_vec.set(0, 1, 0), _vu);
        cameraInstance.quaternion.setFromUnitVectors(_vec.set(0, 0, 1).applyQuaternion(_quat), _vn).multiply(_quat);
        cameraInstance.projectionMatrix.set(
            2 * n / (r - l), 0, (r + l) / (r - l), 0,
            0, 2 * n / (t - b), (t + b) / (t - b), 0,
            0, 0, (f + n) / (n - f), 2 * f * n / (n - f),
            0, 0, -1, 0);
        cameraInstance.projectionMatrixInverse.copy(cameraInstance.projectionMatrix).invert();
    }

    // --- portal frame (visible rim so window parallax reads on screen) ---
    let portalW = PORTAL_H;         // set from aspect in resize()
    const rimGroup = new THREE.Group();
    scene.add(rimGroup);
    function buildRim() {
        while (rimGroup.children.length) rimGroup.remove(rimGroup.children[0]);
        const rimMat = new THREE.MeshBasicMaterial({ color: 0x2a2a33 });
        // shadowbox must be DEEPER than the card (pivot z −0.9) or its own
        // back wall occludes the rig — the first shots run rendered exactly
        // that: a full-portal near-black wall in front of everything
        const T = 0.035, D = 1.5;    // rim thickness on the glass, shadowbox depth
        const mk = (w, h, x, y) => {
            const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.01), rimMat);
            m.position.set(x, y, 0.005); rimGroup.add(m);
        };
        mk(portalW + 2 * T, T, 0, PORTAL_H / 2 + T / 2);
        mk(portalW + 2 * T, T, 0, -PORTAL_H / 2 - T / 2);
        mk(T, PORTAL_H, -portalW / 2 - T / 2, 0);
        mk(T, PORTAL_H, portalW / 2 + T / 2, 0);
        const wallMat = new THREE.MeshBasicMaterial({ color: 0x1c1c24, side: THREE.BackSide });
        const box = new THREE.Mesh(new THREE.BoxGeometry(portalW, PORTAL_H, D), wallMat);
        box.position.set(0, 0, -D / 2);
        rimGroup.add(box);
        const backMat = new THREE.MeshBasicMaterial({ color: 0x101016 });
        const back = new THREE.Mesh(new THREE.PlaneGeometry(portalW * 2.2, PORTAL_H * 2.2), backMat);
        back.position.set(0, 0, -1.45);
        rimGroup.add(back);
    }

    // --- rig card: one quad at the pivot, shader-blended between two views ---
    const cardMat = new THREE.ShaderMaterial({
        uniforms: {
            texA: { value: null }, texB: { value: null }, w: { value: 0 },
            u_hasB: { value: 0 }
        },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `
            uniform sampler2D texA; uniform sampler2D texB;
            uniform float w; uniform float u_hasB;
            varying vec2 vUv;
            void main() {
                vec4 a = texture2D(texA, vUv);
                vec4 b = texture2D(texB, vUv);
                gl_FragColor = (u_hasB > 0.5) ? mix(a, b, w) : a;
            }`,
        transparent: false
    });
    let card = null;

    // --- rig state ---
    const rig = { layers: [], cams: [], fps: 12, frames: 0, radius: 1, ready: false };
    const state = { yawDeg: 0, pitchDeg: 0, a: -1, b: -1, w: 0, frame: 0, clamped: false };
    window._fourdState = state;

    const num = (v) => (typeof v === 'number' ? v : parseFloat(v));
    function parseK(K) {
        // accepts 3x3 nested or flat 9
        const flat = Array.isArray(K[0]) ? K.flat() : K;
        return { fx: num(flat[0]), fy: num(flat[4]), cx: num(flat[2]), cy: num(flat[5]) };
    }
    function parseC2W(m) {
        // accepts 4x4 / 3x4 nested or flat 16 / 12; returns camera position
        const flat = Array.isArray(m[0]) ? m.flat() : m;
        if (flat.length >= 12) return new THREE.Vector3(num(flat[3]), num(flat[7]), num(flat[11]));
        return new THREE.Vector3(0, 0, 1);
    }

    async function loadRig() {
        const res = await fetch(RIG_DIR + '/cameras.json');
        const j = await res.json();
        const cams = j.cameras.map((c) => ({
            id: c.camera_id, layer: c.layer_index, pitch: num(c.pitch), yaw: num(c.yaw),
            K: parseK(c.K), w: c.image_width, h: c.image_height,
            pos: parseC2W(c.camera_to_world),
            video: c.video, seq: c.frame_sequence || null,
            textures: null, videoEl: null, videoTex: null
        }));
        rig.cams = cams;
        rig.radius = cams.reduce((s, c) => s + c.pos.length(), 0) / cams.length || 1;
        const layerIdx = [...new Set(cams.map((c) => c.layer))].sort((x, y) => x - y);
        rig.layers = layerIdx.map((li) => ({
            pitch: cams.find((c) => c.layer === li).pitch,
            cams: cams.filter((c) => c.layer === li).sort((x, y) => x.yaw - y.yaw)
        }));
        // frame source: mp4 <video> when playable, else PNG sequence
        const probe = document.createElement('video');
        const canMp4 = probe.canPlayType && probe.canPlayType('video/mp4; codecs="avc1.42E01E"') !== '';
        await Promise.all(cams.map(async (c) => {
            if (c.seq && (!canMp4 || Q.get('seq') === '1')) {
                rig.frames = c.seq.count;
                rig.fps = c.seq.fps || 12;
                c.textures = new Array(c.seq.count).fill(null);
                await Promise.all(Array.from({ length: c.seq.count }, (_, f) => new Promise((ok) => {
                    const im = new Image();
                    im.onload = () => {
                        const t = new THREE.Texture(im);
                        t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
                        t.needsUpdate = true; c.textures[f] = t; ok();
                    };
                    im.onerror = () => ok();
                    im.src = RIG_DIR + '/' + c.seq.dir + '/' + String(f).padStart(3, '0') + '.png';
                })));
            } else {
                const v = document.createElement('video');
                v.muted = true; v.loop = true; v.playsInline = true;
                v.src = RIG_DIR + '/' + c.video;
                c.videoEl = v;
                c.videoTex = new THREE.VideoTexture(v);
                c.videoTex.minFilter = THREE.LinearFilter;
                await v.play().catch(() => {});
            }
        }));
        // card size: the captured frustum's extent at the pivot distance —
        // height = R * imgH / fy — so the subject keeps its rig-metric size.
        const c0 = cams[0];
        const cardH = rig.radius * c0.h / c0.K.fy;
        const cardW = rig.radius * c0.w / c0.K.fx;
        card = new THREE.Mesh(new THREE.PlaneGeometry(cardW, cardH), cardMat);
        // scale the rig's metric card into the portal: fit card height to a
        // fixed fraction of the portal (the ONE presentation choice; not a
        // physics constant — the rig has no metric link to the portal rect)
        const s = (PORTAL_H * 0.92) / cardH;
        card.scale.set(s, s, s);
        card.position.copy(PIVOT);
        scene.add(card);
        rig.ready = true;
        window._fourdDebug = { rig, card, cardMat, scene, renderer, camera: () => camera };
    }

    // --- eye control: pointer = head, wheel = approach ---
    const eye = new THREE.Vector3(0, 0, EYE_Z0);
    let dragging = false, px0 = 0, py0 = 0, ex0 = 0, ey0 = 0;
    canvas.addEventListener('pointerdown', (e) => { dragging = true; px0 = e.clientX; py0 = e.clientY; ex0 = eye.x; ey0 = eye.y; });
    window.addEventListener('pointerup', () => { dragging = false; });
    window.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        // full canvas drag sweeps the eye across ±1.6 portal heights
        eye.x = ex0 + (e.clientX - px0) / canvas.clientWidth * 3.2;
        eye.y = ey0 - (e.clientY - py0) / canvas.clientHeight * 2.0;
    });
    window.addEventListener('wheel', (e) => {
        eye.z = Math.min(4.0, Math.max(0.7, eye.z + e.deltaY * 0.001));
    }, { passive: true });
    window._fourdSetEye = (x, y, z) => { eye.set(x, y, z); };
    window._fourdPivot = () => ({ x: PIVOT.x, y: PIVOT.y, z: PIVOT.z });
    // harness probe: NDC of a world point through the live off-axis camera
    window._fourdProject = (x, y, z) => {
        const v = new THREE.Vector3(x, y, z).project(camera);
        return { x: v.x, y: v.y };
    };

    function pickViews() {
        const dx = eye.x - PIVOT.x, dy = eye.y - PIVOT.y, dz = eye.z - PIVOT.z;
        state.yawDeg = Math.atan2(dx, dz) * 180 / Math.PI;
        state.pitchDeg = Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI;
        let layer = rig.layers[0];
        for (const L of rig.layers) if (Math.abs(L.pitch - state.pitchDeg) < Math.abs(layer.pitch - state.pitchDeg)) layer = L;
        const cams = layer.cams;
        let a = cams[0], b = null, w = 0;
        state.clamped = false;
        if (state.yawDeg <= cams[0].yaw) { a = cams[0]; state.clamped = cams.length > 1; }
        else if (state.yawDeg >= cams[cams.length - 1].yaw) { a = cams[cams.length - 1]; state.clamped = cams.length > 1; }
        else {
            for (let i = 0; i < cams.length - 1; i++) {
                if (state.yawDeg >= cams[i].yaw && state.yawDeg <= cams[i + 1].yaw) {
                    a = cams[i]; b = cams[i + 1];
                    w = (state.yawDeg - a.yaw) / Math.max(1e-6, b.yaw - a.yaw);
                    break;
                }
            }
        }
        state.a = a.id; state.b = b ? b.id : -1; state.w = w;
        return { a, b, w };
    }

    function texFor(c, frame) {
        if (c.textures) return c.textures[frame] || c.textures[0];
        return c.videoTex;
    }

    const t0 = performance.now();
    function tick() {
        requestAnimationFrame(tick);
        if (!rig.ready) return;
        camera.position.copy(eye);
        const hw = portalW / 2, hh = PORTAL_H / 2;
        frameCorners(camera,
            new THREE.Vector3(-hw, -hh, 0),
            new THREE.Vector3(hw, -hh, 0),
            new THREE.Vector3(-hw, hh, 0));
        const { a, b, w } = pickViews();
        state.frame = rig.frames ? Math.floor((performance.now() - t0) / 1000 * rig.fps) % rig.frames : 0;
        cardMat.uniforms.texA.value = texFor(a, state.frame);
        cardMat.uniforms.texB.value = b ? texFor(b, state.frame) : null;
        cardMat.uniforms.w.value = w;
        cardMat.uniforms.u_hasB.value = b ? 1 : 0;
        // the card faces the eye THROUGH the pivot: the blended image was
        // captured from (approximately) the direction the eye now occupies,
        // so it must present perpendicular to that direction
        card.lookAt(eye);
        renderer.render(scene, camera);
        hud.textContent =
            'eye(' + eye.x.toFixed(2) + ', ' + eye.y.toFixed(2) + ', ' + eye.z.toFixed(2) + ')  ' +
            'yaw=' + state.yawDeg.toFixed(1) + '° pitch=' + state.pitchDeg.toFixed(1) + '°\n' +
            'views ' + state.a + (state.b >= 0 ? ' ↔ ' + state.b + '  w=' + state.w.toFixed(2) : '') +
            (state.clamped ? '  [RIG EDGE]' : '') + '  frame ' + state.frame + '\n' +
            'drag = move head · wheel = approach';
        window._fourdRendered = (window._fourdRendered || 0) + 1;
    }

    function resize() {
        const w = window.innerWidth, h = window.innerHeight;
        renderer.setSize(w, h, false);
        portalW = PORTAL_H * (w / h);
        buildRim();
    }
    window.addEventListener('resize', resize);
    resize();
    loadRig().then(() => { hud.textContent = 'rig ready'; }).catch((e) => {
        hud.textContent = 'rig load failed: ' + e.message;
    });
    tick();
})();
