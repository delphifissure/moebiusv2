// -----------------------------------------------------------------------------
// --- GLOBAL CONFIGURATION & CONSTANTS ----------------------------------------
// -----------------------------------------------------------------------------

// --- Video & Media ---
let videoMode = "separated"; // Default mode: "separated" or "sidebyside"
let separatedVideoRGB = null; // Legacy, used for default load
let separatedVideoDepth = null; // Legacy, used for default load
const octopusImgGlobal = new Image(); // Legacy, used for default load
const octopusDepthGlobal = new Image(); // Legacy, used for default load
const videoContentElementGlobal = document.createElement('video'); // Legacy, used for default load
videoContentElementGlobal.autoplay = true; videoContentElementGlobal.loop = true; videoContentElementGlobal.muted = true; videoContentElementGlobal.playsInline = true;
const defaultRgbVideoCoords = { x: 0, y: 0, width: 960, height: 540 };
const defaultDepthMapCoords = { x: 960, y: 0, width: 960, height: 540 };

// --- NEW: Multi-Layer System ---
let mediaLayers = []; // This is the new source of truth
let stagedMediaLayers = []; // NEW: For modal editing
let nextLayerId = 0;
let isApplyingLayers = false; // Flag to prevent concurrent apply operations
// --- FIX: Load Session Tracking ---
let currentLoadSessionId = 0;
// --- FIX: Track current Render Target dimensions ---
let currentRTWidth = 0;
let currentRTHeight = 0;
let useSolidBackground = false;
let solidBackgroundColor = new THREE.Color(0x000000);

let thumbnailUrlsToRevoke = []; // NEW: For Object URL cleanup
let activeVideoUrls = []; // NEW: Track video blob URLs that must persist
let fileStorage = new Map(); // NEW: Temporary storage for File objects while modal is open

// --- NEW: Render Lock for Safe Clearing ---
let isClearing = false;

// --- NEW: Gap Accumulation / Baking ---
let isAccumulatingGaps = false;  // True when "live sweep" is active
let useStaticInfillAtlas = false; // True when baked atlas is active
let isSweeping = false;           // Master lock for automated sweeps
let infillAtlasMesh = null;       // The static mesh for the baked atlas

// Targets (will be initialized in initializeSceneAndRenderer)
let masterGapTarget, infillAtlasTarget_Color, infillAtlasTarget_Depth;

// Materials (will be initialized in initializeSceneAndRenderer)
let additiveBlendMaterial, feedbackOverlayMaterial, gapMaskExtractorMaterial, maskGeneratorDepthMaterial;
// NEW: Ground Truth Accumulation Materials
let groundTruthColorAccumulatorMaterial, groundTruthDepthAccumulatorMaterial;

// Sweep animation state
let isContinuousSweeping = false;
let sweepStartTime = 0;
let sweepOrigCamPos = new THREE.Vector3();
let sweepHAngle = 0;
let sweepVAngle = 0;

// --- Camera & Scene Parameters ---
let dollyZoomActive = false;
let subjectLockActive = true; // Set to true by default
let dollyZoomTime = 0;
const dollyZoomSpeed = 0.0005;
let initialFov = 75; // This is now a baseline that can be overridden by intrinsics
let subjectLockConstantK = 0;
const dollyMinDistance = 0.05;
const dollyMaxDistance = 0.35;

let portalPlaneWorldZ = 0.0;
let innerVolumeDepth = 0.04; // New, subtler default
let outerVolumeDepth = 0.02; // New, subtler default
let subjectFocalPlaneWorldZ = 0.0;
let currentNormPortalPlane = 0.5;
let currentLinearDepthTolerance = 0.03;
let currentDepthWeightPower = 1.0; // <-- ADD THIS LINE
let currentFillKernelSize = 3;

const terrariumWidth = 0.16;
const terrariumHeight = 0.09;
let contentAspectRatio = 960 / 540; // Aspect ratio of the media content

// ADDED: New variables for metric scaling
let metricScaleFactor = 1.0; // This will convert virtual units to meters
let setScaleModeActive = false;
let scaleFirstPoint = null;
let scaleFirstPointScreen = null;
let physicalScreenDiagonalInches = 15.6;


// -----------------------------------------------------------------------------
// --- 1. UPDATED GLOBAL CONFIGURATION (INPAINTING SECTION) --------------------
// -----------------------------------------------------------------------------

// --- Inpainting / Multi-Pass Rendering ---
let useInpainting = true;
let currentInpaintingMethod = 'pullpush'; // 'jfa', 'dilation', 'pullpush', or 'displacement'
let currentEdgeMethod = 'hybrid';
let dilationIterations = 16; // NEW: Control for dilation passes
let jfaSeedDensity = 0.25;
// --- START: MODIFICATION ---
let currentInpaintingSplitDepthNorm = 0.5; // NEW: FG/BG split point
// --- END: MODIFICATION ---

// --- START: NEW TUNING GLOBALS ---
let maxPyramidLevels = 10;
let useHighQualityFill = false;
let pullMaterialDepthAware_9tap; // Will hold the new 9-tap shader
// --- END: NEW TUNING GLOBALS ---

// Render Targets
let sceneRenderTarget; // Holds the CLEAN pass (Color and Depth)
let edgeMaskRenderTarget, lumaRenderTarget, blurRenderTarget, gradientRenderTarget, nmsRenderTarget;
let jfaPingTarget, jfaPongTarget;
// pingPongRenderTargetA is a utility buffer
// pingPongRenderTargetB holds the GAPPED pass
let pingPongRenderTargetA, pingPongRenderTargetB;
// Pull-Push Pyramid Targets
let pullPyramidTargets = [];
let pushPyramidTargets = [];

let stabilizedEdgeMaskTarget; // Will hold the final, stable mask
let prevEdgeMaskTarget;       // Will hold the mask from the last frame
let temporalStabilizeMaterial;
let temporalFeedback = 0.9;   // How much of the last frame to keep (0=off, 0.9=smooth)

// This string will be injected into cloned materials
const secondaryDepthFragmentShader = `
    uniform sampler2D tPrimaryDepth;
    uniform float u_epsilon;
    uniform float u_objectID;
    uniform vec2 u_resolution;
    // These varyings are passed by the primary vertex shader
    varying vec2 vUv;
    varying float vNormalizedDepth;
    
    void main() {
        // Use texel-center-corrected UV
        vec2 screenUv = (gl_FragCoord.xy + 0.5) / u_resolution;
        float primaryDepth = texture2D(tPrimaryDepth, screenUv).r;
        float currentDepth = gl_FragCoord.z;
        
        // Only write if we're BEHIND the primary surface
        if (currentDepth <= primaryDepth + u_epsilon) {
            discard;
        }
        
        // Write: [depth, objectID, normalized depth from texture, validity flag]
        gl_FragColor = vec4(currentDepth, u_objectID, vNormalizedDepth, 1.0);
    }
`;

// Depth Peeling Feature Toggle
let useFidelityCheck = false; // Master toggle for depth peeling

// Depth Peeling Render Targets
let primaryRenderTarget = null;      // RGBA + Depth (front surfaces)
let secondaryDepthTarget = null;     // RGBA32F (depth + objectID of back surfaces)
let fidelityMaskTarget = null;       // R8 (clean gap mask from comparison)

// Depth Peeling Shader Materials
// let secondaryDepthMaterial = null; // <-- DELETED
let fidelityComparisonMaterial = null;

// Depth Peeling Parameters (tunable via UI)
let depthGradientThreshold = 0.01;   // Threshold for detecting stretch
let depthCliffThreshold = 0.02;      // Minimum depth difference for cliff
let minGapWidth = 2.0;                // Pixels, for edge coherence
let secondaryDepthEpsilon = 0.0001;  // Tolerance for depth peeling

// --- END: ADDED/MODIFIED FIDELITY CHECK GLOBALS ---

// NEW: FG/BG Targets
let layerMaskTarget;
let fgInpaintedTarget, bgInpaintedTarget;
let layerMaskMaterial, finalCompositeMaterial;

// Materials
let lumaMaterial, sobelEdgeMaterial, combineEdgesMaterial, gaussianBlurMaterial, sobelGradientMaterial, nmsMaterial, hysteresisMaterial, normalizeDepthMaterial, debugEdgeMaskMaterial, legacyEdgeMaskMaterial, edgeDilationMaterial;
let jfaSeedMaterial, jfaFloodMaterial, jfaResolveMaterial;
let debugGapsMaterial, debugJfaMaterial, debugDepthMaterial, debugJfaToleranceMaterial, debugJfaDepthCompareMaterial;
let dilationMaterial, copyMaterial;
// Pull-Push Materials
let pullMaterial, pushMaterial, maskGeneratorMaterial, pullMaterialDepthAware;

let ditherMaterial; // This is the old, full-screen dither material
let ditherCompositeMaterial; // NEW: The selective dither material
let ditherStrength = 0.0; // Controlled by slider

let finalRenderPassTarget; // This will hold the anti-aliased image
let fxaaMaterial;
let sharpenMaterial;
let sharpenTarget; // This will hold the sharpened image
let sharpenStrength = 1.0; // Default strength
let useAntiAliasing = true; // Default to on

// Common Post-Processing
let postProcessScene, postProcessCamera;


// --- Non-linear Displacement Gap Threshold (Legacy Method) ---
const GAP_SLIDER_RAW_MIN = 0;
const GAP_SLIDER_RAW_MAX = 5000;
const GAP_SLIDER_EFFECTIVE_MAX = 1.0; // FIX: Changed back to 1.0
const GAP_SLIDER_CURVE_POWER = 5.0; // FIX: Matched old curve
let currentDisplacementGapThreshold = mapGapThreshold(1000);


// --- Edge Tuning ---
let edgeThreshold = 0.1;
let depthContrastRange = 0.1;
let edgeDilationRadius = 1.5;


// --- Face Tracking ---
let latestDetectedFaceX = 0.5;
let latestDetectedFaceY = 0.5;
let baselineFaceTrackerOffsetX = 0;
let baselineFaceTrackerOffsetY = 0;
let initialBaselinePending = true;

// --- Face Tracking Smoothing Parameters ---
let smoothedFaceX_global = 0.5;
let smoothedFaceY_global = 0.5;
const faceSmoothingFactor = 0.6;


// --- Depth Peeking ---
let depthPeekActive = false;
let depthPeekValue = 0.5;
let depthPeekTolerance = 0.02;
let isDraggingDepth = false; // <-- ADD THIS
let didDrag = false;         // <-- ADD THIS
let isDraggingSplit = false; // <-- ADD THIS LINE

// --- Mesh Detail ---
const MESH_DENSITY_FACTOR = 1.0;

// --- Debug Info ---
let lastFpsTime = 0;
let frameCounter = 0;
let fpsDisplayElement, actualVerticesDisplayElement, optimalVerticesDisplayElement, sourceResolutionDisplayElement;
let currentSourceWidthForOptimalCalc = 0;
let currentSourceHeightForOptimalCalc = 0;
let optimalCalculationInterval;

// --- THREE.js Math Instances (Global for reuse) ---
const _va = new THREE.Vector3(), _vb = new THREE.Vector3(), _vc = new THREE.Vector3(),
      _vr = new THREE.Vector3(), _vu = new THREE.Vector3(), _vn = new THREE.Vector3(),
      _vec = new THREE.Vector3(), _quat = new THREE.Quaternion();

// --- Global DOM Element References ---
let videoInput, canvasElement, transformDiv, controlsDiv, buttonContainer, mainContentElement;
let facetrackingScalarSlider, facetrackingScalarInput, facetrackingScalarValue;
let normPortalSliderHTML, normPortalValueHTML;
let scene, camera, renderer, octopusMesh, wireframeCubes = []; // octopusMesh is now legacy, kept for default loads
let portalPlaneGuide, innerVolumeGuide, outerVolumeGuide;

// --- MediaPipe Globals ---
let faceMeshDetector;
let offscreenCanvas;
let offscreenCtx;
let faceOverlayCanvas, faceOverlayCtx;

// Canvas for querying depth values on click
let depthQueryCanvas, depthQueryCtx;
let depthReadbackRequest = { x: 0, y: 0, requested: false };
let isSettingSplitPlane = false; // To control the popup
let depthColorTarget;
let depthToColorMaterial;

// --- Gyro / Device Orientation ---
let isIOS = false;
let gyroActive = false;
let deviceOrientationPermissionGranted = false;
let currentGyroAlpha = 0, currentGyroBeta = 0, currentGyroGamma = 0;
let initialGyroAlpha = null, initialGyroBeta = null, initialGyroGamma = null;
let gyroSensitivityX = 0.0015;
let gyroSensitivityY = 0.0015;
let gyroEnableButton = null;
let calibrateGyroButton = null;
let gyroSensitivityXSlider = null;
let gyroSensitivityYSlider = null;

// --- Quaternion-based orientation variables ---
const initialQuaternionInverse = new THREE.Quaternion();
const currentQuaternion = new THREE.Quaternion();
const deltaQuaternion = new THREE.Quaternion();
const euler = new THREE.Euler();
const radianToDegreeFactor = 180 / Math.PI;

// --- START: NEW GLOBAL HELPER FUNCTION ---
/**
 * Helper function to set a uniform value on all active media layers.
 */
function setAllLayerUniforms(key, value) {
    for (const layer of mediaLayers) {
        // Check if it's a ShaderMaterial with uniforms before accessing
        if (layer.mesh && layer.mesh.material && layer.mesh.material.uniforms && layer.mesh.material.uniforms[key]) {
            layer.mesh.material.uniforms[key].value = value;
        }
    }
}
// --- END: NEW GLOBAL HELPER FUNCTION ---
// ===================================================================
// START: NEW HELPER FUNCTION
// (Add this after setAllLayerUniforms, around line 348)
// ===================================================================
/**
 * Helper function to get all active <video> elements from media layers.
 */
function getAllVideoElements() {
    let videos = [];
    for (const layer of mediaLayers) {
        if (layer.elements) {
            if (layer.elements.color && layer.elements.color.tagName === 'VIDEO') {
                videos.push(layer.elements.color);
            }
            if (layer.elements.depth && layer.elements.depth.tagName === 'VIDEO') {
                videos.push(layer.elements.depth);
            }
            if (layer.elements.alpha && layer.elements.alpha.tagName === 'VIDEO') {
                videos.push(layer.elements.alpha);
            }
        }
    }
    // Remove duplicates if the same video is used for multiple channels
    return [...new Set(videos)];
}
// ===================================================================
// END: NEW HELPER FUNCTION
// ===================================================================
// -----------------------------------------------------------------------------
// --- UTILITY FUNCTIONS -------------------------------------------------------
// -----------------------------------------------------------------------------

function mapGapThreshold(rawValue) {
    const normalizedRaw = parseFloat(rawValue) / GAP_SLIDER_RAW_MAX;
    const mappedNormalized = Math.pow(normalizedRaw, GAP_SLIDER_CURVE_POWER);
    return mappedNormalized * GAP_SLIDER_EFFECTIVE_MAX;
}

function frameCorners(cameraInstance, bottomLeftCorner, bottomRightCorner, topLeftCorner) {
  const pa = bottomLeftCorner, pb = bottomRightCorner, pc = topLeftCorner;
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
    2*n/(r-l),0,(r+l)/(r-l),0,
    0,2*n/(t-b),(t+b)/(t-b),0,
    0,0,(f+n)/(n-f),2*f*n/(n-f),
    0,0,-1,0);
  cameraInstance.projectionMatrixInverse.copy(cameraInstance.projectionMatrix).invert();
}

// MODIFIED: This function now uses HalfFloatType... and checks dimensions before re-initializing.
function initializePyramidTargets(width, height) {
    // FIX: Check if initialization is actually needed. Prevents GPU race condition.
    if (pullPyramidTargets.length > 0 && currentRTWidth === width && currentRTHeight === height) {
        // Dimensions match, reuse existing targets.
        return;
    }

    // Dispose existing targets if they exist (dimensions changed or first run)
    if (pullPyramidTargets) {
        pullPyramidTargets.forEach(target => target.dispose());
    }
    if (pushPyramidTargets) {
        pushPyramidTargets.forEach(target => target.dispose());
    }

    pullPyramidTargets = [];
    pushPyramidTargets = [];

    let currentWidth = width;
    let currentHeight = height;

    // Common options including HalfFloatType to prevent precision loss.
    const commonOptions = {
         format: THREE.RGBAFormat,
         type: THREE.HalfFloatType,
         stencilBuffer: false,
         depthBuffer: false
    };

    // PULL Targets: Must use Nearest filtering for the manual weighted averaging in the pull shader.
    const pullOptions = {
        ...commonOptions,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
    };

    // PUSH Targets: Must use Linear filtering for smooth interpolation during the upsampling phase.
    const pushOptions = {
        ...commonOptions,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
    };


    // Create the pyramid levels
    while (currentWidth >= 1 && currentHeight >= 1) {
        // Use Math.ceil to handle odd resolutions correctly during downsampling
        const w = Math.ceil(currentWidth);
        const h = Math.ceil(currentHeight);

        // Use the specific options for each target type
        const pullTarget = new THREE.WebGLRenderTarget(w, h, pullOptions);
        const pushTarget = new THREE.WebGLRenderTarget(w, h, pushOptions);

        pullPyramidTargets.push(pullTarget);
        pushPyramidTargets.push(pushTarget);

        // Stop if we reach 1x1
        if (currentWidth <= 1 && currentHeight <= 1) break;

        currentWidth /= 2;
        currentHeight /= 2;
    }
    
    // FIX: Update tracked dimensions (Add this before the final console.log)
    currentRTWidth = width;
    currentRTHeight = height;
    
    console.log(`Pull-Push Pyramids initialized with ${pullPyramidTargets.length} levels.`);
}

// -----------------------------------------------------------------------------
// --- 2. UPDATED FUNCTION: resizeRendererAndTargets ---------------------------
// -----------------------------------------------------------------------------

/**
 * Resizes the main renderer, camera, and all offscreen render targets.
 */
function resizeRendererAndTargets(width, height) {
    // --- START FIX: Add a robust guard clause ---
    // This prevents the 0x0 race condition from the ResizeObserver
    if (!width || !height || width <= 0 || height <= 0) {
        // console.warn(`resizeRendererAndTargets: Ignoring invalid 0x0 resize.`);
        return; // Do nothing if dimensions are invalid
    }
    // --- END FIX ---

    // Update main renderer's drawing buffer size
    renderer.setSize(width, height);

    if (renderer.domElement) {
        renderer.domElement.style.width = `${width}px`;
        renderer.domElement.style.height = `${height}px`;
    }

    // COMMENTED OUT: Don't change camera aspect based on content!
    // Each layer has its own geometry-based aspect ratio.
    // Camera aspect should stay fixed to frame aspect (terrariumWidth/terrariumHeight = 16:9)
    // camera.aspect = width / height;
    // camera.updateProjectionMatrix();

    // Update all offscreen render targets
    if (sceneRenderTarget) sceneRenderTarget.setSize(width, height);
    if (edgeMaskRenderTarget) edgeMaskRenderTarget.setSize(width, height);
    if (stabilizedEdgeMaskTarget) stabilizedEdgeMaskTarget.setSize(width, height);
    if (prevEdgeMaskTarget) prevEdgeMaskTarget.setSize(width, height);
    if (lumaRenderTarget) lumaRenderTarget.setSize(width, height);
    if (blurRenderTarget) blurRenderTarget.setSize(width, height);
    if (gradientRenderTarget) gradientRenderTarget.setSize(width, height);
    if (nmsRenderTarget) nmsRenderTarget.setSize(width, height);
    if (jfaPingTarget) jfaPingTarget.setSize(width, height);
    if (jfaPongTarget) jfaPongTarget.setSize(width, height);
    if (pingPongRenderTargetA) pingPongRenderTargetA.setSize(width, height);
    if (pingPongRenderTargetB) pingPongRenderTargetB.setSize(width, height);

    // --- START: MODIFICATION ---
    // NEW: Resize FG/BG targets
    if (layerMaskTarget) layerMaskTarget.setSize(width, height);
    if (fgInpaintedTarget) fgInpaintedTarget.setSize(width, height);
    if (bgInpaintedTarget) bgInpaintedTarget.setSize(width, height);
    if (depthColorTarget) depthColorTarget.setSize(width, height);
    // --- END: MODIFICATION ---
    
    // --- NEW: Resize Gap Accumulation Targets ---
    if (masterGapTarget) masterGapTarget.setSize(width, height);
    if (infillAtlasTarget_Color) infillAtlasTarget_Color.setSize(width, height);
    if (infillAtlasTarget_Depth) infillAtlasTarget_Depth.setSize(width, height);
    // --- END: NEW ---

    if (finalInpaintedTextureTarget) finalInpaintedTextureTarget.setSize(width, height);
    if (finalRenderPassTarget) finalRenderPassTarget.setSize(width, height);
    if (fxaaMaterial) fxaaMaterial.uniforms.resolution.value.set(1.0 / width, 1.0 / height);
    if (sharpenTarget) sharpenTarget.setSize(width, height);
    if (sharpenMaterial) sharpenMaterial.uniforms.resolution.value.set(1.0 / width, 1.0 / height);

    // Update resolution uniform in shaders that need it
    const resolutionVec = new THREE.Vector2(width, height);
    if (sobelEdgeMaterial && sobelEdgeMaterial.uniforms.u_resolution) sobelEdgeMaterial.uniforms.u_resolution.value.copy(resolutionVec);
    if (gaussianBlurMaterial && gaussianBlurMaterial.uniforms.u_resolution) gaussianBlurMaterial.uniforms.u_resolution.value.copy(resolutionVec);
    if (sobelGradientMaterial && sobelGradientMaterial.uniforms.u_resolution) sobelGradientMaterial.uniforms.u_resolution.value.copy(resolutionVec);
    if (nmsMaterial && nmsMaterial.uniforms.u_resolution) nmsMaterial.uniforms.u_resolution.value.copy(resolutionVec);
    if (hysteresisMaterial && hysteresisMaterial.uniforms.u_resolution) hysteresisMaterial.uniforms.u_resolution.value.copy(resolutionVec);
    if (jfaSeedMaterial && jfaSeedMaterial.uniforms.u_resolution) jfaSeedMaterial.uniforms.u_resolution.value.copy(resolutionVec);
    if (jfaFloodMaterial && jfaFloodMaterial.uniforms.u_resolution) jfaFloodMaterial.uniforms.u_resolution.value.copy(resolutionVec);
    if (jfaResolveMaterial && jfaResolveMaterial.uniforms.u_resolution) jfaResolveMaterial.uniforms.u_resolution.value.copy(resolutionVec);
    if (dilationMaterial && dilationMaterial.uniforms.u_resolution) dilationMaterial.uniforms.u_resolution.value.copy(resolutionVec);
    if (legacyEdgeMaskMaterial && legacyEdgeMaskMaterial.uniforms.u_resolution) legacyEdgeMaskMaterial.uniforms.u_resolution.value.copy(resolutionVec);
    if (edgeDilationMaterial && edgeDilationMaterial.uniforms.u_resolution) edgeDilationMaterial.uniforms.u_resolution.value.copy(resolutionVec);

    // NEW: Re-initialize Pull-Push Pyramids
    initializePyramidTargets(width, height);

    // MODIFIED: Update all layers
    for (const layer of mediaLayers) {
        if (layer.mesh && layer.mesh.material.uniforms.u_resolution) {
            layer.mesh.material.uniforms.u_resolution.value.copy(resolutionVec);
        }
    }
}

// -----------------------------------------------------------------------------
// --- GYROSCOPE / DEVICE ORIENTATION FUNCTIONS --------------------------------
// -----------------------------------------------------------------------------

function handleDeviceOrientation(event) {
    if (!event.alpha && !event.beta && !event.gamma && event.alpha !==0 && event.beta !== 0 && event.gamma !== 0) {
        console.warn("DeviceOrientationEvent fired with null data. Gyro might not be available or calibrated correctly.");
        return;
    }
    currentGyroAlpha = event.alpha;
    currentGyroBeta = event.beta;
    currentGyroGamma = event.gamma;

    const gyroDebug = document.getElementById('gyroDebugInfo');
    if (gyroDebug) {
        gyroDebug.textContent = `Alpha: ${currentGyroAlpha?.toFixed(1)}, Beta: ${currentGyroBeta?.toFixed(1)}, Gamma: ${currentGyroGamma?.toFixed(1)}`;
    }
}

function calibrateGyro() {
    if (currentGyroBeta === null || typeof currentGyroBeta !== 'number') {
        if (gyroActive) {
            alert("No valid gyro data yet. Please move your device slightly if enabled, or ensure it's supported.");
        }
        return;
    }

    const alphaRad = THREE.MathUtils.degToRad(currentGyroAlpha);
    const betaRad = THREE.MathUtils.degToRad(currentGyroBeta);
    const gammaRad = THREE.MathUtils.degToRad(currentGyroGamma);

    const tempEuler = new THREE.Euler(betaRad, alphaRad, -gammaRad, 'YXZ');
    initialQuaternionInverse.setFromEuler(tempEuler).invert();

    console.log("Gyro calibrated with quaternion.");
    if (calibrateGyroButton) calibrateGyroButton.textContent = "Recalibrate Gyro (Calibrated!)";
}

function requestDeviceOrientationPermission() {
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
            .then(permissionState => {
                if (permissionState === 'granted') {
                    window.addEventListener('deviceorientation', handleDeviceOrientation, true);
                    deviceOrientationPermissionGranted = true;
                    gyroActive = true;
                    if (gyroEnableButton) {
                        gyroEnableButton.textContent = 'Disable Gyro (Enabled)';
                        gyroEnableButton.style.backgroundColor = '';
                        gyroEnableButton.style.color = '';
                        gyroEnableButton.style.fontWeight = '';
                    }
                    if (calibrateGyroButton) calibrateGyroButton.disabled = false;
                    if (gyroSensitivityXSlider) gyroSensitivityXSlider.disabled = false;
                    if (gyroSensitivityYSlider) gyroSensitivityYSlider.disabled = false;
                    setTimeout(calibrateGyro, 500);
                } else {
                    const modal = document.getElementById('gyroInstructionsModalOverlay');
                    if (modal) {
                        modal.style.display = 'flex';
                    }
                    if (gyroEnableButton) {
                        gyroEnableButton.textContent = 'Enable Gyro (Denied)';
                        gyroEnableButton.style.backgroundColor = '#dc3545';
                    }
                }
            })
            .catch(error => {
                console.error('Device orientation permission request error:', error);
                alert('Error requesting device orientation permission. Your browser or device might not support this feature or it might be blocked.');
                if (gyroEnableButton) gyroEnableButton.textContent = 'Enable Gyro (Error)';
            });
    } else {
        window.addEventListener('deviceorientation', handleDeviceOrientation, true);
        deviceOrientationPermissionGranted = true;
        gyroActive = true;
        if (gyroEnableButton) gyroEnableButton.textContent = 'Disable Gyro (Enabled)';
        if (calibrateGyroButton) calibrateGyroButton.disabled = false;
        if (gyroSensitivityXSlider) gyroSensitivityXSlider.disabled = false;
        if (gyroSensitivityYSlider) gyroSensitivityYSlider.disabled = false;
        setTimeout(calibrateGyro, 500);
    }
}

function toggleGyroActivation() {
    if (!isIOS && !(typeof DeviceOrientationEvent !== 'undefined')) {
        alert("Device orientation features may not be fully supported on this device/browser.");
    }

    if (gyroActive) {
        window.removeEventListener('deviceorientation', handleDeviceOrientation, true);
        gyroActive = false;
        if (gyroEnableButton) gyroEnableButton.textContent = 'Enable Gyro (Disabled)';
        if (calibrateGyroButton) {
            calibrateGyroButton.disabled = true;
        }
        if (gyroSensitivityXSlider) gyroSensitivityXSlider.disabled = true;
        if (gyroSensitivityYSlider) gyroSensitivityYSlider.disabled = true;
        const gyroDebug = document.getElementById('gyroDebugInfo');
        if (gyroDebug) gyroDebug.textContent = 'Gyro: Disabled';

    } else {
        requestDeviceOrientationPermission();
    }
}


// -----------------------------------------------------------------------------
// --- DOM READY & INITIAL UI SETUP --------------------------------------------
// -----------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', function () {
  const toggleMenuButton = document.getElementById('toggleLeftMenuButton');
  const leftMenu = document.getElementById('leftAccordionMenu');
  const leftMenuNominalWidth = 300;
  const buttonEdgePadding = 15;

  if (toggleMenuButton && leftMenu) {
    const updateToggleButtonAppearance = () => {
        const menuIsOpen = !leftMenu.classList.contains('collapsed');
        if (menuIsOpen) {
            toggleMenuButton.textContent = '✕';
            const buttonWidth = toggleMenuButton.offsetWidth;
            toggleMenuButton.style.left = (leftMenuNominalWidth - buttonWidth - buttonEdgePadding) + 'px';
        } else {
            toggleMenuButton.textContent = '☰';
            toggleMenuButton.style.left = buttonEdgePadding + 'px';
        }
    };
    updateToggleButtonAppearance();
    toggleMenuButton.addEventListener('click', () => {
      leftMenu.classList.toggle('collapsed');
      updateToggleButtonAppearance();
    });
  } else {
    console.error("Toggle menu button or left menu element not found.");
  }

  // Simplified logic: No nesting, just toggle the panel
  const acc = document.getElementsByClassName("accordion-button");
  for (let i = 0; i < acc.length; i++) {
    acc[i].addEventListener("click", function() {
      if (leftMenu && !leftMenu.classList.contains('collapsed')) {
        this.classList.toggle("active");
        const panel = this.nextElementSibling;
        
        if (panel.style.maxHeight) { 
            panel.style.maxHeight = null; 
            panel.classList.remove("show"); 
        }
        else { 
            // The original fix: scrollHeight + 30px for padding
            panel.style.maxHeight = (panel.scrollHeight + 30) + "px"; 
            panel.classList.add("show"); 
        }
      }
    });
  }

   if (acc.length > 0 && acc[0].nextElementSibling && !acc[0].classList.contains('active')) {
    if (leftMenu && !leftMenu.classList.contains('collapsed')) {
        const initialDisplay = leftMenu.style.display;
        if(leftMenu.style.display === 'none') leftMenu.style.display = 'flex';

        const firstPanel = acc[0].nextElementSibling;
        const panelInitialMaxHeight = firstPanel.style.maxHeight;
        const panelInitialDisplay = firstPanel.style.display;

        if (!firstPanel.classList.contains('show')) {
            firstPanel.style.maxHeight = 'none';
            firstPanel.style.display = 'block';
        }
        acc[0].click();
        if (!firstPanel.classList.contains('show')) {
            firstPanel.style.maxHeight = panelInitialMaxHeight || null;
            firstPanel.style.display = panelInitialDisplay || '';
        }
        if(leftMenu.style.display !== initialDisplay) leftMenu.style.display = initialDisplay;
    }
  }
  onOpenCvReady();
});

// -----------------------------------------------------------------------------
// --- FACE TRACKING LOGIC (MediaPipe Face Mesh) -------------------------------
// -----------------------------------------------------------------------------

async function initializeFaceMesh() {
  // We still set the TFJS backend as it's used internally, even with MediaPipe runtime.
  await tf.setBackend('webgl');
  console.log("TensorFlow backend set to WebGL.");

  const model = faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh;
  const detectorConfig = {
    maxFaces: 1,
    refineLandmarks: false,
    // Switch runtime from 'tfjs' to 'mediapipe' for reliability
    runtime: 'mediapipe',
    // Provide the location of the MediaPipe solution files via CDN
    solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh',
  };

  try {
    faceMeshDetector = await faceLandmarksDetection.createDetector(model, detectorConfig);
    console.log('Face Mesh detector initialized using MediaPipe runtime.');
  } catch (error) {
    console.error("Failed to initialize Face Mesh detector:", error);
    alert("Error initializing face tracking. Models might be unavailable. Check console.");
  }
}

async function runFaceMeshCycle() {
  try {
    if (faceMeshDetector && videoInput && videoInput.readyState >= 3 && offscreenCtx && faceOverlayCtx) {

      faceOverlayCtx.clearRect(0, 0, faceOverlayCanvas.width, faceOverlayCanvas.height);

      offscreenCtx.drawImage(videoInput, 0, 0, videoInput.videoWidth, videoInput.videoHeight);

      const faces = await faceMeshDetector.estimateFaces(offscreenCanvas, {
        flipHorizontal: false
      });

      if (faces.length > 0) {
        const keypoints = faces[0].keypoints;

        faceOverlayCtx.fillStyle = 'aqua';
        for (const point of keypoints) {
            faceOverlayCtx.beginPath();
            faceOverlayCtx.arc(point.x, point.y, 1.5, 0, 2 * Math.PI);
            faceOverlayCtx.fill();
        }

        const noseTip = keypoints[1];
        const normalizedX = noseTip.x / videoInput.videoWidth;
        const normalizedY = noseTip.y / videoInput.videoHeight;
        smoothedFaceX_global = faceSmoothingFactor * normalizedX + (1 - faceSmoothingFactor) * smoothedFaceX_global;
        smoothedFaceY_global = faceSmoothingFactor * normalizedY + (1 - faceSmoothingFactor) * smoothedFaceY_global;
        latestDetectedFaceX = smoothedFaceX_global;
        latestDetectedFaceY = smoothedFaceY_global;
        if (transformDiv) transformDiv.textContent = `Face Mesh Detected: ${keypoints.length} landmarks`;
        if (initialBaselinePending && canvasElement) {
          setFaceTrackerBaselineOffset(canvasElement);
          initialBaselinePending = false;
        }
      } else {
        if (transformDiv) {
          transformDiv.textContent = 'No face';
        }
      }
    }
  } catch (error) {
    console.error("Error in detection cycle:", error);
  }
  requestAnimationFrame(runFaceMeshCycle);
}

function setFaceTrackerBaselineOffset(currentCanvas) {
    if (!currentCanvas) {
        console.warn("setFaceTrackerBaselineOffset called without a canvas element.");
        return;
    }
    const cRect = currentCanvas.getBoundingClientRect();
    let oX_calc = 0;
    let oY_calc = 0;

    if (document.fullscreenElement || document.webkitFullscreenElement) {
        oX_calc = 0;
        oY_calc = 0;
    } else {
        const sX = window.screenX || 0, sY = window.screenY || 0;
        const cX = sX + cRect.left, cY = sY + cRect.top;
        const screenWidth = window.screen.width || window.innerWidth;
        const screenHeight = window.screen.height || window.innerHeight;
        const cCX = cX + cRect.width / 2;
        const cCY = cY + cRect.height / 2;
        const mCX = screenWidth / 2;
        const mCY = screenHeight / 2;
        oX_calc = cRect.width > 0 ? (cCX - mCX) / cRect.width : 0;
        oY_calc = cRect.height > 0 ? -(cCY - mCY) / cRect.height : 0;
    }
    baselineFaceTrackerOffsetX = (latestDetectedFaceX - 0.5) + oX_calc;
    baselineFaceTrackerOffsetY = (latestDetectedFaceY - 0.5) + oY_calc;
}

// -----------------------------------------------------------------------------
// --- DEBUG INFORMATION & UI UPDATES ------------------------------------------
// -----------------------------------------------------------------------------

function updateActualDebugInfo(sourceWidth, sourceHeight, segmentsW, segmentsH, numVertices) {
    if (sourceResolutionDisplayElement) {
        sourceResolutionDisplayElement.textContent = `${sourceWidth || '-'}x${sourceHeight || '-'}`;
    }
    if (actualVerticesDisplayElement) {
        if (segmentsW && segmentsH && numVertices) {
            actualVerticesDisplayElement.textContent = `${segmentsW}x${segmentsH} (${numVertices.toLocaleString()})`;
        } else {
            actualVerticesDisplayElement.textContent = '-x- (-)';
        }
    }
}

function calculateAndDisplayOptimalVertices() {
    if (optimalVerticesDisplayElement) {
        if (currentSourceWidthForOptimalCalc > 0 && currentSourceHeightForOptimalCalc > 0) {
            let optimalSegmentsW = Math.max(1, Math.round((currentSourceWidthForOptimalCalc / MESH_DENSITY_FACTOR) - 1));
            let optimalSegmentsH = Math.max(1, Math.round((currentSourceHeightForOptimalCalc / MESH_DENSITY_FACTOR) - 1));
            let optimalTotalVertices = (optimalSegmentsW + 1) * (optimalSegmentsH + 1);
            optimalVerticesDisplayElement.textContent = `${optimalSegmentsW}x${optimalSegmentsH} (${optimalTotalVertices.toLocaleString()})`;
        } else {
            optimalVerticesDisplayElement.textContent = '-x- (-)';
        }
    }
}


// -----------------------------------------------------------------------------
// --- SHADER & MATERIAL CREATION ----------------------------------------------
// -----------------------------------------------------------------------------

// --- createShaderMaterial ---
// MODIFIED: Fixed 'shouldDiscard' redefinition error in fragment shader debug logic
function createShaderMaterial(mode, mainTexture, depthTextureForMode, alphaTexture) {
    const materialUniforms = {
        u_portalPlaneDepthNorm: { value: currentNormPortalPlane },
        u_worldOuterVolumeDepth: { value: outerVolumeDepth },
        u_worldInnerVolumeDepth: { value: innerVolumeDepth },
        displacementBias: { value: 0.0 },
        u_textureSize: { value: new THREE.Vector2(1, 1) },
        u_depthPeekActive: { value: depthPeekActive },
        u_depthPeekValue: { value: depthPeekValue },
        u_depthPeekTolerance: { value: depthPeekTolerance },
        u_splitPeekActive: { value: false },
        u_splitPeekValue: { value: 0.0 },
        u_metricScale: { value: metricScaleFactor },
        u_edgeMask: { value: null },
        u_useEdgeMask: { value: false },
        u_resolution: { value: new THREE.Vector2(renderer.domElement.width, renderer.domElement.height) },

        // --- NEW UNIFIED GAP UNIFORMS ---
        u_useDepthGrad: { value: document.getElementById('useDepthGradCheck')?.checked || true },
        u_depthGradThreshold: { value: parseFloat(document.getElementById('depthGradThresholdSlider')?.value) || 0.02 },
        
        u_useSobel: { value: document.getElementById('useSobelCheck')?.checked || false },
        u_sobelThreshold: { value: parseFloat(document.getElementById('sobelThresholdSlider')?.value) || 0.1 },

        u_useLuma: { value: document.getElementById('useLumaCheck')?.checked || false },
        u_lumaThreshold: { value: parseFloat(document.getElementById('lumaThresholdSlider')?.value) || 0.1 },

        u_useChroma: { value: document.getElementById('useChromaCheck')?.checked || false },
        u_chromaThreshold: { value: parseFloat(document.getElementById('chromaThresholdSlider')?.value) || 0.1 },

        u_useCrease: { value: document.getElementById('useCreaseCheck')?.checked || false },
        u_creaseThreshold: { value: parseFloat(document.getElementById('creaseThresholdSlider')?.value) || 0.2 },
        
        u_useCurvature: { value: document.getElementById('useCurvatureCheck')?.checked || false },
        u_curvatureThreshold: { value: parseFloat(document.getElementById('curvatureThresholdSlider')?.value) || 1.0 },
        
        u_useUVStretch: { value: document.getElementById('useUVStretchCheck')?.checked || false },
        u_uvStretchThreshold: { value: parseFloat(document.getElementById('uvStretchThresholdSlider')?.value) || 0.5 },

        u_useGrazingAngle: { value: document.getElementById('useGrazingAngleCheck')?.checked || false },
        u_grazingAngleThreshold: { value: parseFloat(document.getElementById('grazingAngleThresholdSlider')?.value) || 0.2 },
        // --------------------------------

        u_alphaMap: { value: alphaTexture },
        u_hasAlphaMap: { value: (alphaTexture !== null) },
    };

    let specificUniforms, vertexShaderSource, fragmentShaderSource;

    const commonVertexVaryings = `
        varying vec2 vUv;
        varying float vNormalizedDepth;
        varying float vClipW;
        varying vec3 vViewPosition;
    `;

    // --- THE UNIFIED FRAGMENT SHADER HEAD ---
    const fragmentShaderHead = `
        uniform sampler2D u_edgeMask; uniform bool u_useEdgeMask; uniform vec2 u_resolution;
        uniform bool u_depthPeekActive; uniform float u_depthPeekValue; uniform float u_depthPeekTolerance;
        uniform bool u_splitPeekActive; uniform float u_splitPeekValue;
        uniform sampler2D u_alphaMap; uniform bool u_hasAlphaMap;
        uniform vec2 u_textureSize;

        // --- GAP STRATEGY UNIFORMS ---
        uniform bool u_useDepthGrad;   uniform float u_depthGradThreshold;
        uniform bool u_useSobel;       uniform float u_sobelThreshold;
        uniform bool u_useLuma;        uniform float u_lumaThreshold;
        uniform bool u_useChroma;      uniform float u_chromaThreshold;
        uniform bool u_useCrease;      uniform float u_creaseThreshold;
        uniform bool u_useCurvature;   uniform float u_curvatureThreshold;
        uniform bool u_useUVStretch;   uniform float u_uvStretchThreshold;
        uniform bool u_useGrazingAngle; uniform float u_grazingAngleThreshold;

        varying vec2 vUv;
        varying float vNormalizedDepth;
        varying float vClipW;
        varying vec3 vViewPosition;

        // Helper: Luminance
        float getLuma(vec3 rgb) {
            return dot(rgb, vec3(0.299, 0.587, 0.114));
        }
        
        // Helper: getDepth (will be defined by each mode)
        float getDepth(vec2 uv);
    `;

    const unifiedGapLogicGLSL = `
        bool isGap = false;
        // Define 'center' depth early as it is used by Curvature (Laplacian)
        #define center getDepth(vUv)

        // --- 1. GENERATORS (Depth & Texture) ---
        
        // A. Depth Gradient (Standard Derivatives)
        if (u_useDepthGrad) {
            float depthRate = fwidth(vNormalizedDepth);
            if (depthRate > u_depthGradThreshold) isGap = true;
        }

        // B. Luma Derivative (Sharp texture detail)
        if (u_useLuma && !isGap) {
            float luma = getLuma(originalColor.rgb);
            float lumaRate = fwidth(luma);
            if (lumaRate > u_lumaThreshold) isGap = true;
        }

        // C. Chroma Derivative (Color edges)
        if (u_useChroma && !isGap) {
            vec3 rgbRate = fwidth(originalColor.rgb);
            if (length(rgbRate) > u_chromaThreshold) isGap = true;
        }

        // D. 3x3 Sobel (High quality depth)
        if (u_useSobel && !isGap) {
            vec2 texel = 1.0 / u_textureSize;
            float t  = getDepth(vUv + vec2( 0.0,  texel.y));
            float b  = getDepth(vUv + vec2( 0.0, -texel.y));
            float l  = getDepth(vUv + vec2(-texel.x,  0.0));
            float r  = getDepth(vUv + vec2( texel.x,  0.0));
            float tl = getDepth(vUv + vec2(-texel.x,  texel.y));
            float tr = getDepth(vUv + vec2( texel.x,  texel.y));
            float bl = getDepth(vUv + vec2(-texel.x, -texel.y));
            float br = getDepth(vUv + vec2( texel.x, -texel.y));
            // Note: t and center (vUv) are slightly different here due to how Sobel is defined vs Laplacian
            float dX = tr + 2.0*r + br - (tl + 2.0*l + bl);
            float dY = bl + 2.0*b + br - (tl + 2.0*t + tr);
            if (sqrt(dX*dX + dY*dY) > u_sobelThreshold) isGap = true;
        }

        // --- 2. ADVANCED GENERATORS (Curvature & Crease) ---

        // F. Surface Curvature (Depth Laplacian Implementation)
        // We prioritize this over the normal-based approach as it is more stable.
        if (u_useCurvature && !isGap) {
            vec2 texel = 1.0 / u_textureSize;

            // Laplacian Kernel (0, 1, 0 / 1, -4, 1 / 0, 1, 0)
            float laplacian = getDepth(vUv + vec2(0.0, texel.y))
                            + getDepth(vUv + vec2(0.0, -texel.y))
                            + getDepth(vUv + vec2(texel.x, 0.0))
                            + getDepth(vUv + vec2(-texel.x, 0.0))
                            - 4.0 * center;

            // Scaling factor is needed because depth is normalized (0-1). 
            // This factor depends on the scene scale and depth range. 50.0 is a reasonable starting point.
            float curvature = abs(laplacian) * 50.0;

            // Threshold (default 1.0) will likely need tuning for this implementation.
            if (curvature > u_curvatureThreshold) isGap = true;
        }

        // --- 3. NORMAL-BASED CALCULATIONS (Crease and Inhibitors) ---
        
        vec3 faceNormal = vec3(0.0);
        vec3 unnormalizedNormal = vec3(0.0);
        float normalLength = 0.0;

        // Calculate normals only if needed for Crease (MND) or Grazing Angle
        // We check u_useCrease OR (if a gap exists AND u_useGrazingAngle is on)
        if (u_useCrease || (isGap && u_useGrazingAngle)) {
            // Calculate derivatives of view-space position
            vec3 dPosDx = dFdx(vViewPosition);
            vec3 dPosDy = dFdy(vViewPosition);
            
            // Calculate the UNNORMALIZED normal
            unnormalizedNormal = cross(dPosDx, dPosDy);
            normalLength = length(unnormalizedNormal);

            // Normalize safely for Grazing Angle
            if (normalLength > 1e-6) {
                faceNormal = unnormalizedNormal / normalLength;
            } else {
                // Fallback for degenerate geometry (e.g., zero area triangle)
                // Using a safe default prevents NaN propagation, though Grazing Angle won't work here.
                faceNormal = vec3(0.0, 0.0, 1.0); 
            }
        }

        // E. Normal Discontinuity (Crease Generator) - ROBUST IMPLEMENTATION (MND)
        if (u_useCrease && !isGap) {
            // Ensure we don't divide by zero if the normal length is too small
            if (normalLength > 1e-6) {
                // Robust approximation: length(fwidth(Unnormalized)) / Length
                // This isolates the change in orientation.
                float crease = length(fwidth(unnormalizedNormal)) / normalLength;

                // The threshold (default 0.2) may need tuning for this implementation.
                if (crease > u_creaseThreshold) isGap = true;
            }
        }

        // --- 4. INHIBITORS (AND NOT Logic) ---
        
        if (isGap) {
            // A. UV Stretch (Inhibit on slanted surfaces)
            if (u_useUVStretch) {
                vec2 dUvDx = dFdx(vUv);
                vec2 dUvDy = dFdy(vUv);
                float uvStretch = max(length(dUvDx), length(dUvDy));
                // Scale threshold by texture size for consistent results
                if (uvStretch * max(u_textureSize.x, u_textureSize.y) > u_uvStretchThreshold * 100.0) {
                    isGap = false;
                }
            }

            // B. Grazing Angle (Inhibit on smooth silhouettes)
            if (u_useGrazingAngle && isGap) { // Check isGap again
                // Use the safely calculated faceNormal.
                // Only apply if the normal calculation was successful.
                if (normalLength > 1e-6) {
                    vec3 viewDir = normalize(-vViewPosition);
                    float incidence = abs(dot(faceNormal, viewDir));
                    if (incidence < u_grazingAngleThreshold) {
                        isGap = false;
                    }
                }
            }
        }

        // --- 5. FALLBACK (External Post-Processed Mask) ---
        if (u_useEdgeMask && !isGap) {
            vec2 screenUv = gl_FragCoord.xy / u_resolution;
            if (texture2D(u_edgeMask, screenUv).r > 0.5) isGap = true;
        }

        if (isGap) discard;
    `;

    const baseVertexShaderPrefix = `
        ${commonVertexVaryings}
        uniform float u_portalPlaneDepthNorm;
        uniform float u_worldOuterVolumeDepth;
        uniform float u_worldInnerVolumeDepth;
        uniform float displacementBias;
    `;
    
    const viewSpaceDisplacementLogic = `
        float displacement = 0.0;
        if (vNormalizedDepth < u_portalPlaneDepthNorm) {
            float t = smoothstep(0.0, u_portalPlaneDepthNorm, vNormalizedDepth);
            displacement = mix(-u_worldOuterVolumeDepth, 0.0, t);
        } else {
            float t = smoothstep(u_portalPlaneDepthNorm, 1.0, vNormalizedDepth);
            displacement = mix(0.0, u_worldInnerVolumeDepth, t);
        }
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        viewPosition.z += displacement + displacementBias;
        vViewPosition = viewPosition.xyz;
        gl_Position = projectionMatrix * viewPosition;
        vClipW = gl_Position.w;
    `;
     const alphaDiscardLogicGLSL = `
        if (u_hasAlphaMap) {
            float alphaValue = texture2D(u_alphaMap, vUv).r;
            if (alphaValue < 0.1) { 
                 // discard; 
            }
        }
    `;
    
    const peekHighlightLogicGLSL = `
        if (u_splitPeekActive) {
            float depthDiff = vNormalizedDepth - u_splitPeekValue;
            if (abs(depthDiff) < u_depthPeekTolerance) {
               originalColor.rgb = mix(originalColor.rgb, vec3(0.2, 1.0, 0.2), 0.7);
            } else if (depthDiff < 0.0) {
               originalColor.rgb *= 0.5;
            }
        } else if (u_depthPeekActive && abs(vNormalizedDepth - u_depthPeekValue) < u_depthPeekTolerance) {
               originalColor.rgb = mix(originalColor.rgb, vec3(0.8, 0.2, 0.8), 0.5);
        }
    `;

    // Mode-specific shaders (Updated to use the unified gap logic)
    if (mode === "image") {
        specificUniforms = { map: { value: mainTexture }, displacementMap: { value: depthTextureForMode } };
        vertexShaderSource = `
            ${baseVertexShaderPrefix} uniform sampler2D displacementMap;
            void main() { vUv = uv; vNormalizedDepth = texture2D(displacementMap, vUv).r; ${viewSpaceDisplacementLogic} }`;

        fragmentShaderSource = `
            ${fragmentShaderHead} uniform sampler2D map; uniform sampler2D displacementMap;
            float getDepth(vec2 uv) { return texture2D(displacementMap, uv).r; }
            void main() {
                vec4 originalColor = texture2D(map, vUv);
                ${alphaDiscardLogicGLSL}
                if (originalColor.a < 0.01) discard;
                ${unifiedGapLogicGLSL}
                ${peekHighlightLogicGLSL}
                gl_FragColor = originalColor;
            }`;

    } else if (mode === "sidebyside") {
        specificUniforms = {
            videoTexture: { value: mainTexture },
            rgbVideoCoords: { value: new THREE.Vector4(defaultRgbVideoCoords.x, defaultRgbVideoCoords.y, defaultRgbVideoCoords.width, defaultRgbVideoCoords.height) },
            depthMapCoords: { value: new THREE.Vector4(defaultDepthMapCoords.x, defaultDepthMapCoords.y, defaultDepthMapCoords.width, defaultDepthMapCoords.height) },
            videoDimensions: { value: new THREE.Vector2(videoContentElementGlobal.videoWidth || 1920, videoContentElementGlobal.videoHeight || 540) },
        };
         vertexShaderSource = `
            ${baseVertexShaderPrefix} uniform sampler2D videoTexture; uniform vec4 depthMapCoords; uniform vec2 videoDimensions;
            void main() { vUv = uv; vec2 dUV = vec2((depthMapCoords.x + depthMapCoords.z*uv.x)/videoDimensions.x, (depthMapCoords.y + depthMapCoords.w*uv.y)/videoDimensions.y); vNormalizedDepth = texture2D(videoTexture, dUV).r; ${viewSpaceDisplacementLogic} }`;
        
        fragmentShaderSource = `
            ${fragmentShaderHead} uniform sampler2D videoTexture; uniform vec4 rgbVideoCoords; uniform vec4 depthMapCoords; uniform vec2 videoDimensions;
            float getDepth(vec2 planeUv) {
                vec2 dUv = vec2((depthMapCoords.x + depthMapCoords.z * planeUv.x) / videoDimensions.x, (depthMapCoords.y + depthMapCoords.w * planeUv.y) / videoDimensions.y);
                return texture2D(videoTexture, dUv).r;
            }
            void main() {
                vec2 rgbSampleUv = vec2((rgbVideoCoords.x + rgbVideoCoords.z * vUv.x) / videoDimensions.x, (rgbVideoCoords.y + rgbVideoCoords.w * vUv.y) / videoDimensions.y);
                vec4 originalColor = texture2D(videoTexture, rgbSampleUv);
                ${alphaDiscardLogicGLSL}
                if (originalColor.a < 0.01) discard;
                ${unifiedGapLogicGLSL}
                ${peekHighlightLogicGLSL}
                gl_FragColor = originalColor;
            }`;

    } else if (mode === "separated") {
         specificUniforms = { rgbTexture: { value: mainTexture }, depthTexture: { value: depthTextureForMode } };
        vertexShaderSource = `
            ${baseVertexShaderPrefix} uniform sampler2D depthTexture;
            void main() { vUv = uv; vNormalizedDepth = texture2D(depthTexture, vUv).r; ${viewSpaceDisplacementLogic} }`;
        
        fragmentShaderSource = `
            ${fragmentShaderHead} uniform sampler2D rgbTexture; uniform sampler2D depthTexture;
            float getDepth(vec2 uv) { return texture2D(depthTexture, uv).r; }
            void main() {
                vec4 originalColor = texture2D(rgbTexture, vUv);
                ${alphaDiscardLogicGLSL} 
                if (originalColor.a < 0.01) discard; 
                ${unifiedGapLogicGLSL}
                ${peekHighlightLogicGLSL}
                gl_FragColor = originalColor;
            }`;
    }

    Object.assign(materialUniforms, specificUniforms);

    return new THREE.ShaderMaterial({
        uniforms: materialUniforms,
        vertexShader: vertexShaderSource,
        fragmentShader: fragmentShaderSource,
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: true,
        depthTest: true,
        extensions: { derivatives: true }
    });
}

// -----------------------------------------------------------------------------
// --- MEDIA LOADING & MANAGEMENT ----------------------------------------------
// -----------------------------------------------------------------------------

// --- Helper function to create a blank layer object ---
// MODIFIED: No 'sources' initially, add properties as needed
function createBlankLayer() {
    return {
      id: `layer_${nextLayerId++}`,
      type: 'image',
      fileInfo: { color: null, depth: null, alpha: null },
      // --- NEW ---
      sources: { color: null, depth: null, alpha: null },
      // --- END NEW ---
      colorValue: '#000000'
      // elements, textures, mesh are added later during loading
    };
}

// --- Layer Modal Management Functions ---

// MODIFIED: To use selective copying and manage fileStorage
function openLayerModal() {
    document.getElementById('layerModalOverlay').style.display = 'flex';
    fileStorage.clear(); // We can keep this for now, though it's unused for files

    // --- MODIFICATION: Selectively copy necessary data ---
    stagedMediaLayers = mediaLayers.map(layer => {
        const stageLayer = {
             id: layer.id,
             type: layer.type,
             fileInfo: {
                 color: layer.fileInfo?.color ? {...layer.fileInfo.color} : null,
                 depth: layer.fileInfo?.depth ? {...layer.fileInfo.depth} : null,
                 alpha: layer.fileInfo?.alpha ? {...layer.fileInfo.alpha} : null,
             },
             // --- NEW ---
             sources: {
                color: layer.sources?.color || null,
                depth: layer.sources?.depth || null,
                alpha: layer.sources?.alpha || null,
             },
             // --- END NEW ---
             colorValue: layer.colorValue || '#000000'
        };
        
        // This 'if' block is now redundant because of the above
        /*
        if (layer.sources) {
            if (layer.sources.color instanceof File) fileStorage.set(`${layer.id}-color`, layer.sources.color);
            if (layer.sources.depth instanceof File) fileStorage.set(`${layer.id}-depth`, layer.sources.depth);
            if (layer.sources.alpha instanceof File) fileStorage.set(`${layer.id}-alpha`, layer.sources.alpha);
        }
        */

         if (layer.type === 'color' && layer.sources?.color) {
            if (typeof layer.sources.color === 'string') {
                stageLayer.colorValue = layer.sources.color;
                stageLayer.sources.color = null; // Ensure source is null for color layer
            }
         }

        return stageLayer;
    });

    // Add default layers if staged array is empty
    if (stagedMediaLayers.length === 0) {
        stagedMediaLayers.push(createBlankLayer()); // Foreground (index 0)
        stagedMediaLayers.push(createBlankLayer()); // Background (index 1)
    }

    renderLayerList();
}


// --- closeLayerModal ---
// MODIFIED: Ensure isApplyingLayers flag is reset
function closeLayerModal() {
    const modalOverlay = document.getElementById('layerModalOverlay');
    if (modalOverlay) {
        modalOverlay.style.display = 'none';
    } else {
        console.warn("Could not find layer modal overlay to close.");
    }

    // Clean up temporary object URLs used for thumbnails
    thumbnailUrlsToRevoke.forEach(url => { if (url) URL.revokeObjectURL(url); }); // Added check
    thumbnailUrlsToRevoke = [];

    // Clear temporary file storage
    fileStorage.clear();

    // Re-enable apply button and reset text
    const applyBtn = document.getElementById('applyLayersButton');
    if (applyBtn) {
        applyBtn.disabled = false;
        applyBtn.textContent = 'Apply Layers';
    }

    // --- FIX: Reset the applying flag when modal closes ---
    isApplyingLayers = false;
    // --- END FIX ---

    console.log("Layer modal closed.");
}

// MODIFIED: To show thumbnails based on fileStorage or fileInfo
function renderLayerList() {
    const container = document.getElementById('layerListContainer');
    container.innerHTML = ''; // Clear existing list

    // REMOVED: Don't revoke URLs here - they're still needed for display
    // Only revoke when modal closes or layers are applied
    // thumbnailUrlsToRevoke.forEach(url => URL.revokeObjectURL(url));
    // thumbnailUrlsToRevoke = [];

    // Read from the temporary staged array
    if (stagedMediaLayers.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:#6c757d; padding:20px;">No layers. Click "+ Add Layer" to start.</p>';
        return;
    }

    const totalLayers = stagedMediaLayers.length;

    // Render from front (index 0) to back (index N-1)
    stagedMediaLayers.forEach((layer, index) => {
        let title = `Layer ${index + 1}`;
        if (index === 0) title += ' (Foreground)';
        if (index === totalLayers - 1) title += ' (Background)';

        const layerId = layer.id;

        // Add "Solid Color" option only for background layer
        const isBackground = (index === totalLayers - 1);
        const solidColorOption = isBackground ? `<option value="color" ${layer.type === 'color' ? 'selected' : ''}>Solid Color</option>` : '';

        let inputsHtml = '';
        if (layer.type === 'color' && isBackground) {
            // Show color picker
            inputsHtml = `
                <label for="layer-${layerId}-color-picker">Color:</label>
                <input type="color" id="layer-${layerId}-color-picker" class="layer-color-picker" data-layer-id="${layerId}" value="${layer.colorValue || '#000000'}">
            `;
        } else {
            // --- MODIFICATION: Generate Thumbnail/Input HTML ---
            const fileTypes = ['color', 'depth', 'alpha'];
            const labels = {'color': 'Color:', 'depth': 'Depth:', 'alpha': 'Alpha (Opt.):'};
             const accepts = {
                'color': 'image/png, image/jpeg, video/mp4, video/webm',
                'depth': 'image/png, image/jpeg, video/mp4, video/webm',
                'alpha': 'image/png, image/jpeg, video/mp4, video/webm'
            };


            fileTypes.forEach(fileType => {
                const fileKey = `${layerId}-${fileType}`;
                // const file = fileStorage.get(fileKey); // <-- REMOVE
                const file = layer.sources[fileType]; // <-- ADD THIS (Check staged layer)
                const fileInfo = layer.fileInfo[fileType]; // Fallback to stored info
                let inputOrThumbnailHtml = '';

                if (file instanceof File) {
                    const objectURL = URL.createObjectURL(file);
                    thumbnailUrlsToRevoke.push(objectURL); // Add to cleanup list

                    let mediaTag = '';
                    if (file.type.startsWith('image/')) {
                        mediaTag = `<img src="${objectURL}" class="layer-thumbnail" alt="${fileType} thumbnail">`;
                    } else if (file.type.startsWith('video/')) {
                        // For videos, add preload="metadata" to show first frame as thumbnail
                        mediaTag = `<video src="${objectURL}" class="layer-thumbnail" muted playsinline loop controls preload="metadata"></video>`;
                    }

                    inputOrThumbnailHtml = `
                        <div class="thumbnail-container">
                            ${mediaTag}
                            <div class="thumbnail-info">
                                <span class="file-name-display">${file.name}</span>
                                <button class="remove-file-btn" data-layer-id="${layerId}" data-file-type="${fileType}" title="Remove file">✕</button>
                             </div>
                        </div>`;
                } else if (fileInfo) { // Show info if file isn't in storage but we have info
                     // Display file info (name) and a remove button, but no thumbnail
                     inputOrThumbnailHtml = `
                        <div class="thumbnail-container">
                             <div class="thumbnail-info">
                                <span class="file-name-display"><i>${fileInfo.name} (Stored)</i></span>
                                <button class="remove-file-btn" data-layer-id="${layerId}" data-file-type="${fileType}" title="Remove file">✕</button>
                             </div>
                        </div>`;
                }
                else {
                    // Show the file input
                    inputOrThumbnailHtml = `<input type="file" id="layer-${layerId}-${fileType}" class="layer-file-input" data-file-type="${fileType}" data-layer-id="${layerId}" accept="${accepts[fileType]}">`;
                }

                inputsHtml += `<label for="layer-${layerId}-${fileType}">${labels[fileType]}</label>`;
                inputsHtml += `<div>${inputOrThumbnailHtml}</div>`; // Wrap input/thumb in div for grid layout
            });
            // --- END MODIFICATION ---
        }

        const layerHtml = `
        <div class="layer-item" data-layer-id="${layer.id}">
          <div class="layer-item-header">
            <strong>${title}</strong>
            <div class="layer-controls">
              <button class="move-layer-up" title="Move Up (toward foreground)" ${index === 0 ? 'disabled' : ''}>▲</button>
              <button class="move-layer-down" title="Move Down (toward background)" ${index === totalLayers - 1 ? 'disabled' : ''}>▼</button>
              <button class="remove-layer-btn" title="Remove Layer">✕</button>
            </div>
          </div>
          <div class="layer-item-body">
            <label>Type:</label>
            <select class="layer-type-select" data-layer-id="${layer.id}">
              <option value="image" ${layer.type === 'image' ? 'selected' : ''}>Image</option>
              <option value="video" ${layer.type === 'video' ? 'selected' : ''}>Video</option>
              ${solidColorOption}
            </select>
            ${inputsHtml}
          </div>
        </div>`;
        container.innerHTML += layerHtml;
    });

    // Re-attach event listeners for all new elements
    attachLayerModalListeners();
}


// MODIFIED: To modify stagedMediaLayers
function addNewLayerToModal() {
    const newLayer = createBlankLayer();
    stagedMediaLayers.push(newLayer);
    renderLayerList();
}

// MODIFIED: To modify stagedMediaLayers and manage fileStorage
function attachLayerModalListeners() {
    document.querySelectorAll('.remove-layer-btn').forEach(btn => btn.addEventListener('click', handleRemoveLayer));
    document.querySelectorAll('.move-layer-up').forEach(btn => btn.addEventListener('click', handleMoveLayer));
    document.querySelectorAll('.move-layer-down').forEach(btn => btn.addEventListener('click', handleMoveLayer));

    // Expanded listener for layer type change
    document.querySelectorAll('.layer-type-select').forEach(sel => sel.addEventListener('change', (e) => {
        const layerId = e.target.dataset.layerId;
        const layer = stagedMediaLayers.find(l => l.id === layerId); // Find in staged
        if (layer) {
             const oldType = layer.type;
             const newType = e.target.value;
             layer.type = newType;

            // --- START: CORRECTED LOGIC ---
            // This logic prevents wiping files when switching between 'image' and 'video'
            
            if (newType === 'color' && oldType !== 'color') {
                // Switching TO 'color' from 'image' or 'video'
                // Wipe file sources and set a default color
                layer.fileInfo = { color: null, depth: null, alpha: null };
                layer.sources = { color: null, depth: null, alpha: null };
                layer.colorValue = '#000000'; // Reset color
            } else if (newType !== 'color' && oldType === 'color') {
                // Switching FROM 'color' to 'image' or 'video'
                // Wipe file sources (which were null anyway) just to be clean
                layer.fileInfo = { color: null, depth: null, alpha: null };
                layer.sources = { color: null, depth: null, alpha: null };
            }
            // If newType is 'image' and oldType is 'video' (or vice-versa),
            // NOTHING happens, preserving the selected files.
            // --- END: CORRECTED LOGIC ---
        }
        renderLayerList(); // Re-render the whole modal to show new inputs
    }));


    // MODIFIED: Listener for file input (class added)
    document.querySelectorAll('.layer-file-input').forEach(inp => inp.addEventListener('change', handleStoreFile));

    // NEW: Seek video thumbnails to show a preview frame (not black)
    document.querySelectorAll('.layer-thumbnail').forEach(el => {
        if (el.tagName === 'VIDEO') {
            el.addEventListener('loadedmetadata', () => {
                // Seek to 1 second (or 10% of duration, whichever is smaller)
                const seekTime = Math.min(1.0, el.duration * 0.1);
                el.currentTime = seekTime;
            });
        }
    });

    // Add listener for new color picker
    document.querySelectorAll('.layer-color-picker').forEach(inp => inp.addEventListener('input', (e) => {
        const layerId = e.target.dataset.layerId;
        const layer = stagedMediaLayers.find(l => l.id === layerId); // Find in staged
        if (layer) layer.colorValue = e.target.value; // Store color value
    }));

    // --- NEW: Listener for Remove File Button ---
    document.querySelectorAll('.remove-file-btn').forEach(btn => btn.addEventListener('click', (e) => {
        const layerId = e.target.dataset.layerId;
        const fileType = e.target.dataset.fileType;
        const layer = stagedMediaLayers.find(l => l.id === layerId);
        if (layer) {
            layer.fileInfo[fileType] = null; // Clear file info
            layer.sources[fileType] = null; // Clear file from sources
        }
        renderLayerList(); // Re-render to show the input again
    }));
}


// MODIFIED: To modify stagedMediaLayers and clear fileStorage for removed layer
function handleRemoveLayer(e) {
    const layerId = e.target.closest('.layer-item').dataset.layerId;
    stagedMediaLayers = stagedMediaLayers.filter(layer => {
        if (layer.id === layerId) {
            // Clear associated files from storage
            // fileStorage.delete(`${layerId}-color`);
            // fileStorage.delete(`${layerId}-depth`);
            // fileStorage.delete(`${layerId}-alpha`);
            // Sources are cleared automatically by filtering
            return false; // Remove layer
        }
        return true; // Keep layer
    });
    renderLayerList();
}


// MODIFIED: To modify stagedMediaLayers
function handleMoveLayer(e) {
    const layerId = e.target.closest('.layer-item').dataset.layerId;
    const index = stagedMediaLayers.findIndex(layer => layer.id === layerId); // Find in staged
    const isUp = e.target.classList.contains('move-layer-up');

    if (isUp && index > 0) {
        [stagedMediaLayers[index], stagedMediaLayers[index - 1]] = [stagedMediaLayers[index - 1], stagedMediaLayers[index]]; // Swap
    } else if (!isUp && index < stagedMediaLayers.length - 1) {
        [stagedMediaLayers[index], stagedMediaLayers[index + 1]] = [stagedMediaLayers[index + 1], stagedMediaLayers[index]]; // Swap
    }
    renderLayerList();
}

// MODIFIED: To store File in fileStorage and fileInfo in stagedMediaLayers
function handleStoreFile(e) {
    const layerId = e.target.dataset.layerId;
    const fileType = e.target.dataset.fileType;
    const file = e.target.files[0];
    const layer = stagedMediaLayers.find(l => l.id === layerId);

    if (layer) {
        if (file) {
            // fileStorage.set(`${layerId}-${fileType}`, file); // <-- REMOVE
            layer.sources[fileType] = file; // <-- ADD THIS
            layer.fileInfo[fileType] = { name: file.name, type: file.type }; // Store descriptive info
        } else {
            // fileStorage.delete(`${layerId}-${fileType}`); // <-- REMOVE
            layer.sources[fileType] = null; // <-- ADD THIS
            layer.fileInfo[fileType] = null;
        }
    }
    renderLayerList(); // Re-render to show thumbnail/file name
}


// --- applyLayersFromModal ---
// Clean version with session invalidation fixes
async function applyLayersFromModal() {
    console.log("=== APPLY LAYERS START ===");
    const localSessionId = currentLoadSessionId;
    const newLayersFromModalData = stagedMediaLayers.map(layer => ({
        id: layer.id,
        type: layer.type,
        fileInfo: {...layer.fileInfo},
        colorValue: layer.colorValue,
        sources: {
            color: layer.sources.color || null,
            depth: layer.sources.depth || null,
            alpha: layer.sources.alpha || null,
        }
    }));
    newLayersFromModalData.forEach(layer => { if (layer.type === 'color') { layer.sources.color = layer.colorValue; }});
    console.log("Committed layers:", newLayersFromModalData);

    await clearCurrentVisuals(false); // Pass false to prevent session invalidation
    console.log("clearCurrentVisuals finished (called from applyLayers).");

    if (localSessionId !== currentLoadSessionId) {
        console.warn("Load session invalidated unexpectedly during clear phase. Aborting applyLayersFromModal.");
        closeLayerModal();
        return;
     }

    const layersToLoad = [...newLayersFromModalData];
    console.log("Restored layers to load:", layersToLoad);
    const colorLayerIndex = layersToLoad.findIndex(l => l.type === 'color');
    let colorLayer = null;
    if (colorLayerIndex !== -1) { colorLayer = layersToLoad.splice(colorLayerIndex, 1)[0]; console.log("Found color layer:", colorLayer); }

    const isValidSource = (source) => (source instanceof File || (typeof source === 'string' && source.length > 0));
    const validMeshLayers = layersToLoad.filter(l => {
        const validTypes = ['image', 'video', 'separated', 'sidebyside'];
        if (!validTypes.includes(l.type)) { console.warn(`Layer ${l.id} has invalid type: ${l.type}`); return false; }
        const colorValid = isValidSource(l.sources.color);
        const depthValid = true; // Optional
        return colorValid && depthValid;
    });
    console.log(`Valid mesh layers: ${validMeshLayers.length}/${layersToLoad.length}`);

    if (validMeshLayers.length === 0 && !colorLayer) {
        console.log("No valid layers to apply. Scene remains empty.");
        if (renderer && renderer.domElement && (currentRTWidth === 0 || currentRTHeight === 0)) {
             console.log("No valid layers, but ensuring pyramids are initialized based on renderer size.");
             resizeRendererAndTargets(renderer.domElement.width, renderer.domElement.height);
        }
        closeLayerModal();
        return;
    }

    const urlsToRevoke = [];
    const loadLayerSource = (layer, type) => {
        // This is the helper function you provided, which correctly handles Files/Strings
        return new Promise((resolve, reject) => {
            const source = layer.sources[type];
            if (!source) { resolve(null); return; }
            let url, isVideo = false;
            if (source instanceof File) {
                url = URL.createObjectURL(source); isVideo = source.type.startsWith('video/');
                if (isVideo) { activeVideoUrls.push(url); } else { urlsToRevoke.push(url); }
            } else if (typeof source === 'string') {
                url = source;
                if (layer.fileInfo?.[type]?.type) { isVideo = layer.fileInfo[type].type.startsWith('video/'); }
                else { isVideo = url.match(/\.(mp4|webm|ogg)$/i) !== null; }
            } else { console.warn(`Unknown source type for layer ${layer.id} type ${type}:`, source); resolve(null); return; }
            if (layer.type === 'sidebyside' && type === 'color') { isVideo = true; }
            const element = isVideo ? document.createElement('video') : new Image();
            if (isVideo) {
                Object.assign(element, { autoplay: true, loop: true, muted: true, playsInline: true });
                element.onloadedmetadata = () => { layer.elements = layer.elements || {}; layer.elements[type] = element; resolve(element); };
            } else {
                element.onload = () => { layer.elements = layer.elements || {}; layer.elements[type] = element; resolve(element); };
            }
            element.onerror = (e) => { console.error(`ERROR loading ${type} for layer ${layer.id} from ${url}:`, e); resolve(null); };
            element.src = url; if (isVideo) element.load();
        });
    };

    let firstLayerLoaded = false;
    let firstLayerWidth = 0, firstLayerHeight = 0;

    // 7. Load MESH layers
    try {
        for (const layer of validMeshLayers) {
            if (localSessionId !== currentLoadSessionId) { throw new Error("Load session invalidated"); }

            layer.elements = {};
            layer.textures = {};

            const [colorEl, depthEl, alphaEl] = await Promise.all([
                loadLayerSource(layer, 'color'),
                loadLayerSource(layer, 'depth'),
                loadLayerSource(layer, 'alpha')
             ]);
            if (!colorEl) { console.warn(`Skipping layer ${layer.id}: no color element`); continue; }

            // Create textures
            const isVideo = colorEl.tagName === 'VIDEO';
            layer.textures.color = isVideo ? new THREE.VideoTexture(colorEl) : new THREE.Texture(colorEl);
            if (depthEl) { layer.textures.depth = (depthEl.tagName === 'VIDEO') ? new THREE.VideoTexture(depthEl) : new THREE.Texture(depthEl); }
            if (alphaEl) { layer.textures.alpha = (alphaEl.tagName === 'VIDEO') ? new THREE.VideoTexture(alphaEl) : new THREE.Texture(alphaEl); }
            if (!isVideo && layer.textures.color) layer.textures.color.needsUpdate = true;
            if (layer.textures.depth && depthEl && depthEl.tagName !== 'VIDEO') layer.textures.depth.needsUpdate = true;
            if (layer.textures.alpha && alphaEl && alphaEl.tagName !== 'VIDEO') layer.textures.alpha.needsUpdate = true;

            // Get dimensions
            const effectiveWidth = isVideo ? colorEl.videoWidth : colorEl.naturalWidth; const effectiveHeight = isVideo ? colorEl.videoHeight : colorEl.naturalHeight;
            const displayWidth = (layer.type === 'sidebyside') ? effectiveWidth / 2 : effectiveWidth; const displayHeight = effectiveHeight;

            // Set aspect ratio & trigger resize/pyramid init from FIRST valid layer
            if (!firstLayerLoaded) {
                 firstLayerWidth = displayWidth; firstLayerHeight = displayHeight;
                 contentAspectRatio = firstLayerWidth / firstLayerHeight;
                 currentSourceWidthForOptimalCalc = firstLayerWidth; currentSourceHeightForOptimalCalc = firstLayerHeight;
                 calculateAndDisplayOptimalVertices();
                 if (depthQueryCanvas) { depthQueryCanvas.width = firstLayerWidth; depthQueryCanvas.height = firstLayerHeight; }

                 if (renderer && camera) {
                     console.log(`First layer loaded (${firstLayerWidth}x${firstLayerHeight}). Forcing resizeRendererAndTargets (using current renderer size: ${renderer.domElement.width}x${renderer.domElement.height}) to ensure pyramids are initialized.`);
                     resizeRendererAndTargets(renderer.domElement.width, renderer.domElement.height);
                 }
                 firstLayerLoaded = true;
            }

            // Create mesh geometry
            let segmentsW = Math.max(1, Math.round((displayWidth / MESH_DENSITY_FACTOR) - 1)); let segmentsH = Math.max(1, Math.round((displayHeight / MESH_DENSITY_FACTOR) - 1));
            const layerAspect = displayWidth / displayHeight; const frameAspect = terrariumWidth / terrariumHeight;
            let layerWidth, layerHeight;
            if (layerAspect > frameAspect) { layerWidth = terrariumWidth; layerHeight = terrariumWidth / layerAspect; } else { layerHeight = terrariumHeight; layerWidth = terrariumHeight * layerAspect; }
            const geom = new THREE.PlaneGeometry(layerWidth, layerHeight, segmentsW, segmentsH);

            // Create default flat depth texture if missing
            if (!layer.textures.depth) {
                const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
                const ctx = canvas.getContext('2d'); ctx.fillStyle = 'rgb(128, 128, 128)'; ctx.fillRect(0, 0, 1, 1);
                layer.textures.depth = new THREE.Texture(canvas);
                layer.textures.depth.needsUpdate = true;
            }

            // Determine shader mode
            let shaderMode = 'separated';
            if (layer.type === 'sidebyside') shaderMode = 'sidebyside';
            else if (layer.type === 'image' && !isVideo) shaderMode = 'image';

            const mat = createShaderMaterial(
                shaderMode,
                layer.textures.color,
                layer.textures.depth,
                layer.textures.alpha
            );

            // --- ADD THIS LINE ---
            mat.uniforms.u_textureSize.value.set(displayWidth, displayHeight);
            // --- END ADDITION ---

            // Update uniforms for side-by-side if necessary
            if (shaderMode === 'sidebyside' && mat.uniforms.videoDimensions) {
                mat.uniforms.videoDimensions.value.set(effectiveWidth, effectiveHeight);
                 if (mat.uniforms.rgbVideoCoords && mat.uniforms.depthMapCoords) {
                    mat.uniforms.rgbVideoCoords.value.set(0, 0, displayWidth, displayHeight);
                    mat.uniforms.depthMapCoords.value.set(displayWidth, 0, displayWidth, displayHeight);
                 }
             }

            layer.mesh = new THREE.Mesh(geom, mat);
            layer.mesh.position.z = portalPlaneWorldZ;
            layer.mesh.renderOrder = validMeshLayers.indexOf(layer);
            layer.mesh.visible = true; // Ensure visible on creation

            mediaLayers.push(layer); // Add layer to global array

            if (scene) {
                scene.add(layer.mesh);
            } else { console.error("Scene not initialized!"); }

            // Play videos
            if (isVideo) colorEl.play().catch(e => console.error(`Layer ${layer.id} color video play error:`, e));
            if (depthEl && depthEl.tagName === 'VIDEO') depthEl.play().catch(e => console.error(`Layer ${layer.id} depth video play error:`, e));
            if (alphaEl && alphaEl.tagName === 'VIDEO') alphaEl.play().catch(e => console.error(`Layer ${layer.id} alpha video play error:`, e));

        } // End for loop
    } catch (error) {
        if (error.message === "Load session invalidated") {
            console.log("Layer loading aborted due to session invalidation.");
        } else {
            console.error("EXCEPTION during layer loading:", error);
            alert("An error occurred while loading the layer media. Check console for details.");
        }
    } finally {
        // Revoke IMAGE blob URLs after a short delay
        setTimeout(() => {
            urlsToRevoke.forEach(url => { if (url) URL.revokeObjectURL(url); });
        }, 500);
    }

     // --- Check session again ---
    if (localSessionId !== currentLoadSessionId) { console.warn("Load session invalidated before final apply steps. Aborting."); closeLayerModal(); return; }

    // 9. Apply color layer background
    const backgroundButton = document.getElementById('backgroundButton');
    if (colorLayer) {
        solidBackgroundColor.set(colorLayer.colorValue); useSolidBackground = true;
        const solidBgCheckbox = document.getElementById('useSolidBgCheckbox'); if (solidBgCheckbox) solidBgCheckbox.checked = true;
        const solidBgPicker = document.getElementById('solidBgColorPicker'); if (solidBgPicker) solidBgPicker.value = colorLayer.colorValue;
        if (renderer) renderer.setClearColor(solidBackgroundColor, 1.0);
        if(backgroundButton) backgroundButton.disabled = true;
        colorLayer.sources = { color: colorLayer.colorValue, depth: null, alpha: null};
        mediaLayers.push(colorLayer);
        console.log("Solid background color layer applied.");
    } else {
        useSolidBackground = false;
        const solidBgCheckbox = document.getElementById('useSolidBgCheckbox'); if (solidBgCheckbox) solidBgCheckbox.checked = false;
        if (renderer) renderer.setClearColor(0x000000, 0);
        if(backgroundButton) backgroundButton.disabled = false;
    }

    // Ensure Pyramids Initialized if only Color Layer (or if mesh loading failed)
    if (!firstLayerLoaded && (colorLayer || validMeshLayers.length > 0)) {
         console.log("No mesh layers successfully loaded, or only color layer applied.");
         if (renderer && renderer.domElement && (currentRTWidth === 0 || currentRTHeight === 0)) {
              console.log("Ensuring pyramids are initialized based on renderer size as fallback.");
              resizeRendererAndTargets(renderer.domElement.width, renderer.domElement.height);
         }
    }

    // Update debug info
    const firstMeshLayer = mediaLayers.find(l => l.mesh);
    if(firstMeshLayer) {
        const geom = firstMeshLayer.mesh.geometry;
        const segmentsW = geom.parameters.widthSegments || 0; const segmentsH = geom.parameters.heightSegments || 0;
        updateActualDebugInfo(currentSourceWidthForOptimalCalc, currentSourceHeightForOptimalCalc, segmentsW, segmentsH, geom.attributes.position.count);
    } else if (!colorLayer) {
        updateActualDebugInfo('-', '-', null, null, 0); currentSourceWidthForOptimalCalc = 0; currentSourceHeightForOptimalCalc = 0; calculateAndDisplayOptimalVertices();
    } else if (colorLayer && !firstMeshLayer) {
        currentSourceWidthForOptimalCalc = renderer.domElement.width; currentSourceHeightForOptimalCalc = renderer.domElement.height; calculateAndDisplayOptimalVertices();
        updateActualDebugInfo(currentSourceWidthForOptimalCalc, currentSourceHeightForOptimalCalc, 1, 1, 4);
    }

    // Update face tracker baseline if needed
    if (!initialBaselinePending && canvasElement) { setFaceTrackerBaselineOffset(canvasElement); }

    console.log("Final check before closing modal - pullPyramidTargets length:", pullPyramidTargets.length);
    if (pullPyramidTargets.length === 0 && (mediaLayers.some(l => l.mesh) || wireframeCubes.length > 0)) {
         console.error("CRITICAL: Pyramids are STILL empty after applyLayers finished, but mesh content exists!");
    }

    console.log("=== APPLY LAYERS END ===\n");
    closeLayerModal(); // Close modal normally
}

// ===== DIAGNOSTIC COMPARISON FUNCTION =====
// Call this from the console to compare state between working and non-working loads
function diagnoseRenderState() {
    console.log("\n========== RENDER STATE DIAGNOSTIC ==========");
    
    // Scene state
    console.log("\n--- SCENE STATE ---");
    console.log("scene.children.length:", scene.children.length);
    console.log("scene.children:", scene.children);
    console.log("mediaLayers.length:", mediaLayers.length);
    console.log("mediaLayers:", mediaLayers);
    
    // Camera state
    console.log("\n--- CAMERA STATE ---");
    console.log("camera.position:", camera.position.toArray());
    console.log("camera.rotation:", camera.rotation.toArray());
    console.log("camera.fov:", camera.fov);
    console.log("camera.near:", camera.near);
    console.log("camera.far:", camera.far);
    console.log("camera.aspect:", camera.aspect);
    console.log("camera.projectionMatrix:", camera.projectionMatrix.toArray());
    camera.updateProjectionMatrix();
    console.log("camera.projectionMatrix (after update):", camera.projectionMatrix.toArray());
    
    // Renderer state
    console.log("\n--- RENDERER STATE ---");
    console.log("renderer.domElement.width:", renderer.domElement.width);
    console.log("renderer.domElement.height:", renderer.domElement.height);
    console.log("renderer.getSize():", renderer.getSize(new THREE.Vector2()));
    console.log("renderer.getPixelRatio():", renderer.getPixelRatio());
    console.log("renderer.getClearColor():", renderer.getClearColor(new THREE.Color()));
    console.log("renderer.getClearAlpha():", renderer.getClearAlpha());
    
    // Layer-specific state
    if (mediaLayers.length > 0) {
        console.log("\n--- LAYER DETAILS ---");
        mediaLayers.forEach((layer, i) => {
            console.log(`\nLayer ${i} (${layer.id}):`);
            console.log("  type:", layer.type);
            console.log("  mesh:", layer.mesh);
            
            if (layer.mesh) {
                console.log("  mesh.visible:", layer.mesh.visible);
                console.log("  mesh.position:", layer.mesh.position.toArray());
                console.log("  mesh.rotation:", layer.mesh.rotation.toArray());
                console.log("  mesh.scale:", layer.mesh.scale.toArray());
                console.log("  mesh.renderOrder:", layer.mesh.renderOrder);
                console.log("  mesh.frustumCulled:", layer.mesh.frustumCulled);
                console.log("  mesh.matrixAutoUpdate:", layer.mesh.matrixAutoUpdate);
                
                if (layer.mesh.geometry) {
                    console.log("  geometry.type:", layer.mesh.geometry.type);
                    console.log("  geometry.parameters:", layer.mesh.geometry.parameters);
                    console.log("  geometry attributes:", Object.keys(layer.mesh.geometry.attributes));
                }
                
                if (layer.mesh.material) {
                    console.log("  material.type:", layer.mesh.material.type);
                    console.log("  material.visible:", layer.mesh.material.visible);
                    console.log("  material.transparent:", layer.mesh.material.transparent);
                    console.log("  material.opacity:", layer.mesh.material.opacity);
                    console.log("  material.side:", layer.mesh.material.side);
                    console.log("  material.depthTest:", layer.mesh.material.depthTest);
                    console.log("  material.depthWrite:", layer.mesh.material.depthWrite);
                    
                    if (layer.mesh.material.uniforms) {
                        console.log("  material.uniforms keys:", Object.keys(layer.mesh.material.uniforms));
                        
                        // Check key textures
                        if (layer.mesh.material.uniforms.map) {
                            const tex = layer.mesh.material.uniforms.map.value;
                            console.log("  map texture:", tex);
                            if (tex) {
                                console.log("    texture.image:", tex.image);
                                console.log("    texture.needsUpdate:", tex.needsUpdate);
                                console.log("    texture.version:", tex.version);
                            }
                        }
                        
                        if (layer.mesh.material.uniforms.depthMap) {
                            const tex = layer.mesh.material.uniforms.depthMap.value;
                            console.log("  depthMap texture:", tex);
                            if (tex) {
                                console.log("    texture.image:", tex.image);
                                console.log("    texture.needsUpdate:", tex.needsUpdate);
                                console.log("    texture.version:", tex.version);
                            }
                        }
                        
                        if (layer.mesh.material.uniforms.displacementMap) {
                            const tex = layer.mesh.material.uniforms.displacementMap.value;
                            console.log("  displacementMap texture:", tex);
                            if (tex) {
                                console.log("    texture.image:", tex.image);
                                console.log("    texture.needsUpdate:", tex.needsUpdate);
                                console.log("    texture.version:", tex.version);
                            } else {
                                console.error("    ❌ displacementMap texture is NULL!");
                            }
                        } else {
                            console.warn("  ⚠️  displacementMap uniform missing from material!");
                        }
                    }
                }
            }
            
            console.log("  textures:", {
                color: layer.textures?.color ? "present" : "missing",
                depth: layer.textures?.depth ? "present" : "missing",
                alpha: layer.textures?.alpha ? "present" : "missing"
            });
            
            console.log("  elements:", {
                color: layer.elements?.color ? layer.elements.color.tagName : "missing",
                depth: layer.elements?.depth ? layer.elements.depth.tagName : "missing",
                alpha: layer.elements?.alpha ? layer.elements.alpha.tagName : "missing"
            });
        });
    }
    
    // Global state
    console.log("\n--- GLOBAL STATE ---");
    console.log("useInpainting:", useInpainting);
    console.log("currentInpaintingMethod:", currentInpaintingMethod);
    console.log("currentEdgeMethod:", currentEdgeMethod);
    console.log("portalPlaneWorldZ:", portalPlaneWorldZ);
    console.log("currentNormPortalPlane:", currentNormPortalPlane);
    console.log("contentAspectRatio:", contentAspectRatio);
    console.log("isClearing:", isClearing);
    console.log("currentLoadSessionId:", currentLoadSessionId);
    
    // Render targets
    console.log("\n--- RENDER TARGETS ---");
    console.log("sceneRenderTarget:", sceneRenderTarget);
    console.log("  width:", sceneRenderTarget?.width);
    console.log("  height:", sceneRenderTarget?.height);
    
    // Pyramid targets
    console.log("\n--- PYRAMID TARGETS ---");
    console.log("pullPyramidTargets.length:", pullPyramidTargets.length);
    console.log("pushPyramidTargets.length:", pushPyramidTargets.length);
    console.log("currentRTWidth:", currentRTWidth);
    console.log("currentRTHeight:", currentRTHeight);
    if (pullPyramidTargets.length === 0) {
        console.error("  ❌ CRITICAL: pullPyramidTargets is EMPTY!");
        console.error("  This will cause render loop to exit early with no output!");
    } else {
        console.log("  ✓ Pyramid targets populated");
        console.log("  First level dimensions:", pullPyramidTargets[0].width, "x", pullPyramidTargets[0].height);
    }
    
    console.log("\n========== END DIAGNOSTIC ==========\n");
    
    // Try a test render
    console.log("Attempting test render...");
    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(scene, camera);
    console.log("Test render complete");
}

// Expose to window for console access
window.diagnoseRenderState = diagnoseRenderState;


// --- clearCurrentVisuals ---
// MODIFIED: Added check for isApplyingLayers BEFORE invalidating session
async function clearCurrentVisuals(invalidateSession = true) { // Added parameter with default true
    // --- VERY FIRST LINE: Log the received parameter ---
    console.log(`---> ENTERING clearCurrentVisuals | Received invalidateSession: ${invalidateSession} | isClearing: ${isClearing} | isApplyingLayers: ${isApplyingLayers}`);
    // --- END LOG ---

    // --- FIX: Prevent re-entrancy ---
    if (isClearing) {
        console.warn("clearCurrentVisuals called while already clearing. Aborting duplicate call.");
        return; // Exit if already clearing
    }
    // --- END FIX ---

    // 0. Invalidate pending loads (Optional) & Set lock
    // --- MODIFICATION: Check isApplyingLayers flag HERE ---
    let shouldInvalidate = invalidateSession && !isApplyingLayers; // Only invalidate if requested AND not part of an apply operation
    if (shouldInvalidate) {
        currentLoadSessionId++;
        console.log(">>> Invalidating Session! New ID:", currentLoadSessionId); // Highlight this log
    } else {
        console.log(`>>> Session NOT Invalidated. (Requested: ${invalidateSession}, isApplying: ${isApplyingLayers}). Current ID: ${currentLoadSessionId}`); // Highlight this log
    }
    // --- END MODIFICATION ---

    isClearing = true; // Set lock *after* re-entrancy check and session logic
    console.log("Render lock ON (isClearing = true)");

    // 1. Dispose of old single-media elements (legacy)
    if (separatedVideoRGB) {separatedVideoRGB.pause(); separatedVideoRGB.srcObject = null; separatedVideoRGB.removeAttribute('src'); separatedVideoRGB.load(); separatedVideoRGB = null;}
    if (separatedVideoDepth) {separatedVideoDepth.pause(); separatedVideoDepth.srcObject = null; separatedVideoDepth.removeAttribute('src'); separatedVideoDepth.load(); separatedVideoDepth = null;}
    videoContentElementGlobal.pause();
    videoContentElementGlobal.srcObject = null; videoContentElementGlobal.removeAttribute('src'); videoContentElementGlobal.load();

    // 1.5 Stop media elements BEFORE disposing resources.
    console.log("Stopping media elements...");
    for (const layer of mediaLayers) {
        if (layer.elements) {
            const stopMedia = (el) => {
              if (el && el.tagName === 'VIDEO') {
                  el.pause(); el.srcObject = null; el.removeAttribute('src'); el.load();
                  // Check if src is a blob URL before revoking
                  if (el.src && el.src.startsWith('blob:')) {
                      // Don't revoke here if it's in activeVideoUrls, revoke later
                      if (!activeVideoUrls.includes(el.src)) {
                           URL.revokeObjectURL(el.src);
                      }
                  }
              } else if (el && el.tagName === 'IMG') {
                  if (el.src && el.src.startsWith('blob:')) URL.revokeObjectURL(el.src);
                  el.removeAttribute('src');
              }
            };
            stopMedia(layer.elements.color);
            stopMedia(layer.elements.depth);
            stopMedia(layer.elements.alpha);
        }
    }
    console.log("Media elements stopped.");

    // 2. Clear all layers from the scene and dispose THREE resources
    console.log(`Disposing ${mediaLayers.length} layers...`);
    // Create a copy to iterate over, as scene.remove modifies children array
    const layersToRemove = [...mediaLayers];
    for (const layer of layersToRemove) {
        if (layer.mesh) {
            if (scene) scene.remove(layer.mesh);
            else console.warn("Scene not found during mesh removal");

            if (layer.mesh.geometry) layer.mesh.geometry.dispose();
            if (layer.mesh.material) {
                // Dispose textures held directly by the material if they exist
                 const uniforms = layer.mesh.material.uniforms;
                 if (uniforms) {
                    // Check common texture uniform names
                    ['map', 'displacementMap', 'rgbTexture', 'depthTexture', 'u_alphaMap', 'videoTexture'].forEach(key => {
                        if (uniforms[key] && uniforms[key].value instanceof THREE.Texture) {
                            uniforms[key].value.dispose();
                            // Optional: Nullify uniform value after disposal
                            // uniforms[key].value = null;
                        }
                    });
                 }
                layer.mesh.material.dispose();
            }
             layer.mesh = null; // Nullify mesh reference AFTER disposal
             // console.log(`Layer ${layer.id} mesh disposed.`); // Keep logging minimal
        }
        // Dispose textures stored in the layer object itself (redundant but safe)
        if (layer.textures) {
            if (layer.textures.color instanceof THREE.Texture) layer.textures.color.dispose();
            if (layer.textures.depth instanceof THREE.Texture) layer.textures.depth.dispose();
            if (layer.textures.alpha instanceof THREE.Texture) layer.textures.alpha.dispose();
            layer.textures = null;
        }
         layer.elements = null; // Nullify element references
    }
    mediaLayers = []; // Empty the global array AFTER processing all layers in it
    console.log("mediaLayers array cleared.");

    // Revoke any remaining active video URLs
    console.log(`Revoking ${activeVideoUrls.length} active video URLs...`);
    activeVideoUrls.forEach(url => { if (url) URL.revokeObjectURL(url); }); // Added check for null/undefined url
    activeVideoUrls = [];
    console.log("Active video URLs revoked and cleared.");

    // 3. Clear wireframes
    console.log(`Disposing ${wireframeCubes.length} wireframes...`);
     const wireframesToRemove = [...wireframeCubes];
    wireframesToRemove.forEach(c => {
        if (scene) scene.remove(c);
        else console.warn("Scene not found during wireframe removal");
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
    });
    wireframeCubes = [];
    console.log("Wireframes cleared.");

    // 3.5. Reset Pull-Push Pyramids dimensions to force re-init
    // We don't dispose here anymore, disposal happens in initializePyramidTargets if needed
    currentRTWidth = 0;
    currentRTHeight = 0;
    console.log("Pyramid target dimensions reset, will re-initialize on next resize/load.");

    // 4. Reset UI and state
    updateVolumeGuidesVisibility(false);
    updateActualDebugInfo('-', '-', null, null, 0);
    currentSourceWidthForOptimalCalc = 0;
    currentSourceHeightForOptimalCalc = 0;
    calculateAndDisplayOptimalVertices();
    baselineFaceTrackerOffsetX = 0;
    baselineFaceTrackerOffsetY = 0;
    console.log("UI and state reset.");

    // IMPORTANT: Wait a frame using requestAnimationFrame before releasing the lock
    await new Promise(resolve => requestAnimationFrame(resolve));
    isClearing = false; // Release lock at the very end
    console.log("Clearing visuals complete. Render lock released (isClearing = false).");
}

// --- setupMeshWithMedia ---
// (No changes needed)
function setupMeshWithMedia(layer) {
    const isVideo = layer.type === 'video' || layer.type === 'sidebyside' || (layer.elements?.color?.tagName === 'VIDEO');
    const colorEl = layer.elements.color;
    if (!colorEl) {
        console.error("Layer has no color element to set up mesh.", layer);
        return;
    }

    const effectiveWidth = isVideo ? colorEl.videoWidth : colorEl.naturalWidth;
    const effectiveHeight = isVideo ? colorEl.videoHeight : colorEl.naturalHeight;

    contentAspectRatio = effectiveWidth / effectiveHeight;
    currentSourceWidthForOptimalCalc = effectiveWidth;
    currentSourceHeightForOptimalCalc = effectiveHeight;
    calculateAndDisplayOptimalVertices();

    if (depthQueryCanvas) {
        depthQueryCanvas.width = effectiveWidth;
        depthQueryCanvas.height = effectiveHeight;
    }

    // REMOVED: Don't resize renderer based on content!
    // Renderer stays at fixed 16:9 (960×540) matching camera aspect
    // if (renderer && camera) {
    //     resizeRendererAndTargets(effectiveWidth, effectiveHeight);
    // }

    let segmentsW = Math.max(1, Math.round((effectiveWidth / MESH_DENSITY_FACTOR) - 1));
    let segmentsH = Math.max(1, Math.round((effectiveHeight / MESH_DENSITY_FACTOR) - 1));

    console.log(`Media content (${layer.type}). Using mesh segments: ${segmentsW}x${segmentsH}`);
    
    // Calculate this layer's aspect ratio and fit to frame
    const layerAspect = effectiveWidth / effectiveHeight;
    const frameAspect = terrariumWidth / terrariumHeight;
    
    let layerWidth, layerHeight;
    if (layerAspect > frameAspect) {
        // Layer is wider - fit to width
        layerWidth = terrariumWidth;
        layerHeight = terrariumWidth / layerAspect;
        console.log(`Layer is WIDE (${layerAspect.toFixed(2)}:1) - fitting to width`);
    } else {
        // Layer is taller - fit to height
        layerHeight = terrariumHeight;
        layerWidth = terrariumHeight * layerAspect;
        console.log(`Layer is TALL (${layerAspect.toFixed(2)}:1) - fitting to height`);
    }
    
    const geom = new THREE.PlaneGeometry(layerWidth, layerHeight, segmentsW, segmentsH);
    console.log(`Geometry: ${layerWidth.toFixed(4)}×${layerHeight.toFixed(4)}`);

    // Create default flat depth texture if missing
    if (!layer.textures.depth) {
        console.log('No depth texture found, creating flat default depth texture');
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgb(128, 128, 128)'; // Mid-gray = 0.5 depth
        ctx.fillRect(0, 0, 1, 1);
        layer.textures.depth = new THREE.Texture(canvas);
        layer.textures.depth.needsUpdate = true;
    }

    const mat = createShaderMaterial(
        layer.type === 'sidebyside' ? 'sidebyside' : (layer.type === 'image' ? 'image' : 'separated'), // Determine correct mode
        layer.textures.color,
        layer.textures.depth,
        layer.textures.alpha
    );

    // --- ADD THIS LINE ---
    mat.uniforms.u_textureSize.value.set(effectiveWidth, effectiveHeight);
    // --- END ADDITION ---

    layer.mesh = new THREE.Mesh(geom, mat);
    layer.mesh.position.z = portalPlaneWorldZ;
    layer.mesh.renderOrder = 0; // Only one layer in this legacy path
    scene.add(layer.mesh);

    // octopusMesh = layer.mesh; // *** THIS LINE IS REMOVED ***

    updateActualDebugInfo(effectiveWidth, effectiveHeight, segmentsW, segmentsH, geom.attributes.position.count);

    if (!initialBaselinePending && canvasElement) {
      setFaceTrackerBaselineOffset(canvasElement);
    }
}


// --- loadImage, loadVideo ---
// MODIFIED: Ensure layer structure matches the new format used in multi-layer
function loadImage() {
  clearCurrentVisuals(); // This increments the session ID

  const sessionId = currentLoadSessionId; // FIX: Capture the ID for this session

  const imageLayer = {
      id: `layer_${nextLayerId++}`,
      type: 'image',
      sources: { color: 'roomImg.png', depth: 'roomDepth.png', alpha: null },
      fileInfo: {
          color: { name: 'roomImg.png', type: 'image/png'},
          depth: { name: 'roomDepth.png', type: 'image/png'},
          alpha: null
      },
      elements: { color: new Image(), depth: new Image(), alpha: null },
      textures: { color: null, depth: null, alpha: null },
      mesh: null
  };

  const imgColor = imageLayer.elements.color;
  const imgDepth = imageLayer.elements.depth;

  imgColor.onload = function () {
    // FIX: Check if session is stale
    if (currentLoadSessionId !== sessionId) {
        console.warn("Stale loadImage (color) detected and ignored.");
        return;
    }
    
    imgDepth.onload = function () {
      // FIX: Check again before processing
      if (currentLoadSessionId !== sessionId) {
          console.warn("Stale loadImage (depth) detected and ignored.");
          return;
      }
      const tex = new THREE.Texture(imgColor); tex.needsUpdate = true;
      const dTex = new THREE.Texture(imgDepth); dTex.needsUpdate = true;
      imageLayer.textures.color = tex;
      imageLayer.textures.depth = dTex;
      setupMeshWithMedia(imageLayer);
      mediaLayers.push(imageLayer);
    };
    imgDepth.onerror = () => console.error("Error loading default depth image");
    imgDepth.src = imageLayer.sources.depth;
  };
   imgColor.onerror = () => console.error("Error loading default color image");
  imgColor.src = imageLayer.sources.color;
}

function loadVideo() {
  clearCurrentVisuals(); // This increments the session ID

  const sessionId = currentLoadSessionId; // FIX: Capture the ID for this session

  if (videoMode === "sidebyside") {
    const sbsLayer = {
        id: `layer_${nextLayerId++}`,
        type: 'sidebyside',
        sources: { color: 'video-depth.mp4', depth: null, alpha: null },
         fileInfo: {
             color: { name: 'video-depth.mp4', type: 'video/mp4'},
             depth: null, alpha: null
         },
        elements: { color: document.createElement('video'), depth: null, alpha: null },
        textures: { color: null, depth: null, alpha: null },
        mesh: null
    };
    const videoEl = sbsLayer.elements.color;
    Object.assign(videoEl, { autoplay: true, loop: true, muted: true, playsInline: true });

    videoEl.onloadedmetadata = function () {
      // FIX: Check if session is stale
      if (currentLoadSessionId !== sessionId) {
          console.warn("Stale loadVideo (SBS) detected and ignored.");
          videoEl.pause(); // Stop the video element if stale
          return;
      }
      if (!videoEl.videoWidth || !videoEl.videoHeight) { console.error("SBS video metadata error."); return; }
      const videoTex = new THREE.VideoTexture(videoEl);
      sbsLayer.textures.color = videoTex;
      setupMeshWithMedia(sbsLayer);
      mediaLayers.push(sbsLayer);
      videoEl.play().catch(e=>console.error("SBS video play error:",e.message));
    };
    videoEl.onerror = () => console.error("Error loading SBS video");
    videoEl.src = sbsLayer.sources.color;
    videoEl.load();

  } else { // "separated" mode
      const sepLayer = {
        id: `layer_${nextLayerId++}`,
        type: 'separated',
        sources: { color: 'video-rgb.mp4', depth: 'video-depth.mp4', alpha: null },
         fileInfo: {
             color: { name: 'video-rgb.mp4', type: 'video/mp4'},
             depth: { name: 'video-depth.mp4', type: 'video/mp4'},
             alpha: null
         },
        elements: { color: document.createElement('video'), depth: document.createElement('video'), alpha: null },
        textures: { color: null, depth: null, alpha: null },
        mesh: null
      };
      const vidColor = sepLayer.elements.color;
      const vidDepth = sepLayer.elements.depth;
      const commonVidProps = { autoplay: true, loop: true, muted: true, playsInline: true };
      Object.assign(vidColor, commonVidProps);
      Object.assign(vidDepth, commonVidProps);

      let loadedCount = 0;
      function checkSepLoaded(){
          // FIX: Check if session is stale
          if (currentLoadSessionId !== sessionId) {
              if (loadedCount === 0) {
                  console.warn("Stale loadVideo (Separated) detected and ignored.");
                  vidColor.pause();
                  vidDepth.pause();
              }
              loadedCount++;
              return;
          }

          loadedCount++;
          if(loadedCount===2){
              if(!vidColor.videoWidth || !vidColor.videoHeight || !vidDepth.videoWidth || !vidDepth.videoHeight){ console.error("Separated videos metadata error."); return; }
              const rgbT = new THREE.VideoTexture(vidColor);
              const dphT = new THREE.VideoTexture(vidDepth);
              sepLayer.textures.color = rgbT;
              sepLayer.textures.depth = dphT;
              setupMeshWithMedia(sepLayer);
              mediaLayers.push(sepLayer);
              vidColor.play().catch(e=>console.error("Sep RGB play error:",e.message));
              vidDepth.play().catch(e=>console.error("Sep Depth play error:",e.message));
          }
      }
      vidColor.onloadedmetadata = checkSepLoaded;
      vidDepth.onloadedmetadata = checkSepLoaded;
       vidColor.onerror = () => console.error("Error loading separated color video");
       vidDepth.onerror = () => console.error("Error loading separated depth video");
      vidColor.src = sepLayer.sources.color;
      vidDepth.src = sepLayer.sources.depth;
      vidColor.load();
      vidDepth.load();
  }
}


// --- loadCustomImage, loadCustomVideo ---
// MODIFIED: Ensure layer structure matches new format
function loadCustomImage() {
    const colorInput = document.getElementById('imageColorInput');
    const depthInput = document.getElementById('imageDepthInput');
    const colorFile = colorInput.files[0];
    const depthFile = depthInput.files[0];

    if (!colorFile || !depthFile) { alert("Please select both files."); return; }

    clearCurrentVisuals();

    const imageLayer = {
        id: `layer_${nextLayerId++}`,
        type: 'image',
        sources: { color: colorFile, depth: depthFile, alpha: null },
        fileInfo: {
             color: { name: colorFile.name, type: colorFile.type },
             depth: { name: depthFile.name, type: depthFile.type },
             alpha: null
        },
        elements: { color: new Image(), depth: new Image(), alpha: null },
        textures: { color: null, depth: null, alpha: null },
        mesh: null
    };

    const colorUrl = URL.createObjectURL(colorFile);
    const depthUrl = URL.createObjectURL(depthFile);
    imageLayer.elements.color.src = colorUrl;
    imageLayer.elements.depth.src = depthUrl;

    let loadedCount = 0;
    const checkBothLoaded = () => {
        loadedCount++;
        if (loadedCount === 2) {
            const tex = new THREE.Texture(imageLayer.elements.color); tex.needsUpdate = true;
            const dTex = new THREE.Texture(imageLayer.elements.depth); dTex.needsUpdate = true;
            imageLayer.textures.color = tex;
            imageLayer.textures.depth = dTex;
            setupMeshWithMedia(imageLayer);
            mediaLayers.push(imageLayer);
            URL.revokeObjectURL(colorUrl); URL.revokeObjectURL(depthUrl);
        }
    };
    imageLayer.elements.color.onload = checkBothLoaded;
    imageLayer.elements.depth.onload = checkBothLoaded;
    imageLayer.elements.color.onerror = () => { URL.revokeObjectURL(colorUrl); console.error("Err img color"); }
    imageLayer.elements.depth.onerror = () => { URL.revokeObjectURL(depthUrl); console.error("Err img depth"); }
}

function loadCustomVideo() {
    const colorInput = document.getElementById('videoColorInput');
    const depthInput = document.getElementById('videoDepthInput');
    const colorFile = colorInput.files[0];
    const depthFile = depthInput.files[0];

    if (!colorFile || !depthFile) { alert("Please select both files."); return; }

    clearCurrentVisuals();

    const colorUrl = URL.createObjectURL(colorFile);
    const depthUrl = URL.createObjectURL(depthFile);

    const videoLayer = {
        id: `layer_${nextLayerId++}`,
        type: 'separated', // Always separated for custom video upload
        sources: { color: colorFile, depth: depthFile, alpha: null },
         fileInfo: {
             color: { name: colorFile.name, type: colorFile.type },
             depth: { name: depthFile.name, type: depthFile.type },
             alpha: null
        },
        elements: { color: document.createElement('video'), depth: document.createElement('video'), alpha: null },
        textures: { color: null, depth: null, alpha: null },
        mesh: null
    };

    videoMode = "separated";
    document.getElementById('toggleVideoModeButton').textContent = `Video Mode: Separated`;

    const commonProps = { autoplay: true, loop: true, muted: true, playsInline: true };
    Object.assign(videoLayer.elements.color, commonProps, { src: colorUrl });
    Object.assign(videoLayer.elements.depth, commonProps, { src: depthUrl });

    let loadedCount = 0;
    const checkBothLoaded = () => {
        loadedCount++;
        if (loadedCount === 2) {
            const rgbTexture = new THREE.VideoTexture(videoLayer.elements.color);
            const depthTexture = new THREE.VideoTexture(videoLayer.elements.depth);
            videoLayer.textures.color = rgbTexture;
            videoLayer.textures.depth = depthTexture;
            setupMeshWithMedia(videoLayer);
            mediaLayers.push(videoLayer);
            videoLayer.elements.color.play().catch(e => console.error("Custom RGB vid play err:", e));
            videoLayer.elements.depth.play().catch(e => console.error("Custom depth vid play err:", e));
            URL.revokeObjectURL(colorUrl); URL.revokeObjectURL(depthUrl);
        }
    };
    videoLayer.elements.color.onloadedmetadata = checkBothLoaded;
    videoLayer.elements.depth.onloadedmetadata = checkBothLoaded;
    videoLayer.elements.color.onerror = () => { URL.revokeObjectURL(colorUrl); console.error("Err vid color"); }
    videoLayer.elements.depth.onerror = () => { URL.revokeObjectURL(depthUrl); console.error("Err vid depth"); }
    videoLayer.elements.color.load();
    videoLayer.elements.depth.load();
}


// ===================================================================
// START: NEW toggleVideoPlaybackInternal
// (Replaces the old function at lines 2087-2127)
// ===================================================================
function toggleVideoPlaybackInternal() {
  const vidsToToggle = getAllVideoElements(); // Use the new helper
  const playPauseBtnHTML = document.getElementById('playPauseButton');

  if (vidsToToggle.length > 0 && playPauseBtnHTML) {
      const firstValidVideo = vidsToToggle[0];
      if (!firstValidVideo) { console.warn("No valid video to toggle playback."); return; }
      
      // Check if ANY video is paused. If so, play all. Otherwise, pause all.
      const shouldPlay = vidsToToggle.some(v => v.paused);

      vidsToToggle.forEach(v => {
          if (shouldPlay) {
              v.play().catch(e => console.error("Video play error:", e.message, v.src));
          } else { 
              v.pause(); 
          }
      });
      playPauseBtnHTML.textContent = shouldPlay ? 'Pause' : 'Play';
  } else if (playPauseBtnHTML) { 
      playPauseBtnHTML.textContent = 'Play'; // Default to 'Play'
  }
}
// ===================================================================
// END: NEW toggleVideoPlaybackInternal
// ===================================================================

// --- MODIFIED: Iterates over new layer system ---
function toggleVideoLoopInternal() {
   let vidsToLoop = [];

   // NEW: Get videos from all layers
   for (const layer of mediaLayers) {
       if ((layer.type === 'video' || layer.type === 'separated') && layer.elements) {
           if (layer.elements.color) vidsToLoop.push(layer.elements.color);
           if (layer.elements.depth) vidsToLoop.push(layer.elements.depth);
           if (layer.elements.alpha) vidsToLoop.push(layer.elements.alpha);
       } else if (layer.type === 'sidebyside' && layer.elements) {
           if (layer.elements.color) vidsToLoop.push(layer.elements.color);
       }
   }

   // Also include old globals (if any, though they should be in layers now)
   if (videoMode === "sidebyside" && videoContentElementGlobal && !mediaLayers.some(l => l.elements.color === videoContentElementGlobal)) {
      vidsToLoop.push(videoContentElementGlobal);
   }
   else if (videoMode === "separated") {
       if(separatedVideoRGB && !mediaLayers.some(l => l.elements.color === separatedVideoRGB)) vidsToLoop.push(separatedVideoRGB);
       if(separatedVideoDepth && !mediaLayers.some(l => l.elements.depth === separatedVideoDepth)) vidsToLoop.push(separatedVideoDepth);
   }

  const loopBtnHTML = document.getElementById('loopButton');
  if (vidsToLoop.length > 0 && loopBtnHTML) {
      const firstValidVideo = vidsToLoop.find(v => v);
      if (!firstValidVideo) { console.warn("No valid video to toggle loop."); return; }
      const newLoopState = !firstValidVideo.loop;
      vidsToLoop.forEach(v=> { if(v) v.loop=newLoopState });
      loopBtnHTML.textContent = `Loop: ${newLoopState?'On':'Off'}`;
  } else if (loopBtnHTML) { loopBtnHTML.textContent = 'Loop: Off'; }
}


function initializeSceneAndRenderer() {
    const canvasWidth = 960; const canvasHeight = 540;

    scene = new THREE.Scene();
    // IMPORTANT: Camera aspect is fixed to frame aspect (terrariumWidth/terrariumHeight)
    // This ensures consistent projection for all layers regardless of their individual aspects
    const frameAspect = terrariumWidth / terrariumHeight; // 0.16 / 0.09 = 1.778 (16:9)
    camera = new THREE.PerspectiveCamera(initialFov, frameAspect, 0.001, 1000);
    const initialCamDistFromSubject = (dollyMinDistance + dollyMaxDistance) / 2;
    camera.position.z = subjectFocalPlaneWorldZ + initialCamDistFromSubject;

    renderer = new THREE.WebGLRenderer({ canvas: canvasElement, antialias: true, alpha: true });
    renderer.dithering = true; // <-- ADD THIS
    renderer.setSize(canvasWidth, canvasHeight);
    renderer.setClearColor(0x000000, 0); // Default transparent background

    // --- Render Targets ---
    const defaultTargetOptions = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat };
    const jfaTargetOptions = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat, type: THREE.FloatType }; // JFA needs Nearest
    const finalInpaintTargetOptions = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat }; // For smooth final output

    // moebius.js: approx line 2496
    sceneRenderTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        
        // --- START FIX: Robust DepthTexture Configuration ---
        depthBuffer: true,     // Ensure the depth buffer is active
        stencilBuffer: false,  // CRITICAL: Disable stencil buffer for FloatType
        depthTexture: new THREE.DepthTexture(
            canvasWidth, 
            canvasHeight, 
            THREE.FloatType // Use FloatType for high precision
        )
        // --- END FIX ---
    });

    edgeMaskRenderTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, defaultTargetOptions);
    lumaRenderTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, defaultTargetOptions);
    blurRenderTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, defaultTargetOptions);
    gradientRenderTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, { ...defaultTargetOptions, type: THREE.FloatType });
    nmsRenderTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, defaultTargetOptions);

    jfaPingTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, jfaTargetOptions);
    jfaPongTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, jfaTargetOptions);

    pingPongRenderTargetA = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, { minFilter: THREE.LinearFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat });
    pingPongRenderTargetB = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, { ...defaultTargetOptions, depthTexture: new THREE.DepthTexture() });

    // --- START: MODIFICATION ---
    // NEW: FG/BG Targets
    // layerMaskTarget only needs NearestFilter
    layerMaskTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, defaultTargetOptions);
    // Inpainted targets should use LinearFilter for smooth results from push-pull
    const inpaintedTargetOptions = {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat
    };
    fgInpaintedTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, inpaintedTargetOptions);
    bgInpaintedTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, inpaintedTargetOptions);
    
    // NEW: Final target to hold inpainted result before dithering
    finalInpaintedTextureTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, finalInpaintTargetOptions);
    // --- END: MODIFICATION ---

    // This new target will hold the anti-aliased image before dithering
finalRenderPassTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, finalInpaintTargetOptions);

    // --- FIX: Standard Post-Processing Material Options ---
    // Explicitly disable blending to prevent blending with potentially stale framebuffers (ghosting).
    const standardPPOptions = {
        transparent: false,
        blending: THREE.NoBlending,
        depthTest: false,
        depthWrite: false
    };

// This is the standard Three.js FXAAShader
const FXAAShader = {
    uniforms: {
        'tDiffuse': { value: null },
        'resolution': { value: new THREE.Vector2(1.0 / canvasWidth, 1.0 / canvasHeight) }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = vec4( position, 1.0 );
        }`,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 resolution;
        varying vec2 vUv;

        #define FXAA_REDUCE_MIN   (1.0/128.0)
        #define FXAA_REDUCE_MUL   (1.0/8.0)
        #define FXAA_SPAN_MAX     8.0

        void main() {
            vec3 rgbNW = texture2D( tDiffuse, ( gl_FragCoord.xy + vec2( -1.0, -1.0 ) ) * resolution ).xyz;
            vec3 rgbNE = texture2D( tDiffuse, ( gl_FragCoord.xy + vec2( 1.0, -1.0 ) ) * resolution ).xyz;
            vec3 rgbSW = texture2D( tDiffuse, ( gl_FragCoord.xy + vec2( -1.0, 1.0 ) ) * resolution ).xyz;
            vec3 rgbSE = texture2D( tDiffuse, ( gl_FragCoord.xy + vec2( 1.0, 1.0 ) ) * resolution ).xyz;
            vec4 rgbaM = texture2D( tDiffuse, vUv );
            vec3 rgbM = rgbaM.xyz;
            float lumaNW = dot( rgbNW, vec3( 0.299, 0.587, 0.114 ) );
            float lumaNE = dot( rgbNE, vec3( 0.299, 0.587, 0.114 ) );
            float lumaSW = dot( rgbSW, vec3( 0.299, 0.587, 0.114 ) );
            float lumaSE = dot( rgbSE, vec3( 0.299, 0.587, 0.114 ) );
            float lumaM = dot( rgbM, vec3( 0.299, 0.587, 0.114 ) );
            float lumaMin = min( lumaM, min( min( lumaNW, lumaNE ), min( lumaSW, lumaSE ) ) );
            float lumaMax = max( lumaM, max( max( lumaNW, lumaNE ), max( lumaSW, lumaSE ) ) );
            
            vec2 dir;
            dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));
            dir.y =  ((lumaNW + lumaSW) - (lumaNE + lumaSE));
            
            float dirReduce = max( ( lumaNW + lumaNE + lumaSW + lumaSE ) * ( 0.25 * FXAA_REDUCE_MUL ), FXAA_REDUCE_MIN );
            
            float rcpDirMin = 1.0 / ( min( abs( dir.x ), abs( dir.y ) ) + dirReduce );
            dir = min( vec2( FXAA_SPAN_MAX, FXAA_SPAN_MAX ), max( vec2( -FXAA_SPAN_MAX, -FXAA_SPAN_MAX ), dir * rcpDirMin ) ) * resolution;
            
            vec3 rgbA = (1.0/2.0) * (
                texture2D( tDiffuse, vUv + dir * ( 1.0 / 3.0 - 0.5 ) ).xyz +
                texture2D( tDiffuse, vUv + dir * ( 2.0 / 3.0 - 0.5 ) ).xyz );
            vec3 rgbB = rgbA * (1.0/2.0) + (1.0/4.0) * (
                texture2D( tDiffuse, vUv + dir * ( 0.0 / 3.0 - 0.5 ) ).xyz +
                texture2D( tDiffuse, vUv + dir * ( 3.0 / 3.0 - 0.5 ) ).xyz );
            float lumaB = dot( rgbB, vec3( 0.299, 0.587, 0.114 ) );
            
            if ( ( lumaB < lumaMin ) || ( lumaB > lumaMax ) ) {
                gl_FragColor = vec4( rgbA, rgbaM.a );
            } else {
                gl_FragColor = vec4( rgbB, rgbaM.a );
            }
        }`
};

fxaaMaterial = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms),
    vertexShader: FXAAShader.vertexShader,
    fragmentShader: FXAAShader.fragmentShader,
    ...standardPPOptions // Use the same options as your other passes
});

// This new target will hold the sharpened image before dithering
sharpenTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, finalInpaintTargetOptions);

// This is a simple 3x3 sharpening kernel
sharpenMaterial = new THREE.ShaderMaterial({
    uniforms: {
        'tDiffuse': { value: null },
        'resolution': { value: new THREE.Vector2(1.0 / canvasWidth, 1.0 / canvasHeight) },
        'u_strength': { value: sharpenStrength }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = vec4( position, 1.0 );
        }`,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 resolution;
        uniform float u_strength;
        varying vec2 vUv;

        void main() {
            // Simple 3x3 sharpening kernel
            vec4 center = texture2D(tDiffuse, vUv);
            vec4 n = texture2D(tDiffuse, vUv + vec2(0.0, resolution.y));
            vec4 s = texture2D(tDiffuse, vUv - vec2(0.0, resolution.y));
            vec4 e = texture2D(tDiffuse, vUv + vec2(resolution.x, 0.0));
            vec4 w = texture2D(tDiffuse, vUv - vec2(resolution.x, 0.0));

            vec4 sharpened = 5.0 * center - (n + s + e + w);
            
            // Lerp between original and sharpened image based on strength
            gl_FragColor = mix(center, sharpened, u_strength);
            gl_FragColor.a = center.a; // Preserve original alpha
        }`,
    ...standardPPOptions 
});

    // NEW: Initialize Pyramid Targets (initial sizes)
    initializePyramidTargets(canvasWidth, canvasHeight);

    // --- Post-Processing Setup ---
    postProcessCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    postProcessScene = new THREE.Scene();
    const postProcessPlane = new THREE.PlaneGeometry(2, 2);

    // --- Edge Detection Materials ---
    lumaMaterial = new THREE.ShaderMaterial({
        uniforms: { tDiffuse: { value: null } },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tDiffuse; varying vec2 vUv;
            void main() {
                vec3 color = texture2D(tDiffuse, vUv).rgb;
                float luma = dot(color, vec3(0.299, 0.587, 0.114));
                gl_FragColor = vec4(vec3(luma), 1.0);
            }`,
        ...standardPPOptions // Apply the fix
    });

    sobelEdgeMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tDiffuse: { value: null },
            u_resolution: { value: new THREE.Vector2(canvasWidth, canvasHeight) },
            u_threshold: { value: 0.1 }
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tDiffuse; uniform vec2 u_resolution; uniform float u_threshold; varying vec2 vUv;
            float getSample(vec2 offset) { return texture2D(tDiffuse, vUv + offset).r; }
            void main() {
                vec2 texel = 1.0 / u_resolution;
                float gx = -1.0 * getSample(vec2(-texel.x, -texel.y)) + 1.0 * getSample(vec2(texel.x, -texel.y))
                         + -2.0 * getSample(vec2(-texel.x, 0.0))    + 2.0 * getSample(vec2(texel.x, 0.0))
                         + -1.0 * getSample(vec2(-texel.x, texel.y))  + 1.0 * getSample(vec2(texel.x, texel.y));
                float gy = -1.0 * getSample(vec2(-texel.x, -texel.y)) + -2.0 * getSample(vec2(0.0, -texel.y)) + -1.0 * getSample(vec2(texel.x, -texel.y))
                         +  1.0 * getSample(vec2(-texel.x, texel.y))  +  2.0 * getSample(vec2(0.0, texel.y))  +  1.0 * getSample(vec2(texel.x, texel.y));
                float magnitude = sqrt(gx * gx + gy * gy);
                float edge = step(u_threshold, magnitude);
                if (getSample(vec2(0.0)) < 0.001) gl_FragColor = vec4(0.0);
                else gl_FragColor = vec4(vec3(edge), 1.0);
            }`,
        ...standardPPOptions // Apply the fix
    });

    combineEdgesMaterial = new THREE.ShaderMaterial({
        uniforms: { tEdge1: { value: null }, tEdge2: { value: null } },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tEdge1; uniform sampler2D tEdge2; varying vec2 vUv;
            void main() {
                float edge1 = texture2D(tEdge1, vUv).r;
                float edge2 = texture2D(tEdge2, vUv).r;
                gl_FragColor = vec4(vec3(max(edge1, edge2)), 1.0);
            }`,
        ...standardPPOptions // Apply the fix
    });

    legacyEdgeMaskMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tDepth: { value: null }, // Will receive the *normalized* depth texture
            u_displacementGapThreshold: { value: currentDisplacementGapThreshold },
            u_resolution: { value: new THREE.Vector2(canvasWidth, canvasHeight) }
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            #extension GL_OES_standard_derivatives : enable
            uniform sampler2D tDepth;
            uniform float u_displacementGapThreshold;
            varying vec2 vUv;

            void main() {
                float centerDepth = texture2D(tDepth, vUv).r;
                // Don't make gaps on black background (depth 0)
                if (centerDepth < 0.001) {
                    gl_FragColor = vec4(0.0);
                    return;
                }
                float depthDerivativeX = abs(dFdx(centerDepth));
                float depthDerivativeY = abs(dFdy(centerDepth));

                if (max(depthDerivativeX, depthDerivativeY) > u_displacementGapThreshold) {
                    gl_FragColor = vec4(1.0); // Mark as edge/gap
                } else {
                    gl_FragColor = vec4(0.0); // Not an edge/gap
                }
            }`,
        ...standardPPOptions // Apply the fix
    });

    gaussianBlurMaterial = new THREE.ShaderMaterial({
        uniforms: { tDiffuse: { value: null }, u_resolution: { value: new THREE.Vector2(canvasWidth, canvasHeight) }, u_direction: { value: new THREE.Vector2(1, 0) } },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tDiffuse; uniform vec2 u_resolution; uniform vec2 u_direction; varying vec2 vUv;
            void main() {
                vec4 sum = vec4(0.0); vec2 tc = vUv; vec2 texel = 1.0 / u_resolution;
                float kernel[5]; kernel[0] = 0.06136; kernel[1] = 0.24477; kernel[2] = 0.38774; kernel[3] = 0.24477; kernel[4] = 0.06136;
                sum += texture2D(tDiffuse, tc - 2.0 * texel * u_direction) * kernel[0];
                sum += texture2D(tDiffuse, tc - 1.0 * texel * u_direction) * kernel[1];
                sum += texture2D(tDiffuse, tc) * kernel[2];
                sum += texture2D(tDiffuse, tc + 1.0 * texel * u_direction) * kernel[3];
                sum += texture2D(tDiffuse, tc + 2.0 * texel * u_direction) * kernel[4];
                gl_FragColor = sum;
            }`,
        ...standardPPOptions // Apply the fix
    });

    sobelGradientMaterial = new THREE.ShaderMaterial({
        uniforms: { tDiffuse: { value: null }, u_resolution: { value: new THREE.Vector2(canvasWidth, canvasHeight) } },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tDiffuse; uniform vec2 u_resolution; varying vec2 vUv;
            float getSample(vec2 offset) { return texture2D(tDiffuse, vUv + offset).r; }
            void main() {
                vec2 texel = 1.0 / u_resolution;
                float gx = -1.0 * getSample(vec2(-texel.x, -texel.y)) + 1.0 * getSample(vec2(texel.x, -texel.y))
                         + -2.0 * getSample(vec2(-texel.x, 0.0))    + 2.0 * getSample(vec2(texel.x, 0.0))
                         + -1.0 * getSample(vec2(-texel.x, texel.y))  + 1.0 * getSample(vec2(texel.x, texel.y));
                float gy = -1.0 * getSample(vec2(-texel.x, -texel.y)) + -2.0 * getSample(vec2(0.0, -texel.y)) + -1.0 * getSample(vec2(texel.x, -texel.y))
                         +  1.0 * getSample(vec2(-texel.x, texel.y))  +  2.0 * getSample(vec2(0.0, texel.y))  +  1.0 * getSample(vec2(texel.x, texel.y));
                float magnitude = sqrt(gx * gx + gy * gy);
                float direction = atan(gy, gx);
                gl_FragColor = vec4(magnitude, direction, 0.0, 1.0);
            }`,
        ...standardPPOptions // Apply the fix
    });

    nmsMaterial = new THREE.ShaderMaterial({
        uniforms: { tGradient: { value: null }, u_resolution: { value: new THREE.Vector2(canvasWidth, canvasHeight) } },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tGradient; uniform vec2 u_resolution; varying vec2 vUv; const float PI = 3.14159265;
            void main() {
                vec2 texel = 1.0 / u_resolution;
                vec4 center = texture2D(tGradient, vUv);
                float mag = center.r; float dir = center.g;
                vec2 offset1, offset2;
                     if (dir > -PI*0.125 && dir <= PI*0.125) { offset1 = vec2(1,0)*texel; offset2 = vec2(-1,0)*texel; }
                else if (dir > PI*0.125 && dir <= PI*0.375) { offset1 = vec2(1,1)*texel; offset2 = vec2(-1,-1)*texel; }
                else if (dir > PI*0.375 && dir <= PI*0.625) { offset1 = vec2(0,1)*texel; offset2 = vec2(0,-1)*texel; }
                else if (dir > PI*0.625 && dir <= PI*0.875) { offset1 = vec2(-1,1)*texel; offset2 = vec2(1,-1)*texel; }
                else if (dir > PI*0.875 || dir <= -PI*0.875){ offset1 = vec2(-1,0)*texel; offset2 = vec2(1,0)*texel; }
                else if (dir > -PI*0.875 && dir <= -PI*0.625){ offset1 = vec2(-1,-1)*texel; offset2 = vec2(1,1)*texel; }
                else if (dir > -PI*0.625 && dir <= -PI*0.375){ offset1 = vec2(0,-1)*texel; offset2 = vec2(0,1)*texel; }
                else { offset1 = vec2(1,-1)*texel; offset2 = vec2(-1,1)*texel; }
                float mag1 = texture2D(tGradient, vUv + offset1).r;
                float mag2 = texture2D(tGradient, vUv + offset2).r;
                if (mag >= mag1 && mag >= mag2) { gl_FragColor = vec4(vec3(mag), 1.0); }
                else { gl_FragColor = vec4(0.0); }
            }`,
        ...standardPPOptions // Apply the fix
    });

    hysteresisMaterial = new THREE.ShaderMaterial({
        uniforms: { tNMS: { value: null }, u_resolution: { value: new THREE.Vector2(canvasWidth, canvasHeight) }, u_lowThreshold: { value: 0.02 }, u_highThreshold: { value: 0.1 } },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tNMS; uniform vec2 u_resolution; uniform float u_lowThreshold; uniform float u_highThreshold; varying vec2 vUv;
            void main() {
                float centerMag = texture2D(tNMS, vUv).r;
                if (centerMag < u_lowThreshold) { gl_FragColor = vec4(0.0); return; }
                if (centerMag > u_highThreshold) { gl_FragColor = vec4(1.0); return; }
                vec2 texel = 1.0 / u_resolution;
                for (int i = -1; i <= 1; i++) {
                    for (int j = -1; j <= 1; j++) {
                        if (i == 0 && j == 0) continue;
                        if (texture2D(tNMS, vUv + vec2(i, j) * texel).r > u_highThreshold) {
                            gl_FragColor = vec4(1.0); return;
                        }
                    }
                }
                gl_FragColor = vec4(0.0);
            }`,
        ...standardPPOptions // Apply the fix
    });

    edgeDilationMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tDiffuse: { value: null }, // The edge mask
            u_resolution: { value: new THREE.Vector2(canvasWidth, canvasHeight) },
            u_radius: { value: 1.5 } // The dilation radius in pixels
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tDiffuse;
            uniform vec2 u_resolution;
            uniform float u_radius;
            varying vec2 vUv;

            void main() {
                vec2 texel = 1.0 / u_resolution;
                float maxVal = 0.0;

                // Iterate in a square around the current pixel
                for (float i = -u_radius; i <= u_radius; i += 1.0) {
                    for (float j = -u_radius; j <= u_radius; j += 1.0) {
                        vec2 offset = vec2(i, j) * texel;
                        maxVal = max(maxVal, texture2D(tDiffuse, vUv + offset).r);
                    }
                }

                gl_FragColor = vec4(vec3(maxVal), 1.0);
            }
        `,
        ...standardPPOptions // Apply the fix
    });

    // New targets for temporal stabilization
    stabilizedEdgeMaskTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, defaultTargetOptions);
    prevEdgeMaskTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, defaultTargetOptions);

    temporalStabilizeMaterial = new THREE.ShaderMaterial({
        uniforms: {
            'tCurrentMask': { value: null },
            'tPreviousMask': { value: null },
            'u_feedback': { value: temporalFeedback },
            'u_maskUsesAlpha': { value: false } // <-- ADD THIS
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = vec4( position, 1.0 );
            }`,
        fragmentShader: `
        uniform sampler2D tCurrentMask;
        uniform sampler2D tPreviousMask;
        uniform float u_feedback;
        uniform bool u_maskUsesAlpha; 
        varying vec2 vUv;

        void main() {
            float currentMask;
            if (u_maskUsesAlpha) {
                // Read gapped image: mask is (1.0 - alpha)
                currentMask = 1.0 - texture2D(tCurrentMask, vUv).a;
            } else {
                // Read R-channel mask
                currentMask = texture2D(tCurrentMask, vUv).r;
            }
            
            float prevMask = texture2D(tPreviousMask, vUv).r;
            
            // Blend the old mask value towards the new one
            float blendedMask = mix(currentMask, prevMask, u_feedback);

            // TAKE THE MAXIMUM of the new mask and the blended old one.
            // This makes new gaps (currentMask=1.0) appear INSTANTLY,
            // while old gaps (currentMask=0.0) fade out slowly.
            float stabilizedMask = max(currentMask, blendedMask);
            
            gl_FragColor = vec4(vec3(stabilizedMask), 1.0);
        }`,
        ...standardPPOptions
    });

    // --- JFA Materials ---
    jfaSeedMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tDepth: { value: null },
            tEdgeMask: { value: null },
            u_seedDensity: { value: 0.25 },
            u_seedSize: { value: 1.0 },
            u_resolution: { value: new THREE.Vector2(canvasWidth, canvasHeight) },
            u_maskUsesAlpha: { value: false } // <-- ADDED UNIFORM
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tDepth;
            uniform sampler2D tEdgeMask;
            uniform float u_seedDensity;
            uniform float u_seedSize;
            uniform vec2 u_resolution;
            uniform bool u_maskUsesAlpha; // <-- ADDED UNIFORM
            varying vec2 vUv;

            float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

            void main() {
                // --- START MODIFICATION ---
                float maskValue = u_maskUsesAlpha ? (1.0 - texture2D(tEdgeMask, vUv).a) : texture2D(tEdgeMask, vUv).r;
                bool isGap = maskValue > 0.5; // Check if *current* pixel is a gap

                if (isGap) { // If I am a gap pixel, I cannot be a seed
                // --- END MODIFICATION ---
                    gl_FragColor = vec4(0.0, 0.0, 9999.0, 0.0); // Mark as invalid seed
                    return;
                }

                // If I am NOT a gap pixel, proceed to check if I should become a seed based on density
                vec2 blockCoord = floor(gl_FragCoord.xy / u_seedSize); // Use pixel coord for hashing block

                if (hash(blockCoord) < u_seedDensity) { // Am I chosen in this block?
                    vec2 blockCenterPixel = (blockCoord + 0.5) * u_seedSize;
                    vec2 blockCenterUv = blockCenterPixel / u_resolution;

                    // --- START MODIFICATION ---
                    // Check if the *chosen center* of the block is a gap (redundant check, technically covered above, but safe)
                    float centerMaskValue = u_maskUsesAlpha ? (1.0 - texture2D(tEdgeMask, blockCenterUv).a) : texture2D(tEdgeMask, blockCenterUv).r;
                    bool centerIsGap = centerMaskValue > 0.5;

                    if (centerIsGap) { // If the chosen center is bad, this block yields no seed
                    // --- END MODIFICATION ---
                         gl_FragColor = vec4(0.0, 0.0, 9999.0, 0.0);
                         return;
                    }

                    // The chosen center is valid, use its UV and depth
                    float depth = texture2D(tDepth, blockCenterUv).r; // Depth from clean render
                    gl_FragColor = vec4(blockCenterUv, depth, 1.0); // Output: Seed UV, Seed Depth, Validity=1
                } else {
                    // Not chosen as a seed in this block
                    gl_FragColor = vec4(0.0, 0.0, 9999.0, 0.0); // Mark as invalid seed
                }
            }`,
        ...standardPPOptions // Apply the fix
    });


    jfaFloodMaterial = new THREE.ShaderMaterial({
        uniforms: { tJFA: { value: null }, u_resolution: { value: new THREE.Vector2(canvasWidth, canvasHeight) }, u_step: { value: 0.0 } },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tJFA; uniform vec2 u_resolution; uniform float u_step; varying vec2 vUv;
            void main() {
                vec4 bestData = texture2D(tJFA, vUv); // My current best seed data
                for (int i = -1; i <= 1; i++) {
                    for (int j = -1; j <= 1; j++) {
                        if (i == 0 && j == 0) continue;
                        // UV of neighbor pixel to check
                        vec2 neighborUv = vUv + vec2(float(i), float(j)) * u_step / u_resolution;
                        // Get the seed data stored at that neighbor
                        vec4 neighborData = texture2D(tJFA, neighborUv);
                        // Is the neighbor's seed valid? (W > 0.5)
                        if (neighborData.w > 0.5) {
                            // Calculate distance from *me* to the neighbor's *source seed*
                            float distToNeighborSource = distance(vUv, neighborData.xy);
                            // Calculate distance from *me* to *my current* source seed
                            float myDist = (bestData.w > 0.5) ? distance(vUv, bestData.xy) : 9999.0;
                            // If the neighbor's source seed is closer, adopt it
                            if (distToNeighborSource < myDist) {
                                bestData = neighborData;
                            }
                        }
                    }
                }
                gl_FragColor = bestData; // Output the best seed data found
            }`,
        ...standardPPOptions // Apply the fix
    });

    jfaResolveMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tJFA: { value: null },
            tDiffuse: { value: null }, // Clean color texture
            tOriginalDepth: { value: null }, // Clean depth texture
            tEdgeMask: { value: null }, // Mask texture (could be alpha or red)
            u_projectionMatrixInverse: { value: new THREE.Matrix4() },
            u_linearDepthTolerance: { value: 0.03 },
            u_resolution: { value: new THREE.Vector2(canvasWidth, canvasHeight) },
            u_maskUsesAlpha: { value: false } // <-- ADDED UNIFORM
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tJFA;
            uniform sampler2D tDiffuse;
            uniform sampler2D tOriginalDepth;
            uniform sampler2D tEdgeMask;
            uniform mat4 u_projectionMatrixInverse;
            uniform float u_linearDepthTolerance;
            uniform bool u_maskUsesAlpha; // <-- ADDED UNIFORM
            varying vec2 vUv;

            float linearize_depth(float z, vec2 uv) {
                if (z >= 1.0) return 9999.0;
                vec4 clipSpacePos = vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
                vec4 viewSpacePos = u_projectionMatrixInverse * clipSpacePos;
                return abs(viewSpacePos.z / viewSpacePos.w);
            }

            void main() {
                // --- START MODIFICATION ---
                float maskValue = u_maskUsesAlpha ? (1.0 - texture2D(tEdgeMask, vUv).a) : texture2D(tEdgeMask, vUv).r;
                bool isGap = maskValue > 0.5;

                // Only run on pixels that ARE gaps
                if (!isGap) discard;
                // --- END MODIFICATION ---

                // Get the closest seed data for this gap pixel
                vec4 jfaData = texture2D(tJFA, vUv);
                if (jfaData.w < 0.5) discard; // Discard if no valid seed found

                // Get the depth of the object that *originally* was here (before gapping)
                float gapNonLinearDepth = texture2D(tOriginalDepth, vUv).r;

                // Depth test: Compare original depth with the depth of the source seed
                float sourceNonLinearDepth = jfaData.z;
                float linearizedSourceDepth = linearize_depth(sourceNonLinearDepth, jfaData.xy);
                float linearizedGapDepth = linearize_depth(gapNonLinearDepth, vUv);

                // If source seed is significantly IN FRONT of the original pixel, discard (artifact)
                if (linearizedSourceDepth < (linearizedGapDepth - u_linearDepthTolerance)) {
                    discard;
                }

                // Passed depth test: Fill the gap with color from the source seed's UV
                gl_FragColor = texture2D(tDiffuse, jfaData.xy);
            }`,
        // depthTest: false, // Already in standardPPOptions
        // depthWrite: false // Already in standardPPOptions
        ...standardPPOptions
    });

    // --- Utility Materials ---
    dilationMaterial = new THREE.ShaderMaterial({
        // REMOVED tDepth uniform, added tOriginalDepth
        uniforms: {
             tDiffuse: { value: null },
             tOriginalDepth: { value: null }, // NEW: To read clean depth
             u_resolution: { value: new THREE.Vector2(canvasWidth, canvasHeight) }
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tDiffuse;
            // uniform sampler2D tDepth; // REMOVED
            uniform sampler2D tOriginalDepth; // NEW
            uniform vec2 u_resolution; varying vec2 vUv;
            void main() {
                vec4 centerColor = texture2D(tDiffuse, vUv);
                // If current pixel is valid (alpha > 0.01), just output it.
                if (centerColor.a > 0.01) {
                    gl_FragColor = centerColor;
                    return;
                }

                float maxDepth = -1.0; // Corresponds to furthest distance (depth 1.0)
                vec4 finalColor = vec4(0.0); // Default to black if no neighbor found
                vec2 pixelSize = 1.0 / u_resolution;

                 const int KERNEL_SIZE = 1; // 3x3 kernel

                for (int i = -KERNEL_SIZE; i <= KERNEL_SIZE; i++) {
                    for (int j = -KERNEL_SIZE; j <= KERNEL_SIZE; j++) {
                        if (i == 0 && j == 0) continue;
                        vec2 offsetUv = vUv + vec2(float(i), float(j)) * pixelSize;
                        vec4 neighborColor = texture2D(tDiffuse, offsetUv);

                        // If neighbor is valid (has color/alpha)
                        if (neighborColor.a > 0.01) {
                            // Read the *original* depth of the neighbor from the clean depth texture
                            float neighborDepth = texture2D(tOriginalDepth, offsetUv).r; // <-- THE FIX
                            // We want the neighbor with the *largest* depth value (closest to camera)
                            if (neighborDepth > maxDepth) { // ">" means closer
                                maxDepth = neighborDepth;
                                finalColor = neighborColor; // Store its color
                            }
                        }
                    }
                }
                // Output the chosen neighbor color
                gl_FragColor = finalColor;
            }`,
        // depthWrite: false, // Already in standardPPOptions
        // depthTest: false // Already in standardPPOptions
        ...standardPPOptions
    });


    copyMaterial = new THREE.ShaderMaterial({
        uniforms: { tDiffuse: { value: null } },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv; void main() { gl_FragColor = texture2D(tDiffuse, vUv); }`,
        // depthWrite: false, // Already in standardPPOptions
        // depthTest: false // Already in standardPPOptions
        ...standardPPOptions
    });

    normalizeDepthMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tDepth: { value: null },
            u_projectionMatrixInverse: { value: new THREE.Matrix4() },
            u_normalizationRange: { value: depthContrastRange } // Default, might be overridden
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tDepth;
            uniform mat4 u_projectionMatrixInverse;
            uniform float u_normalizationRange;
            varying vec2 vUv;

            void main() {
                float z = texture2D(tDepth, vUv).r;
                if (z >= 1.0) {
                    gl_FragColor = vec4(vec3(0.0), 1.0); // Output black for background
                    return;
                }

                vec4 clipSpacePos = vec4(vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
                vec4 viewSpacePos = u_projectionMatrixInverse * clipSpacePos;
                viewSpacePos.xyz /= viewSpacePos.w;

                float linearDepth = abs(viewSpacePos.z);
                // Normalize based on range, clamped to 0-1 (0=far, 1=close)
                float normalizedZ = 1.0 - smoothstep(0.0, u_normalizationRange, linearDepth);
                gl_FragColor = vec4(vec3(normalizedZ), 1.0);
            }`,
        ...standardPPOptions // Apply the fix
    });

    // --- Pull-Push Materials ---
    
    // --- START: MODIFICATION ---
    // maskGeneratorMaterial is now refactored to be "alpha-aware"
    maskGeneratorMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tDiffuse: { value: null }, // Gapped scene (if alpha) OR Clean scene (if R)
            tEdgeMask: { value: null }, // Sobel mask (if R)
            tLayerMask: { value: null }, // R=isFG, G=isBG
            u_maskChannel: { value: 0 },  // 0 for FG, 1 for BG
            u_maskUsesAlpha: { value: false } // <-- THE CRITICAL SWITCH
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tDiffuse;
            uniform sampler2D tEdgeMask;
            uniform sampler2D tLayerMask;
            uniform int u_maskChannel;
            uniform bool u_maskUsesAlpha;
            varying vec2 vUv;
            
            void main() {
                float isGap;
                if (u_maskUsesAlpha) {
                    // Read from alpha channel of the gapped texture
                    isGap = 1.0 - texture2D(tDiffuse, vUv).a;
                } else {
                    // Read from red channel of the Sobel mask
                    isGap = texture2D(tEdgeMask, vUv).r;
                }

                // Get the color from the source
                vec4 color = texture2D(tDiffuse, vUv);
                
                float isUnknown;

                // u_maskChannel < 0 is the "bake mode" flag
                if (u_maskChannel < 0) {
                    isUnknown = step(0.5, isGap);
                } else {
                    // Get the FG/BG layer
                    vec2 layerMask = texture2D(tLayerMask, vUv).rg; 

                    float isTargetLayer;
                    if (u_maskChannel == 0) { // 0 == FG
                        isTargetLayer = layerMask.r;
                    } else { // 1 == BG
                        isTargetLayer = layerMask.g;
                    }

                    // A pixel is "unknown" (needs inpainting) if it's a gap AND in the target layer
                    isUnknown = step(0.5, isGap) * step(0.5, isTargetLayer);
                }
                
                // Alpha = 1.0 if KNOWN (not a gap, or a gap in the *other* layer)
                // Alpha = 0.0 if UNKNOWN (a gap in *this* layer)
                color.a = 1.0 - isUnknown;
                
                // If we're using an R-channel mask, the color texture was clean,
                // so we must mask it out.
                if (!u_maskUsesAlpha) {
                    color.rgb *= (1.0 - isUnknown);
                }

                gl_FragColor = color;
            }
        `,
        ...standardPPOptions // Apply the fix
    });
    // --- END: MODIFICATION ---

    pullMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tFinerLevel: { value: null },
            u_texelSize: { value: new THREE.Vector2() }
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tFinerLevel;
            uniform vec2 u_texelSize;
            varying vec2 vUv;

            void main() {
                // Sample 4 neighbors from the finer level
                vec2 offset = u_texelSize * 0.5;
                vec4 c1 = texture2D(tFinerLevel, vUv + vec2(-offset.x, -offset.y));
                vec4 c2 = texture2D(tFinerLevel, vUv + vec2( offset.x, -offset.y));
                vec4 c3 = texture2D(tFinerLevel, vUv + vec2(-offset.x,  offset.y));
                vec4 c4 = texture2D(tFinerLevel, vUv + vec2( offset.x,  offset.y));

                // Weighted average based on validity (alpha)
                float totalValidity = c1.a + c2.a + c3.a + c4.a;
                vec3 colorSum = c1.rgb * c1.a + c2.rgb * c2.a + c3.rgb * c3.a + c4.rgb * c4.a;

                if (totalValidity > 0.0001) {
                    gl_FragColor.rgb = colorSum / totalValidity; // Average color
                    gl_FragColor.a = totalValidity / 4.0;      // Average validity
                } else {
                    gl_FragColor = vec4(0.0); // No valid neighbors
                }
            }
        `,
        ...standardPPOptions // Apply the fix
    });

    pushMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tCurrentLevel: { value: null }, // Pull pyramid level corresponding to this push level
            tCoarserLevel: { value: null } // Result from the previous (coarser) push level
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tCurrentLevel;
            uniform sampler2D tCoarserLevel;
            varying vec2 vUv;

            void main() {
                // Data from the corresponding pull level (contains original valid pixels at this resolution)
                vec4 currentData = texture2D(tCurrentLevel, vUv);
                // Check if this pixel had valid data originally (alpha > threshold)
                float useCurrent = step(0.001, currentData.a);

                // Data interpolated from the coarser push level (contains filled-in gap data)
                vec4 coarseData = texture2D(tCoarserLevel, vUv);

                // If original data exists, use it; otherwise, use the interpolated data from coarser level
                vec3 finalColor = mix(coarseData.rgb, currentData.rgb, useCurrent);
                // Final validity is the max of original or interpolated validity
                float finalValidity = max(currentData.a, coarseData.a);

                gl_FragColor = vec4(finalColor, finalValidity);
            }
        `,
        ...standardPPOptions // Apply the fix
    });

// --- START: MODIFICATION ---
    // REMOVED old pullMaterialDepthAware (4-tap)
    // REMOVED old pullMaterialDepthAware_9tap (9-tap)
    // ADDED new combined pullMaterialDepthAware with dynamic kernel
    pullMaterialDepthAware = new THREE.ShaderMaterial({
        uniforms: {
            tFinerLevel: { value: null }, // RGBA (Color + Validity)
            tFinerDepth: { value: null }, // R (Clean Depth) from sceneRenderTarget
            tLayerMask: { value: null },
            u_maskChannel: { value: 0 }, // 0=FG, 1=BG
            u_texelSize: { value: new THREE.Vector2() },
            u_depthTolerance: { value: 0.05 },
            u_depthWeightPower: { value: currentDepthWeightPower },
            u_fillKernelSize: { value: 3 } // NEW: Default to 3 (9-tap)
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tFinerLevel;
            uniform sampler2D tFinerDepth;
            uniform sampler2D tLayerMask;
            uniform int u_maskChannel;
            uniform vec2 u_texelSize;
            uniform float u_depthTolerance;
            uniform float u_depthWeightPower;
            uniform int u_fillKernelSize;
            varying vec2 vUv;

            void main() {
                // --- KERNEL 2 (4-TAP) LOGIC ---
                if (u_fillKernelSize == 2) {
                    vec2 offset = u_texelSize * 0.5;
                    vec2 uv1 = vUv + vec2(-offset.x, -offset.y);
                    vec2 uv2 = vUv + vec2( offset.x, -offset.y);
                    vec2 uv3 = vUv + vec2(-offset.x,  offset.y);
                    vec2 uv4 = vUv + vec2( offset.x,  offset.y);

                    vec4 c1 = texture2D(tFinerLevel, uv1);
                    vec4 c2 = texture2D(tFinerLevel, uv2);
                    vec4 c3 = texture2D(tFinerLevel, uv3);
                    vec4 c4 = texture2D(tFinerLevel, uv4);

                    float d1 = texture2D(tFinerDepth, uv1).r;
                    float d2 = texture2D(tFinerDepth, uv2).r;
                    float d3 = texture2D(tFinerDepth, uv3).r;
                    float d4 = texture2D(tFinerDepth, uv4).r;

                    float avgDepth = 0.0;
                    float totalValidAlpha = 0.0;
                    float totalAlphaForOutput = 0.0;
                    
                    // Read the correct channel based on the pass
                    float m1 = (u_maskChannel == 0) ? texture2D(tLayerMask, uv1).r : texture2D(tLayerMask, uv1).g;
                    float m2 = (u_maskChannel == 0) ? texture2D(tLayerMask, uv2).r : texture2D(tLayerMask, uv2).g;
                    float m3 = (u_maskChannel == 0) ? texture2D(tLayerMask, uv3).r : texture2D(tLayerMask, uv3).g;
                    float m4 = (u_maskChannel == 0) ? texture2D(tLayerMask, uv4).r : texture2D(tLayerMask, uv4).g;

                    // Check if neighbor is valid AND in the correct layer (mask > 0.5)
                    if (c1.a > 0.01 && (u_maskChannel < 0 || m1 > 0.5)) { avgDepth += d1 * c1.a; totalValidAlpha += c1.a; }
                    if (c2.a > 0.01 && (u_maskChannel < 0 || m2 > 0.5)) { avgDepth += d2 * c2.a; totalValidAlpha += c2.a; }
                    if (c3.a > 0.01 && (u_maskChannel < 0 || m3 > 0.5)) { avgDepth += d3 * c3.a; totalValidAlpha += c3.a; }
                    if (c4.a > 0.01 && (u_maskChannel < 0 || m4 > 0.5)) { avgDepth += d4 * c4.a; totalValidAlpha += c4.a; }
                    
                    totalAlphaForOutput = (c1.a + c2.a + c3.a + c4.a) / 4.0;
                    
                    if (totalValidAlpha < 0.0001) {
                        gl_FragColor = vec4(0.0);
                        return;
                    }
                    avgDepth /= totalValidAlpha;

                    vec3 colorSum = vec3(0.0);
                    float totalWeight = 0.0;

                    if (c1.a > 0.01) {
                        float depthDiff1 = abs(d1 - avgDepth);
                        float normalizedDiff1 = clamp(depthDiff1 / u_depthTolerance, 0.0, 1.0);
                        float weight1 = (1.0 - pow(normalizedDiff1, u_depthWeightPower)) * c1.a;
                        colorSum += c1.rgb * weight1;
                        totalWeight += weight1;
                    }
                    if (c2.a > 0.01) {
                        float depthDiff2 = abs(d2 - avgDepth);
                        float normalizedDiff2 = clamp(depthDiff2 / u_depthTolerance, 0.0, 1.0);
                        float weight2 = (1.0 - pow(normalizedDiff2, u_depthWeightPower)) * c2.a;
                        colorSum += c2.rgb * weight2;
                        totalWeight += weight2;
                    }
                    if (c3.a > 0.01) {
                        float depthDiff3 = abs(d3 - avgDepth);
                        float normalizedDiff3 = clamp(depthDiff3 / u_depthTolerance, 0.0, 1.0);
                        float weight3 = (1.0 - pow(normalizedDiff3, u_depthWeightPower)) * c3.a;
                        colorSum += c3.rgb * weight3;
                        totalWeight += weight3;
                    }
                    if (c4.a > 0.01) {
                        float depthDiff4 = abs(d4 - avgDepth);
                        float normalizedDiff4 = clamp(depthDiff4 / u_depthTolerance, 0.0, 1.0);
                        float weight4 = (1.0 - pow(normalizedDiff4, u_depthWeightPower)) * c4.a;
                        colorSum += c4.rgb * weight4;
                        totalWeight += weight4;
                    }
                    
                    if (totalWeight > 0.0001) {
                        gl_FragColor.rgb = colorSum / totalWeight;
                        gl_FragColor.a = totalAlphaForOutput;
                    } else {
                        gl_FragColor = vec4(0.0);
                    }
                
                // --- KERNEL > 2 (NxN) LOGIC ---
                } else {
                    float kernelHalfSize = floor(float(u_fillKernelSize) * 0.5);
                    float start = -kernelHalfSize;
                    // Handle even-sized kernels (4x4) by shifting UV
                    vec2 uvOffset = (mod(float(u_fillKernelSize), 2.0) == 0.0) ? u_texelSize * 0.5 : vec2(0.0);
                    vec2 uv = vUv - uvOffset;
                    float kernelEnd = (mod(float(u_fillKernelSize), 2.0) == 0.0) ? kernelHalfSize - 1.0 : kernelHalfSize;

                    // First pass: find average depth of valid pixels in kernel
                    float avgDepth = 0.0;
                    float totalValidAlpha = 0.0;
                    float totalAlphaForOutput = 0.0;
                    float totalSamples = 0.0;

                    float isFG = float(u_maskChannel == 0);

                    for (float y = start; y <= kernelEnd; y++) {
                        for (float x = start; x <= kernelEnd; x++) {
                            vec2 offsetUV = uv + vec2(x, y) * u_texelSize;
                            vec4 neighbor = texture2D(tFinerLevel, offsetUV);
                            
                            totalAlphaForOutput += neighbor.a;
                            totalSamples += 1.0;

                        // Check if neighbor is valid AND in the correct layer
                            vec4 maskVec = texture2D(tLayerMask, offsetUV);
                            float mask = (u_maskChannel == 0) ? maskVec.r : maskVec.g; // Read R for FG, G for BG
                            if (neighbor.a > 0.01 && (u_maskChannel < 0 || mask > 0.5)) { // Check if it's in the target layer
                                float neighborDepth = texture2D(tFinerDepth, offsetUV).r;
                                avgDepth += neighborDepth * neighbor.a;
                                totalValidAlpha += neighbor.a;
                            }
                        }
                    }

                    if (totalValidAlpha < 0.0001) {
                        gl_FragColor = vec4(0.0);
                        return;
                    }
                    avgDepth /= totalValidAlpha;

                    // Second pass: apply weighted kernel (box filter for now)
                    vec3 colorSum = vec3(0.0);
                    float totalWeight = 0.0;

                    for (float y = start; y <= kernelEnd; y++) {
                        for (float x = start; x <= kernelEnd; x++) {
                            vec2 offsetUV = uv + vec2(x, y) * u_texelSize;
                            vec4 neighbor = texture2D(tFinerLevel, offsetUV);
                            
                            if (neighbor.a > 0.01) {
                                float neighborDepth = texture2D(tFinerDepth, offsetUV).r;
                                float depthDiff = abs(neighborDepth - avgDepth);

                                float normalizedDiff = clamp(depthDiff / u_depthTolerance, 0.0, 1.0);
                                float depthWeight = (1.0 - pow(normalizedDiff, u_depthWeightPower)) * neighbor.a;
                                
                                // Simple box filter weight (1.0)
                                float kernelWeight = 1.0; 

                                float finalWeight = depthWeight * kernelWeight;
                                
                                colorSum += neighbor.rgb * finalWeight;
                                totalWeight += finalWeight;
                            }
                        }
                    }
                    
                    if (totalWeight > 0.0001) {
                        gl_FragColor.rgb = colorSum / totalWeight;
                        gl_FragColor.a = totalAlphaForOutput / totalSamples; // Propagate average validity
                    } else {
                        gl_FragColor = vec4(0.0); // No valid pixels found
                    }
                }
            }
        `,
        ...standardPPOptions
    });
    // --- END: MODIFICATION ---


// NEW: layerMaskMaterial
    layerMaskMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tDepth: { value: null }, // From sceneRenderTarget.depthTexture
            u_inpaintingSplitDepth_RAW: { value: 0.5 }, // New uniform (raw 0-1)
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tDepth;
            uniform float u_inpaintingSplitDepth_RAW;
            varying vec2 vUv;

            void main() {
                float rawHardwareDepth = texture2D(tDepth, vUv).r;
                if (rawHardwareDepth < 0.001 || rawHardwareDepth >= 1.0) {
                    gl_FragColor = vec4(0.0); // Background
                    return;
                }

                // --- Direct hardware depth comparison ---
                // rawHardwareDepth is 0.0 (near) to 1.0 (far)
                // We want 1.0 (FG) for pixels *nearer* than the split point.
                float isFG = 1.0 - step(u_inpaintingSplitDepth_RAW, rawHardwareDepth);
                float isBG = 1.0 - isFG;
                gl_FragColor = vec4(isFG, isBG, 0.0, 1.0);
            }
        `,
        ...standardPPOptions
    });

    // --- ADD THIS LINE INSTEAD ---
    finalCompositeMaterial = createFinalCompositeMaterial();
    // --- END ADDITION ---

    // --- END: MODIFICATION ---

    // --- Debug Materials ---
    debugEdgeMaskMaterial = new THREE.ShaderMaterial({
        uniforms: { tDiffuse: { value: null } },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv; void main() { gl_FragColor = texture2D(tDiffuse, vUv); }`,
        ...standardPPOptions // Apply the fix
    });

    debugJfaMaterial = new THREE.ShaderMaterial({
        uniforms: { tJFA: { value: null } },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tJFA;
            varying vec2 vUv;

            vec3 hash3( vec2 p ) {
                vec3 q = vec3( dot(p,vec2(127.1,311.7)),
                               dot(p,vec2(269.5,183.3)),
                               dot(p,vec2(419.2,751.9)) );
                return fract(sin(q)*43758.5453);
            }

            void main() {
                vec4 jfaData = texture2D(tJFA, vUv);
                if (jfaData.w < 0.5) {
                    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
                    return;
                }
                vec3 color = hash3(jfaData.xy);
                gl_FragColor = vec4(color, 1.0);
            }`,
        ...standardPPOptions // Apply the fix
    });

// --- MODIFIED: debugDepthMaterial (Output Red on Match) ---
    debugDepthMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tDepth: { value: null },
            // Restored Linearization/Normalization Uniforms
            u_projectionMatrixInverse: { value: new THREE.Matrix4() },
            u_normalizationRange: { value: depthContrastRange },
            // Added Peek Uniforms
            u_depthPeekActive: { value: depthPeekActive },
            u_depthPeekValue: { value: depthPeekValue },
            u_depthPeekTolerance: { value: depthPeekTolerance },
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tDepth;
            // Restored Uniforms
            uniform mat4 u_projectionMatrixInverse;
            uniform float u_normalizationRange;
            // Added Peek Uniforms
            uniform bool u_depthPeekActive;
            uniform float u_depthPeekValue;
            uniform float u_depthPeekTolerance;
            varying vec2 vUv;

            void main() {
                // Read the raw non-linear depth (0=BG, 1=FG)
                float nonLinearDepth = texture2D(tDepth, vUv).r;
                float displayValue = 0.0; // Default black for background

                // Restore Linearization/Normalization for display brightness
                if (nonLinearDepth > 0.0) { // If it's not pure background
                    // Linearize using the raw nonLinearDepth
                    vec4 clipSpacePos = vec4(vUv * 2.0 - 1.0, nonLinearDepth * 2.0 - 1.0, 1.0);
                    vec4 viewSpacePos = u_projectionMatrixInverse * clipSpacePos;
                    viewSpacePos.xyz /= viewSpacePos.w;
                    float linearDepth = abs(viewSpacePos.z);

                    // Normalize brightness (1=close/white, 0=far/black) based on range
                    displayValue = 1.0 - smoothstep(0.0, u_normalizationRange, linearDepth);
                }
                // End Restore

                // Base color is the normalized depth visualization
                vec4 finalColor = vec4(vec3(displayValue), 1.0);

                // --- DEBUGGING: Output Red on Match ---
                if (u_depthPeekActive) {
                    // Compare peek value against the raw non-linear depth (0=BG, 1=FG)
                    if (abs(nonLinearDepth - u_depthPeekValue) < u_depthPeekTolerance) {
                       finalColor.rgb = vec3(1.0, 0.0, 0.0); // Output pure RED if condition met
                    }
                    // else: finalColor remains the grayscale depth value
                }
                // --- END DEBUGGING ---

                gl_FragColor = finalColor;
            }`,
        ...standardPPOptions
    });
    // --- END MODIFIED: debugDepthMaterial ---

    debugJfaToleranceMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tJFA: { value: null },
            tOriginalDepth: { value: null },
            tEdgeMask: { value: null },
            u_projectionMatrixInverse: { value: new THREE.Matrix4() },
            u_linearDepthTolerance: { value: 0.03 },
            u_maskUsesAlpha: { value: false } // Add if needed for debug
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tJFA;
            uniform sampler2D tOriginalDepth;
            uniform sampler2D tEdgeMask;
            uniform mat4 u_projectionMatrixInverse;
            uniform float u_linearDepthTolerance;
            uniform bool u_maskUsesAlpha; // Add if needed
            varying vec2 vUv;

            float linearize_depth(float z, vec2 uv) {
                if (z >= 1.0) return 9999.0; // Use nonLinearDepth convention
                vec4 clipSpacePos = vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
                vec4 viewSpacePos = u_projectionMatrixInverse * clipSpacePos;
                return abs(viewSpacePos.z / viewSpacePos.w);
            }

            void main() {
                 float maskValue = u_maskUsesAlpha ? (1.0 - texture2D(tEdgeMask, vUv).a) : texture2D(tEdgeMask, vUv).r;
                 if (maskValue < 0.5) discard;
                vec4 jfaData = texture2D(tJFA, vUv);
                if (jfaData.w < 0.5) discard;

                float gapNonLinearDepth = texture2D(tOriginalDepth, vUv).r;
                float sourceNonLinearDepth = jfaData.z;
                vec2 sourceUV = jfaData.xy;

                float linearizedGapDepth = linearize_depth(gapNonLinearDepth, vUv);
                float linearizedSourceDepth = linearize_depth(sourceNonLinearDepth, sourceUV);

                if (linearizedSourceDepth < (linearizedGapDepth - u_linearDepthTolerance)) {
                    gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); // Red for rejected pixels (in front)
                } else {
                    gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0); // Green for accepted pixels (behind)
                }
            }
        `,
        // depthTest: false, // Already in standardPPOptions
        // depthWrite: false // Already in standardPPOptions
        ...standardPPOptions
    });

    debugJfaDepthCompareMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tJFA: { value: null },
            tOriginalDepth: { value: null },
            tEdgeMask: { value: null },
            u_projectionMatrixInverse: { value: new THREE.Matrix4() },
            u_maskUsesAlpha: { value: false } // Add if needed for debug
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tJFA;
            uniform sampler2D tOriginalDepth;
            uniform sampler2D tEdgeMask;
            uniform mat4 u_projectionMatrixInverse;
             uniform bool u_maskUsesAlpha; // Add if needed
            varying vec2 vUv;

             float linearize_depth(float z, vec2 uv) {
                if (z >= 1.0) return 9999.0; // Use nonLinearDepth convention
                vec4 clipSpacePos = vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
                vec4 viewSpacePos = u_projectionMatrixInverse * clipSpacePos;
                return abs(viewSpacePos.z / viewSpacePos.w);
            }

            void main() {
                float maskValue = u_maskUsesAlpha ? (1.0 - texture2D(tEdgeMask, vUv).a) : texture2D(tEdgeMask, vUv).r;
                if (maskValue < 0.5) discard;
                vec4 jfaData = texture2D(tJFA, vUv);
                if (jfaData.w < 0.5) discard;

                float gapNonLinearDepth = texture2D(tOriginalDepth, vUv).r;
                float sourceNonLinearDepth = jfaData.z;
                vec2 sourceUV = jfaData.xy;

                float linearizedGapDepth = linearize_depth(gapNonLinearDepth, vUv);
                float linearizedSourceDepth = linearize_depth(sourceNonLinearDepth, sourceUV);

                const float epsilon = 0.001;
                if (linearizedSourceDepth > linearizedGapDepth + epsilon) {
                    gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0); // GREEN: Source is behind gap
                } else if (linearizedSourceDepth < linearizedGapDepth - epsilon) {
                    gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); // RED: Source is in front of gap
                } else {
                    gl_FragColor = vec4(0.0, 0.0, 1.0, 1.0); // BLUE: Source is at same depth
                }
            }
        `,
        // depthTest: false, // Already in standardPPOptions
        // depthWrite: false // Already in standardPPOptions
        ...standardPPOptions
    });

    // START ADDITION: Universal Dither Material (for debug views)
    ditherMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tDiffuse: { value: null },
            u_strength: { value: 0.0 },
            u_resolution: { value: new THREE.Vector2(canvasWidth, canvasHeight) }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D tDiffuse;
            uniform float u_strength;
            uniform vec2 u_resolution;
            varying vec2 vUv;

            // Simple hash function to create pseudo-random noise
            float hash(vec2 p) {
                return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
            }

            void main() {
                vec4 color = texture2D(tDiffuse, vUv);
                
                // Get a noise value based on screen coordinates
                float noise = hash(gl_FragCoord.xy) - 0.5; // Centered noise
                
                // Apply dither
                // We scale strength by 1/255.0 because color values are 0-1
                // A strength of 1.0 will add/subtract 1 color level
                color.rgb += noise * (u_strength / 255.0);
                
                gl_FragColor = color;
            }
        `,
        ...standardPPOptions
    });
    // END ADDITION
    
    // --- START: NEW ditherCompositeMaterial ---
    ditherCompositeMaterial = new THREE.ShaderMaterial({
    uniforms: {
        tDiffuse: { value: null }, 
        tMask: { value: null },    
        u_strength: { value: 0.0 },
        u_resolution: { value: new THREE.Vector2(canvasWidth, canvasHeight) },
        u_maskUsesAlpha: { value: false } // <-- ADD THIS UNIFORM
    },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D tDiffuse;
            uniform sampler2D tMask;
            uniform float u_strength;
            uniform vec2 u_resolution;
            uniform bool u_maskUsesAlpha; // <-- ADD THIS UNIFORM
            varying vec2 vUv;

            // Simple hash function to create pseudo-random noise
            float hash(vec2 p) {
                return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
            }

            void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            
                // --- START FIX ---
                float mask;
                if (u_maskUsesAlpha) {
                    // Read from alpha channel (1.0 - alpha = mask)
                    mask = 1.0 - texture2D(tMask, vUv).a;
                } else {
                    // Read from red channel
                    mask = texture2D(tMask, vUv).r;
                }
                // --- END FIX ---
                
                float noise = hash(gl_FragCoord.xy) - 0.5;
                float ditherAmount = noise * (u_strength / 255.0);
                
                if (mask > 0.5) {
                    color.rgb += ditherAmount;
                }

                gl_FragColor = color;
            }
        `,
        ...standardPPOptions
    });
    // --- END: NEW ditherCompositeMaterial ---

    // --- NEW: Gap Accumulation Targets (Task 2) ---
    masterGapTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, {
        format: THREE.RedFormat, // R8
        type: THREE.UnsignedByteType,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter
    });

    infillAtlasTarget_Color = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, {
        format: THREE.RGBAFormat, // RGBA8
        type: THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter, // Final atlas should be smooth
        magFilter: THREE.LinearFilter
    });

    infillAtlasTarget_Depth = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, {
        format: THREE.RedFormat, // Storing single-channel depth
        type: THREE.FloatType, // R32F for precision
        minFilter: THREE.NearestFilter, // Depth must be precise
        magFilter: THREE.NearestFilter
    });

    // --- NEW: Gap Accumulation Materials ---
    additiveBlendMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tBase: { value: null }, // masterGapTarget
            tNew: { value: null }  // The current frame's gap mask
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tBase;
            uniform sampler2D tNew;
            varying vec2 vUv;
            void main() {
                float baseMask = texture2D(tBase, vUv).r;
                float newMask = texture2D(tNew, vUv).r;
                gl_FragColor = vec4(max(baseMask, newMask), 0.0, 0.0, 1.0);
            }
        `,
        blending: THREE.NoBlending, // We do the blend manually with max()
        ...standardPPOptions
    });

    feedbackOverlayMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tDiffuse: { value: null }, // The final rendered image
            tMask: { value: null }     // masterGapTarget
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tDiffuse;
            uniform sampler2D tMask;
            varying vec2 vUv;
            void main() {
                vec4 color = texture2D(tDiffuse, vUv);
                float mask = texture2D(tMask, vUv).r;
                color.rgb = mix(color.rgb, vec3(1.0, 0.0, 0.0), mask * 0.5); // 50% red overlay
                gl_FragColor = color;
            }
        `,
        ...standardPPOptions
    });

    gapMaskExtractorMaterial = new THREE.ShaderMaterial({
        uniforms: { tDiffuse: { value: null }, u_maskUsesAlpha: { value: false } },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tDiffuse;
            uniform bool u_maskUsesAlpha;
            varying vec2 vUv;
            void main() {
                float mask;
                if (u_maskUsesAlpha) {
                    mask = 1.0 - texture2D(tDiffuse, vUv).a; // Gaps are 1.0
                } else {
                    mask = texture2D(tDiffuse, vUv).r; // Mask is 1.0
                }
                gl_FragColor = vec4(mask, 0.0, 0.0, 1.0);
            }
        `,
        ...standardPPOptions
    });

    maskGeneratorDepthMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tDepth: { value: null },    // The clean depth to be inpainted
            tMask: { value: null }     // masterGapTarget
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tDepth;
            uniform sampler2D tMask;
            varying vec2 vUv;
            void main() {
                float depth = texture2D(tDepth, vUv).r;
                float isGap = texture2D(tMask, vUv).r;
                
                // Output: (R,G,B,A) = (depth, depth, depth, validity)
                gl_FragColor = vec4(vec3(depth), 1.0 - isGap);
            }
        `,
        ...standardPPOptions
    });

    maskGeneratorDepthMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tDepth: { value: null },    // The clean depth to be inpainted
            tMask: { value: null }     // masterGapTarget
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tDepth;
            uniform sampler2D tMask;
            varying vec2 vUv;
            void main() {
                float depth = texture2D(tDepth, vUv).r;
                float isGap = texture2D(tMask, vUv).r;
                
                // Output: (R,G,B,A) = (depth, depth, depth, validity)
                gl_FragColor = vec4(vec3(depth), 1.0 - isGap);
            }
        `,
        ...standardPPOptions
    });

    // --- NEW: Ground Truth Accumulation Materials ---
    
    // Material to accumulate COLOR and VALIDITY (Alpha)
    // Uses Custom Blending for "Write If Empty" logic.
    groundTruthColorAccumulatorMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tCurrentColor: { value: null }, // sceneRenderTarget.texture
            tLayerMask: { value: null },    // layerMaskTarget
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tCurrentColor;
            uniform sampler2D tLayerMask;
            varying vec2 vUv;
            void main() {
                // Read inputs
                vec4 currentColor = texture2D(tCurrentColor, vUv);
                // LayerMask G channel holds the background mask
                float isBG = texture2D(tLayerMask, vUv).g;

                // If the current pixel is background, we want to write it.
                if (isBG > 0.5) {
                    // Output the color and set validity (alpha) to 1.0
                    gl_FragColor = vec4(currentColor.rgb, 1.0);
                } else {
                    // If it's foreground, discard the fragment. 
                    // This prevents it from affecting the blending operation entirely.
                    discard;
                }
            }
        `,
        // CRITICAL: Custom blend mode for "Write if Empty".
        // DstColor = SrcColor * (1 - DstAlpha) + DstColor * DstAlpha
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneMinusDstAlphaFactor,
        blendDst: THREE.DstAlphaFactor,
        depthWrite: false,
        depthTest: false
    });

    // Material to accumulate DEPTH
    // Uses the same logic and blending as the Color accumulator.
    groundTruthDepthAccumulatorMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tCurrentDepthNormalized: { value: null }, // Normalized 0-1 depth texture
            tLayerMask: { value: null },
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tCurrentDepthNormalized;
            uniform sampler2D tLayerMask;
            varying vec2 vUv;
            void main() {
                // Read inputs
                float currentDepth = texture2D(tCurrentDepthNormalized, vUv).r;
                float isBG = texture2D(tLayerMask, vUv).g;

                // If the current pixel is background, we want to write it.
                if (isBG > 0.5) {
                    // Output the depth (R) and set validity (A) to 1.0.
                    // We must output RGBA for the blending factors (which rely on Alpha) to work,
                    // even though the target (infillAtlasTarget_Depth) is R32F.
                    gl_FragColor = vec4(currentDepth, 0.0, 0.0, 1.0);
                } else {
                    discard;
                }
            }
        `,
        // Use the same custom blending strategy
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneMinusDstAlphaFactor,
        blendDst: THREE.DstAlphaFactor,
        depthWrite: false,
        depthTest: false
    });

    const postProcessQuad = new THREE.Mesh(postProcessPlane, null);
    postProcessScene.add(postProcessQuad);
    // ... (at the end of the function, after postProcessScene.add(postProcessQuad);)

    // --- ADD THIS ---
    // Target for storing depth as a color, for readback
    depthColorTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType // This is the default, but good to be explicit
    });

   // Material to encode depth into RGBA
depthToColorMaterial = new THREE.ShaderMaterial({
    uniforms: { tDepth: { value: null } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
    fragmentShader: `
        uniform sampler2D tDepth;
        varying vec2 vUv;
        vec4 packDepthToRGBA( const in float v ) {
            vec4 r = fract( v * vec4( 1.0, 255.0, 65025.0, 16581375.0 ) );
            r.xyz -= r.yzw * ( 1.0 / 255.0 );
            return r;
        }
        void main() {
            float depth = texture2D(tDepth, vUv).r;
            gl_FragColor = (depth >= 1.0) ? vec4(1.0) : packDepthToRGBA(depth);
        }
    `,
    ...standardPPOptions
});
    // --- END ADD ---
    
    // --- NEW: Infill Atlas Mesh (Task 6) ---
    const atlasGeom = new THREE.PlaneGeometry(terrariumWidth, terrariumHeight);
    const atlasMat = new THREE.ShaderMaterial({
        uniforms: {
            tColor: { value: infillAtlasTarget_Color.texture },
            tDepth: { value: infillAtlasTarget_Depth.texture },
            // Pass in camera uniforms to reconstruct position for depth displacement
            u_portalPlaneDepthNorm: { value: currentNormPortalPlane },
            u_worldOuterVolumeDepth: { value: outerVolumeDepth },
            u_worldInnerVolumeDepth: { value: innerVolumeDepth },
            displacementBias: { value: 0.0 },
            u_metricScale: { value: metricScaleFactor }
        },
        vertexShader: `
            uniform sampler2D tDepth;
            uniform float u_portalPlaneDepthNorm;
            uniform float u_worldOuterVolumeDepth;
            uniform float u_worldInnerVolumeDepth;
            uniform float displacementBias;
            varying vec2 vUv;
            varying float vNormalizedDepth;
            
            void main() {
                vUv = uv;
                // Read pre-baked inpainted depth
                vNormalizedDepth = texture2D(tDepth, vUv).r;
                
                // Use the *exact* same displacement logic as the main shader
                float displacement = 0.0;
                if (vNormalizedDepth < u_portalPlaneDepthNorm) {
                    float t = smoothstep(0.0, u_portalPlaneDepthNorm, vNormalizedDepth);
                    displacement = mix(-u_worldOuterVolumeDepth, 0.0, t);
                } else {
                    float t = smoothstep(u_portalPlaneDepthNorm, 1.0, vNormalizedDepth);
                    displacement = mix(0.0, u_worldInnerVolumeDepth, t);
                }
                vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
                viewPosition.z += displacement + displacementBias;
                gl_Position = projectionMatrix * viewPosition;
            }
        `,
        fragmentShader: `
            uniform sampler2D tColor;
            varying vec2 vUv;
            void main() {
                // Sample from pre-baked inpainted color
                gl_FragColor = texture2D(tColor, vUv);
            }
        `,
        side: THREE.DoubleSide,
        depthWrite: true,
        depthTest: true
    });
    infillAtlasMesh = new THREE.Mesh(atlasGeom, atlasMat);
    infillAtlasMesh.position.z = portalPlaneWorldZ;
    infillAtlasMesh.renderOrder = 0; // The very back
    infillAtlasMesh.visible = false; // Hidden by default
    scene.add(infillAtlasMesh);
}

let splitMaterial;

/**
 * Creates a material that splits the scene into FG and BG.
 */
// moebius.js: approx line 2808 (ADD THIS FUNCTION)
function createSplitMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {
            tColor: { value: null },      // sceneRenderTarget
            tLayerMask: { value: null },  // layerMaskTarget
            u_showFG: { value: true }     // Toggle: true=show FG, false=show BG
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D tColor;
            uniform sampler2D tLayerMask;
            uniform bool u_showFG;
            varying vec2 vUv;

            void main() {
                vec4 color = texture2D(tColor, vUv);
                float mask = texture2D(tLayerMask, vUv).r; // 1.0 = FG, 0.0 = BG

                if (u_showFG) {
                    // Show FG: Pass through color if mask is 1.0, otherwise transparent
                    gl_FragColor = vec4(color.rgb, color.a * mask);
                } else {
                    // Show BG: Pass through color if mask is 0.0, otherwise transparent
                    gl_FragColor = vec4(color.rgb, color.a * (1.0 - mask));
                }
            }
        `,
        transparent: true,
        blending: THREE.NoBlending
    });
}
// moebius.js: Add this function after createSplitMaterial (approx. line 2823)

function createFinalCompositeMaterial() {
    return new THREE.ShaderMaterial({
        uniforms: {
            tFG: { value: null },
            tBG: { value: null },
            tLayerMask: { value: null },
            tOriginal: { value: null }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D tFG;
            uniform sampler2D tBG;
            uniform sampler2D tLayerMask;
            uniform sampler2D tOriginal;
            varying vec2 vUv;

            void main() {
                vec4 fgColor = texture2D(tFG, vUv);
                vec4 bgColor = texture2D(tBG, vUv);
                float mask = texture2D(tLayerMask, vUv).r;
                
                // Lerp between BG and FG based on the mask
                vec4 finalColor = mix(bgColor, fgColor, mask);
                
                // If the final inpainted color is transparent,
                // fallback to the original (non-gap) pixel.
                if (finalColor.a < 0.01) {
                    gl_FragColor = texture2D(tOriginal, vUv);
                } else {
                    gl_FragColor = finalColor;
                }
            }
        `,
        transparent: false
    });
}

function createSceneGuides() {
    const portalPlaneMaterial = new THREE.MeshBasicMaterial({ color: 0x00cc00, wireframe: true, transparent: true, opacity: 0.25, side: THREE.DoubleSide });
    portalPlaneGuide = new THREE.Mesh(new THREE.PlaneGeometry(terrariumWidth, terrariumHeight), portalPlaneMaterial);
    scene.add(portalPlaneGuide);

    const innerVolumeMaterial = new THREE.MeshBasicMaterial({ color: 0x3333ff, wireframe: true, transparent: true, opacity: 0.15, depthWrite: false });
    innerVolumeGuide = new THREE.Mesh(new THREE.BoxGeometry(terrariumWidth, terrariumHeight, 1), innerVolumeMaterial);
    scene.add(innerVolumeGuide);

    const outerVolumeMaterial = new THREE.MeshBasicMaterial({ color: 0xff3333, wireframe: true, transparent: true, opacity: 0.15, depthWrite: false });
    outerVolumeGuide = new THREE.Mesh(new THREE.BoxGeometry(terrariumWidth, terrariumHeight, 1), outerVolumeMaterial);
    scene.add(outerVolumeGuide);
    updateVolumeGuidesPositionsAndScales();
}

function updateVolumeGuidesVisibility(show, duration = 0) {
    if (!portalPlaneGuide || !innerVolumeGuide || !outerVolumeGuide) return;
    portalPlaneGuide.visible = show;
    innerVolumeGuide.visible = show && innerVolumeDepth > 0.0001;
    outerVolumeGuide.visible = show && outerVolumeDepth > 0.0001;

    if (show && duration > 0) {
        setTimeout(() => {
            updateVolumeGuidesVisibility(false);
        }, duration);
    }
}

function updateVolumeGuidesPositionsAndScales() {
    if (!portalPlaneGuide || !innerVolumeGuide || !outerVolumeGuide) return;
    portalPlaneGuide.position.z = portalPlaneWorldZ;
    const scaledInnerDepth = innerVolumeDepth * metricScaleFactor;
    const scaledOuterDepth = outerVolumeDepth * metricScaleFactor;

    if (scaledInnerDepth > 0.0001) {
        innerVolumeGuide.scale.z = scaledInnerDepth;
        innerVolumeGuide.position.z = portalPlaneWorldZ + scaledInnerDepth / 2;
    } else { innerVolumeGuide.scale.z = 0.0001; }
    if (scaledOuterDepth > 0.0001) {
        outerVolumeGuide.scale.z = scaledOuterDepth;
        outerVolumeGuide.position.z = portalPlaneWorldZ - scaledOuterDepth / 2;
    } else { outerVolumeGuide.scale.z = 0.0001; }

    const guidesAreManuallyOn = portalPlaneGuide.visible && !dollyZoomActive && !depthPeekActive && wireframeCubes.length === 0;
    if (!guidesAreManuallyOn) {
        updateVolumeGuidesVisibility(wireframeCubes.length > 0 || dollyZoomActive || depthPeekActive);
    }
}
// =================================================================
// --- START: CORRECTED DEPTH PEELING FUNCTIONS (PASTE AS BLOCK) ---
// =================================================================

/**
 * Initialize depth peeling render targets
 * Call this from initializeSceneAndRenderer() after line 2538
 */
function initializeDepthPeelingTargets(width, height) {
    console.log("Initializing depth peeling targets...");
    
    const standardOptions = {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: false,
        stencilBuffer: false
    };
    
    // moebius.js: approx line 3097
    primaryRenderTarget = new THREE.WebGLRenderTarget(width, height, {
        ...standardOptions,

        // --- START FIX: Robust DepthTexture Configuration ---
        depthBuffer: true,    // Override standardOptions. Depth buffer is required.
        stencilBuffer: false, // Already set to false in standardOptions.
        depthTexture: new THREE.DepthTexture(width, height, THREE.FloatType) // Use FloatType.
        // --- END FIX ---
    });
    
    // Secondary depth target (needs float precision for accurate depth)
    secondaryDepthTarget = new THREE.WebGLRenderTarget(width, height, {
        format: THREE.RGBAFormat,
        type: THREE.FloatType,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: true,
        stencilBuffer: false
    });
    
    // Fidelity mask target
    fidelityMaskTarget = new THREE.WebGLRenderTarget(width, height, {
        ...standardOptions
    });
    
    console.log("Depth peeling targets initialized.");
}

/**
 * Resize depth peeling targets when window resizes
 * Call this from your resizeRendererAndTargets() function
 */
function resizeDepthPeelingTargets(width, height) {
    if (primaryRenderTarget) {
        primaryRenderTarget.setSize(width, height);
        if (primaryRenderTarget.depthTexture) {
            primaryRenderTarget.depthTexture.image.width = width;
            primaryRenderTarget.depthTexture.image.height = height;
        }
    }
    if (secondaryDepthTarget) {
        secondaryDepthTarget.setSize(width, height);
    }
    if (fidelityMaskTarget) {
        fidelityMaskTarget.setSize(width, height);
    }
}

/**
 * Create the fidelity comparison material
 * This is the CORRECTED version that fixes the gap mask.
 */
function createFidelityComparisonMaterial() {
    fidelityComparisonMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tPrimaryColor: { value: null },
            tPrimaryDepth: { value: null },
            tSecondaryData: { value: null },
            u_resolution: { value: new THREE.Vector2(1, 1) },
            u_depthGradientThreshold: { value: depthGradientThreshold }, // No longer used
            u_depthCliffThreshold: { value: depthCliffThreshold },    // No longer used
            u_minGapWidth: { value: minGapWidth }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = vec4(position, 1.0);
            }
        `,
        // moebius.js: lines 3176-3217 (REPLACE)

        fragmentShader: `
            uniform sampler2D tPrimaryColor;
            uniform sampler2D tPrimaryDepth;    // Stretched FG (0=Near, 1=Far)
            uniform sampler2D tSecondaryData;   // Background (0=Near, 1=Far)
            uniform vec2 u_resolution;
            uniform float u_depthCliffThreshold;    // The MINIMUM depth difference to be a gap
            uniform float u_minGapWidth;
            varying vec2 vUv;
            
            void main() {
                // Sample primary layer (stretched foreground)
                float primaryDepth = texture2D(tPrimaryDepth, vUv).r; // e.g., 0.1 (Near)
                
                // Sample secondary layer (background)
                vec4 secondaryData = texture2D(tSecondaryData, vUv);
                float secondaryDepth = secondaryData.r; // e.g., 0.9 (Far)
                bool hasSecondaryLayer = secondaryData.a > 0.5;

                // Ignore pure background or invalid depths
                // primaryDepth > 0.999 means it's the far clipping plane (background)
                if (!hasSecondaryLayer || primaryDepth > 0.999) {
                    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
                    return;
                }
                
                // --- 1. Identify Disocclusion Gaps ---
                
                // We are looking for a stretched foreground pixel (primaryDepth)
                // that is covering a distant background pixel (secondaryDepth).
                // secondaryDepth (BG) MUST be greater (further) than primaryDepth (FG).
                float depthDifference = secondaryDepth - primaryDepth; // e.g., 0.9 - 0.1 = 0.8
                
                // isDisocclusion:
                // 1. The difference must be positive (BG is behind FG).
                // 2. The difference must be *larger* than the cliff threshold.
                bool isDisocclusion = (depthDifference > u_depthCliffThreshold);

                // --- 2. Edge Coherence Check (to remove noise) ---
                vec2 texel = 1.0 / u_resolution;
                float neighborGaps = 0.0;
                for (int dx = -1; dx <= 1; dx++) {
                    for (int dy = -1; dy <= 1; dy++) {
                        if (dx == 0 && dy == 0) continue;
                        
                        vec2 nUv = vUv + vec2(float(dx), float(dy)) * texel;
                        vec4 nSecondaryData = texture2D(tSecondaryData, nUv);
                        float nPrimaryDepth = texture2D(tPrimaryDepth, nUv).r;
                        
                        if (nSecondaryData.a > 0.5 && nPrimaryDepth < 0.999) {
                            float nDepthDiff = nSecondaryData.r - nPrimaryDepth;
                            // Check if neighbor is *also* a disocclusion gap
                            if (nDepthDiff > u_depthCliffThreshold) {
                                neighborGaps += 1.0;
                            }
                        }
                    }
                }
                bool hasCoherence = neighborGaps >= u_minGapWidth;
                
                // === FINAL DECISION ===
                bool isTrueDisocclusion = isDisocclusion && hasCoherence;
                
                if (isTrueDisocclusion) {
                    gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0); // Mark as gap (white)
                } else {
                    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); // Not a gap (black)
                }
            }
        `,
        depthWrite: false,
        depthTest: false,
        transparent: false
    });
    
    console.log("Fidelity comparison material created (Corrected, Hardware Z-Test Version).");
}

/**
 * Render primary pass (front surfaces with all gap detection disabled)
 * Returns the primary render target
 */
function renderPrimaryPass(scene, camera, renderer) {
    // --- START FIX: Disable ALL in-shader gap methods ---
    // This ensures the primary pass is rendered CLEANLY
    setAllLayerUniforms('u_useDepthGrad', false);
    setAllLayerUniforms('u_useSobel', false);
    setAllLayerUniforms('u_useLuma', false);
    setAllLayerUniforms('u_useChroma', false);
    setAllLayerUniforms('u_useUVStretch', false);
    setAllLayerUniforms('u_useGrazingAngle', false);
    setAllLayerUniforms('u_useEdgeMask', false);
    // --- END FIX ---
    
    // Set object IDs for each layer
    mediaLayers.forEach((layer, index) => {
        if (layer.mesh && layer.mesh.material && layer.mesh.material.uniforms) {
            const normalizedID = mediaLayers.length > 1 ? index / (mediaLayers.length - 1) : 0.0;
            if (!layer.mesh.material.uniforms.u_objectID) {
                layer.mesh.material.uniforms.u_objectID = { value: normalizedID };
            } else {
                layer.mesh.material.uniforms.u_objectID.value = normalizedID;
            }
        }
    });
    
    // Render to primary target
    renderer.setRenderTarget(primaryRenderTarget);
    renderer.clear();
    renderer.render(scene, camera);
    
    return primaryRenderTarget;
}

// moebius.js: REPLACE this entire function

/**
 * Render secondary pass (background surfaces behind foreground)
 * Requires the primary render target from first pass
 */
function renderSecondaryPass(scene, camera, renderer, primaryTarget) {
    if (!primaryTarget || !primaryTarget.depthTexture) {
        console.error("Primary target or its depth texture missing for secondary pass");
        return null;
    }

    // --- Store original state ---
    const originalSide = new Map();
    const originalDepthTest = new Map();
    const originalDepthWrite = new Map();
    const originalFragmentShader = new Map();

    // --- START: NEW (Corrected) ---
    // --- Get the WebGL context and store original state ---
    const gl = renderer.getContext();
    if (!gl) {
        console.error("WebGL context not available in renderSecondaryPass");
        return null;
    }
    // Get the current depth function (e.g., gl.LESS)
    const originalDepthFunc = gl.getParameter(gl.DEPTH_FUNC); 
    // --- END: NEW (Corrected) ---

    // --- PASS 1: Configure ALL layers for secondary pass ---
    mediaLayers.forEach((layer, index) => {
        if (!layer.mesh) return;

        const originalMaterial = layer.mesh.material;
        
        // --- Store original properties ---
        originalSide.set(layer.id, originalMaterial.side);
        originalDepthTest.set(layer.id, originalMaterial.depthTest);
        originalDepthWrite.set(layer.id, originalMaterial.depthWrite);
        originalFragmentShader.set(layer.id, originalMaterial.fragmentShader);

        // --- INJECT Secondary Pass Logic ---
        
        // 1. Render front-faces.
        originalMaterial.side = THREE.FrontSide;
        
        // 2. Enable depth testing.
        originalMaterial.depthTest = true;
        
        // 3. Disable depth writing.
        originalMaterial.depthWrite = false;

        // 4. ADD and SET the uniforms required by the secondary shader
        if (!originalMaterial.uniforms.tPrimaryDepth) {
            originalMaterial.uniforms.tPrimaryDepth = { value: null };
        }
        if (!originalMaterial.uniforms.u_epsilon) {
            originalMaterial.uniforms.u_epsilon = { value: null };
        }
        if (!originalMaterial.uniforms.u_resolution) {
            originalMaterial.uniforms.u_resolution = { value: new THREE.Vector2() };
        }

        originalMaterial.uniforms.tPrimaryDepth.value = primaryTarget.depthTexture;
        originalMaterial.uniforms.u_epsilon.value = secondaryDepthEpsilon;
        originalMaterial.uniforms.u_resolution.value.set(renderer.domElement.width, renderer.domElement.height);

        // 5. Replace the fragment shader.
        originalMaterial.fragmentShader = secondaryDepthFragmentShader;
        
        // 6. Add/Update the u_objectID uniform.
        const normalizedID = mediaLayers.length > 1 ? index / (mediaLayers.length - 1) : 0.0;
        if (!originalMaterial.uniforms.u_objectID) {
             originalMaterial.uniforms.u_objectID = { value: normalizedID };
        } else {
             originalMaterial.uniforms.u_objectID.value = normalizedID;
        }

        // 7. Force the material to recompile.
        originalMaterial.needsUpdate = true;
    });

    // --- PASS 2: Render the scene ---
    renderer.setRenderTarget(secondaryDepthTarget);
    renderer.clear();
    
    // Bind Primary's depth for hardware Z-testing.
    secondaryDepthTarget.depthTexture = primaryTarget.depthTexture;

    // --- START: CRITICAL FIX (Corrected) ---
    // 8. Change the hardware depth test function.
    //    We tell the GPU to PASS fragments that are GREATER THAN OR EQUAL to
    //    the existing (primary) depth.
    gl.depthFunc(gl.GEQUAL); // THREE.GreaterEqualDepth corresponds to gl.GEQUAL
    // --- END: CRITICAL FIX (Corrected) ---

    renderer.render(scene, camera);

    // --- START: NEW (Corrected) ---
    // --- Restore original renderer state ---
    gl.depthFunc(originalDepthFunc); // Restore the original function (e.g., gl.LESS)
    // --- END: NEW (Corrected) ---

    // --- PASS 3: Restore all original materials ---
    mediaLayers.forEach(layer => {
        if (layer.mesh && originalFragmentShader.has(layer.id)) {
            const originalMaterial = layer.mesh.material;
            
            // Restore original properties
            originalMaterial.side = originalSide.get(layer.id);
            originalMaterial.depthTest = originalDepthTest.get(layer.id);
            originalMaterial.depthWrite = originalDepthWrite.get(layer.id);
            originalMaterial.fragmentShader = originalFragmentShader.get(layer.id);

            // Force the material to recompile *back*
            originalMaterial.needsUpdate = true;
        }
    });
    
    // Unbind the depth texture
    secondaryDepthTarget.depthTexture = null;

    return secondaryDepthTarget;
}

/**
 * Render fidelity comparison pass (analyze primary vs secondary)
 * Creates a clean gap mask
 */
function renderFidelityComparisonPass(postProcessScene, postProcessCamera, renderer, primaryTarget, secondaryTarget) {
    if (!fidelityComparisonMaterial || !primaryTarget || !secondaryTarget) {
        console.error("Fidelity comparison material or targets missing");
        return null;
    }
    
    // Update uniforms
    fidelityComparisonMaterial.uniforms.tPrimaryColor.value = primaryTarget.texture;
    fidelityComparisonMaterial.uniforms.tPrimaryDepth.value = primaryTarget.depthTexture;
    fidelityComparisonMaterial.uniforms.tSecondaryData.value = secondaryTarget.texture;
    fidelityComparisonMaterial.uniforms.u_resolution.value.set(
        renderer.domElement.width,
        renderer.domElement.height
    );
    fidelityComparisonMaterial.uniforms.u_depthGradientThreshold.value = depthGradientThreshold;
    fidelityComparisonMaterial.uniforms.u_depthCliffThreshold.value = depthCliffThreshold;
    fidelityComparisonMaterial.uniforms.u_minGapWidth.value = minGapWidth;
    
    // Render full-screen quad
    const postProcessQuad = postProcessScene.children[0];
    if (!postProcessQuad) {
        console.error("Post-process quad not found");
        return null;
    }
    
    const originalMaterial = postProcessQuad.material;
    postProcessQuad.material = fidelityComparisonMaterial;
    
    renderer.setRenderTarget(fidelityMaskTarget);
    renderer.clear();
    renderer.render(postProcessScene, postProcessCamera);
    
    postProcessQuad.material = originalMaterial;
    
    return fidelityMaskTarget;
}
// =================================================================
// --- END: CORRECTED DEPTH PEELING FUNCTIONS ---
// =================================================================

function initializeSubjectLockConstant() {
    if (!camera) return;
    const distToSubj = Math.abs(camera.position.z - subjectFocalPlaneWorldZ);
    if (distToSubj > 0.00001 && camera.fov > 0.1 && Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2.0) > 0.00001) {
        subjectLockConstantK = distToSubj / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2.0);
    } else {
        subjectLockConstantK = (dollyMaxDistance) / Math.tan(THREE.MathUtils.degToRad(initialFov) / 2.0);
    }
}

// --- MODIFIED: Loops over new layer system ---
function updateCameraAndProjection() {
    if (!camera || !canvasElement) return;

    if (dollyZoomActive) {
        dollyZoomTime += dollyZoomSpeed * 100;
        let distFromSubject = dollyMinDistance + (dollyMaxDistance - dollyMinDistance) * (0.5 * (1 + Math.sin(dollyZoomTime)));
        camera.position.z = subjectFocalPlaneWorldZ + Math.max(0.001, distFromSubject);
        if (subjectLockActive) {
            const actualDistToSubj = Math.abs(camera.position.z - subjectFocalPlaneWorldZ);
            if (subjectLockConstantK > 0.00001 && actualDistToSubj > 0.00001) {
                camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(actualDistToSubj / subjectLockConstantK));
            } else { camera.fov = initialFov; }
        } else {
            const distToPortal = Math.abs(camera.position.z - portalPlaneWorldZ);
            if (distToPortal > 0.00001) {
                camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(terrariumHeight / (2 * distToPortal)));
            } else { camera.fov = initialFov; }
        }
        camera.fov = Math.max(5, Math.min(160, camera.fov));
    }

    const ftsSlider = document.getElementById('facetrackingScalarSlider');
    const scalarVal = ftsSlider ? parseFloat(ftsSlider.value) : 1.0;

    const cRect = canvasElement.getBoundingClientRect();
    let oX_current, oY_current;

    if (document.fullscreenElement || document.webkitFullscreenElement) {
        oX_current = 0; oY_current = 0;
    } else {
        const sX = window.screenX || 0, sY = window.screenY || 0;
        const cX = sX + cRect.left, cY = sY + cRect.top;
        const screenWidth = window.screen.width || window.innerWidth;
        const screenHeight = window.screen.height || window.innerHeight;
        const cCX = cX + cRect.width / 2; const cCY = cY + cRect.height / 2;
        const mCX = screenWidth / 2; const mCY = screenHeight / 2;
        oX_current = cRect.width > 0 ? (cCX - mCX) / cRect.width : 0;
        oY_current = cRect.height > 0 ? -(cCY - mCY) / cRect.height : 0;
    }

    // --- START: MODIFICATION for Auto-Sweep ---
    // If an automated sweep is running, it controls the camera.
    // Otherwise, use head tracking.
    if (!isSweeping) {
    // --- END: MODIFICATION ---
        const currentCombinedX = (latestDetectedFaceX - 0.5) + oX_current;
        const currentCombinedY = (latestDetectedFaceY - 0.5) + oY_current;
        const effectiveDeviationX = currentCombinedX - baselineFaceTrackerOffsetX;
        const effectiveDeviationY = currentCombinedY - baselineFaceTrackerOffsetY;
        const camOff = 0.2;
        let faceTrackCamX = -effectiveDeviationX * camOff * scalarVal;
        let faceTrackCamY = -effectiveDeviationY * camOff * scalarVal;


        let gyroCamX = 0;
        let gyroCamY = 0;

        if (gyroActive && typeof currentGyroBeta === 'number') {
            const alphaRad = THREE.MathUtils.degToRad(currentGyroAlpha);
            const betaRad = THREE.MathUtils.degToRad(currentGyroBeta);
            const gammaRad = THREE.MathUtils.degToRad(currentGyroGamma);

            const tempEuler = new THREE.Euler(betaRad, alphaRad, -gammaRad, 'YXZ');
            currentQuaternion.setFromEuler(tempEuler);

            deltaQuaternion.multiplyQuaternions(initialQuaternionInverse, currentQuaternion);

            euler.setFromQuaternion(deltaQuaternion, 'YXZ');

            const stablePitchRad = euler.x;
            const stableRollRad = euler.z;

            const stablePitchDegEquivalent = stablePitchRad * radianToDegreeFactor;
            const stableRollDegEquivalent = stableRollRad * radianToDegreeFactor;

            gyroCamX = -stablePitchDegEquivalent * gyroSensitivityX;
            gyroCamY = stableRollDegEquivalent * gyroSensitivityY;
        }

        camera.position.x = faceTrackCamX + gyroCamX;
        camera.position.y = faceTrackCamY + gyroCamY;
    } // --- ADDED: Closing brace for isSweeping check ---

    camera.updateProjectionMatrix();
    const pbl = new THREE.Vector3(-terrariumWidth/2,-terrariumHeight/2,portalPlaneWorldZ);
    const pbr = new THREE.Vector3(terrariumWidth/2,-terrariumHeight/2,portalPlaneWorldZ);
    const ptl = new THREE.Vector3(-terrariumWidth/2,terrariumHeight/2,portalPlaneWorldZ);
    frameCorners(camera, pbl, pbr, ptl);

    // --- MODIFIED: Loop over all layers ---
    for (const layer of mediaLayers) {
        if (layer.mesh && layer.mesh.material.uniforms) {
            layer.mesh.position.z = portalPlaneWorldZ;
            const uniforms = layer.mesh.material.uniforms;
            uniforms.u_portalPlaneDepthNorm.value = currentNormPortalPlane;
            uniforms.u_worldOuterVolumeDepth.value = outerVolumeDepth;
            uniforms.u_worldInnerVolumeDepth.value = innerVolumeDepth;
            uniforms.u_depthPeekActive.value = depthPeekActive;
            uniforms.u_depthPeekValue.value = depthPeekValue;
            uniforms.u_depthPeekTolerance.value = depthPeekTolerance;
            uniforms.u_splitPeekActive.value = isDraggingSplit; // NEW
            uniforms.u_splitPeekValue.value = depthPeekValue; // NEW (re-uses 8-bit image depth for highlight)
            uniforms.u_metricScale.value = metricScaleFactor;
        }
    }

    // --- NEW: Update infillAtlasMesh uniforms (Task 6) ---
    if (infillAtlasMesh) {
        infillAtlasMesh.position.z = portalPlaneWorldZ;
        const uniforms = infillAtlasMesh.material.uniforms;
        uniforms.u_portalPlaneDepthNorm.value = currentNormPortalPlane;
        uniforms.u_worldOuterVolumeDepth.value = outerVolumeDepth;
        uniforms.u_worldInnerVolumeDepth.value = innerVolumeDepth;
        uniforms.u_metricScale.value = metricScaleFactor;
    }
    // --- END: NEW ---

    updateVolumeGuidesPositionsAndScales();
}

/**
 * Runs one frame of ground truth accumulation using hardware blending.
 * This function now accepts the necessary inputs generated during the sweep loop or render loop.
 * OLD SIGNATURE: function runAccumulationPass()
 */
function runAccumulationPass(cleanColorTexture, layerMaskTexture, normalizedDepthTexture) {
    // This function accumulates the ground truth from the provided textures.
    // We rely on the inputs being correctly generated before this call.

    if (!renderer || !postProcessScene || !postProcessCamera ||
        !infillAtlasTarget_Color || !infillAtlasTarget_Depth ||
        !groundTruthColorAccumulatorMaterial || !groundTruthDepthAccumulatorMaterial ||
        !cleanColorTexture || !layerMaskTexture || !normalizedDepthTexture)
    {
        // Avoid spamming errors every frame during normal operation if textures aren't ready yet.
        return;
    }
    
    const postProcessQuad = postProcessScene.children[0];

    // 1. Accumulate Color and Validity
    postProcessQuad.material = groundTruthColorAccumulatorMaterial;
    groundTruthColorAccumulatorMaterial.uniforms.tCurrentColor.value = cleanColorTexture;
    groundTruthColorAccumulatorMaterial.uniforms.tLayerMask.value = layerMaskTexture;
    
    // Render to the Color Atlas (infillAtlasTarget_Color). 
    // The custom blending handles the "Write If Empty" logic.
    renderer.setRenderTarget(infillAtlasTarget_Color);
    // DO NOT CLEAR. We are accumulating.
    renderer.render(postProcessScene, postProcessCamera);

    // 2. Accumulate Depth
    postProcessQuad.material = groundTruthDepthAccumulatorMaterial;
    groundTruthDepthAccumulatorMaterial.uniforms.tCurrentDepthNormalized.value = normalizedDepthTexture;
    groundTruthDepthAccumulatorMaterial.uniforms.tLayerMask.value = layerMaskTexture;

    // Render to the Depth Atlas (infillAtlasTarget_Depth).
    renderer.setRenderTarget(infillAtlasTarget_Depth);
    // DO NOT CLEAR.
    renderer.render(postProcessScene, postProcessCamera);
}


/**
 * Bakes the final Infill Atlas (Color + Depth) using the accumulated Ground Truth.
 * The "True Unknown Mask" is implicitly the Alpha channel of the accumulated color.
 */
async function bakeInfillAtlas() {
    console.log("--- Starting Ground Truth Atlas Bake ---");
    isSweeping = true; // Use master lock during bake
    
    const bakeButton = document.getElementById('manualAccumulationButton');

    // Check dependencies
    if (!renderer || !postProcessScene || !postProcessCamera ||
        !infillAtlasTarget_Color?.texture || !infillAtlasTarget_Depth?.texture ||
        !pullPyramidTargets.length || !pushPyramidTargets.length ||
        !pullMaterial || !pushMaterial || !copyMaterial)
    {
        console.error("Bake (Ground Truth) failed: Missing essential components.");
        isSweeping = false;
        if (bakeButton) bakeButton.textContent = "Bake Failed";
        return;
    }
    
    // Define standardPPOptions locally for the utility shader (ensuring they exist)
    const standardPPOptions = {
        transparent: false,
        blending: THREE.NoBlending,
        depthTest: false,
        depthWrite: false
    };

    const postProcessQuad = postProcessScene.children[0];
    const numLevels = Math.min(pullPyramidTargets.length, maxPyramidLevels);
    const coarsestIndex = numLevels - 1;

    // We must bake DEPTH first, because the depth bake initialization requires the 
    // validity mask (Alpha channel) from the Color atlas BEFORE the color bake overwrites it.

    // --- BAKE 1: DEPTH ---
    console.log("Baking Depth Atlas...");
    if (bakeButton) bakeButton.textContent = "Baking... (1/2 Depth)";

    // 1.1: Initialize Pull Pyramid base for Depth.
    // We need the format (D, D, D, A) where D comes from the Depth Atlas (R) 
    // and A comes from the Color Atlas (A).
    
    // Create a temporary utility shader for this specific initialization step.
    const depthInitMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tDepth: { value: infillAtlasTarget_Depth.texture },
            tValiditySource: { value: infillAtlasTarget_Color.texture }
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tDepth;
            uniform sampler2D tValiditySource;
            varying vec2 vUv;
            void main() {
                float depth = texture2D(tDepth, vUv).r;
                float validity = texture2D(tValiditySource, vUv).a;
                gl_FragColor = vec4(vec3(depth), validity);
            }
        `,
        ...standardPPOptions
    });
    
    postProcessQuad.material = depthInitMaterial;
    renderer.setRenderTarget(pullPyramidTargets[0]);
    renderer.clear();
    renderer.render(postProcessScene, postProcessCamera);

    // 1.2: Run Pull (Simple) - Use simple pullMaterial for depth values.
    postProcessQuad.material = pullMaterial; 
    for (let i = 1; i <= coarsestIndex; i++) {
        const finer = pullPyramidTargets[i-1];
        const coarser = pullPyramidTargets[i];
        pullMaterial.uniforms.tFinerLevel.value = finer.texture;
        pullMaterial.uniforms.u_texelSize.value.set(1.0 / finer.width, 1.0 / finer.height);
        renderer.setRenderTarget(coarser);
        renderer.setViewport(0, 0, coarser.width, coarser.height);
        renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);
    }
    
    // 1.3: Copy coarsest to push
    postProcessQuad.material = copyMaterial;
    copyMaterial.uniforms.tDiffuse.value = pullPyramidTargets[coarsestIndex].texture;
    renderer.setRenderTarget(pushPyramidTargets[coarsestIndex]);
    renderer.setViewport(0, 0, pushPyramidTargets[coarsestIndex].width, pushPyramidTargets[coarsestIndex].height);
    renderer.render(postProcessScene, postProcessCamera);
    
    // 1.4: Run Push
    postProcessQuad.material = pushMaterial;
    for (let i = coarsestIndex - 1; i >= 0; i--) {
        const coarserSourceTarget = pushPyramidTargets[i+1];
        const currentLevelSourceTarget = pullPyramidTargets[i];
        const finerDestinationTarget = pushPyramidTargets[i];
        pushMaterial.uniforms.tCoarserLevel.value = coarserSourceTarget.texture;
        pushMaterial.uniforms.tCurrentLevel.value = currentLevelSourceTarget.texture;
        renderer.setRenderTarget(finerDestinationTarget); 
        renderer.setViewport(0, 0, finerDestinationTarget.width, finerDestinationTarget.height);
        renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);
    }
    
    // 1.5: Copy final result back to the Depth Atlas
    renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
    postProcessQuad.material = copyMaterial;
    copyMaterial.uniforms.tDiffuse.value = pushPyramidTargets[0].texture;
    renderer.setRenderTarget(infillAtlasTarget_Depth);
    // Do not clear, we are replacing the content.
    renderer.render(postProcessScene, postProcessCamera);


    // --- BAKE 2: COLOR ---
    console.log("Baking Color Atlas...");
    if (bakeButton) bakeButton.textContent = "Baking... (2/2 Color)";

    // 2.1: Copy the accumulated Color Atlas to the base of the Pull Pyramid.
    // The atlas is already in the correct format (C, C, C, A).
    postProcessQuad.material = copyMaterial;
    copyMaterial.uniforms.tDiffuse.value = infillAtlasTarget_Color.texture;
    renderer.setRenderTarget(pullPyramidTargets[0]);
    // renderer.clear(); // No need to clear, we are overwriting
    renderer.render(postProcessScene, postProcessCamera);

    // 2.2: Run Pull (Simple)
    // We use simple pullMaterial as depth-aware weighting is less critical for the final background layer.
    postProcessQuad.material = pullMaterial; 
    for (let i = 1; i <= coarsestIndex; i++) {
        const finer = pullPyramidTargets[i-1];
        const coarser = pullPyramidTargets[i];
        pullMaterial.uniforms.tFinerLevel.value = finer.texture;
        pullMaterial.uniforms.u_texelSize.value.set(1.0 / finer.width, 1.0 / finer.height);
        renderer.setRenderTarget(coarser);
        renderer.setViewport(0, 0, coarser.width, coarser.height);
        renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);
    }
    
    // 2.3: Copy coarsest to push
    postProcessQuad.material = copyMaterial;
    copyMaterial.uniforms.tDiffuse.value = pullPyramidTargets[coarsestIndex].texture;
    renderer.setRenderTarget(pushPyramidTargets[coarsestIndex]);
    renderer.setViewport(0, 0, pushPyramidTargets[coarsestIndex].width, pushPyramidTargets[coarsestIndex].height);
    renderer.render(postProcessScene, postProcessCamera);
    
    // 2.4: Run Push
    postProcessQuad.material = pushMaterial;
    for (let i = coarsestIndex - 1; i >= 0; i--) {
        const coarserSourceTarget = pushPyramidTargets[i+1];
        const currentLevelSourceTarget = pullPyramidTargets[i];
        const finerDestinationTarget = pushPyramidTargets[i];
        pushMaterial.uniforms.tCoarserLevel.value = coarserSourceTarget.texture;
        pushMaterial.uniforms.tCurrentLevel.value = currentLevelSourceTarget.texture;
        renderer.setRenderTarget(finerDestinationTarget); 
        renderer.setViewport(0, 0, finerDestinationTarget.width, finerDestinationTarget.height);
        renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);
    }
    
    // 2.5: Copy final result back to the Color Atlas
    renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
    postProcessQuad.material = copyMaterial;
    copyMaterial.uniforms.tDiffuse.value = pushPyramidTargets[0].texture;
    renderer.setRenderTarget(infillAtlasTarget_Color);
    // Do not clear.
    renderer.render(postProcessScene, postProcessCamera);
    
    
    // --- FINALIZE ---
    useStaticInfillAtlas = true;
    isAccumulatingGaps = false; // Ensure this is off (used by manual sweep/overlay)
    isSweeping = false; // Release master lock
    console.log("--- Ground Truth Atlas Bake Complete ---");
    
    // Reset button states
    const manualBtn = document.getElementById('manualAccumulationButton');
    const quickBtn = document.getElementById('autoSweepQuickButton');
    const fullBtn = document.getElementById('autoSweepFullButton');
    if (manualBtn) { 
        manualBtn.textContent = 'Start Live Sweep'; 
        manualBtn.disabled = false; 
        manualBtn.style.backgroundColor = '#17a2b8'; // Restore original color
    }
    if (quickBtn) { quickBtn.textContent = 'Run Quick Bake (Grid)'; quickBtn.disabled = false; }
    if (fullBtn) { fullBtn.textContent = 'Run Full Bake (Continuous)'; fullBtn.disabled = false; }
}


/**
 * Runs a 5x5 grid sweep to accumulate ground truth, then bakes the atlas.
 * MODIFIED for Ground Truth architecture.
 */
async function runAutomatedSweep() {
    // If a manual sweep is active, stop it before starting automated sweep.
    if (isAccumulatingGaps) {
        const manualBtn = document.getElementById('manualAccumulationButton');
        if (manualBtn) manualBtn.click(); // Simulate stop click
        return;
    }
    if (isSweeping) return;

    // --- START: Ground Truth Initialization ---
    // We need the normalized 8-bit depth texture for accumulation.
    const firstLayer = mediaLayers.find(l => l.mesh && l.textures.depth);
    if (!firstLayer) {
        console.error("Sweep failed: No mesh layer with a depth texture found.");
        return;
    }
    const normalizedDepthTexture = firstLayer.textures.depth;
    // --- END: Ground Truth Initialization ---

    isSweeping = true;
    // We do not set isAccumulatingGaps = true here, as we don't want the red overlay during automated sweeps.
    useStaticInfillAtlas = false;
    console.log("Starting Quick Bake (Grid) - Ground Truth");
    
    const quickBtn = document.getElementById('autoSweepQuickButton');
    const fullBtn = document.getElementById('autoSweepFullButton');
    const manualBtn = document.getElementById('manualAccumulationButton');
    if (quickBtn) { quickBtn.disabled = true; quickBtn.textContent = "Sweeping... (0/25)"; }
    if (fullBtn) fullBtn.disabled = true;
    if (manualBtn) manualBtn.disabled = true;

    // CRITICAL: Clear the atlas targets (Accumulators) before starting.
    // We no longer use masterGapTarget for accumulation in this architecture.
    renderer.setRenderTarget(infillAtlasTarget_Color);
    renderer.clear();
    renderer.setRenderTarget(infillAtlasTarget_Depth);
    renderer.clear();
    
    const origCamPos = camera.position.clone();
    
    const hAngle = parseFloat(document.getElementById('autoSweepAngleHorizSlider')?.value || 45) / 400.0;
    const vAngle = parseFloat(document.getElementById('autoSweepAngleVertSlider')?.value || 20) / 400.0;

    const steps = 5; // 5x5 grid
    let count = 0;

    // Prepare for the render sequence
    const postProcessQuad = postProcessScene.children[0];

    for (let i = 0; i < steps; i++) {
        for (let j = 0; j < steps; j++) {
            // Handle edge case where steps=1
            const u = (steps > 1) ? (i / (steps - 1)) * 2.0 - 1.0 : 0.0; // -1 to 1
            const v = (steps > 1) ? (j / (steps - 1)) * 2.0 - 1.0 : 0.0; // -1 to 1
            
            camera.position.x = origCamPos.x + u * hAngle;
            camera.position.y = origCamPos.y + v * vAngle;
            
            updateCameraAndProjection();
            
            // --- START: Ground Truth Render Sequence ---
            // We must perform the pre-rendering steps here to get the inputs for runAccumulationPass.

            // 1. Render Clean Scene
            // Ensure all gap detection is OFF.
            setAllLayerUniforms('u_useDepthGrad', false);
            setAllLayerUniforms('u_useSobel', false);
            setAllLayerUniforms('u_useLuma', false);
            setAllLayerUniforms('u_useChroma', false);
            setAllLayerUniforms('u_useCrease', false);
            setAllLayerUniforms('u_useCurvature', false);
            setAllLayerUniforms('u_useUVStretch', false);
            setAllLayerUniforms('u_useGrazingAngle', false);
            setAllLayerUniforms('u_useEdgeMask', false);

            renderer.setRenderTarget(sceneRenderTarget);
            renderer.clear();
            renderer.render(scene, camera);

            // 2. Generate Layer Mask (FG/BG Split)
            postProcessQuad.material = layerMaskMaterial;
            layerMaskMaterial.uniforms.tDepth.value = sceneRenderTarget.depthTexture;
            layerMaskMaterial.uniforms.u_inpaintingSplitDepth_RAW.value = currentInpaintingSplitDepthNorm;
            renderer.setRenderTarget(layerMaskTarget);
            renderer.clear();
            renderer.render(postProcessScene, postProcessCamera);

            // 3. Run Accumulation Pass
            runAccumulationPass(
                sceneRenderTarget.texture, 
                layerMaskTarget.texture,
                normalizedDepthTexture
            );
            // --- END: Ground Truth Render Sequence ---

            count++;
            if (quickBtn) quickBtn.textContent = `Sweeping... (${count}/25)`;

            // Yield control to allow the renderer to process and prevent blocking
            await new Promise(resolve => requestAnimationFrame(resolve)); 
        }
    }
    
    camera.position.copy(origCamPos);
    updateCameraAndProjection();
    
    await bakeInfillAtlas(); // This resets buttons and isSweeping
    console.log("Quick Bake Complete (Ground Truth)");
}

/**
 * Runs a 3-second continuous sweep to accumulate ground truth, then bakes the atlas.
 * MODIFIED for Ground Truth architecture.
 */
async function runContinuousSweep() {
    // If a manual sweep is active, stop it before starting automated sweep.
    if (isAccumulatingGaps) {
        const manualBtn = document.getElementById('manualAccumulationButton');
        if (manualBtn) manualBtn.click();
        return;
    }
    if (isSweeping) return;

    // --- START: Ground Truth Initialization ---
    const firstLayer = mediaLayers.find(l => l.mesh && l.textures.depth);
    if (!firstLayer) {
        console.error("Sweep failed: No mesh layer with a depth texture found.");
        return;
    }
    const normalizedDepthTexture = firstLayer.textures.depth;
    // --- END: Ground Truth Initialization ---

    isSweeping = true;
    // We do not set isAccumulatingGaps = true here.
    useStaticInfillAtlas = false;
    console.log("Starting Full Bake (Continuous) - Ground Truth");
    
    const quickBtn = document.getElementById('autoSweepQuickButton');
    const fullBtn = document.getElementById('autoSweepFullButton');
    const manualBtn = document.getElementById('manualAccumulationButton');
    if (quickBtn) quickBtn.disabled = true;
    if (fullBtn) { fullBtn.disabled = true; fullBtn.textContent = "Sweeping... (0%)"; }
    if (manualBtn) manualBtn.disabled = true;

    // CRITICAL: Clear the atlas targets (Accumulators).
    renderer.setRenderTarget(infillAtlasTarget_Color);
    renderer.clear();
    renderer.setRenderTarget(infillAtlasTarget_Depth);
    renderer.clear();
    
    const origCamPos = camera.position.clone();
    
    const hAngle = parseFloat(document.getElementById('autoSweepAngleHorizSlider')?.value || 45) / 400.0;
    const vAngle = parseFloat(document.getElementById('autoSweepAngleVertSlider')?.value || 20) / 400.0;
    
    const totalFrames = 180; // ~3 seconds at 60fps
    const postProcessQuad = postProcessScene.children[0];
    
    for (let frame = 0; frame < totalFrames; frame++) {
        const t = frame / (totalFrames - 1); // 0 to 1
        
        camera.position.x = origCamPos.x + hAngle * Math.sin(t * Math.PI * 2 * 3); // 3 horizontal loops
        camera.position.y = origCamPos.y + vAngle * Math.sin(t * Math.PI * 2 * 2); // 2 vertical loops
        
        updateCameraAndProjection();

        // --- START: Ground Truth Render Sequence ---
        // 1. Render Clean Scene
        setAllLayerUniforms('u_useDepthGrad', false);
        setAllLayerUniforms('u_useSobel', false);
        setAllLayerUniforms('u_useLuma', false);
        setAllLayerUniforms('u_useChroma', false);
        setAllLayerUniforms('u_useCrease', false);
        setAllLayerUniforms('u_useCurvature', false);
        setAllLayerUniforms('u_useUVStretch', false);
        setAllLayerUniforms('u_useGrazingAngle', false);
        setAllLayerUniforms('u_useEdgeMask', false);

        renderer.setRenderTarget(sceneRenderTarget);
        renderer.clear();
        renderer.render(scene, camera);

        // 2. Generate Layer Mask
        postProcessQuad.material = layerMaskMaterial;
        layerMaskMaterial.uniforms.tDepth.value = sceneRenderTarget.depthTexture;
        layerMaskMaterial.uniforms.u_inpaintingSplitDepth_RAW.value = currentInpaintingSplitDepthNorm;
        renderer.setRenderTarget(layerMaskTarget);
        renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);

        // 3. Run Accumulation Pass
        runAccumulationPass(
            sceneRenderTarget.texture, 
            layerMaskTarget.texture,
            normalizedDepthTexture
        );
        // --- END: Ground Truth Render Sequence ---
        
        if (frame % 10 === 0 && fullBtn) {
            fullBtn.textContent = `Sweeping... (${Math.round(t*100)}%)`;
        }
        
        // Yield control
        await new Promise(resolve => requestAnimationFrame(resolve));
    }
    
    camera.position.copy(origCamPos);
    updateCameraAndProjection();
    
    await bakeInfillAtlas(); // This resets buttons and isSweeping
    console.log("Full Bake Complete (Ground Truth)");
}

function render() {
    requestAnimationFrame(render);

    // Lock to prevent rendering during clearing
    if (isClearing) {
        renderer.setRenderTarget(null);
        renderer.clear();
        return;
    }

    // --- Performance monitoring ---
    const now = performance.now();
    frameCounter++;
    const elapsed = now - lastFpsTime;
    if (elapsed >= 1000) {
        const currentFps = Math.round((frameCounter * 1000) / elapsed);
        if (fpsDisplayElement) fpsDisplayElement.textContent = currentFps;
        frameCounter = 0;
        lastFpsTime = now;
    }
    
    const postProcessQuad = postProcessScene?.children[0];
    const debugView = document.getElementById('debugViewSelect')?.value || 'final';

    // DEPRECATED: Continuous Sweep Logic (isContinuousSweeping) is removed from render() loop.
    
    // 1. Update Camera and Render Order
    updateCameraAndProjection();

    // --- NEW: Render Order and Static Atlas Logic (Task 6) ---
    if (infillAtlasMesh) {
        infillAtlasMesh.visible = useStaticInfillAtlas;
    }
    const foregroundRenderOrderBase = useStaticInfillAtlas ? 1 : 0;
    for (const layer of mediaLayers) {
        if (layer.mesh) {
            // Store the original render order on first run
            if (layer.mesh.userData.baseRenderOrder === undefined) {
                layer.mesh.userData.baseRenderOrder = layer.mesh.renderOrder;
            }
            // Apply offset
            layer.mesh.renderOrder = layer.mesh.userData.baseRenderOrder + foregroundRenderOrderBase;
        }
    }
    
    if (useStaticInfillAtlas) {
        // --- STATIC ATLAS RENDER PATH ---
        
        // 1. Enable in-shader gap detection (8-sliders)
        // The foreground needs holes so the completed atlas shows through.
        setAllLayerUniforms('u_useDepthGrad', document.getElementById('useDepthGradCheck')?.checked || false);
        setAllLayerUniforms('u_useSobel', document.getElementById('useSobelCheck')?.checked || false);
        setAllLayerUniforms('u_useLuma', document.getElementById('useLumaCheck')?.checked || false);
        setAllLayerUniforms('u_useChroma', document.getElementById('useChromaCheck')?.checked || false);
        setAllLayerUniforms('u_useCrease', document.getElementById('useCreaseCheck')?.checked || false);
        setAllLayerUniforms('u_useCurvature', document.getElementById('useCurvatureCheck')?.checked || false);
        setAllLayerUniforms('u_useUVStretch', document.getElementById('useUVStretchCheck')?.checked || false);
        setAllLayerUniforms('u_useGrazingAngle', document.getElementById('useGrazingAngleCheck')?.checked || false);
        setAllLayerUniforms('u_useEdgeMask', false);

        // 2. Render the "sandwich" (Atlas at 0, FG w/ holes at 1+)
        renderer.setRenderTarget(null);
        renderer.clear();
        renderer.render(scene, camera);
        
        // 3. Disable gap detection
        setAllLayerUniforms('u_useDepthGrad', false);
        setAllLayerUniforms('u_useSobel', false);
        setAllLayerUniforms('u_useLuma', false);
        setAllLayerUniforms('u_useChroma', false);
        setAllLayerUniforms('u_useCrease', false);
        setAllLayerUniforms('u_useCurvature', false);
        setAllLayerUniforms('u_useUVStretch', false);
        setAllLayerUniforms('u_useGrazingAngle', false);
        
        return; // Done for this frame
    }
    
    // --- DYNAMIC RENDER PATH (Real-time Inpainting or Live Sweep) ---
    
    // Helper function for final render passes (Dither and Feedback Overlay)
    const renderToScreen = (finalImageTexture) => {
        if (!finalImageTexture) {
            console.warn("renderToScreen called with no texture.");
            renderer.setRenderTarget(null);
            renderer.clear();
            return;
        }

        // --- NEW: Feedback Overlay Logic (Ground Truth) ---
        // During Live Sweep (isAccumulatingGaps=true, isSweeping=false), we show feedback.
        const showFeedbackOverlay = isAccumulatingGaps && !isSweeping;

        if (showFeedbackOverlay) {
            // Render dither/copy pass to a temp target first
            renderer.setRenderTarget(pingPongRenderTargetA); // Reuse A
            renderer.clear();
            renderer.setViewport(0, 0, pingPongRenderTargetA.width, pingPongRenderTargetA.height);
        } else {
            // Render directly to screen
            renderer.setRenderTarget(null);
            renderer.clear();
            renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height); // Always reset viewport
        }
        
        // Use dither material if strength is high enough, otherwise just copy
        if (ditherMaterial && ditherStrength > 0.01) { 
            if (!postProcessQuad) { console.error("Missing postProcessQuad for dither."); return; }
            postProcessQuad.material = ditherMaterial;
            ditherMaterial.uniforms.tDiffuse.value = finalImageTexture;
            ditherMaterial.uniforms.u_strength.value = ditherStrength;
            ditherMaterial.uniforms.u_resolution.value.set(renderer.domElement.width, renderer.domElement.height);
        } else {
            if (!copyMaterial || !postProcessQuad) {
                 console.error("Dither fallback failed: copyMaterial or postProcessQuad not initialized.");
                 return;
            }
            postProcessQuad.material = copyMaterial;
            copyMaterial.uniforms.tDiffuse.value = finalImageTexture;
        }
        
        renderer.render(postProcessScene, postProcessCamera);

        // --- NEW: Final overlay pass (Ground Truth) ---
        if (showFeedbackOverlay) {
            // We want the overlay to show the "Unknown" areas (where ground truth hasn't been captured yet).
            // The infillAtlasTarget_Color alpha channel is the Validity mask (1=Known, 0=Unknown).
            // The feedbackOverlayMaterial expects a mask where 1=Overlay, 0=No Overlay.
            // Therefore, we need to invert the alpha channel (1 - Alpha) before passing it to the overlay.

            // We can use gapMaskExtractorMaterial to perform this inversion quickly.
            // We will use masterGapTarget as a temporary buffer for the inverted mask.
            postProcessQuad.material = gapMaskExtractorMaterial;
            gapMaskExtractorMaterial.uniforms.tDiffuse.value = infillAtlasTarget_Color.texture;
            gapMaskExtractorMaterial.uniforms.u_maskUsesAlpha.value = true; // Calculates 1 - Alpha
            renderer.setRenderTarget(masterGapTarget); 
            renderer.render(postProcessScene, postProcessCamera);

            // Now render the final image with the overlay
            renderer.setRenderTarget(null);
            renderer.clear();
            renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
            postProcessQuad.material = feedbackOverlayMaterial;
            // pingPongRenderTargetA holds the final image rendered in the previous step
            feedbackOverlayMaterial.uniforms.tDiffuse.value = pingPongRenderTargetA.texture; 
            // masterGapTarget holds the inverted mask (1=Unknown/Overlay)
            feedbackOverlayMaterial.uniforms.tMask.value = masterGapTarget.texture;
            renderer.render(postProcessScene, postProcessCamera);
        }
    };
    

    // ... (Update uniforms: debugDepthMaterial, normalizeDepthMaterial, etc.) ...
    if (debugDepthMaterial) {
        debugDepthMaterial.uniforms.u_projectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
        debugDepthMaterial.uniforms.u_normalizationRange.value = depthContrastRange;
        debugDepthMaterial.uniforms.u_depthPeekActive.value = depthPeekActive;
        debugDepthMaterial.uniforms.u_depthPeekValue.value = depthPeekValue;
        debugDepthMaterial.uniforms.u_depthPeekTolerance.value = depthPeekTolerance;
    }
    if (normalizeDepthMaterial) {
        normalizeDepthMaterial.uniforms.u_projectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
        normalizeDepthMaterial.uniforms.u_normalizationRange.value = depthContrastRange;
    }
    if (jfaResolveMaterial) {
        jfaResolveMaterial.uniforms.u_projectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
    }
     if (debugJfaToleranceMaterial) {
         debugJfaToleranceMaterial.uniforms.u_projectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
     }
      if (debugJfaDepthCompareMaterial) {
          debugJfaDepthCompareMaterial.uniforms.u_projectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
      }


    if (!postProcessQuad) {
        console.error("Post processing quad not found! Cannot render post-processing effects.");
        renderer.setRenderTarget(null);
        renderer.clear();
        if(scene && camera) renderer.render(scene, camera); // Fallback attempt
        return;
    }

    renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);

    // --- CASE 1: Inpainting Disabled (and not accumulating) ---
    if (!useInpainting && debugView === 'final' && !(isAccumulatingGaps && !isSweeping)) {
        // We are NOT in a debug view, and NOT live sweeping, so we can render and exit early.
        
        // 1. SET ALL 8 UNIFORMS for the "Inpainting Off" render
        setAllLayerUniforms('u_useDepthGrad', document.getElementById('useDepthGradCheck')?.checked || false);
        setAllLayerUniforms('u_useSobel', document.getElementById('useSobelCheck')?.checked || false);
        setAllLayerUniforms('u_useLuma', document.getElementById('useLumaCheck')?.checked || false);
        setAllLayerUniforms('u_useChroma', document.getElementById('useChromaCheck')?.checked || false);
        setAllLayerUniforms('u_useCrease', document.getElementById('useCreaseCheck')?.checked || false);
        setAllLayerUniforms('u_useCurvature', document.getElementById('useCurvatureCheck')?.checked || false);
        setAllLayerUniforms('u_useUVStretch', document.getElementById('useUVStretchCheck')?.checked || false);
        setAllLayerUniforms('u_useGrazingAngle', document.getElementById('useGrazingAngleCheck')?.checked || false);
        setAllLayerUniforms('u_useEdgeMask', false);

        // 2. Render directly to screen
        renderer.setRenderTarget(null);
        renderer.clear();
        renderer.render(scene, camera);
        
        // 3. RESET ALL 8 UNIFORMS
        setAllLayerUniforms('u_useDepthGrad', false);
        setAllLayerUniforms('u_useSobel', false);
        setAllLayerUniforms('u_useLuma', false);
        setAllLayerUniforms('u_useChroma', false);
        setAllLayerUniforms('u_useCrease', false);
        setAllLayerUniforms('u_useCurvature', false);
        setAllLayerUniforms('u_useUVStretch', false);
        setAllLayerUniforms('u_useGrazingAngle', false);
        
        return; // Exit render loop early
    }

    // --- CASE 2: Inpainting Enabled OR a Debug View is Active OR Live Sweeping ---
    
    // Check for content
    const hasMeshLayers = mediaLayers.some(l => l.mesh);
    const hasWireframes = wireframeCubes.length > 0;
    const hasRenderableContent = hasMeshLayers || hasWireframes || useSolidBackground;

    if (!hasRenderableContent) {
        renderer.setRenderTarget(null); renderer.clear(); return; // Nothing to render
    }

    // --- PRE-PASS: Render CLEAN scene (Color + Depth) ---
    
    // 1. Disable ALL in-shader gap methods
    setAllLayerUniforms('u_useDepthGrad', false);
    setAllLayerUniforms('u_useSobel', false);
    setAllLayerUniforms('u_useLuma', false);
    setAllLayerUniforms('u_useChroma', false);
    setAllLayerUniforms('u_useUVStretch', false);
    setAllLayerUniforms('u_useGrazingAngle', false);
    setAllLayerUniforms('u_useEdgeMask', false);
    
    // 2. Render clean scene
    if (!sceneRenderTarget) { console.error("sceneRenderTarget is not initialized!"); return; }
    renderer.setRenderTarget(sceneRenderTarget);
    renderer.clear();
    renderer.render(scene, camera);
    
    let cleanColorTexture = sceneRenderTarget.texture;
    let cleanDepthTexture = sceneRenderTarget.depthTexture;

    // --- GPU DEPTH READBACK PASS ---
    if (depthReadbackRequest.requested) {
        if (!depthToColorMaterial || !depthColorTarget || !postProcessQuad) {
            console.error("Depth-to-Color materials not ready!");
            depthReadbackRequest.requested = false;
        } else {
            // Use the clean depth texture we just rendered
            postProcessQuad.material = depthToColorMaterial;
            depthToColorMaterial.uniforms.tDepth.value = cleanDepthTexture;
            renderer.setRenderTarget(depthColorTarget);
            renderer.clear();
            renderer.render(postProcessScene, postProcessCamera);
        }
    }
    // (This readback logic is now synchronous with the pass)
    if (depthReadbackRequest.requested) {
        const x = depthReadbackRequest.x;
        const y = depthReadbackRequest.y;
        const readBuffer = new Uint8Array(4);

        try {
            renderer.readRenderTargetPixels(
                depthColorTarget,
                x,
                depthColorTarget.height - 1 - y, // Invert Y
                1, 1,
                readBuffer
            );
            const rawHardwareDepth = decodeDepthFromColor(readBuffer);
            if (rawHardwareDepth < 1.0) { 
                currentInpaintingSplitDepthNorm = rawHardwareDepth;
                const splitSlider = document.getElementById('inpaintingSplitDepthNormSlider');
                const splitValueDisplay = document.getElementById('inpaintingSplitDepthNormSliderValue');
                if (splitSlider) {
                    splitSlider.value = rawHardwareDepth;
                    splitValueDisplay.textContent = rawHardwareDepth.toFixed(3);
                }
                if (isSettingSplitPlane) {
                    const u = x / renderer.domElement.width;
                    const v_gl = 1.0 - (y / renderer.domElement.height);
                    const clickedDepth_Meters = getMetersFromHardwareDepth(rawHardwareDepth, u, v_gl);
                    const instructionsPanel = document.getElementById('setScaleInstructions');
                    if (instructionsPanel) {
                        instructionsPanel.innerHTML = `<p>FG/BG Split: ${clickedDepth_Meters.toFixed(2)} m</p>`;
                    }
                }
            }
        } catch (e) { console.error("Error reading render target pixels:", e); }
        depthReadbackRequest.requested = false; 
    }

    // --- PASS: Generate FG/BG Layer Mask (for PullPush and Live Sweep) ---
    if (!layerMaskMaterial || !layerMaskTarget) { console.error("layerMaskMaterial or layerMaskTarget not initialized!"); return; }
    postProcessQuad.material = layerMaskMaterial;
    layerMaskMaterial.uniforms.tDepth.value = cleanDepthTexture;
    layerMaskMaterial.uniforms.u_inpaintingSplitDepth_RAW.value = currentInpaintingSplitDepthNorm;
    renderer.setRenderTarget(layerMaskTarget); renderer.clear();
    renderer.render(postProcessScene, postProcessCamera);


    // --- NEW: Live Sweep Accumulation Logic (Ground Truth) ---
    // If we are in Live Sweep mode (isAccumulatingGaps=true) AND not currently running an automated sweep (isSweeping=false)
    if (isAccumulatingGaps && !isSweeping) {
        // Find the normalized depth texture
        const firstLayer = mediaLayers.find(l => l.mesh && l.textures.depth);
        if (firstLayer) {
            const normalizedDepthTexture = firstLayer.textures.depth;
            // Run the accumulation pass using the data we just rendered.
            runAccumulationPass(
                cleanColorTexture,
                layerMaskTarget.texture,
                normalizedDepthTexture
            );
        }
    }


    // --- PASS: Generate Gaps/Edges (For real-time inpainting visualization) ---
    // This pass is still required if real-time inpainting is enabled, or if we are showing feedback.
    
    // 1. SET ALL 8 UNIFORMS from the UI
    setAllLayerUniforms('u_useDepthGrad', document.getElementById('useDepthGradCheck')?.checked || false);
    setAllLayerUniforms('u_useSobel', document.getElementById('useSobelCheck')?.checked || false);
    setAllLayerUniforms('u_useLuma', document.getElementById('useLumaCheck')?.checked || false);
    setAllLayerUniforms('u_useChroma', document.getElementById('useChromaCheck')?.checked || false);
    setAllLayerUniforms('u_useCrease', document.getElementById('useCreaseCheck')?.checked || false);
    setAllLayerUniforms('u_useCurvature', document.getElementById('useCurvatureCheck')?.checked || false);
    setAllLayerUniforms('u_useUVStretch', document.getElementById('useUVStretchCheck')?.checked || false);
    setAllLayerUniforms('u_useGrazingAngle', document.getElementById('useGrazingAngleCheck')?.checked || false);
    setAllLayerUniforms('u_useEdgeMask', false);
    
    // 2. Render scene WITH GAPS
    if (!pingPongRenderTargetB) { console.error("pingPongRenderTargetB not initialized!"); return; }
    renderer.setRenderTarget(pingPongRenderTargetB); renderer.clear();
    renderer.render(scene, camera);
    
    // 3. Store the gapped texture and set the mask type
    let finalEdgeMaskTexture = pingPongRenderTargetB.texture;
    let maskUsesAlpha = true; // The in-shader method writes gaps to the alpha channel
    
    // 4. RESET ALL 8 UNIFORMS
    setAllLayerUniforms('u_useDepthGrad', false);
    setAllLayerUniforms('u_useSobel', false);
    setAllLayerUniforms('u_useLuma', false);
    setAllLayerUniforms('u_useChroma', false);
    setAllLayerUniforms('u_useCrease', false);
    setAllLayerUniforms('u_useCurvature', false);
    setAllLayerUniforms('u_useUVStretch', false);
    setAllLayerUniforms('u_useGrazingAngle', false);

    // DEPRECATED: Old Gap Accumulation Logic (Task 3) is removed.

    
    // --- Handle Debug Views ---
    if (debugView === 'layer_mask') {
        renderToScreen(layerMaskTarget.texture);
        return; 
    }
    // DEPRECATED: luma_edge, depth_edge, edge
    if (debugView === 'depth') { 
        renderer.setRenderTarget(null); renderer.clear();
        postProcessQuad.material = debugDepthMaterial;
        debugDepthMaterial.uniforms.u_depthPeekActive.value = true;
        debugDepthMaterial.uniforms.tDepth.value = cleanDepthTexture; // Use clean depth
        renderer.render(postProcessScene, postProcessCamera);
        return;
    }
    // DEPRECATED: normalized_depth
    if (debugView === 'gaps') {
        renderToScreen(pingPongRenderTargetB.texture); // Shows gapped render
        return;
    }
    if (debugView === 'jfa') {
        // ... (JFA debug logic is unchanged) ...
        if (!jfaSeedMaterial || !jfaFloodMaterial || !jfaPingTarget || !jfaPongTarget || !finalEdgeMaskTexture || !sceneRenderTarget?.depthTexture || !debugJfaMaterial) { console.error("Missing resources for JFA debug view!"); return; }
        const jfaEdgeMaskTextureDebug = finalEdgeMaskTexture;
        jfaSeedMaterial.uniforms.tEdgeMask.value = jfaEdgeMaskTextureDebug; jfaSeedMaterial.uniforms.u_maskUsesAlpha.value = maskUsesAlpha;
        postProcessQuad.material = jfaSeedMaterial; jfaSeedMaterial.uniforms.tDepth.value = sceneRenderTarget.depthTexture; jfaSeedMaterial.uniforms.u_seedDensity.value = jfaSeedDensity;
        renderer.setRenderTarget(jfaPingTarget); renderer.clear(); renderer.render(postProcessScene, postProcessCamera);
        postProcessQuad.material = jfaFloodMaterial; let readTarget = jfaPingTarget, writeTarget = jfaPongTarget; const numPasses = Math.ceil(Math.log2(Math.max(renderer.domElement.width, renderer.domElement.height)));
        for (let i = 0; i < numPasses; i++) { const step = Math.pow(2, numPasses - 1 - i); jfaFloodMaterial.uniforms.u_step.value = step; jfaFloodMaterial.uniforms.tJFA.value = readTarget.texture; renderer.setRenderTarget(writeTarget); renderer.clear(); renderer.render(postProcessScene, postProcessCamera); [readTarget, writeTarget] = [writeTarget, readTarget]; }
        let finalJfaTextureDebug = readTarget.texture;
        renderer.setRenderTarget(null); renderer.clear();
        postProcessQuad.material = debugJfaMaterial; debugJfaMaterial.uniforms.tJFA.value = finalJfaTextureDebug;
        renderer.render(postProcessScene, postProcessCamera); return;
    }
    if (debugView === 'jfa_tolerance') {
        // ... (JFA tolerance debug logic is unchanged) ...
         if (!jfaSeedMaterial || !jfaFloodMaterial || !jfaPingTarget || !jfaPongTarget || !finalEdgeMaskTexture || !sceneRenderTarget?.depthTexture || !sceneRenderTarget?.texture || !copyMaterial || !debugJfaToleranceMaterial) { console.error("Missing resources for JFA tolerance debug view!"); return; }
        const jfaEdgeMaskTextureDebug = finalEdgeMaskTexture;
        jfaSeedMaterial.uniforms.tEdgeMask.value = jfaEdgeMaskTextureDebug; jfaSeedMaterial.uniforms.u_maskUsesAlpha.value = maskUsesAlpha;
        postProcessQuad.material = jfaSeedMaterial; jfaSeedMaterial.uniforms.tDepth.value = sceneRenderTarget.depthTexture; jfaSeedMaterial.uniforms.u_seedDensity.value = jfaSeedDensity;
        renderer.setRenderTarget(jfaPingTarget); renderer.clear(); renderer.render(postProcessScene, postProcessCamera);
        postProcessQuad.material = jfaFloodMaterial; let readTarget = jfaPingTarget, writeTarget = jfaPongTarget; const numPasses = Math.ceil(Math.log2(Math.max(renderer.domElement.width, renderer.domElement.height)));
        for (let i = 0; i < numPasses; i++) { const step = Math.pow(2, numPasses - 1 - i); jfaFloodMaterial.uniforms.u_step.value = step; jfaFloodMaterial.uniforms.tJFA.value = readTarget.texture; renderer.setRenderTarget(writeTarget); renderer.clear(); renderer.render(postProcessScene, postProcessCamera); [readTarget, writeTarget] = [writeTarget, readTarget]; }
        let finalJfaTextureDebug = readTarget.texture;
        const toleranceSliderDebug = document.getElementById('linearDepthToleranceSlider');
        const toleranceValueDebug = toleranceSliderDebug ? parseFloat(toleranceSliderDebug.value) : 0.03;
        renderer.setRenderTarget(null); renderer.clear();
        postProcessQuad.material = copyMaterial; copyMaterial.uniforms.tDiffuse.value = sceneRenderTarget.texture;
        renderer.render(postProcessScene, postProcessCamera);
        postProcessQuad.material = debugJfaToleranceMaterial;
        debugJfaToleranceMaterial.uniforms.tJFA.value = finalJfaTextureDebug;
        debugJfaToleranceMaterial.uniforms.tOriginalDepth.value = sceneRenderTarget.depthTexture;
        debugJfaToleranceMaterial.uniforms.tEdgeMask.value = jfaEdgeMaskTextureDebug;
        debugJfaToleranceMaterial.uniforms.u_linearDepthTolerance.value = toleranceValueDebug;
        renderer.autoClear = false;
        renderer.render(postProcessScene, postProcessCamera);
        renderer.autoClear = true;
        return;
    }
    if (debugView === 'jfa_depth_compare') {
        // ... (JFA depth compare debug logic is unchanged) ...
        if (!jfaSeedMaterial || !jfaFloodMaterial || !jfaPingTarget || !jfaPongTarget || !finalEdgeMaskTexture || !sceneRenderTarget?.depthTexture || !debugJfaDepthCompareMaterial) { console.error("Missing resources for JFA depth compare debug view!"); return; }
        const jfaEdgeMaskTextureDebug = finalEdgeMaskTexture;
        jfaSeedMaterial.uniforms.tEdgeMask.value = jfaEdgeMaskTextureDebug; jfaSeedMaterial.uniforms.u_maskUsesAlpha.value = maskUsesAlpha;
        postProcessQuad.material = jfaSeedMaterial; jfaSeedMaterial.uniforms.tDepth.value = sceneRenderTarget.depthTexture; jfaSeedMaterial.uniforms.u_seedDensity.value = jfaSeedDensity;
        renderer.setRenderTarget(jfaPingTarget); renderer.clear(); renderer.render(postProcessScene, postProcessCamera);
        postProcessQuad.material = jfaFloodMaterial; let readTarget = jfaPingTarget, writeTarget = jfaPongTarget; const numPasses = Math.ceil(Math.log2(Math.max(renderer.domElement.width, renderer.domElement.height)));
        for (let i = 0; i < numPasses; i++) { const step = Math.pow(2, numPasses - 1 - i); jfaFloodMaterial.uniforms.u_step.value = step; jfaFloodMaterial.uniforms.tJFA.value = readTarget.texture; renderer.setRenderTarget(writeTarget); renderer.clear(); renderer.render(postProcessScene, postProcessCamera); [readTarget, writeTarget] = [writeTarget, readTarget]; }
        let finalJfaTextureDebug = readTarget.texture;
        renderer.setRenderTarget(null); renderer.clear();
        postProcessQuad.material = debugJfaDepthCompareMaterial;
        debugJfaDepthCompareMaterial.uniforms.tJFA.value = finalJfaTextureDebug;
        debugJfaDepthCompareMaterial.uniforms.tOriginalDepth.value = sceneRenderTarget.depthTexture;
        debugJfaDepthCompareMaterial.uniforms.tEdgeMask.value = jfaEdgeMaskTextureDebug;
        renderer.render(postProcessScene, postProcessCamera);
        return;
    }
    // ... (PullPush debug logic is unchanged) ...
    if (debugView === 'pull_coarsest') {
        if (pullPyramidTargets.length === 0 || !copyMaterial || !pingPongRenderTargetB?.texture || !finalEdgeMaskTexture || !pullMaterialDepthAware) { console.error("Missing resources for PullPush coarsest debug view prep!"); return; }
        if (!maskGeneratorMaterial) {console.error("maskGeneratorMaterial missing!"); return;}
        postProcessQuad.material = maskGeneratorMaterial;
        maskGeneratorMaterial.uniforms.u_maskUsesAlpha.value = maskUsesAlpha;
        maskGeneratorMaterial.uniforms.tLayerMask.value = layerMaskTarget.texture;
        maskGeneratorMaterial.uniforms.u_maskChannel.value = 0; // Default to FG
        maskGeneratorMaterial.uniforms.tDiffuse.value = maskUsesAlpha ? pingPongRenderTargetB.texture : sceneRenderTarget.texture;
        maskGeneratorMaterial.uniforms.tEdgeMask.value = maskUsesAlpha ? null : finalEdgeMaskTexture;
        renderer.setRenderTarget(pullPyramidTargets[0]); renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);
        let pullShaderMaterialDebug = pullMaterialDepthAware; 
        postProcessQuad.material = pullShaderMaterialDebug;
        const numLevelsToUseDebug = Math.min(pullPyramidTargets.length, maxPyramidLevels);
        const coarsestIndexDebug = numLevelsToUseDebug - 1;
        for (let i = 1; i <= coarsestIndexDebug; i++) {
            const finerTarget = pullPyramidTargets[i-1]; const coarserTarget = pullPyramidTargets[i];
            if (!finerTarget?.texture || !coarserTarget) break;
            pullShaderMaterialDebug.uniforms.tFinerLevel.value = finerTarget.texture;
            pullShaderMaterialDebug.uniforms.u_texelSize.value.set(1.0 / finerTarget.width, 1.0 / finerTarget.height);
            pullShaderMaterialDebug.uniforms.tFinerDepth.value = sceneRenderTarget.depthTexture;
            pullShaderMaterialDebug.uniforms.tLayerMask.value = layerMaskTarget.texture; // ADDED
            pullShaderMaterialDebug.uniforms.u_maskChannel.value = 0; // ADDED
            renderer.setRenderTarget(coarserTarget); renderer.clear();
            renderer.setViewport(0, 0, coarserTarget.width, coarserTarget.height);
            renderer.render(postProcessScene, postProcessCamera);
        }
        if (!pullPyramidTargets[coarsestIndexDebug]?.texture) { console.error("Coarsest target texture missing after pull phase!"); return; }
        renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height); 
        renderToScreen(pullPyramidTargets[coarsestIndexDebug].texture);
        return; 
    }
    if (debugView === 'push_final') {
         if (pullPyramidTargets.length === 0 || pushPyramidTargets.length === 0 || !pullMaterial || !pushMaterial || !copyMaterial || !pingPongRenderTargetB?.texture || !finalEdgeMaskTexture || !pullMaterialDepthAware) { console.error("Missing resources for PullPush final debug view prep!"); return; }
        if (!maskGeneratorMaterial) {console.error("maskGeneratorMaterial missing!"); return;}
        postProcessQuad.material = maskGeneratorMaterial;
        maskGeneratorMaterial.uniforms.u_maskUsesAlpha.value = maskUsesAlpha;
        maskGeneratorMaterial.uniforms.tLayerMask.value = layerMaskTarget.texture;
        maskGeneratorMaterial.uniforms.u_maskChannel.value = 0; // Default to FG
        maskGeneratorMaterial.uniforms.tDiffuse.value = maskUsesAlpha ? pingPongRenderTargetB.texture : sceneRenderTarget.texture;
        maskGeneratorMaterial.uniforms.tEdgeMask.value = maskUsesAlpha ? null : finalEdgeMaskTexture;
        renderer.setRenderTarget(pullPyramidTargets[0]); renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);
        let pullShaderMaterialDebug = pullMaterialDepthAware;
        postProcessQuad.material = pullShaderMaterialDebug;
        const numLevelsToUseDebug = Math.min(pullPyramidTargets.length, maxPyramidLevels);
        const coarsestIndexDebug = numLevelsToUseDebug - 1;
        for (let i = 1; i <= coarsestIndexDebug; i++) { 
            const finerTarget = pullPyramidTargets[i-1]; const coarserTarget = pullPyramidTargets[i];
            if (!finerTarget?.texture || !coarserTarget) break;
            pullShaderMaterialDebug.uniforms.tFinerLevel.value = finerTarget.texture;
            pullShaderMaterialDebug.uniforms.u_texelSize.value.set(1.0 / finerTarget.width, 1.0 / finerTarget.height);
            pullShaderMaterialDebug.uniforms.tFinerDepth.value = sceneRenderTarget.depthTexture;
            pullShaderMaterialDebug.uniforms.tLayerMask.value = layerMaskTarget.texture; // ADDED
            pullShaderMaterialDebug.uniforms.u_maskChannel.value = 0; // ADDED
            renderer.setRenderTarget(coarserTarget); renderer.clear();
            renderer.setViewport(0, 0, coarserTarget.width, coarserTarget.height);
            renderer.render(postProcessScene, postProcessCamera);
        }
        if (!pullPyramidTargets[coarsestIndexDebug]?.texture || !pushPyramidTargets[coarsestIndexDebug]) { console.error("Coarsest targets missing!"); return;}
        postProcessQuad.material = copyMaterial; copyMaterial.uniforms.tDiffuse.value = pullPyramidTargets[coarsestIndexDebug].texture;
        renderer.setRenderTarget(pushPyramidTargets[coarsestIndexDebug]); renderer.setViewport(0, 0, pushPyramidTargets[coarsestIndexDebug].width, pushPyramidTargets[coarsestIndexDebug].height);
        renderer.render(postProcessScene, postProcessCamera);
        postProcessQuad.material = pushMaterial;
        for (let i = coarsestIndexDebug - 1; i >= 0; i--) { 
             const coarserSourceTarget = pushPyramidTargets[i+1]; const currentLevelSourceTarget = pullPyramidTargets[i]; const finerDestinationTarget = pushPyramidTargets[i];
             if (!coarserSourceTarget?.texture || !currentLevelSourceTarget?.texture || !finerDestinationTarget) break;
             pushMaterial.uniforms.tCoarserLevel.value = coarserSourceTarget.texture;
             pushMaterial.uniforms.tCurrentLevel.value = currentLevelSourceTarget.texture;
             renderer.setRenderTarget(finerDestinationTarget); renderer.clear();
             renderer.setViewport(0, 0, finerDestinationTarget.width, finerDestinationTarget.height);
             renderer.render(postProcessScene, postProcessCamera);
        }
        if (!pushPyramidTargets[0]?.texture) { console.error("Final push target texture missing after push phase!"); return; }
        renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height); 
        renderToScreen(pushPyramidTargets[0].texture);
        return; 
    }
    // ... (FG/BG layer debug logic is unchanged) ...
    if (debugView === 'fg_inpainted' || debugView === 'bg_inpainted' || debugView === 'fg_layer' || debugView === 'bg_layer') {
        // This block now *only* runs if we are in one of these debug views
        // AND the inpainting method is 'pullpush'.
        if (currentInpaintingMethod !== 'pullpush') {
            console.warn("FG/BG debug views only available for PullPush method.");
            renderToScreen(pingPongRenderTargetB.texture); // Show gapped render as fallback
            return;
        }
        // Run pull-push for both layers to populate targets
        if (!splitMaterial) splitMaterial = createSplitMaterial();
        if (pullPyramidTargets.length === 0 || pushPyramidTargets.length === 0 || !pullMaterial || !pushMaterial || !copyMaterial || !pingPongRenderTargetB?.texture || !finalEdgeMaskTexture || !pullMaterialDepthAware || !layerMaskTarget?.texture || !fgInpaintedTarget || !bgInpaintedTarget || !finalCompositeMaterial || !finalInpaintedTextureTarget) {
            console.warn("PullPush pyramids or materials not initialized, skipping inpainting.");
            renderToScreen(pingPongRenderTargetB.texture); return;
        }
        let pullShaderMaterial = pullMaterialDepthAware; 
        const runPullPushPass = (maskChannel) => {
            const totalAvailableLevels = pullPyramidTargets.length;
            const numLevelsToUse = Math.min(totalAvailableLevels, maxPyramidLevels); 
            if (numLevelsToUse <= 0) { console.error("No pyramid levels to use!"); return; }
            const coarsestIndexToUse = numLevelsToUse - 1; 
            if (!maskGeneratorMaterial) {console.error("maskGeneratorMaterial missing!"); return;}
            postProcessQuad.material = maskGeneratorMaterial;
            maskGeneratorMaterial.uniforms.u_maskUsesAlpha.value = maskUsesAlpha;
            maskGeneratorMaterial.uniforms.tLayerMask.value = layerMaskTarget.texture;
            maskGeneratorMaterial.uniforms.u_maskChannel.value = maskChannel;
            maskGeneratorMaterial.uniforms.tDiffuse.value = maskUsesAlpha ? pingPongRenderTargetB.texture : sceneRenderTarget.texture;
            maskGeneratorMaterial.uniforms.tEdgeMask.value = maskUsesAlpha ? null : finalEdgeMaskTexture;
            renderer.setRenderTarget(pullPyramidTargets[0]); renderer.clear(); 
            renderer.render(postProcessScene, postProcessCamera);
            postProcessQuad.material = pullShaderMaterial;
            for (let i = 1; i <= coarsestIndexToUse; i++) {
                const finerTarget = pullPyramidTargets[i-1]; const coarserTarget = pullPyramidTargets[i];
                if (!finerTarget?.texture || !coarserTarget) { console.error(`Missing target in pull phase at index ${i}`); break; }
                pullShaderMaterial.uniforms.tLayerMask.value = layerMaskTarget.texture;
                pullShaderMaterial.uniforms.u_maskChannel.value = maskChannel;
                pullShaderMaterial.uniforms.tFinerLevel.value = finerTarget.texture;
                pullShaderMaterial.uniforms.u_texelSize.value.set(1.0 / finerTarget.width, 1.0 / finerTarget.height);
                pullShaderMaterial.uniforms.tFinerDepth.value = sceneRenderTarget.depthTexture;
                renderer.setRenderTarget(coarserTarget); renderer.clear();
                renderer.setViewport(0, 0, coarserTarget.width, coarserTarget.height);
                renderer.render(postProcessScene, postProcessCamera);
            }
            if (!pullPyramidTargets[coarsestIndexToUse]?.texture || !pushPyramidTargets[coarsestIndexToUse]) { console.error("Missing coarsest targets!"); return; }
            postProcessQuad.material = copyMaterial;
            copyMaterial.uniforms.tDiffuse.value = pullPyramidTargets[coarsestIndexToUse].texture;
            renderer.setRenderTarget(pushPyramidTargets[coarsestIndexToUse]);
            renderer.setViewport(0, 0, pushPyramidTargets[coarsestIndexToUse].width, pushPyramidTargets[coarsestIndexToUse].height);
            renderer.render(postProcessScene, postProcessCamera);
            postProcessQuad.material = pushMaterial;
            for (let i = coarsestIndexToUse - 1; i >= 0; i--) {
                const coarserSourceTarget = pushPyramidTargets[i+1]; const currentLevelSourceTarget = pullPyramidTargets[i]; const finerDestinationTarget = pushPyramidTargets[i];
                if (!coarserSourceTarget?.texture || !currentLevelSourceTarget?.texture || !finerDestinationTarget) { console.error(`Missing target in push phase at index ${i}`); break; }
                pushMaterial.uniforms.tCoarserLevel.value = coarserSourceTarget.texture;
                pushMaterial.uniforms.tCurrentLevel.value = currentLevelSourceTarget.texture;
                renderer.setRenderTarget(finerDestinationTarget); renderer.clear();
                renderer.setViewport(0, 0, finerDestinationTarget.width, finerDestinationTarget.height);
                renderer.render(postProcessScene, postProcessCamera);
            }
        };
        // Run pass 1 (BG)
        runPullPushPass(1); 
        postProcessQuad.material = copyMaterial;
        copyMaterial.uniforms.tDiffuse.value = pushPyramidTargets[0].texture;
        renderer.setRenderTarget(bgInpaintedTarget); renderer.clear();
        renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
        renderer.render(postProcessScene, postProcessCamera);
        // Run pass 2 (FG)
        runPullPushPass(0);
        postProcessQuad.material = copyMaterial;
        copyMaterial.uniforms.tDiffuse.value = pushPyramidTargets[0].texture;
        renderer.setRenderTarget(fgInpaintedTarget); renderer.clear();
        renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
        renderer.render(postProcessScene, postProcessCamera);
        
        // Now render the correct debug view
        if (debugView === 'fg_inpainted') {
            renderToScreen(fgInpaintedTarget.texture); return;
        } else if (debugView === 'bg_inpainted') {
            renderToScreen(bgInpaintedTarget.texture); return;
        } else if (debugView === 'fg_layer') {
            postProcessQuad.material = splitMaterial;
            splitMaterial.uniforms.tColor.value = sceneRenderTarget.texture;
            splitMaterial.uniforms.tLayerMask.value = layerMaskTarget.texture;
            splitMaterial.uniforms.u_showFG.value = true;
            renderer.setRenderTarget(null); renderer.clear();
            renderer.render(postProcessScene, postProcessCamera); return;
        } else if (debugView === 'bg_layer') {
            postProcessQuad.material = splitMaterial;
            splitMaterial.uniforms.tColor.value = sceneRenderTarget.texture;
            splitMaterial.uniforms.tLayerMask.value = layerMaskTarget.texture;
            splitMaterial.uniforms.u_showFG.value = false;
            renderer.setRenderTarget(null); renderer.clear();
            renderer.render(postProcessScene, postProcessCamera); return;
        }
    }
    // --- DEPRECATED: Fidelity debug views are removed ---
    
    // --- PASS: Inpainting (Main Logic) ---
    // If inpainting is disabled, we skip this section unless we are in Live Sweep mode (for feedback visualization).
    if (!useInpainting && !(isAccumulatingGaps && !isSweeping)) {
        // Inpainting is off and we are not sweeping. Use the gapped render target.
         if (!copyMaterial || !pingPongRenderTargetB?.texture || !finalInpaintedTextureTarget) {
            console.error("Missing resources for default view!");
            renderer.setRenderTarget(null); renderer.clear();
            return;
         }
        renderer.setRenderTarget(finalInpaintedTextureTarget); renderer.clear();
        postProcessQuad.material = copyMaterial;
        copyMaterial.uniforms.tDiffuse.value = pingPongRenderTargetB.texture;
        renderer.render(postProcessScene, postProcessCamera);
    } else {
        // Inpainting is ON or we are in Live Sweep mode.
        // NOTE: If we are in Live Sweep mode, the inpainting visualization helps show what the *current* view's gaps look like.
        switch(currentInpaintingMethod) {
            case 'jfa':
                // ... (JFA main logic is unchanged) ...
                if (!jfaSeedMaterial || !jfaFloodMaterial || !jfaResolveMaterial || !jfaPingTarget || !jfaPongTarget || !finalEdgeMaskTexture || !sceneRenderTarget?.depthTexture || !sceneRenderTarget?.texture || !copyMaterial || !pingPongRenderTargetB?.texture || !finalInpaintedTextureTarget) {
                     console.error("Missing resources for JFA inpainting!");
                     renderer.setRenderTarget(null); renderer.clear(); if(copyMaterial && pingPongRenderTargetB?.texture) { postProcessQuad.material = copyMaterial; copyMaterial.uniforms.tDiffuse.value = pingPongRenderTargetB.texture; renderer.render(postProcessScene, postProcessCamera);}
                     return;
                }
                const jfaEdgeMaskTexture = finalEdgeMaskTexture;
                jfaSeedMaterial.uniforms.tEdgeMask.value = jfaEdgeMaskTexture; 
                jfaSeedMaterial.uniforms.u_maskUsesAlpha.value = maskUsesAlpha;
                jfaResolveMaterial.uniforms.tEdgeMask.value = jfaEdgeMaskTexture; 
                jfaResolveMaterial.uniforms.u_maskUsesAlpha.value = maskUsesAlpha;
                const toleranceSliderJFA = document.getElementById('linearDepthToleranceSlider');
                const toleranceValueJFA = toleranceSliderJFA ? parseFloat(toleranceSliderJFA.value) : 0.03;
                if (jfaResolveMaterial.uniforms.u_linearDepthTolerance) jfaResolveMaterial.uniforms.u_linearDepthTolerance.value = toleranceValueJFA;
                postProcessQuad.material = jfaSeedMaterial; jfaSeedMaterial.uniforms.tDepth.value = sceneRenderTarget.depthTexture; jfaSeedMaterial.uniforms.u_seedDensity.value = jfaSeedDensity;
                 renderer.setRenderTarget(jfaPingTarget); renderer.clear(); renderer.render(postProcessScene, postProcessCamera);
                postProcessQuad.material = jfaFloodMaterial; let readTarget = jfaPingTarget, writeTarget = jfaPongTarget; const numPasses = Math.ceil(Math.log2(Math.max(renderer.domElement.width, renderer.domElement.height)));
                for (let i = 0; i < numPasses; i++) { const step = Math.pow(2, numPasses - 1 - i); jfaFloodMaterial.uniforms.u_step.value = step; jfaFloodMaterial.uniforms.tJFA.value = readTarget.texture; renderer.setRenderTarget(writeTarget); renderer.clear(); renderer.render(postProcessScene, postProcessCamera); [readTarget, writeTarget] = [writeTarget, readTarget]; } let finalJfaTexture = readTarget.texture;
                renderer.setRenderTarget(finalInpaintedTextureTarget); renderer.clear();
                postProcessQuad.material = copyMaterial; copyMaterial.uniforms.tDiffuse.value = pingPongRenderTargetB.texture;
                renderer.render(postProcessScene, postProcessCamera);
                postProcessQuad.material = jfaResolveMaterial;
                jfaResolveMaterial.uniforms.tOriginalDepth.value = sceneRenderTarget.depthTexture; 
                jfaResolveMaterial.uniforms.tDiffuse.value = sceneRenderTarget.texture; 
                jfaResolveMaterial.uniforms.tJFA.value = finalJfaTexture;
                 renderer.autoClear = false;
                 renderer.render(postProcessScene, postProcessCamera);
                 renderer.autoClear = true;
                break;

            case 'pullpush':
                // ... (PullPush main logic is unchanged) ...
                if (!splitMaterial) splitMaterial = createSplitMaterial();
                if (pullPyramidTargets.length === 0 || pushPyramidTargets.length === 0 || !pullMaterial || !pushMaterial || !copyMaterial || !pingPongRenderTargetB?.texture || !finalEdgeMaskTexture || !pullMaterialDepthAware || !layerMaskTarget?.texture || !fgInpaintedTarget || !bgInpaintedTarget || !finalCompositeMaterial || !finalInpaintedTextureTarget) {
                    console.warn("PullPush pyramids or materials not initialized, skipping inpainting.");
                    renderer.setRenderTarget(null); renderer.clear(); if(copyMaterial && pingPongRenderTargetB?.texture) { postProcessQuad.material = copyMaterial; copyMaterial.uniforms.tDiffuse.value = pingPongRenderTargetB.texture; renderer.render(postProcessScene, postProcessCamera);}
                    return;
                }
                let pullShaderMaterial = pullMaterialDepthAware; 
                const runPullPushPass = (maskChannel) => {
                    const totalAvailableLevels = pullPyramidTargets.length;
                    const numLevelsToUse = Math.min(totalAvailableLevels, maxPyramidLevels); 
                    if (numLevelsToUse <= 0) { console.error("No pyramid levels to use!"); return; }
                    const coarsestIndexToUse = numLevelsToUse - 1; 
                    if (!maskGeneratorMaterial) {console.error("maskGeneratorMaterial missing!"); return;}
                    postProcessQuad.material = maskGeneratorMaterial;
                    maskGeneratorMaterial.uniforms.u_maskUsesAlpha.value = maskUsesAlpha;
                    maskGeneratorMaterial.uniforms.tLayerMask.value = layerMaskTarget.texture;
                    maskGeneratorMaterial.uniforms.u_maskChannel.value = maskChannel;
                    maskGeneratorMaterial.uniforms.tDiffuse.value = maskUsesAlpha ? pingPongRenderTargetB.texture : sceneRenderTarget.texture;
                    maskGeneratorMaterial.uniforms.tEdgeMask.value = maskUsesAlpha ? null : finalEdgeMaskTexture;
                    renderer.setRenderTarget(pullPyramidTargets[0]); renderer.clear(); 
                    renderer.render(postProcessScene, postProcessCamera);
                    postProcessQuad.material = pullShaderMaterial;
                    for (let i = 1; i <= coarsestIndexToUse; i++) {
                        const finerTarget = pullPyramidTargets[i-1]; const coarserTarget = pullPyramidTargets[i];
                        if (!finerTarget?.texture || !coarserTarget) { console.error(`Missing target in pull phase at index ${i}`); break; }
                        pullShaderMaterial.uniforms.tLayerMask.value = layerMaskTarget.texture;
                        pullShaderMaterial.uniforms.u_maskChannel.value = maskChannel;
                        pullShaderMaterial.uniforms.tFinerLevel.value = finerTarget.texture;
                        pullShaderMaterial.uniforms.u_texelSize.value.set(1.0 / finerTarget.width, 1.0 / finerTarget.height);
                        pullShaderMaterial.uniforms.tFinerDepth.value = sceneRenderTarget.depthTexture;
                        renderer.setRenderTarget(coarserTarget); renderer.clear();
                        renderer.setViewport(0, 0, coarserTarget.width, coarserTarget.height);
                        renderer.render(postProcessScene, postProcessCamera);
                    }
                    if (!pullPyramidTargets[coarsestIndexToUse]?.texture || !pushPyramidTargets[coarsestIndexToUse]) { console.error("Missing coarsest targets!"); return; }
                    postProcessQuad.material = copyMaterial;
                    copyMaterial.uniforms.tDiffuse.value = pullPyramidTargets[coarsestIndexToUse].texture;
                    renderer.setRenderTarget(pushPyramidTargets[coarsestIndexToUse]);
                    renderer.setViewport(0, 0, pushPyramidTargets[coarsestIndexToUse].width, pushPyramidTargets[coarsestIndexToUse].height);
                    renderer.render(postProcessScene, postProcessCamera);
                    postProcessQuad.material = pushMaterial;
                    for (let i = coarsestIndexToUse - 1; i >= 0; i--) {
                        const coarserSourceTarget = pushPyramidTargets[i+1]; const currentLevelSourceTarget = pullPyramidTargets[i]; const finerDestinationTarget = pushPyramidTargets[i];
                        if (!coarserSourceTarget?.texture || !currentLevelSourceTarget?.texture || !finerDestinationTarget) { console.error(`Missing target in push phase at index ${i}`); break; }
                        pushMaterial.uniforms.tCoarserLevel.value = coarserSourceTarget.texture;
                        pushMaterial.uniforms.tCurrentLevel.value = currentLevelSourceTarget.texture;
                        renderer.setRenderTarget(finerDestinationTarget); renderer.clear();
                        renderer.setViewport(0, 0, finerDestinationTarget.width, finerDestinationTarget.height);
                        renderer.render(postProcessScene, postProcessCamera);
                    }
                };
                // --- PASS 1: BACKGROUND (Channel 1) ---
                runPullPushPass(1); 
                postProcessQuad.material = copyMaterial;
                copyMaterial.uniforms.tDiffuse.value = pushPyramidTargets[0].texture;
                renderer.setRenderTarget(bgInpaintedTarget); renderer.clear();
                renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
                renderer.render(postProcessScene, postProcessCamera);
                // --- PASS 2: FOREGROUND (Channel 0) ---
                runPullPushPass(0);
                postProcessQuad.material = copyMaterial;
                copyMaterial.uniforms.tDiffuse.value = pushPyramidTargets[0].texture;
                renderer.setRenderTarget(fgInpaintedTarget); renderer.clear();
                renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
                renderer.render(postProcessScene, postProcessCamera);
                // --- 5. Composite FG over BG ---
                postProcessQuad.material = finalCompositeMaterial;
                finalCompositeMaterial.uniforms.tFG.value = fgInpaintedTarget.texture;
                finalCompositeMaterial.uniforms.tBG.value = bgInpaintedTarget.texture;
                finalCompositeMaterial.uniforms.tLayerMask.value = layerMaskTarget.texture;
                finalCompositeMaterial.uniforms.tOriginal.value = sceneRenderTarget.texture;
                renderer.setRenderTarget(finalInpaintedTextureTarget); renderer.clear();
                renderer.render(postProcessScene, postProcessCamera);
                break;

            case 'dilation':
                // ... (Dilation main logic is unchanged) ...
                if (!dilationMaterial || !sceneRenderTarget?.depthTexture || !pingPongRenderTargetB?.texture || !pingPongRenderTargetA || !copyMaterial || !finalInpaintedTextureTarget) {
                     console.error("Missing resources for dilation!");
                     renderer.setRenderTarget(null); renderer.clear(); if(copyMaterial && pingPongRenderTargetB?.texture) { postProcessQuad.material = copyMaterial; copyMaterial.uniforms.tDiffuse.value = pingPongRenderTargetB.texture; renderer.render(postProcessScene, postProcessCamera);}
                     return;
                 }
                let dilateRead = pingPongRenderTargetB; let dilateWrite = pingPongRenderTargetA;
                for (let i = 0; i < dilationIterations; i++) {
                    postProcessQuad.material = dilationMaterial;
                    dilationMaterial.uniforms.tDiffuse.value = dilateRead.texture;
                    dilationMaterial.uniforms.tOriginalDepth.value = sceneRenderTarget.depthTexture;
                    renderer.setRenderTarget(dilateWrite); renderer.clear();
                    renderer.render(postProcessScene, postProcessCamera);
                    [dilateRead, dilateWrite] = [dilateWrite, dilateRead];
                }
                renderer.setRenderTarget(finalInpaintedTextureTarget); renderer.clear();
                postProcessQuad.material = copyMaterial;
                copyMaterial.uniforms.tDiffuse.value = dilateRead.texture;
                renderer.render(postProcessScene, postProcessCamera);
                break;

            case 'cutoff': // Falls through
            case 'displacement': // Falls through
            default:
                // Default: Show the gapped image
                if (!copyMaterial || !pingPongRenderTargetB?.texture || !finalInpaintedTextureTarget) {
                    console.error("Missing resources for default/displacement view!");
                    renderer.setRenderTarget(null); renderer.clear();
                    return;
                 }
                renderer.setRenderTarget(finalInpaintedTextureTarget); renderer.clear();
                postProcessQuad.material = copyMaterial;
                copyMaterial.uniforms.tDiffuse.value = pingPongRenderTargetB.texture;
                renderer.render(postProcessScene, postProcessCamera);
                break;
        }
    }
    
    // --- FINAL POST-PROCESSING (AA -> Sharpen -> Dither) ---
    
    if (!finalInpaintedTextureTarget?.texture || !finalEdgeMaskTexture || 
        !ditherCompositeMaterial || !copyMaterial || !fxaaMaterial || 
        !finalRenderPassTarget || !sharpenMaterial || !sharpenTarget) {
            
        console.error("Missing resources for final render passes (AA/Sharpen/Dither)!");
        renderToScreen(sceneRenderTarget.texture); // Fallback to clean scene
        return;
    }

    let sourceForSharpenPass;
    if (useAntiAliasing) {
        // --- PASS 1: Apply FXAA ---
        renderer.setRenderTarget(finalRenderPassTarget);
        renderer.clear();
        renderer.setViewport(0, 0, finalRenderPassTarget.width, finalRenderPassTarget.height);
        postProcessQuad.material = fxaaMaterial;
        fxaaMaterial.uniforms.tDiffuse.value = finalInpaintedTextureTarget.texture;
        renderer.render(postProcessScene, postProcessCamera);
        sourceForSharpenPass = finalRenderPassTarget.texture;
    } else {
        sourceForSharpenPass = finalInpaintedTextureTarget.texture;
    }

    // --- PASS 2: Apply Sharpening ---
    renderer.setRenderTarget(sharpenTarget);
    renderer.clear();
    renderer.setViewport(0, 0, sharpenTarget.width, sharpenTarget.height);
    postProcessQuad.material = sharpenMaterial;
    sharpenMaterial.uniforms.tDiffuse.value = sourceForSharpenPass;
    renderer.render(postProcessScene, postProcessCamera);


    // --- PASS 3: Apply Dither and Render to Screen ---
    // The renderToScreen function now handles the dither logic *and*
    // the feedback overlay logic.
    
    // We need to select the correct texture to dither
    let textureForDither;
    if (ditherStrength > 0.01) {
        // Use selective dither material
        postProcessQuad.material = ditherCompositeMaterial;
        ditherCompositeMaterial.uniforms.tDiffuse.value = sharpenTarget.texture; // Read from Sharpen pass
        ditherCompositeMaterial.uniforms.tMask.value = finalEdgeMaskTexture;
        ditherCompositeMaterial.uniforms.u_maskUsesAlpha.value = maskUsesAlpha;
        ditherCompositeMaterial.uniforms.u_strength.value = ditherStrength;
        ditherCompositeMaterial.uniforms.u_resolution.value.set(renderer.domElement.width, renderer.domElement.height);
        
        // Render this to a temp target so renderToScreen gets one texture
        renderer.setRenderTarget(finalRenderPassTarget); // Re-use this
        renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);
        textureForDither = finalRenderPassTarget.texture;

    } else {
        // Dither is off, just use the sharpened result
        textureForDither = sharpenTarget.texture;
    }

    renderToScreen(textureForDither);
    
}
// ===================================================================
// END: REPLACEMENT render()
// ===================================================================


// -----------------------------------------------------------------------------
// --- UI CONTROLS CREATION & EVENT HANDLING -----------------------------------
// -----------------------------------------------------------------------------
function setupGyroUIControls(parentElement) {
    const gyroContainer = document.createElement('div');
    gyroContainer.style.marginTop = '15px';
    gyroContainer.style.paddingTop = '10px';
    gyroContainer.style.borderTop = '1px solid #ddd';

    gyroEnableButton = document.createElement('button');
    gyroEnableButton.id = 'enableGyroButton';
    gyroEnableButton.textContent = 'Enable Gyro';
    gyroEnableButton.title = 'Enable or disable gyroscope-based camera control (primarily for iOS).';
    gyroEnableButton.style.marginBottom = '10px';
    gyroEnableButton.addEventListener('click', toggleGyroActivation);
    gyroContainer.appendChild(gyroEnableButton);

    calibrateGyroButton = document.createElement('button');
    calibrateGyroButton.id = 'calibrateGyroButton';
    calibrateGyroButton.textContent = 'Calibrate Gyro';
    calibrateGyroButton.title = 'Set the current device orientation as the neutral view.';
    calibrateGyroButton.style.marginBottom = '10px';
    calibrateGyroButton.disabled = true;
    calibrateGyroButton.addEventListener('click', calibrateGyro);
    gyroContainer.appendChild(calibrateGyroButton);

    const sensXContainer = document.createElement('div');
    sensXContainer.className = 'slider-container';
    const sensXLabel = document.createElement('label');
    sensXLabel.htmlFor = 'gyroSensitivityXSlider'; sensXLabel.textContent = 'Gyro Sens. X:';
    gyroSensitivityXSlider = document.createElement('input');
    gyroSensitivityXSlider.type = 'range'; gyroSensitivityXSlider.id = 'gyroSensitivityXSlider';
    gyroSensitivityXSlider.min = '0.0001'; gyroSensitivityXSlider.max = '0.005'; gyroSensitivityXSlider.step = '0.0001';
    gyroSensitivityXSlider.value = gyroSensitivityX.toString(); gyroSensitivityXSlider.disabled = true;
    const sensXValueDisplay = document.createElement('span');
    sensXValueDisplay.id = 'gyroSensitivityXValue'; sensXValueDisplay.textContent = gyroSensitivityX.toFixed(4);
    gyroSensitivityXSlider.addEventListener('input', function() {
        gyroSensitivityX = parseFloat(this.value);
        sensXValueDisplay.textContent = gyroSensitivityX.toFixed(4);
    });
    sensXContainer.appendChild(sensXLabel); sensXContainer.appendChild(gyroSensitivityXSlider); sensXContainer.appendChild(sensXValueDisplay);
    gyroContainer.appendChild(sensXContainer);

    const sensYContainer = document.createElement('div');
    sensYContainer.className = 'slider-container';
    const sensYLabel = document.createElement('label');
    sensYLabel.htmlFor = 'gyroSensitivityYSlider'; sensYLabel.textContent = 'Gyro Sens. Y:';
    gyroSensitivityYSlider = document.createElement('input');
    gyroSensitivityYSlider.type = 'range'; gyroSensitivityYSlider.id = 'gyroSensitivityYSlider';
    gyroSensitivityYSlider.min = '-0.005';
    gyroSensitivityYSlider.max = '0.005';
    gyroSensitivityYSlider.step = '0.0001';
    gyroSensitivityYSlider.value = gyroSensitivityY.toString(); gyroSensitivityYSlider.disabled = true;
    const sensYValueDisplay = document.createElement('span');
    sensYValueDisplay.id = 'gyroSensitivityYValue'; sensYValueDisplay.textContent = gyroSensitivityY.toFixed(4);
    gyroSensitivityYSlider.addEventListener('input', function() {
        gyroSensitivityY = parseFloat(this.value);
        sensYValueDisplay.textContent = gyroSensitivityY.toFixed(4);
    });
    sensYContainer.appendChild(sensYLabel); sensYContainer.appendChild(gyroSensitivityYSlider); sensYContainer.appendChild(sensYValueDisplay);
    gyroContainer.appendChild(sensYContainer);

    const gyroDebugInfo = document.createElement('div');
    gyroDebugInfo.id = 'gyroDebugInfo';
    gyroDebugInfo.style.fontSize = '0.8em'; gyroDebugInfo.style.marginTop = '5px';
    gyroDebugInfo.style.padding = '5px';
    gyroDebugInfo.style.backgroundColor = '#f0f0f0';
    gyroDebugInfo.style.border = '1px solid #ccc';
    gyroDebugInfo.style.borderRadius = '3px';
    gyroDebugInfo.textContent = 'Gyro: Inactive';
    gyroContainer.appendChild(gyroDebugInfo);

    parentElement.appendChild(gyroContainer);
}

function setupDynamicControls() {
    // Find the new parent container
    const parentElement = document.getElementById('viewerControls');
    if (!parentElement) {
        console.error("viewerControls div is not initialized in setupDynamicControls.");
        return;
    }
    setupGyroUIControls(parentElement);
}

function setupStaticControlListeners() {
    // --- Layer Modal Buttons ---
    document.getElementById('loadLayersButton')?.addEventListener('click', openLayerModal);
    document.getElementById('closeLayerModalButton')?.addEventListener('click', closeLayerModal);
    document.getElementById('addNewLayerButton')?.addEventListener('click', addNewLayerToModal);

    // --- Apply Layers Button Listener ---
    const applyBtn = document.getElementById('applyLayersButton');
    if (applyBtn) {
        applyBtn.addEventListener('click', async () => {
            if (isApplyingLayers) return;
            isApplyingLayers = true;
            applyBtn.disabled = true;
            applyBtn.textContent = 'Applying...';
            try {
                await applyLayersFromModal();
            } catch (err) {
                console.error("Error captured from applyLayersFromModal execution:", err);
                alert("An error occurred while applying layers. Check console.");
            } finally {
                // Reset button state regardless of modal state
                isApplyingLayers = false;
                applyBtn.disabled = false;
                applyBtn.textContent = 'Apply Layers';
            }
        });
    }

    // --- Inpainting / Edge Controls ---
    const inpaintingMethodSelect = document.getElementById('inpaintingMethodSelect');
    const debugViewSelect = document.getElementById('debugViewSelect');

    // This function is no longer needed as the Fidelity options are removed from HTML
    function updateDebugViewOptions() {}

    if (inpaintingMethodSelect) {
        const jfaControls = document.getElementById('jfaControls');
        const jfaSpecificControls = document.getElementById('jfaSpecificControls');
        const pullPushSpecificControls = document.getElementById('pullPushSpecificControls');
        const dilationControls = document.getElementById('dilationControls');
        const cutoffControls = document.getElementById('cutoffControls'); // Added this
        const depthToleranceLabel = jfaControls ? jfaControls.querySelector('label[for="linearDepthToleranceSlider"]') : null;

        const updateInpaintingControls = () => {
            currentInpaintingMethod = inpaintingMethodSelect.value;
            const showParentDiv = (currentInpaintingMethod === 'jfa' || currentInpaintingMethod === 'pullpush');
            if (jfaControls) jfaControls.style.display = showParentDiv ? 'block' : 'none';

            const showJfaSpecific = (currentInpaintingMethod === 'jfa');
            if (jfaSpecificControls) jfaSpecificControls.style.display = showJfaSpecific ? 'block' : 'none';

            const showPullPushSpecific = (currentInpaintingMethod === 'pullpush');
            if (pullPushSpecificControls) pullPushSpecificControls.style.display = showPullPushSpecific ? 'block' : 'none';

            if (dilationControls) dilationControls.style.display = (currentInpaintingMethod === 'dilation') ? 'block' : 'none';
            
            if (cutoffControls) cutoffControls.style.display = (currentInpaintingMethod === 'cutoff') ? 'block' : 'none'; // Added this

            if (depthToleranceLabel) {
                 if (currentInpaintingMethod === 'jfa') {
                    depthToleranceLabel.textContent = 'JFA Depth Tolerance:';
                } else if (currentInpaintingMethod === 'pullpush') {
                    depthToleranceLabel.textContent = 'P-P Depth Tolerance:';
                }
            }
            // updateDebugViewOptions(); // No longer needed
        };
        inpaintingMethodSelect.addEventListener('change', updateInpaintingControls);
        currentInpaintingMethod = inpaintingMethodSelect.value || 'pullpush';
        updateInpaintingControls();
    }
    
    // DEPRECATED: Old edgeMethodSelect logic is removed

    // --- Sliders ---
    // All sliders that still exist are wired up here
    const sliderConfigs = {
        // Scene & Depth
        'innerDepthSlider': { update: (v) => innerVolumeDepth = v, precision: 3 },
        'outerDepthSlider': { update: (v) => outerVolumeDepth = v, precision: 3 },
        'portalPlaneZSlider': { update: (v) => portalPlaneWorldZ = v, precision: 3 },
        'subjectFocalZSlider': { update: (v) => { subjectFocalPlaneWorldZ = v; initializeSubjectLockConstant(); }, precision: 3 },
        'depthMidpointSlider': { update: (v) => currentNormPortalPlane = v, precision: 2, valId: 'depthMidpointValue' },
        'depthPeekValueSlider': { update: (v) => depthPeekValue = v, precision: 3 },
        'depthPeekToleranceSlider': { update: (v) => depthPeekTolerance = v, precision: 3 },
        // Gap Detection
        'depthGradThresholdSlider': { update: (v) => setAllLayerUniforms('u_depthGradThreshold', v), precision: 3 },
        'sobelThresholdSlider': { update: (v) => setAllLayerUniforms('u_sobelThreshold', v), precision: 2 },
        'lumaThresholdSlider': { update: (v) => setAllLayerUniforms('u_lumaThreshold', v), precision: 2 },
        'chromaThresholdSlider': { update: (v) => setAllLayerUniforms('u_chromaThreshold', v), precision: 2 },
        'creaseThresholdSlider': { update: (v) => setAllLayerUniforms('u_creaseThreshold', v), precision: 2 },
        'curvatureThresholdSlider': { update: (v) => setAllLayerUniforms('u_curvatureThreshold', v), precision: 1 },
        'uvStretchThresholdSlider': { update: (v) => setAllLayerUniforms('u_uvStretchThreshold', v), precision: 2 },
        'grazingAngleThresholdSlider': { update: (v) => setAllLayerUniforms('u_grazingAngleThreshold', v), precision: 2 },
        // Inpainting
        'inpaintingSplitDepthNormSlider': { update: (v) => currentInpaintingSplitDepthNorm = v, precision: 3 }, // Fixed precision
        'dilationIterationsSlider': { update: (v) => dilationIterations = v, precision: 0 },
        'cutoffThresholdSlider': { update: (v) => {}, precision: 3 }, // No global var, but keep listener
        'linearDepthToleranceSlider': { update: (v) => { if (jfaResolveMaterial?.uniforms?.u_linearDepthTolerance) jfaResolveMaterial.uniforms.u_linearDepthTolerance.value = v; if (pullMaterialDepthAware) pullMaterialDepthAware.uniforms.u_depthTolerance.value = v; }, precision: 3 },
        'pushBlendSlider': { update: (v) => {}, precision: 2 }, // No global var
        'maxPyramidLevelsSlider': { update: (v) => maxPyramidLevels = parseInt(v, 10), precision: 0 },
        'fillQualitySlider': { update: (v) => { if (pullMaterialDepthAware) pullMaterialDepthAware.uniforms.u_fillKernelSize.value = parseInt(v, 10); }, precision: 0 },
        'depthWeightPowerSlider': { update: (v) => { currentDepthWeightPower = v; if (pullMaterialDepthAware) pullMaterialDepthAware.uniforms.u_depthWeightPower.value = v; }, precision: 2 },
        'jfaSeedDensitySlider': { update: (v) => jfaSeedDensity = v, precision: 2 },
        'jfaSeedSizeSlider': { update: (v) => { if (jfaSeedMaterial?.uniforms?.u_seedSize) jfaSeedMaterial.uniforms.u_seedSize.value = v; }, precision: 0 },
        // Post-Processing
        'sharpenStrengthSlider': { update: (v) => { sharpenStrength = v; if (sharpenMaterial) sharpenMaterial.uniforms.u_strength.value = v; }, precision: 2 },
        'temporalFeedbackSlider': { update: (v) => { temporalFeedback = v; if (temporalStabilizeMaterial) temporalStabilizeMaterial.uniforms.u_feedback.value = v; }, precision: 2 },
        'ditherStrengthSlider': { update: (v) => ditherStrength = v, precision: 1 },
        // NEW: Gap Accumulation Sliders
        'autoSweepAngleHorizSlider': { update: (v) => {}, precision: 0 }, // No global var, just read
        'autoSweepAngleVertSlider': { update: (v) => {}, precision: 0 },  // No global var, just read
    };

    for (const id in sliderConfigs) {
        const slider = document.getElementById(id);
        const config = sliderConfigs[id];
        // Use custom value ID if provided, otherwise default to id + 'Value'
        const valueDisplay = document.getElementById(config.valId || (id + 'Value'));
        
        if (slider && valueDisplay) {
            const listener = function() {
                const rawValue = parseFloat(this.value);
                config.update(rawValue);
                valueDisplay.textContent = rawValue.toFixed(config.precision);
            };
            slider.addEventListener('input', listener);
            listener.call(slider); // Initialize
        }
    }

    // --- Gap Strategy Checkboxes (Unchanged) ---
    const gapChecks = {
        'useDepthGradCheck': 'u_useDepthGrad',
        'useSobelCheck': 'u_useSobel',
        'useLumaCheck': 'u_useLuma',
        'useChromaCheck': 'u_useChroma',
        'useCreaseCheck': 'u_useCrease',
        'useCurvatureCheck': 'u_useCurvature',
        'useUVStretchCheck': 'u_useUVStretch',
        'useGrazingAngleCheck': 'u_useGrazingAngle'
    };
    for (const [id, uniform] of Object.entries(gapChecks)) {
        const checkbox = document.getElementById(id);
        if (checkbox) {
            checkbox.addEventListener('change', (e) => setAllLayerUniforms(uniform, e.target.checked));
            setAllLayerUniforms(uniform, checkbox.checked); // Initialize
        }
    }
    
    // DEPRECATED: Fidelity Check Listeners are removed

    // --- Screen Size Controls (Unchanged) ---
    const screenSizePreset = document.getElementById('screenSizePreset');
    const screenDiagonalOverride = document.getElementById('screenDiagonalOverride');
    if (screenSizePreset && screenDiagonalOverride) {
        const syncValues = (source) => {
            if (source === 'preset') {
                const selectedValue = screenSizePreset.value;
                if (selectedValue !== 'custom') {
                    const size = parseFloat(selectedValue);
                    physicalScreenDiagonalInches = size;
                    screenDiagonalOverride.value = size.toFixed(1);
                }
            } else if (source === 'override') {
                const size = parseFloat(screenDiagonalOverride.value);
                if (!isNaN(size) && size > 0) {
                    physicalScreenDiagonalInches = size;
                    const matchingOption = Array.from(screenSizePreset.options).find(opt => parseFloat(opt.value) === size);
                    screenSizePreset.value = matchingOption ? matchingOption.value : 'custom';
                }
            }
        };
        screenSizePreset.addEventListener('change', () => syncValues('preset'));
        screenDiagonalOverride.addEventListener('input', () => syncValues('override'));
        physicalScreenDiagonalInches = parseFloat(screenDiagonalOverride.value) || 15.6;
        syncValues('override'); // Init
    }

    // --- Checkboxes ---
    const inpaintingCheckbox = document.getElementById('useInpaintingCheckbox');
    if (inpaintingCheckbox) {
        inpaintingCheckbox.addEventListener('change', function() { useInpainting = this.checked; });
        useInpainting = inpaintingCheckbox.checked; // Init
    }
    const depthPeekCheckbox = document.getElementById('depthPeekActiveChk');
    if (depthPeekCheckbox) {
        depthPeekCheckbox.addEventListener('change', function() { depthPeekActive = this.checked; });
        depthPeekActive = depthPeekCheckbox.checked; // Init
    }
    const aaCheckbox = document.getElementById('useAACheckbox');
    if (aaCheckbox) {
        aaCheckbox.addEventListener('change', function() { useAntiAliasing = this.checked; });
        useAntiAliasing = aaCheckbox.checked; // Init
    }

    // --- Buttons ---
    const setPortalZButton = document.getElementById('setPortalZFromPeek');
    if (setPortalZButton) {
        setPortalZButton.addEventListener('click', () => {
            if (!depthPeekActive) { alert("Please activate 'Depth Peek'..."); return; }
            currentNormPortalPlane = depthPeekValue;
            // Update the slider/value for Norm. Portal
            const normPortalSlider = document.getElementById('depthMidpointSlider');
            const normPortalValue = document.getElementById('depthMidpointValue');
            if (normPortalSlider && normPortalValue) {
                normPortalSlider.value = currentNormPortalPlane.toFixed(2);
                normPortalValue.textContent = currentNormPortalPlane.toFixed(2);
            }
        });
    }
    // Set Subject Focus Button (Unchanged)
    const setSubjectFocusZButton = document.getElementById('setSubjectFocusZFromPeek');
    if (setSubjectFocusZButton) {
        setSubjectFocusZButton.addEventListener('click', () => {
            if (!depthPeekActive) { alert("Please activate 'Depth Peek'..."); return; }
            let newSubjectFocusZ;
            const relativeNormDepth = depthPeekValue - currentNormPortalPlane;
            const normPortalOrOne = Math.max(currentNormPortalPlane, 0.0001);
            const oneMinusNormPortalOrOne = Math.max(1.0 - currentNormPortalPlane, 0.0001);
            if (relativeNormDepth < 0) {
                newSubjectFocusZ = portalPlaneWorldZ - (Math.abs(relativeNormDepth) / normPortalOrOne) * outerVolumeDepth;
            } else {
                newSubjectFocusZ = portalPlaneWorldZ + (relativeNormDepth / oneMinusNormPortalOrOne) * innerVolumeDepth;
            }
            subjectFocalPlaneWorldZ = newSubjectFocusZ;
            const subjectSlider = document.getElementById('subjectFocalZSlider');
            const subjectValue = document.getElementById('subjectFocalZSliderValue');
            if (subjectSlider && subjectValue) {
                subjectSlider.value = subjectFocalPlaneWorldZ.toFixed(3);
                subjectValue.textContent = subjectFocalPlaneWorldZ.toFixed(3);
            }
            initializeSubjectLockConstant();
        });
    }
    // Set Inpainting Split Button (Unchanged)
    document.getElementById('setInpaintingSplitFromPeek')?.addEventListener('click', () => {
        if (!depthPeekActive) {
            alert("Please activate 'Depth Peek' first, then drag to the desired depth.");
            return;
        }
        alert("This feature is complex to map. For now, please SHIFT+CLICK or SHIFT+DRAG on the scene to set the inpainting split point directly.");
    });


    // --- Face Tracking Scalar Controls (Unchanged) ---
    if (facetrackingScalarSlider && facetrackingScalarInput && facetrackingScalarValue) {
        const updateFacetrackingScalar = (valStr) => {
            let v = parseFloat(valStr);
            if (isNaN(v)) v = 1;
            v = Math.max(0, Math.min(50, v)); // Clamp value
            if (facetrackingScalarSlider) facetrackingScalarSlider.value = v;
            if (facetrackingScalarInput) facetrackingScalarInput.value = v;
            if (facetrackingScalarValue) facetrackingScalarValue.textContent = v.toFixed(2);
        };
        facetrackingScalarSlider.addEventListener('input', (e) => updateFacetrackingScalar(e.target.value));
        facetrackingScalarInput.addEventListener('input', (e) => updateFacetrackingScalar(e.target.value));
        facetrackingScalarInput.addEventListener('change', (e) => { updateFacetrackingScalar(e.target.value); });
        updateFacetrackingScalar(facetrackingScalarSlider.value); // Init
    }

    // DEPRECATED: Old Media Loading Buttons are removed
    
    // --- Wireframe Test Button (Now on bottom bar) ---
    const wireframeButton = document.getElementById('wireframeButton');
    if (wireframeButton) {
        wireframeButton.addEventListener('click', async function () {
            await clearCurrentVisuals();
            // ... (rest of wireframe logic is unchanged) ...
            const s = 0.01;
            const ccm = new THREE.MeshBasicMaterial({ color: 0x00ffff, wireframe: true });
            const cc = new THREE.Mesh(new THREE.BoxGeometry(s * 1.5, s * 1.5, s * 1.5), ccm);
            cc.position.set(0, 0, subjectFocalPlaneWorldZ);
            scene.add(cc);
            wireframeCubes.push(cc);
            for (let i = 0; i < 3; i++) {
                const m = new THREE.MeshBasicMaterial({ color: 0x3333ff });
                const o = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), m);
                o.position.set((Math.random() - 0.5) * (terrariumWidth * 0.8), (Math.random() - 0.5) * (terrariumHeight * 0.8), portalPlaneWorldZ + Math.random() * innerVolumeDepth * metricScaleFactor);
                scene.add(o);
                wireframeCubes.push(o);
            }
            for (let i = 0; i < 2; i++) {
                const m = new THREE.MeshBasicMaterial({ color: 0xff3333 });
                const o = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), m);
                o.position.set((Math.random() - 0.5) * (terrariumWidth * 0.8), (Math.random() - 0.5) * (terrariumHeight * 0.8), portalPlaneWorldZ - Math.random() * outerVolumeDepth * metricScaleFactor);
                scene.add(o);
                wireframeCubes.push(o);
            }
            updateVolumeGuidesVisibility(true);
            updateVolumeGuidesPositionsAndScales();
            currentSourceWidthForOptimalCalc = 0;
            currentSourceHeightForOptimalCalc = 0;
            calculateAndDisplayOptimalVertices();
            updateActualDebugInfo('-', '-', '-', '-', wireframeCubes.reduce((acc, c) => acc + (c.geometry ? c.geometry.attributes.position.count : 0), 0));
            if (!initialBaselinePending && canvasElement) setFaceTrackerBaselineOffset(canvasElement);
            if (renderer && renderer.domElement && (currentRTWidth === 0 || currentRTHeight === 0)) {
                resizeRendererAndTargets(renderer.domElement.width, renderer.domElement.height);
            }
        });
    }

    // DEPRECATED: Background Color Toggle Button is removed

    // --- Fullscreen Button (Bottom bar) ---
    // (The accordion one is gone)
    const bottomFullscreenBtnHTML = document.getElementById('fullscreenButtonBottom');
    async function handleFullscreenRequest() {
        // ... (rest of fullscreen logic is unchanged) ...
        try {
            if (!document.fullscreenElement && !document.webkitFullscreenElement) {
                let fullscreenPromise;
                if (mainContentElement.requestFullscreen) {
                    fullscreenPromise = mainContentElement.requestFullscreen();
                } else if (mainContentElement.webkitRequestFullscreen) {
                    fullscreenPromise = new Promise((resolve) => {
                        const onWebkitFullscreenChange = () => { document.removeEventListener('webkitfullscreenchange', onWebkitFullscreenChange); resolve(); };
                        document.addEventListener('webkitfullscreenchange', onWebkitFullscreenChange);
                        mainContentElement.webkitRequestFullscreen();
                    });
                } else {
                    if (screen.orientation?.lock) { await screen.orientation.lock('landscape-primary').catch(err => console.error("Orientation lock error:", err)); }
                    return;
                }
                await fullscreenPromise;
                if (screen.orientation?.lock) { await screen.orientation.lock('landscape-primary').catch(err => console.error("Orientation lock error:", err)); }
            } else {
                if (screen.orientation?.unlock) screen.orientation.unlock();
                let exitFullscreenPromise;
                if (document.exitFullscreen) {
                    exitFullscreenPromise = document.exitFullscreen();
                } else if (document.webkitExitFullscreen) {
                    exitFullscreenPromise = new Promise((resolve) => {
                        const onWebkitFullscreenExit = () => { document.removeEventListener('webkitfullscreenchange', onWebkitFullscreenExit); resolve(); };
                        document.addEventListener('webkitfullscreenchange', onWebkitFullscreenExit);
                        document.webkitExitFullscreen();
                    });
                }
                if (exitFullscreenPromise) await exitFullscreenPromise;
            }
        } catch (err) { console.error(`Fullscreen/Orientation error: ${err.name}, ${err.message}`, err); }
    }
    if (bottomFullscreenBtnHTML) bottomFullscreenBtnHTML.addEventListener('click', handleFullscreenRequest);
    
    // Fullscreen listener (Unchanged)
    if (mainContentElement) {
        const reBaselineOnFullscreenChange = () => { setTimeout(() => { if (canvasElement) setFaceTrackerBaselineOffset(canvasElement); calibrateGyro(); }, 100); };
        document.addEventListener('fullscreenchange', reBaselineOnFullscreenChange);
        document.addEventListener('webkitfullscreenchange', reBaselineOnFullscreenChange);
    }

    // --- Reset View Button (Bottom bar) ---
    document.getElementById('resetViewButton')?.addEventListener('click', () => {
        if (canvasElement) setFaceTrackerBaselineOffset(canvasElement);
        if (gyroActive && calibrateGyroButton && !calibrateGyroButton.disabled) calibrateGyro();
    });

    // --- NEW / UPDATED: Video Playback Controls (Bottom bar) ---
    document.getElementById('playPauseButton')?.addEventListener('click', toggleVideoPlaybackInternal);
    document.getElementById('loopButton')?.addEventListener('click', toggleVideoLoopInternal);
    
    const muteButton = document.getElementById('muteButton');
    const volumeSlider = document.getElementById('volumeSlider');

    if (muteButton) {
        muteButton.addEventListener('click', () => {
            const videos = getAllVideoElements();
            if (videos.length === 0) return;
            // Toggle based on the state of the first video
            const isMuted = videos[0].muted;
            videos.forEach(v => v.muted = !isMuted);
            muteButton.textContent = isMuted ? '🔊' : '🔇';
            if (volumeSlider) volumeSlider.value = isMuted ? (videos[0].volume || 1) : 0;
        });
    }

    if (volumeSlider) {
        volumeSlider.addEventListener('input', (e) => {
            const newVolume = parseFloat(e.target.value);
            const videos = getAllVideoElements();
            videos.forEach(v => {
                v.volume = newVolume;
                v.muted = newVolume === 0;
            });
            if (muteButton) muteButton.textContent = newVolume === 0 ? '🔇' : '🔊';
        });
    }

    // --- Dolly Zoom / Subject Lock Buttons (Bottom bar) ---
    let dollyZoomBtnHTML = document.getElementById('dollyZoomButton');
    let subjectLockToggleBtnHTML = document.getElementById('subjectLockToggleButton');
    if (dollyZoomBtnHTML) {
        dollyZoomBtnHTML.textContent = `Dolly Zoom: ${dollyZoomActive ? 'On' : 'Off'}`;
        dollyZoomBtnHTML.addEventListener('click', function() {
            dollyZoomActive = !dollyZoomActive;
            this.textContent = `Dolly Zoom: ${dollyZoomActive ? 'On' : 'Off'}`;
            if (dollyZoomActive) { initializeSubjectLockConstant(); } else { if (camera) { camera.fov = initialFov; camera.updateProjectionMatrix(); } }
            updateVolumeGuidesVisibility(dollyZoomActive || wireframeCubes.length > 0 || depthPeekActive);
        });
    }
    if (subjectLockToggleBtnHTML) {
        subjectLockToggleBtnHTML.textContent = `Subject Lock: ${subjectLockActive ? 'On' : 'Off'}`;
        subjectLockToggleBtnHTML.addEventListener('click', function() {
            subjectLockActive = !subjectLockActive;
            this.textContent = `Subject Lock: ${subjectLockActive ? 'On' : 'Off'}`;
            if (subjectLockActive && dollyZoomActive) { initializeSubjectLockConstant(); }
        });
    }

    // --- Set Scale Button (Unchanged logic) ---
    document.getElementById('setScaleButton')?.addEventListener('click', () => {
        setScaleModeActive = !setScaleModeActive;
        const instructionsPanel = document.getElementById('setScaleInstructions');
        const setScaleButton = document.getElementById('setScaleButton');
        if (setScaleModeActive) {
            scaleFirstPoint = null;
            scaleFirstPointScreen = null;
            if (setScaleButton) {
                setScaleButton.textContent = 'Cancel Scale';
                setScaleButton.style.backgroundColor = '#dc3545';
            }
            if (canvasElement) canvasElement.style.cursor = 'crosshair';
            if (instructionsPanel) {
                instructionsPanel.style.display = 'block';
                instructionsPanel.innerHTML = `<h4>Set Scale</h4><p>Click the <strong>first point</strong>...</p>`;
            }
        } else {
            if (setScaleButton) {
                setScaleButton.textContent = 'Set Scale';
                setScaleButton.style.backgroundColor = '';
            }
            if (canvasElement) canvasElement.style.cursor = 'default';
            if (instructionsPanel && !instructionsPanel.innerHTML.includes("<h4>Scale Set!</h4>")) {
                 instructionsPanel.style.display = 'none';
            }
        }
    });

    // --- Camera Intrinsics Inputs (Unchanged logic) ---
    const focalLengthInput = document.getElementById('focalLengthInput');
    const sensorWidthInput = document.getElementById('sensorWidthInput');
    const fovInput = document.getElementById('fovInput');
    let isCalculatingIntrinsics = false;
    function updateIntrinsics(source) {
        // ... (rest of intrinsics logic is unchanged) ...
        if (isCalculatingIntrinsics || !camera || !renderer) return;
        isCalculatingIntrinsics = true;
        const rendererSize = renderer.getSize(new THREE.Vector2());
        const aspectRatio = rendererSize.width / rendererSize.height;
        let focal = parseFloat(focalLengthInput.value);
        let sensorW = parseFloat(sensorWidthInput.value);
        let vFOV_deg = parseFloat(fovInput.value);
        try {
            if (source === 'focal' && !isNaN(focal) && focal > 0 && !isNaN(sensorW) && sensorW > 0) {
                const sensorH = sensorW / aspectRatio;
                const vFOV_rad = 2 * Math.atan(sensorH / (2 * focal));
                vFOV_deg = THREE.MathUtils.radToDeg(vFOV_rad);
                fovInput.value = vFOV_deg.toFixed(1);
            } else if (source === 'sensor' && !isNaN(sensorW) && sensorW > 0 && !isNaN(focal) && focal > 0) {
                const sensorH = sensorW / aspectRatio;
                const vFOV_rad = 2 * Math.atan(sensorH / (2 * focal));
                vFOV_deg = THREE.MathUtils.radToDeg(vFOV_rad);
                fovInput.value = vFOV_deg.toFixed(1);
            } else if (source === 'fov' && !isNaN(vFOV_deg) && vFOV_deg > 0 && !isNaN(sensorW) && sensorW > 0) {
                const sensorH = sensorW / aspectRatio;
                const vFOV_rad = THREE.MathUtils.degToRad(vFOV_deg);
                focal = sensorH / (2 * Math.tan(vFOV_rad / 2));
                focalLengthInput.value = focal.toFixed(1);
            }
            if (!isNaN(vFOV_deg) && vFOV_deg > 0 && Math.abs(camera.fov - vFOV_deg) > 0.01) {
                initialFov = vFOV_deg;
                camera.fov = vFOV_deg;
                camera.updateProjectionMatrix();
                initializeSubjectLockConstant();
                updateVolumeGuidesVisibility(true, 1500);
            }
        } catch (e) { console.error("Error in updateIntrinsics:", e); }
        finally { isCalculatingIntrinsics = false; }
    }
    if (focalLengthInput) focalLengthInput.addEventListener('input', () => updateIntrinsics('focal'));
    if (sensorWidthInput) sensorWidthInput.addEventListener('input', () => updateIntrinsics('sensor'));
    if (fovInput) fovInput.addEventListener('input', () => updateIntrinsics('fov'));
    initialFov = parseFloat(fovInput.value) || 27; // Updated default
    if (camera) { camera.fov = initialFov; camera.updateProjectionMatrix(); }

    // DEPRECATED: Advanced Controls Toggle Button is removed

    // --- Instructions Modal Button (Now on bottom bar) ---
    const showInstructionsButton = document.getElementById('showInstructionsButton');
    if (showInstructionsButton) {
        const modal = document.getElementById('workflowInstructionsModalOverlay');
        const closeButton = document.getElementById('closeWorkflowInstructionsButton');
        if (modal && closeButton) {
            showInstructionsButton.addEventListener('click', () => { modal.style.display = 'flex'; });
            closeButton.addEventListener('click', () => { modal.style.display = 'none'; });
        }
    }

    // --- Canvas Mouse Listeners (Unchanged) ---
    if (canvasElement) { 
        canvasElement.addEventListener('click', handleCanvasClick); 
        canvasElement.addEventListener('mousedown', handleCanvasMouseDown);
        canvasElement.addEventListener('mousemove', handleCanvasMouseMove);
        window.addEventListener('mouseup', handleCanvasMouseUp);
    }
    
    // --- NEW: Gap Accumulation Listeners ---
    const manualAccumulationButton = document.getElementById('manualAccumulationButton');
    const autoSweepQuickBtn = document.getElementById('autoSweepQuickButton');
    const autoSweepFullBtn = document.getElementById('autoSweepFullButton');
    
    if (manualAccumulationButton) {
        manualAccumulationButton.addEventListener('click', () => {
            if (isSweeping) return; // Prevent clicks during automated sweeps

            // --- START: Ground Truth Check ---
            // We need the normalized 8-bit depth texture for accumulation, check if available.
            const firstLayer = mediaLayers.find(l => l.mesh && l.textures.depth);
            if (!firstLayer) {
                alert("Cannot start sweep: No media layer with a depth texture found.");
                return;
            }
            // --- END: Ground Truth Check ---

            isAccumulatingGaps = !isAccumulatingGaps;
            
            if (isAccumulatingGaps) {
                // Starting manual accumulation (Live Sweep)
                useStaticInfillAtlas = false; // Disable static atlas while sweeping
                
                // CRITICAL: Clear the atlas targets (Accumulators) before starting.
                renderer.setRenderTarget(infillAtlasTarget_Color);
                renderer.clear();
                renderer.setRenderTarget(infillAtlasTarget_Depth);
                renderer.clear();

                manualAccumulationButton.textContent = 'Stop and Bake';
                manualAccumulationButton.style.backgroundColor = '#dc3545'; // Red color when active
            } else {
                // Stopping manual accumulation and baking
                manualAccumulationButton.textContent = 'Baking...';
                manualAccumulationButton.disabled = true;
                // isAccumulatingGaps is now false, but we rely on bakeInfillAtlas to finalize and reset state.
                bakeInfillAtlas(); 
            }
        });
    }
    
    if (autoSweepQuickBtn) {
        autoSweepQuickBtn.addEventListener('click', runAutomatedSweep);
    }
    if (autoSweepFullBtn) {
        autoSweepFullBtn.addEventListener('click', runContinuousSweep);
    }


    console.log("Static control listeners attached (Refactored).");
}

function get3DPointFromUV(u, v) {
    if (!depthQueryCtx || !canvasElement || !mediaLayers || !renderer) {
        console.warn("get3DPointFromUV called before components initialized.");
        return null;
    }

    const v_canvas = 1.0 - v; // Convert GL coord (0=bottom) to canvas coord (0=top)
    
    // 1. Sort visible layers from front-to-back
    const sortedLayers = mediaLayers
        .filter(layer =>
            // --- START FIX ---
            // Check layer.mesh.visible, not layer.visible
            layer.mesh?.visible &&
            // --- END FIX ---
            layer.elements?.depth // Use safe optional chaining
        )
        .sort((a, b) => b.renderOrder - a.renderOrder);

    if (sortedLayers.length === 0) {
        console.warn("get3DPointFromUV: No layers with depth to sample.");
        return null; // No depth, return null
    }

    let normDepth = 0.0; // Default to background depth

    // 2. Iterate through layers to find the first valid depth
    for (const layer of sortedLayers) {
        const currentDepthSource = layer.elements.depth;
        let sourceNativeWidth = 0;
        let sourceNativeHeight = 0;

        // 3. Get source dimensions
        if (currentDepthSource.tagName === 'VIDEO') {
            if (currentDepthSource.readyState < currentDepthSource.HAVE_METADATA) continue;
            sourceNativeWidth = currentDepthSource.videoWidth;
            sourceNativeHeight = currentDepthSource.videoHeight;
        } else if (currentDepthSource.tagName === 'IMG') {
            if (!currentDepthSource.complete || currentDepthSource.naturalWidth === 0) continue;
            sourceNativeWidth = currentDepthSource.naturalWidth;
            sourceNativeHeight = currentDepthSource.naturalHeight;
        } else {
            continue;
        }

        if (sourceNativeWidth === 0 || sourceNativeHeight === 0) continue;

        // 4. Check if UV is within this layer's aspect ratio
        // Note: This assumes the UV (u,v) is relative to the *full* 16:9 terrarium,
        // but the 'Set Scale' feature maps click->UV relative to the *canvas*
        // which is then mapped to the *source*. We must replicate that.
        // The (u, v) passed in here IS from the click, so it's already
        // relative to the full canvas. We must check letterboxing.
        
        const canvasAspect = renderer.domElement.width / renderer.domElement.height;
        const sourceAspect = sourceNativeWidth / sourceNativeHeight;
        
        let u_rendered = u;
        let v_rendered_canvas = v_canvas;
        
        if (canvasAspect > sourceAspect) { // Letterboxing
            const renderedWidthNorm = sourceAspect / canvasAspect;
            const offsetXNorm = (1.0 - renderedWidthNorm) / 2;
            if (u < offsetXNorm || u > offsetXNorm + renderedWidthNorm) {
                continue; // Click is in letterbox bars for this layer
            }
            // Remap U
            u_rendered = (u - offsetXNorm) / renderedWidthNorm;
        } else { // Pillarboxing
            const renderedHeightNorm = canvasAspect / sourceAspect;
            const offsetYNorm = (1.0 - renderedHeightNorm) / 2;
            if (v_canvas < offsetYNorm || v_canvas > offsetYNorm + renderedHeightNorm) {
                continue; // Click is in pillarbox bars for this layer
            }
            // Remap V
            v_rendered_canvas = (v_canvas - offsetYNorm) / renderedHeightNorm;
        }
        
        // 5. Sample the depth texture
        try {
            if (depthQueryCanvas.width !== sourceNativeWidth || depthQueryCanvas.height !== sourceNativeHeight) {
                depthQueryCanvas.width = sourceNativeWidth;
                depthQueryCanvas.height = sourceNativeHeight;
            }
            depthQueryCtx.drawImage(currentDepthSource, 0, 0, sourceNativeWidth, sourceNativeHeight);

            const sourcePixelX = Math.floor(u_rendered * sourceNativeWidth);
            const sourcePixelY = Math.floor(v_rendered_canvas * sourceNativeHeight);

            const clampedX = Math.max(0, Math.min(sourcePixelX, sourceNativeWidth - 1));
            const clampedY = Math.max(0, Math.min(sourcePixelY, sourceNativeHeight - 1));

            const pixelData = depthQueryCtx.getImageData(clampedX, clampedY, 1, 1).data;
            const depthValue = pixelData[0]; // 0-255

            if (depthValue > 5) {
                normDepth = depthValue / 255.0; // Found it!
                break; // Exit loop
            }
            // If 0, loop continues to next layer
        } catch (e) {
            console.error(`Error in get3DPointFromUV sampling:`, e);
            // Continue to next layer
        }
    }
    
    // 6. Calculate 3D point using the found normDepth (which is 0.0 if no layer was hit)
    let displacement = 0;
    if (normDepth < currentNormPortalPlane) {
        const t = currentNormPortalPlane < 0.00001 ? 0.0 : Math.min(1.0, normDepth / currentNormPortalPlane);
        displacement = (1.0 - t) * -outerVolumeDepth;
    } else {
        const t = (1.0 - currentNormPortalPlane) < 0.00001 ? 1.0 : Math.min(1.0, (normDepth - currentNormPortalPlane) / (1.0 - currentNormPortalPlane));
        displacement = t * innerVolumeDepth;
    }

    const point = new THREE.Vector3(
        (u - 0.5) * terrariumWidth,
        (v - 0.5) * terrariumHeight, // Use original v (0=bottom, 1=top)
        portalPlaneWorldZ + displacement
    );
    
    return point;
}
/**
 * Converts a raw hardware depth value (0-1) at a specific UV
 * to a linear distance from the camera in meters.
 * @param {number} rawHardwareDepth The non-linear depth (0-1) from readDepthPixelGPU.
 * @param {number} u The horizontal UV coordinate (0-1) of the pixel.
 * @param {number} v_gl The vertical UV coordinate (0=bottom, 1=top) of the pixel.
 * @returns {number} The distance in meters.
 */
function getMetersFromHardwareDepth(rawHardwareDepth, u, v_gl) {
    if (!camera) return 0;

    // 1. Convert UV to Clip Space
    // (u, v_gl) are 0-1, so we map them to -1 to 1
    const clipX = u * 2.0 - 1.0;
    const clipY = v_gl * 2.0 - 1.0;
    const clipZ = rawHardwareDepth * 2.0 - 1.0;
    const clipW = 1.0;

    // 2. Unproject
    const clipSpacePos = new THREE.Vector4(clipX, clipY, clipZ, clipW);
    clipSpacePos.applyMatrix4(camera.projectionMatrixInverse);

    // 3. Perspective Divide
    clipSpacePos.multiplyScalar(1.0 / clipSpacePos.w);

    // 4. Get View-Space Depth
    // viewSpacePos.z is the linear distance from the camera in "view units"
    const linearDepth_viewUnits = Math.abs(clipSpacePos.z);

    // 5. Convert to Meters
    return linearDepth_viewUnits * metricScaleFactor;
}


// --- DELETE readDepthPixelGPU (lines 6674-6791) ---

// --- ADD THIS NEW FUNCTION (around line 6674) ---
/**
 * Decodes a 32-bit float depth value (0.0-1.0) from a 4-channel
 * 8-bit RGBA color buffer (Uint8Array[4]).
 * @param {Uint8Array} buffer A 4-element array (R, G, B, A).
 * @returns {number} The reconstructed depth value.
 */
function decodeDepthFromColor(buffer) {
    if (!buffer || buffer.length < 4) return 0.0;
    
    // This is the standard THREE.js function to decode depth from RGBA
    const bitShifts = new THREE.Vector4(1.0, 1.0 / 255.0, 1.0 / (255.0 * 255.0), 1.0 / (255.0 * 255.0 * 255.0));
    const colorVec = new THREE.Vector4(buffer[0]/255.0, buffer[1]/255.0, buffer[2]/255.0, buffer[3]/255.0);
    
    return colorVec.dot(bitShifts);
}
// --- END ADD ---

function getDepthAtScreenCoord(event) {
    console.log('--- Depth Sample Start ---'); // DEBUG

    // Changed `this.layers` to `mediaLayers` and `this.renderer` to `renderer`
    if (!depthQueryCtx || !canvasElement || !mediaLayers || !renderer) {
        console.warn("Depth sampling called before components are initialized.");
        return 0.0; // Return 0.0 for background
    }

    // 1. Get Click Coordinates relative to the HTML Canvas Element
    const rect = canvasElement.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;
    const canvasWidth = rect.width;
    const canvasHeight = rect.height;

    // 2. Sort visible layers from front-to-back
    const sortedLayers = mediaLayers
        .filter(layer =>
            // --- START FIX ---
            // Check layer.mesh.visible, not layer.visible
            layer.mesh?.visible &&
            // --- END FIX ---
            layer.elements?.depth // Use safe optional chaining
        )
        .sort((a, b) => b.renderOrder - a.renderOrder);

    if (sortedLayers.length === 0) {
        console.warn("No layers with depth to sample."); // This is OK if no layers have depth maps
        return 0.0;
    }
    
    console.log(`Found ${sortedLayers.length} visible layers with depth to check.`); // DEBUG

    // 3. Iterate through layers
    for (const layer of sortedLayers) {
        console.log(`Checking Layer ${layer.id} (Render Order ${layer.renderOrder})...`); // DEBUG
        
        // We know layer.elements.depth exists because of the filter
        const currentDepthSource = layer.elements.depth;
        let sourceNativeWidth = 0;
        let sourceNativeHeight = 0;

        // 4. Get this layer's native depth source dimensions
        if (currentDepthSource.tagName === 'VIDEO') {
            if (currentDepthSource.readyState < currentDepthSource.HAVE_METADATA) {
                console.log('...Video depth source not ready. Checking next layer.'); // DEBUG
                continue; // Skip if video not ready
            }
            sourceNativeWidth = currentDepthSource.videoWidth;
            sourceNativeHeight = currentDepthSource.videoHeight;
        } else if (currentDepthSource.tagName === 'IMG') {
            if (!currentDepthSource.complete || currentDepthSource.naturalWidth === 0) {
                 console.log('...Image depth source not ready. Checking next layer.'); // DEBUG
                continue; // Skip if image not ready
            }
            sourceNativeWidth = currentDepthSource.naturalWidth;
            sourceNativeHeight = currentDepthSource.naturalHeight;
        } else {
            continue; // Not a valid source
        }

        if (sourceNativeWidth === 0 || sourceNativeHeight === 0) continue; // Skip if no dimensions

        // 5. Calculate Rendered Area Dimensions and Offset (Letter/Pillarboxing)
        const canvasAspect = canvasWidth / canvasHeight;
        const sourceAspect = sourceNativeWidth / sourceNativeHeight;

        let renderedWidth, renderedHeight, offsetX, offsetY;

        if (canvasAspect > sourceAspect) { // Letterboxing (canvas is wider)
            renderedHeight = canvasHeight;
            renderedWidth = renderedHeight * sourceAspect;
            offsetX = (canvasWidth - renderedWidth) / 2;
            offsetY = 0;
        } else { // Pillarboxing (canvas is taller or equal aspect)
            renderedWidth = canvasWidth;
            renderedHeight = renderedWidth / sourceAspect;
            offsetX = 0;
            offsetY = (canvasHeight - renderedHeight) / 2;
        }

        // 6. Check if Click is Outside this Layer's Rendered Area
        if (clickX < offsetX || clickX > offsetX + renderedWidth ||
            clickY < offsetY || clickY > offsetY + renderedHeight) {
            // Click is in the bars for *this layer*, so try the next layer
            console.log('...Click was in letterbox/pillarbox area. Checking next layer.'); // DEBUG
            continue;
        }

        // 7. Remap Click Coordinates to be Relative to the Rendered Area (0-1)
        const u_rendered = (clickX - offsetX) / renderedWidth;
        const v_rendered_canvas = (clickY - offsetY) / renderedHeight; // 0=top, 1=bottom

        try {
            // 8. Ensure query canvas matches SOURCE dimensions
            if (depthQueryCanvas.width !== sourceNativeWidth || depthQueryCanvas.height !== sourceNativeHeight) {
                depthQueryCanvas.width = sourceNativeWidth;
                depthQueryCanvas.height = sourceNativeHeight;
            }

            // 9. Draw this layer's source 1:1
            depthQueryCtx.drawImage(currentDepthSource, 0, 0, sourceNativeWidth, sourceNativeHeight);

            // 10. Calculate Pixel Coordinates using REMAPPED UVs and SOURCE dimensions
            const sourcePixelX = Math.floor(u_rendered * sourceNativeWidth);
            const sourcePixelY = Math.floor(v_rendered_canvas * sourceNativeHeight);

            const clampedX = Math.max(0, Math.min(sourcePixelX, sourceNativeWidth - 1));
            const clampedY = Math.max(0, Math.min(sourcePixelY, sourceNativeHeight - 1));

            // 11. Read pixel data
            const pixelData = depthQueryCtx.getImageData(clampedX, clampedY, 1, 1).data;
            const depthValue = pixelData[0]; // Value 0-255

            // 12. Check if this is a "hit" (non-background pixel)
            if (depthValue > 5) { // Use a small threshold
                const finalDepth = depthValue / 255.0;
                console.log(`...Hit! Sampled depth ${finalDepth} at (${clampedX}, ${clampedY}). Returning this value.`); // DEBUG
                return finalDepth; // Return normalized value
            }
            
            console.log(`...Hit! Sampled depth 0 (transparent) at (${clampedX}, ${clampedY}). Checking next layer.`); // DEBUG
            // If depthValue was 0, it was a "hole", so the
            // loop continues to check the next layer (further back).

        } catch (e) {
            console.error(`Error sampling depth for layer ${layer.id}: `, e);
            // Continue to the next layer
        }
    }

    // If no layers were hit (clicked on empty background)
    console.log('--- Depth Sample End: No layers hit. Returning 0.0 ---'); // DEBUG
    return 0.0;
}

/**
 * Helper function to update the depthPeekValue and its UI from a mouse event.
 * (This function is unchanged, but provided for completeness)
 */
function updateDepthFromMouse(event) {
    const rawDepthValue = getDepthAtScreenCoord(event); // Get 0-1 value (1=FG, 0=BG)
    if (rawDepthValue === null) return; // Happens if click is in letterbox

    // --- MODIFIED: Removed the inversion (1.0 - rawDepthValue) ---
    // Now directly uses the value where 1=FG, 0=BG.
    depthPeekValue = rawDepthValue;
    // --- END MODIFICATION ---

    const peekSlider = document.getElementById('depthPeekValueSlider');
    const peekValueDisplay = document.getElementById('depthPeekValueSliderValue');
    if (peekSlider) peekSlider.value = depthPeekValue;
    if (peekValueDisplay) peekValueDisplay.textContent = depthPeekValue.toFixed(3);
}

/**
 * Handles the click event (NO-SHIFT) to:
 * 1. Set the inpainting split point (in meters) from the raw 32-bit hardware depth.
 * 2. Trigger the 8-bit "Depth Peek" animation (Artistic).
 * 3. Configure the "Sweet Spot" settings (Artistic).
 */
// ===================================================================
// START: NEW handleCanvasClick
// (Replaces the old function)
// ===================================================================
function handleCanvasClick(event) {
    // If a drag just finished, don't run click logic.
    if (didDrag) return; 

    // SHIFT + CLICK is handled by MouseDown/MouseUp/MouseMove (isDraggingSplit)
    if (event.shiftKey) return;

    // Set Scale Logic is handled by MouseDown
    if (setScaleModeActive) return;

    if (!depthQueryCtx || !canvasElement || !renderer || !camera) {
        console.warn("handleCanvasClick: Components not ready.");
        return;
    }

    // --- This is the "Set Subject" (Job 2) logic ---
    
    // 1. Get 8-bit Image Depth for Animation & "Sweet Spot" (Artistic)
    const clickedDepthValue_8bit = getDepthAtScreenCoord(event);
    
    if (isNaN(clickedDepthValue_8bit) || clickedDepthValue_8bit < 0.01) {
        // Clicked on background or an invalid area
        console.warn("Could not read 8-bit image depth for animation. Clicked on background?");
        return;
    } 

    // 2. Run the Depth Peek Animation
    const revealDuration = 2000;
    const startTime = performance.now();
    depthPeekActive = true;
    const depthPeekChk = document.getElementById('depthPeekActiveChk');
    if (depthPeekChk) depthPeekChk.checked = true;

    function animateReveal() {
        const elapsedTime = performance.now() - startTime;
        const progress = Math.min(elapsedTime / revealDuration, 1.0);
        
        // Animate from the clicked depth down to 0
        depthPeekValue = clickedDepthValue_8bit * (1.0 - progress);

        const peekSlider = document.getElementById('depthPeekValueSlider');
        const peekValueDisplay = document.getElementById('depthPeekValueSliderValue');
        if (peekSlider) peekSlider.value = depthPeekValue;
        if (peekValueDisplay) peekValueDisplay.textContent = depthPeekValue.toFixed(3);

        if (progress < 1.0) {
            requestAnimationFrame(animateReveal);
        } else {
            depthPeekActive = false;
            if (depthPeekChk) depthPeekChk.checked = false;
        }
    }
    requestAnimationFrame(animateReveal);

    // 3. Auto-Configure "Sweet Spot" Sliders
    currentNormPortalPlane = clickedDepthValue_8bit; // Set portal to clicked depth
    subjectFocalPlaneWorldZ = portalPlaneWorldZ;     // Set subject focus to portal plane
    outerVolumeDepth = 0.01;                         // Reduce outer depth for a subtler effect

    const normPortalSlider = document.getElementById('depthMidpointSlider');
    const normPortalValue = document.getElementById('depthMidpointValue');
    const subjectFocalZSlider = document.getElementById('subjectFocalZSlider');
    const subjectFocalZValue = document.getElementById('subjectFocalZSliderValue');
    const outerDepthSlider = document.getElementById('outerDepthSlider');
    const outerDepthValue = document.getElementById('outerDepthSliderValue');

    if(normPortalSlider) normPortalSlider.value = currentNormPortalPlane;
    if(normPortalValue) normPortalValue.textContent = currentNormPortalPlane.toFixed(2);
    if(subjectFocalZSlider) subjectFocalZSlider.value = subjectFocalPlaneWorldZ.toFixed(3); // Use toFixed(3)
    if(subjectFocalZValue) subjectFocalZValue.textContent = subjectFocalPlaneWorldZ.toFixed(3);
    if(outerDepthSlider) outerDepthSlider.value = outerVolumeDepth;
    if(outerDepthValue) outerDepthValue.textContent = outerVolumeDepth.toFixed(3); // Use toFixed(3)

    initializeSubjectLockConstant();
}
// ===================================================================
// END: NEW handleCanvasClick
// ===================================================================

// In handleCanvasMouseDown 
function handleCanvasMouseDown(event) {
    didDrag = false; // Reset drag flag on new mDown

    if (setScaleModeActive) {
        // --- NEW ---
        // Handle scale logic on MOUSE DOWN to avoid 'didDrag' issue
        handleCanvasClickForScale(event); 
        return; // Don't do any other drag logic
        // --- END NEW ---
    }

    if (event.shiftKey) {
        isDraggingSplit = true;
        isDraggingDepth = false; 

        // --- MODIFIED ---
        isSettingSplitPlane = true; // Show popup
        const instructionsPanel = document.getElementById('setScaleInstructions');
        if (instructionsPanel) {
            instructionsPanel.style.display = 'block'; 
            instructionsPanel.classList.add('live-update');
            instructionsPanel.innerHTML = `<p>Setting split...</p>`;
        }

        // Request a readback at the current position
        const rect = canvasElement.getBoundingClientRect();
        depthReadbackRequest.x = Math.floor(event.clientX - rect.left);
        depthReadbackRequest.y = Math.floor(event.clientY - rect.top);
        depthReadbackRequest.requested = true;

        // Still call this for the live VISUAL update
        updateDepthFromMouse(event);
        
    } else {
        // Start a regular Depth Peek Drag
        isDraggingDepth = true;
        isDraggingSplit = false;
    }
    
    didDrag = false; // Reset drag flag on new mDowntime
}

/**
 * Handles the mousemove event to update depth peek while dragging.
 */
function handleCanvasMouseMove(event) {
    if (!isDraggingDepth && !isDraggingSplit) return; 

    didDrag = true; 

    if (isDraggingSplit) {
        // --- MODIFIED ---
        // Request a readback at the current position
        const rect = canvasElement.getBoundingClientRect();
        depthReadbackRequest.x = Math.floor(event.clientX - rect.left);
        depthReadbackRequest.y = Math.floor(event.clientY - rect.top);
        depthReadbackRequest.requested = true;

        // Still call this for the live VISUAL update
        updateDepthFromMouse(event);
        // --- END MODIFIED ---
        
    } else if (isDraggingDepth) {
        // Update the regular Depth Peek
        
        // Activate peek UI only once a drag starts
        if (!depthPeekActive) {
            depthPeekActive = true;
            document.getElementById('depthPeekActiveChk').checked = true;
        }
        updateDepthFromMouse(event); // Update visualization
    }
}

/**
 * Handles the mouseup event to stop the depth drag.
 */
function handleCanvasMouseUp(event) {
    if (isDraggingSplit) {
        isDraggingSplit = false;

        // --- MODIFIED ---
        isSettingSplitPlane = false; // Hide popup
        const instructionsPanel = document.getElementById('setScaleInstructions');
        if (instructionsPanel) {
            instructionsPanel.classList.remove('live-update');
            instructionsPanel.style.display = 'none';
        }
        // --- END MODIFIED ---
        
    } else if (isDraggingDepth) {
        // Finalize regular Depth Peek Drag
        if (didDrag) {
            // If we dragged, turn off peek on mouseup
            depthPeekActive = false;
            document.getElementById('depthPeekActiveChk').checked = false;
        }
        isDraggingDepth = false;
    }
    
    // didDrag is reset by handleCanvasClick or handleCanvasMouseDown
}

// --- ADD THIS NEW FUNCTION (around line 5227) ---
function handleCanvasClickForScale(event) {
    // This is the logic block moved from handleCanvasClick (lines 5410-5472)
    
    if (!depthQueryCtx || !canvasElement || !renderer || !camera) return;

    const rect = canvasElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const u = x / rect.width;
    const v_gl = 1.0 - (y / rect.height); // Y is inverted

    const instructionsPanel = document.getElementById('setScaleInstructions');
    const setScaleButton = document.getElementById('setScaleButton');
    
    // This is the core logic
    const clickedPoint3D = get3DPointFromUV(u, v_gl);
    if (!clickedPoint3D) {
        alert("Could not get 3D point. Is a depth map loaded?");
        return;
    }

    if (!scaleFirstPoint) {
        scaleFirstPoint = clickedPoint3D;
        scaleFirstPointScreen = { x: event.clientX, y: event.clientY };
        if (setScaleButton) setScaleButton.textContent = 'Click second point...';
        if (instructionsPanel) instructionsPanel.innerHTML = `<h4>Set Scale</h4><p>Click the <strong>second point</strong> to complete the measurement.</p>`;
    } else {
        const virtualDistance = scaleFirstPoint.distanceTo(clickedPoint3D);
        const realDistanceStr = prompt(`Virtual distance is ${virtualDistance.toFixed(4)}. Enter the real-world distance between these points in METERS:`);
        const realDistance = parseFloat(realDistanceStr);

        if (!isNaN(realDistance) && realDistance > 0) {
            metricScaleFactor = realDistance / virtualDistance;
            // ... (rest of scale/scalar calculation logic) ...
            const secondPointScreen = { x: event.clientX, y: event.clientY };
            const pixelDistance = Math.abs(secondPointScreen.y - scaleFirstPointScreen.y);
            const canvasRect = canvasElement.getBoundingClientRect();
            const canvasHeightPixels = canvasRect.height;
            const vFovRad = THREE.MathUtils.degToRad(camera.fov);
            const apparentAngle = (pixelDistance / canvasHeightPixels) * vFovRad;
            const estimatedDistance = (realDistance / 2) / Math.tan(apparentAngle / 2);
            const NATURAL_INTERACTION_DISTANCE_M = 0.7;
            const BASE_PARALLAX_SENSITIVITY = 3.0;
            const newScalar = (NATURAL_INTERACTION_DISTANCE_M / estimatedDistance) * BASE_PARALLAX_SENSITIVITY;
            const clampedScalar = Math.max(0, Math.min(50, newScalar));
            const scalarSlider = document.getElementById('facetrackingScalarSlider');
            const scalarInput = document.getElementById('facetrackingScalarInput');
            const scalarValue = document.getElementById('facetrackingScalarValue');
            if(scalarSlider && scalarInput && scalarValue) {
                scalarSlider.value = clampedScalar;
                scalarInput.value = clampedScalar;
                scalarValue.textContent = clampedScalar.toFixed(2);
            }
            const resultsPanel = document.getElementById('setScaleInstructions');
            if (resultsPanel) {
                const realDistanceInches = realDistance * 39.3701;
                resultsPanel.innerHTML = `
                    <h4>Scale Set!</h4>
                    <p>
                        Real Size: <strong>${realDistance.toFixed(2)} m / ${realDistanceInches.toFixed(1)} in</strong><br>
                        Est. Distance: <strong>${estimatedDistance.toFixed(1)} m</strong><br>
                        New Parallax Scalar: <strong>${clampedScalar.toFixed(2)}</strong>
                    </p>
                `;
                resultsPanel.style.display = 'block';
                setTimeout(() => {
                    if (resultsPanel) { resultsPanel.style.display = 'none'; }
                }, 6000);
            }

        } else {
            alert("Invalid distance entered. Scale not set.");
        }

        setScaleModeActive = false;
        scaleFirstPoint = null;
        scaleFirstPointScreen = null;
        if (setScaleButton) {
            setScaleButton.textContent = 'Set Scale';
            setScaleButton.style.backgroundColor = '';
        }
        if (canvasElement) canvasElement.style.cursor = 'default';
        if (instructionsPanel && !instructionsPanel.innerHTML.includes("<h4>Scale Set!</h4>")) {
             instructionsPanel.style.display = 'none';
        }
    }
    // --- End of moved logic block ---
}
// -----------------------------------------------------------------------------
// --- MAIN APPLICATION ENTRY POINT --------------------------------------------
// -----------------------------------------------------------------------------

// ===================================================================
// START: NEW onOpenCvReady
// (Replaces the old function)
// ===================================================================
async function onOpenCvReady() {
    isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

    // --- Get all essential elements ---
    videoInput = document.getElementById('video');
    canvasElement = document.getElementById('canvas');
    faceOverlayCanvas = document.getElementById('faceOverlayCanvas');
    if (faceOverlayCanvas) faceOverlayCtx = faceOverlayCanvas.getContext('2d');
    transformDiv = document.getElementById('transform');
    mainContentElement = document.querySelector('.main-content');
    fpsDisplayElement = document.getElementById('fpsDisplay');
    actualVerticesDisplayElement = document.getElementById('actualVerticesDisplay');
    optimalVerticesDisplayElement = document.getElementById('optimalVerticesDisplay');
    sourceResolutionDisplayElement = document.getElementById('sourceResolutionDisplay');
    
    // --- Get non-essential elements (won't block setup) ---
    facetrackingScalarSlider = document.getElementById('facetrackingScalarSlider');
    facetrackingScalarInput = document.getElementById('facetrackingScalarInput');
    facetrackingScalarValue = document.getElementById('facetrackingScalarValue');
    normPortalSliderHTML = document.getElementById('depthMidpointSlider');
    normPortalValueHTML = document.getElementById('depthMidpointValue');

    depthQueryCanvas = document.createElement('canvas');
    depthQueryCtx = depthQueryCanvas.getContext('2d', { willReadFrequently: true });

    // --- CORRECTED: Removed controlsDiv and buttonContainer from the check ---
    if (!videoInput || !canvasElement || !mainContentElement || !faceOverlayCanvas || !transformDiv) {
        console.error("One or more essential HTML elements are missing! Aborting setup.");
        // Log what's missing
        if (!videoInput) console.error("Missing: #video");
        if (!canvasElement) console.error("Missing: #canvas");
        if (!mainContentElement) console.error("Missing: .main-content");
        if (!faceOverlayCanvas) console.error("Missing: #faceOverlayCanvas");
        if (!transformDiv) console.error("Missing: #transform");
        return;
    }

    initializeSceneAndRenderer();
    createSceneGuides();
    
    // --- CORRECTED: Call setupDynamicControls without the null argument ---
    setupDynamicControls();
    
    setupStaticControlListeners(); 

    const frameElement = document.querySelector('.frame');
    if (frameElement) {
        const resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                const { width, height } = entry.contentRect;
                if (width === 0 || height === 0) {
                    continue; 
                }
                if (width > 0 && height > 0 && renderer && camera && camera.aspect) {
                    let newWidth, newHeight;
                    if (width / height > camera.aspect) {
                        newHeight = height;
                        newWidth = height * camera.aspect;
                    } else {
                        newWidth = width;
                        newHeight = width / camera.aspect;
                    }
                    resizeRendererAndTargets(Math.round(newWidth), Math.round(newHeight));
                }
            }
        });
        resizeObserver.observe(frameElement);
    }

    if (optimalCalculationInterval) clearInterval(optimalCalculationInterval);
    optimalCalculationInterval = setInterval(calculateAndDisplayOptimalVertices, 500);
    if (camera && camera.fov > 0) initializeSubjectLockConstant();
    
    // DEPRECATED: loadImage(); // Don't load default media, wait for user
    // Instead, just initialize the pyramids
    if (renderer && renderer.domElement && (currentRTWidth === 0 || currentRTHeight === 0)) {
        console.log("Initializing pyramids based on initial renderer size.");
        resizeRendererAndTargets(renderer.domElement.width, renderer.domElement.height);
    }

    lastFpsTime = performance.now();
    render();

    const startApp = async () => {
        const startDetection = async () => {
            if (!videoInput.videoWidth || !videoInput.videoHeight) {
                console.error("Video stream has no dimensions. Cannot start detection.");
                return;
            }
            faceOverlayCanvas.width = videoInput.videoWidth;
            faceOverlayCanvas.height = videoInput.videoHeight;

            offscreenCanvas = document.createElement('canvas');
            offscreenCanvas.width = videoInput.videoWidth;
            offscreenCanvas.height = videoInput.videoHeight;
            offscreenCtx = offscreenCanvas.getContext('2d');

            console.log("Camera stream loaded. Initializing Face Mesh...");
            await initializeFaceMesh();
           
            runFaceMeshCycle();
        };

        try {
            console.log("Requesting camera access...");
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            videoInput.srcObject = stream;
            
            // Use 'loadeddata' as it's more reliable than 'loadedmetadata' for dimensions
            videoInput.onloadeddata = () => {
                console.log(`Video data loaded: ${videoInput.videoWidth}x${videoInput.videoHeight}`);
                startDetection();
            };
            
            videoInput.play().catch(e => console.error("Webcam play error:", e.message));

        } catch (err) {
            console.error("Error starting video stream or Face Mesh:", err);
            alert("Could not access the camera. Please grant permission and refresh the page.");
        }
    };

    if (isIOS) {
        console.log("iOS device detected. Displaying permission primer modal.");
        const modalOverlay = document.getElementById('permissionModalOverlay');
        const allowButton = document.getElementById('allowPermissionsButton');

        if (modalOverlay && allowButton) {
            modalOverlay.style.display = 'flex';

            allowButton.addEventListener('click', async () => {
                modalOverlay.style.display = 'none';
                await startApp();

                if (gyroEnableButton) {
                    gyroEnableButton.textContent = '▶ Click to Enable Gyro';
                    gyroEnableButton.style.backgroundColor = '#28a745';
                    gyroEnableButton.style.color = 'white';
                    gyroEnableButton.style.fontWeight = 'bold';
                }
            }, { once: true });
        } else {
             console.error("Permission modal elements not found!");
        }
    } else {
        await startApp();
    }

    const gyroModal = document.getElementById('gyroInstructionsModalOverlay');
    const closeGyroModalButton = document.getElementById('closeGyroInstructionsButton');
    if (gyroModal && closeGyroModalButton) {
        closeGyroModalButton.addEventListener('click', () => {
            gyroModal.style.display = 'none';
        });
    }
}
// ===================================================================
// END: NEW onOpenCvReady
// ===================================================================