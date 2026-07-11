console.log('%c[BUILD] FG-SUB rimdepth v3.12.0-bandcut | band-gated FG stretch cut + directional plug + smooth margin', 'color:#0f0;font-weight:bold');
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
// NEW: Added infillAtlasTarget_Depth_VTF
let masterGapTarget, infillAtlasTarget_Color, infillAtlasTarget_Depth, infillAtlasTarget_Depth_VTF;

// Materials (will be initialized in initializeSceneAndRenderer)
let additiveBlendMaterial, feedbackOverlayMaterial, gapMaskExtractorMaterial, maskGeneratorDepthMaterial;
// NEW: Ground Truth Accumulation Materials
let groundTruthColorAccumulatorMaterial, groundTruthDepthAccumulatorMaterial;
// NEW: Normalization Material for WAA
let normalizationMaterial;

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

// Cache to store "Parasitic" Depth Materials
// WeakMap ensures memory is freed if the original material is disposed
const depthMaterialCache = new WeakMap();

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
let lumaMaterial, sobelEdgeMaterial, combineEdgesMaterial, gaussianBlurMaterial, sobelGradientMaterial, nmsMaterial, hysteresisMaterial, normalizeDepthMaterial, debugEdgeMaskMaterial, debugFGExclusionColorMaterial, debugFGExclusionDepthMaterial, legacyEdgeMaskMaterial, edgeDilationMaterial;
let jfaSeedMaterial, jfaFloodMaterial, jfaResolveMaterial;
let debugGapsMaterial, debugJfaMaterial, debugDepthMaterial, debugJfaToleranceMaterial, debugJfaDepthCompareMaterial;
let inpaintOnlyMaterial; // Shows only the inpainted pixels (difference between gapped and inpainted)
let inpaintOnlyDepthMaterial; // Shows only the depth where inpainted
let debugGapTargetDepthMaterial; // Shows gap target depth for debug
let debugSceneDepthMaterial; // Shows scene depth with gaps highlighted
let debugSceneDepthCompositeMaterial; // Shows scene depth + inpainted gap depth
let dilationMaterial, copyMaterial;
// Pull-Push Materials
let pullMaterial, pushMaterial, pushMaterialDepthAware, maskGeneratorMaterial, pullMaterialDepthAware;

let ditherMaterial; // This is the old, full-screen dither material
let ditherCompositeMaterial; // NEW: The selective dither material
let ditherStrength = 0.0; // Controlled by slider

let finalRenderPassTarget; // This will hold the anti-aliased image
let fxaaMaterial;
let sharpenMaterial;
let sharpenTarget; // This will hold the sharpened image
let sharpenStrength = 1.0; // Default strength
let useAntiAliasing = true; // Default to on

// --- NEW: Bake Strategy Globals ---
let currentBakeFillMethod = 'pyramid'; // Default to Pyramid for seamless gradients
let debugAtlasGeometry = false;

// New Materials for Baking Strategies
let fillBackgroundFloodMaterial;
let fillMaxDepthDownsampleMaterial;
let fillMaxDepthUpsampleMaterial;
let fillPlanarBackplaneMaterial;
let geometryInspectionMaterial; // Checkerboard debug

let screenNormalizedDepthTarget; // New target for linear depth capture

// --- NEW: SD Pipeline / Gap Export System ---
let sdExportGapMaskTarget;       // Binary gap mask (white = gap)
let sdExportGapDepthTarget;      // Expected BG depth in gap regions
let sdExportGapDepthTarget2;     // Second target for iterative propagation
let gapDepthPullMaterial, gapDepthPushMaterial, gapDepthSeedMaterial, fgSubtractionMaterial;
let sdExportContextColorTarget;  // Color context for SD
let sdExportInpaintPatchMesh;    // Mesh for imported inpaint patches

// Materials for SD Pipeline
let sdGapMaskMaterial;           // Creates binary gap mask from atlas validity
let sdGapDepthEstimatorMaterial; // Estimates background depth for gaps
let sdInpaintPatchMaterial;      // Material for imported SD patches with displacement

// SD Export Settings
let sdExportResolution = 1024;   // Target resolution for exports
let sdExportPadding = 32;        // Padding around gap regions
let currentSDExportMode = 'gaps_only'; // 'gaps_only', 'full_atlas', 'current_view'

// --- NEW: Hole Patch System (Simplified) ---
let holePatchTarget;             // Combined patch data: R=alpha, G=depth
let holeAccumulationCount = 0;   // Counter for debugging accumulation
let holeCaptureTarget;           // Per-frame hole capture
let holePatchPingPongTarget;     // Ping-pong for accumulation
let uvPositionTarget;            // Screen-space UV position map
let holePatchMesh;               // The patch mesh
let showHolePatchOnly = false;   // Toggle to view just the patch

// NEW: Color accumulation targets
let holePatchColorTarget;        // Accumulated color: RGB=sum(color×weight), A=sum(weights)
let holePatchColorPingPong;      // Ping-pong for color accumulation  
let holeColorCaptureTarget;      // Per-frame color capture

// Hole Patch Materials
let holeDetectMaterial;          // Detects holes (black pixels) + estimates BG depth
let holeAccumulateMaterial;      // Accumulates holes to UV space (uses UV position map)
let holePatchRenderMaterial;     // Renders the patch mesh with displacement
let uvPositionMaterial;          // Renders UV coordinates to screen space
let holeColorDetectMaterial;     // NEW: Compares gapped vs inpainted to find hole colors
let holeColorAccumulateMaterial; // NEW: Accumulates hole colors to UV space
let holeColorCaptureMaterial;    // NEW: Captures hole color from inpainted frame

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
    if (typeof bgLayerMesh !== 'undefined' && bgLayerMesh && bgLayerMesh.material &&
        bgLayerMesh.material.uniforms && bgLayerMesh.material.uniforms[key] &&
        key !== 'u_useEdgeMask') { // BG must never take the screen-space gap mask
        bgLayerMesh.material.uniforms[key].value = value;
    }
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

// ===================================================================
// START: NEW HELPER FUNCTIONS (UV Capture)
// ===================================================================
/**
 * Creates a temporary UV Capture material based on an original layer material.
 * This ensures the vertex shader logic (displacement) is identical, 
 * but overrides the fragment shader to output texture UVs.
 */
function createUVCaptureMaterial(originalMaterial) {
    if (!originalMaterial || !originalMaterial.isShaderMaterial) {
        return null;
    }

    // Clone the material to avoid altering the original
    const uvMaterial = originalMaterial.clone();

    // Override the fragment shader
    uvMaterial.fragmentShader = `
        // This assumes the original vertex shader defines and calculates 'vUv'
        varying vec2 vUv;

        void main() {
            // Output the texture coordinates (R=U, G=V)
            gl_FragColor = vec4(vUv.x, vUv.y, 0.0, 1.0);
        }
    `;
    
    uvMaterial.needsUpdate = true;
    return uvMaterial;
}

/**
 * Renders the Texture UV coordinates of the scene geometry.
 * FIX: Shares the exact uniforms object with the original material to guarantee 1:1 displacement.
 */
function renderUVMap() {
    if (!uvMapRenderTarget || !scene || !camera) return;

    const originalMaterials = new Map();
    const overrides = [];

    // 1. Prepare Materials
    scene.traverse((object) => {
        if (object.isMesh && object.material && object.material.isShaderMaterial) {
            if (object === infillAtlasMesh) return;

            // Identify if this is one of our Media Layers
            if (object.material.vertexShader.includes('vUv')) {
                const originalMat = object.material;
                
                // Create a new material but STEAL the uniforms from the original
                // This ensures that updates in updateCameraAndProjection() affect this material instantly
                const uvMaterial = new THREE.ShaderMaterial({
                    uniforms: originalMat.uniforms, // <--- SHARED REFERENCE
                    vertexShader: originalMat.vertexShader, // Exact same vertex logic
                    fragmentShader: `
                        varying vec2 vUv;
                        varying float vNormalizedDepth;
                        varying float vClipW;
                        varying vec3 vViewPosition;

                        void main() {
                            // Output UVs as Color (R=u, G=v)
                            gl_FragColor = vec4(vUv.x, vUv.y, 0.0, 1.0);
                        }
                    `,
                    side: originalMat.side,
                    transparent: originalMat.transparent,
                    depthTest: originalMat.depthTest,
                    depthWrite: originalMat.depthWrite
                });

                overrides.push({ object: object, original: originalMat, temp: uvMaterial });
                object.material = uvMaterial;
            }
        }
    });

    // 2. Render
    renderer.setRenderTarget(uvMapRenderTarget);
    renderer.clear();
    renderer.render(scene, camera);

    // 3. Restore
    overrides.forEach(entry => {
        entry.object.material = entry.original;
        entry.temp.dispose(); // Cleanup the shell material
    });
}
// ===================================================================
// END: NEW HELPER FUNCTIONS
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

/**
 * Clears the accumulation buffers to start a fresh bake.
 */
function resetAccumulation() {
    if (!renderer || !infillAtlasTarget_Color || !infillAtlasTarget_Depth) return;
    
    console.log("--- Resetting Accumulation Buffers ---");
    
    // Clear Targets
    renderer.setRenderTarget(infillAtlasTarget_Color); renderer.clear();
    renderer.setRenderTarget(infillAtlasTarget_Depth); renderer.clear();
    renderer.setRenderTarget(infillAtlasTarget_Depth_VTF); renderer.clear();
    
    // Reset state flags
    isAccumulatingGaps = false;
    isSweeping = false;
    useStaticInfillAtlas = false;
    
    // --- CRITICAL FIX: Restore ALL buttons ---
    const manualBtn = document.getElementById('manualAccumulationButton');
    const quickBtn = document.getElementById('autoSweepQuickButton');
    const fullBtn = document.getElementById('autoSweepFullButton');

    if (manualBtn) {
        manualBtn.textContent = 'Start Live Sweep';
        manualBtn.disabled = false;
        manualBtn.style.backgroundColor = ''; 
    }
    if (quickBtn) {
        quickBtn.textContent = 'Run Quick Bake (Grid)';
        quickBtn.disabled = false;
    }
    if (fullBtn) {
        fullBtn.textContent = 'Run Full Bake (Continuous)';
        fullBtn.disabled = false;
    }
    
    renderer.setRenderTarget(null);
}

/**
 * Updates the Static Background Mesh.
 * Uses the baked COLOR atlas and the baked VTF DEPTH atlas for displacement.
 */
function initializeInfillAtlasMesh() {
    if (!infillAtlasTarget_Color || !infillAtlasTarget_Depth_VTF) return;

    // Find the source geometry to clone
    const primaryLayer = mediaLayers.find(l => l.mesh && l.mesh.visible);
    if (!primaryLayer) return;

    // 1. Create/Update Material
    if (!infillAtlasMesh) {
        const geometry = primaryLayer.mesh.geometry.clone();
        
        // Use the inspection material if debug is ON, otherwise clone original
        let material; 
        if (debugAtlasGeometry) {
            material = geometryInspectionMaterial; 
        } else {
            material = primaryLayer.mesh.material.clone();
            // Disable "Gap" logic on the background mesh (it should be solid)
            material.uniforms.u_useDepthGrad.value = false;
            material.uniforms.u_useSobel.value = false;
        }
        
        infillAtlasMesh = new THREE.Mesh(geometry, material);
        infillAtlasMesh.renderOrder = -1; // Always behind foreground
        infillAtlasMesh.frustumCulled = false; 
        scene.add(infillAtlasMesh);
    } else {
        // Handle Toggling Material at Runtime (Swap between debug and production mat)
        if (debugAtlasGeometry && infillAtlasMesh.material !== geometryInspectionMaterial) {
            infillAtlasMesh.material = geometryInspectionMaterial;
        } else if (!debugAtlasGeometry && infillAtlasMesh.material === geometryInspectionMaterial) {
            const newMat = primaryLayer.mesh.material.clone();
            newMat.uniforms.u_useDepthGrad.value = false;
            newMat.uniforms.u_useSobel.value = false;
            infillAtlasMesh.material = newMat;
        }
    }

    const mat = infillAtlasMesh.material;

    // 2. Assign Baked Textures / Update Debug Uniforms
    if (debugAtlasGeometry) {
        // Debug Mode: Only needs the depth map for displacement
        mat.uniforms.displacementMap.value = infillAtlasTarget_Depth_VTF.texture;
        mat.uniforms.u_portalPlaneDepthNorm.value = currentNormPortalPlane;
        mat.uniforms.u_worldInnerVolumeDepth.value = innerVolumeDepth;
        mat.uniforms.u_worldOuterVolumeDepth.value = outerVolumeDepth;
        mat.uniforms.u_metricScale.value = metricScaleFactor;
    } else {
        // Normal Mode: Assign Color and Depth
        if (mat.uniforms.map) mat.uniforms.map.value = infillAtlasTarget_Color.texture;
        if (mat.uniforms.rgbTexture) mat.uniforms.rgbTexture.value = infillAtlasTarget_Color.texture;
        if (mat.uniforms.videoTexture) mat.uniforms.videoTexture.value = infillAtlasTarget_Color.texture;

        if (mat.uniforms.displacementMap) mat.uniforms.displacementMap.value = infillAtlasTarget_Depth_VTF.texture;
        if (mat.uniforms.depthTexture) mat.uniforms.depthTexture.value = infillAtlasTarget_Depth_VTF.texture;
    }

    mat.needsUpdate = true;
    infillAtlasMesh.visible = useStaticInfillAtlas;
    console.log("Infill Atlas Mesh Updated. Debug Mode:", debugAtlasGeometry);
}

// -----------------------------------------------------------------------------
// --- 2. UPDATED FUNCTION: resizeRendererAndTargets ---------------------------
// -----------------------------------------------------------------------------

/**
 * Resizes the main renderer, camera, and all offscreen render targets.
 */
function resizeRendererAndTargets(width, height) {
    if (!width || !height || width <= 0 || height <= 0) return; 

    // Update main renderer
    renderer.setSize(width, height);
    if (renderer.domElement) {
        renderer.domElement.style.width = `${width}px`;
        renderer.domElement.style.height = `${height}px`;
    }

    // Update Render Targets
    if (sceneRenderTarget) sceneRenderTarget.setSize(width, height);
    if (uvMapRenderTarget) uvMapRenderTarget.setSize(width, height);
    if (screenNormalizedDepthTarget) screenNormalizedDepthTarget.setSize(width, height);

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

    if (layerMaskTarget) layerMaskTarget.setSize(width, height);
    if (fgInpaintedTarget) fgInpaintedTarget.setSize(width, height);
    if (bgInpaintedTarget) bgInpaintedTarget.setSize(width, height);
    if (depthColorTarget) depthColorTarget.setSize(width, height);
    
    if (masterGapTarget) masterGapTarget.setSize(width, height);
    if (infillAtlasTarget_Color) infillAtlasTarget_Color.setSize(width, height);
    if (infillAtlasTarget_Depth) infillAtlasTarget_Depth.setSize(width, height);
    if (infillAtlasTarget_Depth_VTF) infillAtlasTarget_Depth_VTF.setSize(width, height);

    // SD Pipeline targets
    if (sdExportGapMaskTarget) sdExportGapMaskTarget.setSize(width, height);
    if (sdExportGapDepthTarget) sdExportGapDepthTarget.setSize(width, height);
    if (sdExportGapDepthTarget2) sdExportGapDepthTarget2.setSize(width, height);
    if (sdExportContextColorTarget) sdExportContextColorTarget.setSize(width, height);

    // Hole Patch targets
    if (holePatchTarget) holePatchTarget.setSize(width, height);
    if (holeCaptureTarget) holeCaptureTarget.setSize(width, height);
    if (uvPositionTarget) uvPositionTarget.setSize(width, height);
    if (holePatchColorTarget) holePatchColorTarget.setSize(width, height);
    if (holePatchColorPingPong) holePatchColorPingPong.setSize(width, height);
    if (holeColorCaptureTarget) holeColorCaptureTarget.setSize(width, height);
    if (holePatchPingPongTarget) holePatchPingPongTarget.setSize(width, height);

    if (finalInpaintedTextureTarget) finalInpaintedTextureTarget.setSize(width, height);
    if (finalRenderPassTarget) finalRenderPassTarget.setSize(width, height);
    if (sharpenTarget) sharpenTarget.setSize(width, height);

    // Update Uniforms
    const resolutionVec = new THREE.Vector2(width, height);
    const inverseRes = new THREE.Vector2(1.0 / width, 1.0 / height);

    if (fxaaMaterial) fxaaMaterial.uniforms.resolution.value.copy(inverseRes);
    if (sharpenMaterial) sharpenMaterial.uniforms.resolution.value.copy(inverseRes);

    if (sobelEdgeMaterial) sobelEdgeMaterial.uniforms.u_resolution.value.copy(resolutionVec);
    if (gaussianBlurMaterial) gaussianBlurMaterial.uniforms.u_resolution.value.copy(resolutionVec);
    if (sobelGradientMaterial) sobelGradientMaterial.uniforms.u_resolution.value.copy(resolutionVec);
    if (nmsMaterial) nmsMaterial.uniforms.u_resolution.value.copy(resolutionVec);
    if (hysteresisMaterial) hysteresisMaterial.uniforms.u_resolution.value.copy(resolutionVec);
    if (jfaSeedMaterial) jfaSeedMaterial.uniforms.u_resolution.value.copy(resolutionVec);
    if (jfaFloodMaterial) jfaFloodMaterial.uniforms.u_resolution.value.copy(resolutionVec);
    if (jfaResolveMaterial) jfaResolveMaterial.uniforms.u_resolution.value.copy(resolutionVec);
    if (dilationMaterial) dilationMaterial.uniforms.u_resolution.value.copy(resolutionVec);
    if (legacyEdgeMaskMaterial) legacyEdgeMaskMaterial.uniforms.u_resolution.value.copy(resolutionVec);
    if (edgeDilationMaterial) edgeDilationMaterial.uniforms.u_resolution.value.copy(resolutionVec);
    
    // --- NEW: Update Accumulator Resolutions (Fixes Mismatch) ---
    if (groundTruthColorAccumulatorMaterial) groundTruthColorAccumulatorMaterial.uniforms.u_resolution.value.copy(resolutionVec);
    if (groundTruthDepthAccumulatorMaterial) groundTruthDepthAccumulatorMaterial.uniforms.u_resolution.value.copy(resolutionVec);
    if (ditherMaterial) ditherMaterial.uniforms.u_resolution.value.copy(resolutionVec);
    if (ditherCompositeMaterial) ditherCompositeMaterial.uniforms.u_resolution.value.copy(resolutionVec);
    if (fillBackgroundFloodMaterial) fillBackgroundFloodMaterial.uniforms.u_resolution.value.copy(resolutionVec);
    
    // Hole patch materials
    if (holeColorDetectMaterial) holeColorDetectMaterial.uniforms.u_resolution.value.copy(resolutionVec);
    if (holeColorCaptureMaterial) holeColorCaptureMaterial.uniforms.u_resolution.value.copy(resolutionVec);
    
    // SD Pipeline material resolutions
    if (sdGapDepthEstimatorMaterial) sdGapDepthEstimatorMaterial.uniforms.u_resolution.value.copy(resolutionVec);

    // Re-initialize Pyramids
    initializePyramidTargets(width, height);

    // Update Layer Uniforms
    for (const layer of mediaLayers) {
        if (layer.mesh && layer.mesh.material.uniforms.u_resolution) {
            layer.mesh.material.uniforms.u_resolution.value.copy(resolutionVec);
        }
    }
    
    initializeInfillAtlasMesh();
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
        u_isBackgroundLayer: { value: false },
        u_resolution: { value: new THREE.Vector2(renderer.domElement.width, renderer.domElement.height) },

        // --- NEW UNIFIED GAP UNIFORMS ---
        u_useDepthGrad: { value: document.getElementById('useDepthGradCheck')?.checked || true },
        u_depthGradThreshold: { value: parseFloat(document.getElementById('depthGradThresholdSlider')?.value) || 0.02 },
        u_cutSharp: { value: false }, // RUNG cut: set by the certified-source gate
        
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

        // Band-gated stretch cut (set by buildBackgroundLayer once the plug
        // exists): u_bandMask = source-space disocclusion band (dilated), the
        // ONLY region where the FG may discard; the trigger is the
        // sampled-vs-interpolated depth mismatch (see unifiedGapLogicGLSL).
        u_useBandCut: { value: false },
        u_bandMask: { value: null },
        u_bandCutMismatch: { value: 0.01 },
        u_bandCutMaxGrad: { value: 0.04 },
        u_bandCutUvRate: { value: 0.0 }, // 0 = stretch test off until armed
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
        uniform sampler2D u_edgeMask; uniform bool u_useEdgeMask;
        uniform bool u_isBackgroundLayer; uniform vec2 u_resolution;
        uniform bool u_depthPeekActive; uniform float u_depthPeekValue; uniform float u_depthPeekTolerance;
        uniform bool u_splitPeekActive; uniform float u_splitPeekValue;
        uniform sampler2D u_alphaMap; uniform bool u_hasAlphaMap;
        uniform vec2 u_textureSize;

        // --- GAP STRATEGY UNIFORMS ---
        uniform bool u_useDepthGrad;   uniform float u_depthGradThreshold;
        uniform bool u_cutSharp; // RUNG cut: certified-asset threshold override (0.008)
        uniform bool u_useSobel;       uniform float u_sobelThreshold;
        uniform bool u_useLuma;        uniform float u_lumaThreshold;
        uniform bool u_useChroma;      uniform float u_chromaThreshold;
        uniform bool u_useCrease;      uniform float u_creaseThreshold;
        uniform bool u_useCurvature;   uniform float u_curvatureThreshold;
        uniform bool u_useUVStretch;   uniform float u_uvStretchThreshold;
        uniform bool u_useGrazingAngle; uniform float u_grazingAngleThreshold;
        uniform bool u_useBandCut;     uniform sampler2D u_bandMask;
        uniform float u_bandCutMismatch; uniform float u_bandCutMaxGrad;
        uniform float u_bandCutUvRate;

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

        // --- 0. BAND-GATED STRETCH CUT (plug reveal) ---
        // A fragment whose sampled depth (center) disagrees with its
        // vertex-interpolated depth (vNormalizedDepth) sits on a triangle
        // spanning a depth cliff. Whether that triangle is a mid-parallax
        // RUBBER BAND (the smear that reads as a streak) or just a rest-state
        // silhouette cell is decided by the screen-space ramp rate: at rest
        // the cliff crosses its cell in ~2px (fwidth large); a stretched
        // triangle ramps the same cliff over tens of px (fwidth tiny). Cut
        // only the stretched case, only inside the plug band (where the BG
        // layer is guaranteed opaque) — thin features stay intact at rest,
        // and no naked holes can ever open.
        if (u_useBandCut && !u_isBackgroundLayer && !isGap) {
            if (texture2D(u_bandMask, vUv).r > 0.5) {
                // (a) STRETCH: UV advances far slower per screen px than an
                // unstretched cell would (the derivative is constant across a
                // triangle, so this catches the WHOLE rubber band — including
                // the near half, where the depth mismatch is zero by
                // construction). u_bandCutUvRate = fraction-of-expected rate.
                float uvRate = max(length(dFdx(vUv)), length(dFdy(vUv)));
                bool stretched = (u_bandCutUvRate > 0.0) && (uvRate < u_bandCutUvRate);
                // (b) MISMATCH: sampled-vs-interpolated depth disagreement,
                // gated to slow ramps so rest-state cliffs are exempt.
                bool torn = abs(center - vNormalizedDepth) > u_bandCutMismatch &&
                            fwidth(vNormalizedDepth) < u_bandCutMaxGrad;
                if (stretched || torn) isGap = true;
            }
        }

        // --- 1. GENERATORS (Depth & Texture) ---
        
        // A. Depth Gradient (Standard Derivatives)
        if (u_useDepthGrad) {
            float depthRate = fwidth(vNormalizedDepth);
            // RUNG cut: on the certified (sharpened) asset the skin class
            // (0.008-0.03 steps) discards onto the clean plate; smooth
            // interiors measure < 0.008/px everywhere (0 false discards).
            if (depthRate > (u_cutSharp ? 0.008 : u_depthGradThreshold)) isGap = true;
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

        // The BACKGROUND LAYER never discards: it is the completed layer whose
        // whole purpose is to be visible where the foreground layer opens.
        if (isGap && !u_isBackgroundLayer) discard;
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

/**
 * Creates a "Ghost" filler mesh.
 * FIX: Directly edits the custom ShaderMaterial string (since chunks don't exist).
 * Forces depth to 0.0 (Background) to create a FLAT plate, then dilates it.
 */
function createGhostMesh(originalMesh) {
    if (!originalMesh || !originalMesh.geometry || !originalMesh.material) return null;

    const ghostGeometry = originalMesh.geometry.clone();
    const ghostMaterial = originalMesh.material.clone();

    ghostMaterial.side = THREE.BackSide;
    
    // --- 1. FLATTEN & DILATE (Vertex Shader) ---
    let vs = ghostMaterial.vertexShader;
    
    // A. Force Depth to 0.0 (Background)
    // This kills the "Ramp". The mesh will now sit flat at the furthest depth plane.
    // We look for the line: vNormalizedDepth = texture2D(...).r;
    vs = vs.replace(
        /vNormalizedDepth\s*=\s*texture2D\([^)]+\)\.r;/g, 
        'vNormalizedDepth = 0.0;' 
    );

    // B. Dilate XY (Stretch width/height)
    // We inject logic to push vertices outward from the center.
    const dilationLogic = `
        // Dilation: Push vertices outwards to create a rim
        vec2 fromCenter = uv - 0.5;
        vec3 dilatedPos = position;
        // 0.04 = 4% expansion. Increase this if you still see gaps.
        dilatedPos.xy += normalize(fromCenter) * 0.04; 
    `;
    
    // Inject the variable definition at the start of main()
    vs = vs.replace('void main() {', 'void main() { ' + dilationLogic);
    
    // Apply the dilated position to the modelViewMatrix calculation
    // Your shader uses: vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vs = vs.replace(
        'vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);',
        'vec4 viewPosition = modelViewMatrix * vec4(dilatedPos, 1.0);'
    );

    ghostMaterial.vertexShader = vs;

    // --- 2. DARKEN (Fragment Shader) ---
    // Make it look like a shadow/void filling.
    let fs = ghostMaterial.fragmentShader;
    fs = fs.replace(
        'gl_FragColor = originalColor;',
        `
        // Darken the ghost to 30% brightness
        gl_FragColor = vec4(originalColor.rgb * 0.3, 1.0);
        `
    );
    
    ghostMaterial.fragmentShader = fs;
    ghostMaterial.needsUpdate = true;

    const ghostMesh = new THREE.Mesh(ghostGeometry, ghostMaterial);
    ghostMesh.renderOrder = -5; // Force it to draw behind the main mesh
    
    return ghostMesh;
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

/**
 * Auto-loads default images on startup
 */
async function loadDefaultImages(isRetry = false) {
    console.log(`[DEFAULTS] Loading default images${isRetry ? ' (retry)' : ''}...`);

    const colorUrl = 'defaultImgColor.png';
    const depthUrl = 'defaultImgDepth.png';

    // --- Preflight: verify the files are actually reachable, and say so loudly.
    // (fetch fails under file:// — in that case skip preflight and let the
    // Image loader's own onerror report.)
    try {
        for (const url of [colorUrl, depthUrl]) {
            const resp = await fetch(url, { method: 'HEAD' }).catch(() => fetch(url, { method: 'GET' }));
            if (!resp.ok) {
                console.error(`[DEFAULTS] '${url}' not found next to the HTML (HTTP ${resp.status}). ` +
                              `Default auto-load needs defaultImgColor.png and defaultImgDepth.png ` +
                              `in the same directory as moebius.html.`);
                return;
            }
        }
        console.log('[DEFAULTS] Preflight OK — both files reachable.');
    } catch (e) {
        console.warn('[DEFAULTS] Preflight fetch unavailable (file:// protocol?). Attempting load anyway.', e);
    }

    // Create a layer with default image URLs
    const defaultLayer = {
        id: `layer_${nextLayerId++}`,
        type: 'image',
        fileInfo: { 
            color: { name: 'defaultImgColor.png', type: 'image/png' }, 
            depth: { name: 'defaultImgDepth.png', type: 'image/png' }, 
            alpha: null 
        },
        sources: { 
            color: colorUrl,  // URL string
            depth: depthUrl,  // URL string
            alpha: null 
        },
        colorValue: '#000000'
    };
    
    // Set up staged layers
    stagedMediaLayers = [defaultLayer];
    
    // Apply without opening the modal
    try {
        await applyLayersFromModal();
        if (mediaLayers && mediaLayers.length > 0) {
            console.log('[DEFAULTS] Default images loaded successfully.');
        } else {
            console.warn('[DEFAULTS] applyLayersFromModal completed but no layers are active ' +
                         '(startup race or session invalidation?).');
        }
    } catch (err) {
        console.warn('[DEFAULTS] Could not load default images:', err);
        stagedMediaLayers = [];
    }

    // --- One retry: startup (webcam init, resize, session churn) can clear or
    // invalidate the scene right after defaults apply. If nothing is loaded
    // shortly after, and the user hasn't loaded anything manually, try once more.
    if (!isRetry) {
        setTimeout(() => {
            if ((!mediaLayers || mediaLayers.length === 0)) {
                console.warn('[DEFAULTS] Scene still empty after startup — retrying default load once.');
                loadDefaultImages(true);
            }
        }, 1500);
    }
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
/**
 * Performs a single frame of Ground Truth Accumulation.
 */
function stepAccumulation() {
    // 1. Force-Hide the Infill Mesh (The "Plug")
    // We must hide it so we can see the holes behind it!
    const wasAtlasVisible = infillAtlasMesh ? infillAtlasMesh.visible : false;
    if (infillAtlasMesh) {
        infillAtlasMesh.visible = false;
    }

    // 2. Render Clean Scene
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

    // 3. Render Helper Passes (Now with fixed shaders)
    renderNormalizedDepthPass();
    renderUVMap();

    // 4. Generate Layer Mask
    const postProcessQuad = postProcessScene.children[0];
    postProcessQuad.material = layerMaskMaterial;
    layerMaskMaterial.uniforms.tDepth.value = sceneRenderTarget.depthTexture;
    layerMaskMaterial.uniforms.u_inpaintingSplitDepth_RAW.value = currentInpaintingSplitDepthNorm;
    renderer.setRenderTarget(layerMaskTarget);
    renderer.clear();
    renderer.render(postProcessScene, postProcessCamera);

    // 5. Accumulate
    runAccumulationPass(
        layerMaskTarget.texture,
        uvMapRenderTarget.texture,
        sceneRenderTarget.texture,          
        screenNormalizedDepthTarget.texture 
    );
    
    // 6. Restore Infill Mesh Visibility
    if (infillAtlasMesh) {
        infillAtlasMesh.visible = wasAtlasVisible;
    }
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
            // URL-string sources must be CORS-clean for WebGL texture upload.
            // Harmless on same-origin; required for CDN-hosted assets. (Note:
            // does not help under file:// — file:// cannot satisfy CORS at all;
            // serve over http instead.)
            if (typeof source === 'string' && !url.startsWith('blob:') && !url.startsWith('data:')) {
                element.crossOrigin = 'anonymous';
            }
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

    // ========================================================================
    // --- NEW: Re-initialize the Infill Atlas Mesh after layer changes ---
    // (This is the patch from the handoff prompt)
    // ========================================================================
    initializeInfillAtlasMesh();
    // ========================================================================

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

    // ========================================================================
    // --- NEW: Remove and dispose the Infill Atlas Mesh ---
    // (This is the patch from the handoff prompt)
    // ========================================================================
    if (infillAtlasMesh) {
        console.log("Disposing Infill Atlas Mesh...");
        if (scene) scene.remove(infillAtlasMesh);
        infillAtlasMesh.geometry.dispose();
        if (infillAtlasMesh.material) {
            infillAtlasMesh.material.dispose();
        }
        infillAtlasMesh = null;
    }
    // ========================================================================

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

    // Set texture size uniform
    mat.uniforms.u_textureSize.value.set(effectiveWidth, effectiveHeight);

    // Update uniforms for side-by-side if necessary
    if (layer.type === 'sidebyside' && mat.uniforms.videoDimensions) {
        const displayWidth = effectiveWidth / 2; // Half width for SBS
        const displayHeight = effectiveHeight;
        
        mat.uniforms.videoDimensions.value.set(effectiveWidth, effectiveHeight);
        if (mat.uniforms.rgbVideoCoords && mat.uniforms.depthMapCoords) {
            // Assume Standard SBS: RGB Left, Depth Right
            mat.uniforms.rgbVideoCoords.value.set(0, 0, displayWidth, displayHeight);
            mat.uniforms.depthMapCoords.value.set(displayWidth, 0, displayWidth, displayHeight);
        }
    }

    layer.mesh = new THREE.Mesh(geom, mat);
    layer.mesh.position.z = portalPlaneWorldZ;
    layer.mesh.renderOrder = 0; 
    scene.add(layer.mesh);

    // --- NEW: Create and Add Ghost Mesh ---
    // Only needed if displacement is happening (i.e., we have depth)
    // We check layer type or presence of depth texture
    if (layer.type !== 'image' || (layer.textures && layer.textures.depth)) {
        // Cleanup old ghost if re-initializing
        if (layer.ghostMesh) { 
            scene.remove(layer.ghostMesh); 
            if(layer.ghostMesh.geometry) layer.ghostMesh.geometry.dispose();
            if(layer.ghostMesh.material) layer.ghostMesh.material.dispose();
            layer.ghostMesh = null;
        }

        const ghost = createGhostMesh(layer.mesh);
        if (ghost) {
            ghost.position.z = layer.mesh.position.z; // Align Z
            scene.add(ghost);
            layer.ghostMesh = ghost; // Store reference for updates
            console.log(`Ghost mesh created for layer ${layer.id}`);
        }
    }
    // --------------------------------------

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
    const frameAspect = terrariumWidth / terrariumHeight; 
    camera = new THREE.PerspectiveCamera(initialFov, frameAspect, 0.001, 1000);
    const initialCamDistFromSubject = (dollyMinDistance + dollyMaxDistance) / 2;
    camera.position.z = subjectFocalPlaneWorldZ + initialCamDistFromSubject;

    renderer = new THREE.WebGLRenderer({ canvas: canvasElement, antialias: true, alpha: true, preserveDrawingBuffer: true }); // preserveDrawingBuffer: lets the debug sheet (and right-click save) capture the canvas
    renderer.dithering = true;
    renderer.setSize(canvasWidth, canvasHeight);
    renderer.setClearColor(0x000000, 0);

    // --- Render Targets ---
    const defaultTargetOptions = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat };
    const jfaTargetOptions = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat, type: THREE.FloatType };
    const finalInpaintTargetOptions = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat };

    sceneRenderTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
        depthBuffer: true,
        stencilBuffer: false,
        depthTexture: new THREE.DepthTexture(canvasWidth, canvasHeight, THREE.FloatType)
    });

    uvMapRenderTarget = new THREE.WebGLRenderTarget(renderer.domElement.width, renderer.domElement.height, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat,
        type: THREE.HalfFloatType,
        depthBuffer: true,
        stencilBuffer: false
    });

    // --- NEW: Screen-Space Normalized Depth Target ---
    screenNormalizedDepthTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat,
        type: THREE.HalfFloatType
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

    layerMaskTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, defaultTargetOptions);
    
    const inpaintedTargetOptions = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat };
    fgInpaintedTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, inpaintedTargetOptions);
    bgInpaintedTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, inpaintedTargetOptions);
    
    finalInpaintedTextureTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, finalInpaintTargetOptions);
    finalRenderPassTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, finalInpaintTargetOptions);

    const standardPPOptions = { transparent: false, blending: THREE.NoBlending, depthTest: false, depthWrite: false };

    // --- FXAA Setup ---
    const FXAAShader = {
        uniforms: {
            'tDiffuse': { value: null },
            'resolution': { value: new THREE.Vector2(1.0 / renderer.domElement.width, 1.0 / renderer.domElement.height) }
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position, 1.0 ); }`,
        fragmentShader: `
            uniform sampler2D tDiffuse; uniform vec2 resolution; varying vec2 vUv;
            #define FXAA_REDUCE_MIN (1.0/128.0)
            #define FXAA_REDUCE_MUL (1.0/8.0)
            #define FXAA_SPAN_MAX 8.0
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
                vec2 dir; dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE)); dir.y = ((lumaNW + lumaSW) - (lumaNE + lumaSE));
                float dirReduce = max( ( lumaNW + lumaNE + lumaSW + lumaSE ) * ( 0.25 * FXAA_REDUCE_MUL ), FXAA_REDUCE_MIN );
                float rcpDirMin = 1.0 / ( min( abs( dir.x ), abs( dir.y ) ) + dirReduce );
                dir = min( vec2( FXAA_SPAN_MAX, FXAA_SPAN_MAX ), max( vec2( -FXAA_SPAN_MAX, -FXAA_SPAN_MAX ), dir * rcpDirMin ) ) * resolution;
                vec3 rgbA = (1.0/2.0) * ( texture2D( tDiffuse, vUv + dir * ( 1.0 / 3.0 - 0.5 ) ).xyz + texture2D( tDiffuse, vUv + dir * ( 2.0 / 3.0 - 0.5 ) ).xyz );
                vec3 rgbB = rgbA * (1.0/2.0) + (1.0/4.0) * ( texture2D( tDiffuse, vUv + dir * ( 0.0 / 3.0 - 0.5 ) ).xyz + texture2D( tDiffuse, vUv + dir * ( 3.0 / 3.0 - 0.5 ) ).xyz );
                float lumaB = dot( rgbB, vec3( 0.299, 0.587, 0.114 ) );
                if ( ( lumaB < lumaMin ) || ( lumaB > lumaMax ) ) { gl_FragColor = vec4( rgbA, rgbaM.a ); } else { gl_FragColor = vec4( rgbB, rgbaM.a ); }
            }`
    };

    fxaaMaterial = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms),
        vertexShader: FXAAShader.vertexShader,
        fragmentShader: FXAAShader.fragmentShader,
        ...standardPPOptions
    });

    sharpenTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, finalInpaintTargetOptions);
    sharpenMaterial = new THREE.ShaderMaterial({
        uniforms: {
            'tDiffuse': { value: null },
            'resolution': { value: new THREE.Vector2(1.0 / renderer.domElement.width, 1.0 / renderer.domElement.height) },
            'u_strength': { value: sharpenStrength }
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position, 1.0 ); }`,
        fragmentShader: `
            uniform sampler2D tDiffuse; uniform vec2 resolution; uniform float u_strength; varying vec2 vUv;
            void main() {
                vec4 center = texture2D(tDiffuse, vUv);
                vec4 n = texture2D(tDiffuse, vUv + vec2(0.0, resolution.y));
                vec4 s = texture2D(tDiffuse, vUv - vec2(0.0, resolution.y));
                vec4 e = texture2D(tDiffuse, vUv + vec2(resolution.x, 0.0));
                vec4 w = texture2D(tDiffuse, vUv - vec2(resolution.x, 0.0));
                vec4 sharpened = 5.0 * center - (n + s + e + w);
                gl_FragColor = mix(center, sharpened, u_strength);
                gl_FragColor.a = center.a;
            }`,
        ...standardPPOptions 
    });

    initializePyramidTargets(canvasWidth, canvasHeight);

    postProcessCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    postProcessScene = new THREE.Scene();
    const postProcessPlane = new THREE.PlaneGeometry(2, 2);

    // --- Utility Materials ---
    lumaMaterial = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv; void main() { vec3 color = texture2D(tDiffuse, vUv).rgb; float luma = dot(color, vec3(0.299, 0.587, 0.114)); gl_FragColor = vec4(vec3(luma), 1.0); }`, ...standardPPOptions });
    sobelEdgeMaterial = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, u_resolution: { value: new THREE.Vector2(canvasWidth, canvasHeight) }, u_threshold: { value: 0.1 } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 u_resolution; uniform float u_threshold; varying vec2 vUv; float getSample(vec2 offset) { return texture2D(tDiffuse, vUv + offset).r; } void main() { vec2 texel = 1.0 / u_resolution; float gx = -1.0 * getSample(vec2(-texel.x, -texel.y)) + 1.0 * getSample(vec2(texel.x, -texel.y)) + -2.0 * getSample(vec2(-texel.x, 0.0)) + 2.0 * getSample(vec2(texel.x, 0.0)) + -1.0 * getSample(vec2(-texel.x, texel.y)) + 1.0 * getSample(vec2(texel.x, texel.y)); float gy = -1.0 * getSample(vec2(-texel.x, -texel.y)) + -2.0 * getSample(vec2(0.0, -texel.y)) + -1.0 * getSample(vec2(texel.x, -texel.y)) + 1.0 * getSample(vec2(-texel.x, texel.y)) + 2.0 * getSample(vec2(0.0, texel.y)) + 1.0 * getSample(vec2(texel.x, texel.y)); float magnitude = sqrt(gx * gx + gy * gy); float edge = step(u_threshold, magnitude); if (getSample(vec2(0.0)) < 0.001) gl_FragColor = vec4(0.0); else gl_FragColor = vec4(vec3(edge), 1.0); }`, ...standardPPOptions });
    combineEdgesMaterial = new THREE.ShaderMaterial({ uniforms: { tEdge1: { value: null }, tEdge2: { value: null } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, fragmentShader: `uniform sampler2D tEdge1; uniform sampler2D tEdge2; varying vec2 vUv; void main() { float edge1 = texture2D(tEdge1, vUv).r; float edge2 = texture2D(tEdge2, vUv).r; gl_FragColor = vec4(vec3(max(edge1, edge2)), 1.0); }`, ...standardPPOptions });
    legacyEdgeMaskMaterial = new THREE.ShaderMaterial({ uniforms: { tDepth: { value: null }, u_displacementGapThreshold: { value: currentDisplacementGapThreshold }, u_resolution: { value: new THREE.Vector2(canvasWidth, canvasHeight) } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, fragmentShader: `#extension GL_OES_standard_derivatives : enable\n uniform sampler2D tDepth; uniform float u_displacementGapThreshold; varying vec2 vUv; void main() { float centerDepth = texture2D(tDepth, vUv).r; if (centerDepth < 0.001) { gl_FragColor = vec4(0.0); return; } float depthDerivativeX = abs(dFdx(centerDepth)); float depthDerivativeY = abs(dFdy(centerDepth)); if (max(depthDerivativeX, depthDerivativeY) > u_displacementGapThreshold) { gl_FragColor = vec4(1.0); } else { gl_FragColor = vec4(0.0); } }`, ...standardPPOptions });
    gaussianBlurMaterial = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, u_resolution: { value: new THREE.Vector2(canvasWidth, canvasHeight) }, u_direction: { value: new THREE.Vector2(1, 0) } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 u_resolution; uniform vec2 u_direction; varying vec2 vUv; void main() { vec4 sum = vec4(0.0); vec2 tc = vUv; vec2 texel = 1.0 / u_resolution; float kernel[5]; kernel[0] = 0.06136; kernel[1] = 0.24477; kernel[2] = 0.38774; kernel[3] = 0.24477; kernel[4] = 0.06136; sum += texture2D(tDiffuse, tc - 2.0 * texel * u_direction) * kernel[0]; sum += texture2D(tDiffuse, tc - 1.0 * texel * u_direction) * kernel[1]; sum += texture2D(tDiffuse, tc) * kernel[2]; sum += texture2D(tDiffuse, tc + 1.0 * texel * u_direction) * kernel[3]; sum += texture2D(tDiffuse, tc + 2.0 * texel * u_direction) * kernel[4]; gl_FragColor = sum; }`, ...standardPPOptions });
    sobelGradientMaterial = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, u_resolution: { value: new THREE.Vector2(canvasWidth, canvasHeight) } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 u_resolution; varying vec2 vUv; float getSample(vec2 offset) { return texture2D(tDiffuse, vUv + offset).r; } void main() { vec2 texel = 1.0 / u_resolution; float gx = -1.0 * getSample(vec2(-texel.x, -texel.y)) + 1.0 * getSample(vec2(texel.x, -texel.y)) + -2.0 * getSample(vec2(-texel.x, 0.0)) + 2.0 * getSample(vec2(texel.x, 0.0)) + -1.0 * getSample(vec2(-texel.x, texel.y)) + 1.0 * getSample(vec2(texel.x, texel.y)); float gy = -1.0 * getSample(vec2(-texel.x, -texel.y)) + -2.0 * getSample(vec2(0.0, -texel.y)) + -1.0 * getSample(vec2(texel.x, -texel.y)) + 1.0 * getSample(vec2(-texel.x, texel.y)) + 2.0 * getSample(vec2(0.0, texel.y)) + 1.0 * getSample(vec2(texel.x, texel.y)); float magnitude = sqrt(gx * gx + gy * gy); float direction = atan(gy, gx); gl_FragColor = vec4(magnitude, direction, 0.0, 1.0); }`, ...standardPPOptions });
    nmsMaterial = new THREE.ShaderMaterial({ uniforms: { tGradient: { value: null }, u_resolution: { value: new THREE.Vector2(canvasWidth, canvasHeight) } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, fragmentShader: `uniform sampler2D tGradient; uniform vec2 u_resolution; varying vec2 vUv; const float PI = 3.14159265; void main() { vec2 texel = 1.0 / u_resolution; vec4 center = texture2D(tGradient, vUv); float mag = center.r; float dir = center.g; vec2 offset1, offset2; if (dir > -PI*0.125 && dir <= PI*0.125) { offset1 = vec2(1,0)*texel; offset2 = vec2(-1,0)*texel; } else if (dir > PI*0.125 && dir <= PI*0.375) { offset1 = vec2(1,1)*texel; offset2 = vec2(-1,-1)*texel; } else if (dir > PI*0.375 && dir <= PI*0.625) { offset1 = vec2(0,1)*texel; offset2 = vec2(0,-1)*texel; } else if (dir > PI*0.625 && dir <= PI*0.875) { offset1 = vec2(-1,1)*texel; offset2 = vec2(1,-1)*texel; } else if (dir > PI*0.875 || dir <= -PI*0.875){ offset1 = vec2(-1,0)*texel; offset2 = vec2(1,0)*texel; } else if (dir > -PI*0.875 && dir <= -PI*0.625){ offset1 = vec2(-1,-1)*texel; offset2 = vec2(1,1)*texel; } else if (dir > -PI*0.625 && dir <= -PI*0.375){ offset1 = vec2(0,-1)*texel; offset2 = vec2(0,1)*texel; } else { offset1 = vec2(1,-1)*texel; offset2 = vec2(-1,1)*texel; } float mag1 = texture2D(tGradient, vUv + offset1).r; float mag2 = texture2D(tGradient, vUv + offset2).r; if (mag >= mag1 && mag >= mag2) { gl_FragColor = vec4(vec3(mag), 1.0); } else { gl_FragColor = vec4(0.0); } }`, ...standardPPOptions });
    hysteresisMaterial = new THREE.ShaderMaterial({ uniforms: { tNMS: { value: null }, u_resolution: { value: new THREE.Vector2(canvasWidth, canvasHeight) }, u_lowThreshold: { value: 0.02 }, u_highThreshold: { value: 0.1 } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, fragmentShader: `uniform sampler2D tNMS; uniform vec2 u_resolution; uniform float u_lowThreshold; uniform float u_highThreshold; varying vec2 vUv; void main() { float centerMag = texture2D(tNMS, vUv).r; if (centerMag < u_lowThreshold) { gl_FragColor = vec4(0.0); return; } if (centerMag > u_highThreshold) { gl_FragColor = vec4(1.0); return; } vec2 texel = 1.0 / u_resolution; for (int i = -1; i <= 1; i++) { for (int j = -1; j <= 1; j++) { if (i == 0 && j == 0) continue; if (texture2D(tNMS, vUv + vec2(i, j) * texel).r > u_highThreshold) { gl_FragColor = vec4(1.0); return; } } } gl_FragColor = vec4(0.0); }`, ...standardPPOptions });
    edgeDilationMaterial = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, u_resolution: { value: new THREE.Vector2(canvasWidth, canvasHeight) }, u_radius: { value: 1.5 } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 u_resolution; uniform float u_radius; varying vec2 vUv; void main() { vec2 texel = 1.0 / u_resolution; float maxVal = 0.0; for (float i = -u_radius; i <= u_radius; i += 1.0) { for (float j = -u_radius; j <= u_radius; j += 1.0) { vec2 offset = vec2(i, j) * texel; maxVal = max(maxVal, texture2D(tDiffuse, vUv + offset).r); } } gl_FragColor = vec4(vec3(maxVal), 1.0); }`, ...standardPPOptions });
    stabilizedEdgeMaskTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, defaultTargetOptions);
    prevEdgeMaskTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, defaultTargetOptions);
    temporalStabilizeMaterial = new THREE.ShaderMaterial({ uniforms: { 'tCurrentMask': { value: null }, 'tPreviousMask': { value: null }, 'u_feedback': { value: temporalFeedback }, 'u_maskUsesAlpha': { value: false } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position, 1.0 ); }`, fragmentShader: `uniform sampler2D tCurrentMask; uniform sampler2D tPreviousMask; uniform float u_feedback; uniform bool u_maskUsesAlpha; varying vec2 vUv; void main() { float currentMask; if (u_maskUsesAlpha) { currentMask = 1.0 - texture2D(tCurrentMask, vUv).a; } else { currentMask = texture2D(tCurrentMask, vUv).r; } float prevMask = texture2D(tPreviousMask, vUv).r; float blendedMask = mix(currentMask, prevMask, u_feedback); float stabilizedMask = max(currentMask, blendedMask); gl_FragColor = vec4(vec3(stabilizedMask), 1.0); }`, ...standardPPOptions });
    
    // --- JFA Materials ---
    jfaSeedMaterial = new THREE.ShaderMaterial({ uniforms: { tDepth: { value: null }, tEdgeMask: { value: null }, u_seedDensity: { value: 0.25 }, u_seedSize: { value: 1.0 }, u_resolution: { value: new THREE.Vector2(canvasWidth, canvasHeight) }, u_maskUsesAlpha: { value: false } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, fragmentShader: `uniform sampler2D tDepth; uniform sampler2D tEdgeMask; uniform float u_seedDensity; uniform float u_seedSize; uniform vec2 u_resolution; uniform bool u_maskUsesAlpha; varying vec2 vUv; float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); } void main() { float maskValue = u_maskUsesAlpha ? (1.0 - texture2D(tEdgeMask, vUv).a) : texture2D(tEdgeMask, vUv).r; bool isGap = maskValue > 0.5; if (isGap) { gl_FragColor = vec4(0.0, 0.0, 9999.0, 0.0); return; } vec2 blockCoord = floor(gl_FragCoord.xy / u_seedSize); if (hash(blockCoord) < u_seedDensity) { vec2 blockCenterPixel = (blockCoord + 0.5) * u_seedSize; vec2 blockCenterUv = blockCenterPixel / u_resolution; float centerMaskValue = u_maskUsesAlpha ? (1.0 - texture2D(tEdgeMask, blockCenterUv).a) : texture2D(tEdgeMask, blockCenterUv).r; bool centerIsGap = centerMaskValue > 0.5; if (centerIsGap) { gl_FragColor = vec4(0.0, 0.0, 9999.0, 0.0); return; } float depth = texture2D(tDepth, blockCenterUv).r; gl_FragColor = vec4(blockCenterUv, depth, 1.0); } else { gl_FragColor = vec4(0.0, 0.0, 9999.0, 0.0); } }`, ...standardPPOptions });
    jfaFloodMaterial = new THREE.ShaderMaterial({ uniforms: { tJFA: { value: null }, u_resolution: { value: new THREE.Vector2(canvasWidth, canvasHeight) }, u_step: { value: 0.0 } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, fragmentShader: `uniform sampler2D tJFA; uniform vec2 u_resolution; uniform float u_step; varying vec2 vUv; void main() { vec4 bestData = texture2D(tJFA, vUv); for (int i = -1; i <= 1; i++) { for (int j = -1; j <= 1; j++) { if (i == 0 && j == 0) continue; vec2 neighborUv = vUv + vec2(float(i), float(j)) * u_step / u_resolution; vec4 neighborData = texture2D(tJFA, neighborUv); if (neighborData.w > 0.5) { float distToNeighborSource = distance(vUv, neighborData.xy); float myDist = (bestData.w > 0.5) ? distance(vUv, bestData.xy) : 9999.0; if (distToNeighborSource < myDist) { bestData = neighborData; } } } } gl_FragColor = bestData; }`, ...standardPPOptions });
    jfaResolveMaterial = new THREE.ShaderMaterial({ uniforms: { tJFA: { value: null }, tDiffuse: { value: null }, tOriginalDepth: { value: null }, tEdgeMask: { value: null }, tGapTargetDepth: { value: null }, u_projectionMatrixInverse: { value: new THREE.Matrix4() }, u_linearDepthTolerance: { value: 0.03 }, u_useBackgroundBias: { value: true }, u_resolution: { value: new THREE.Vector2(canvasWidth, canvasHeight) }, u_maskUsesAlpha: { value: false } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, fragmentShader: `uniform sampler2D tJFA; uniform sampler2D tDiffuse; uniform sampler2D tOriginalDepth; uniform sampler2D tEdgeMask; uniform sampler2D tGapTargetDepth; uniform mat4 u_projectionMatrixInverse; uniform float u_linearDepthTolerance; uniform bool u_useBackgroundBias; uniform bool u_maskUsesAlpha; varying vec2 vUv; void main() { float maskValue = u_maskUsesAlpha ? (1.0 - texture2D(tEdgeMask, vUv).a) : texture2D(tEdgeMask, vUv).r; bool isGap = maskValue > 0.5; if (!isGap) discard; vec4 jfaData = texture2D(tJFA, vUv); if (jfaData.w < 0.5) discard; float sourceNormDepth = jfaData.z; if (u_useBackgroundBias) { float targetNormDepth = texture2D(tGapTargetDepth, vUv).r; if (abs(sourceNormDepth - targetNormDepth) > u_linearDepthTolerance) { discard; } } else { float gapNormDepth = texture2D(tOriginalDepth, vUv).r; if (sourceNormDepth > gapNormDepth + u_linearDepthTolerance) { discard; } } gl_FragColor = texture2D(tDiffuse, jfaData.xy); }`, ...standardPPOptions });

    // --- Gap Target Depth Material ---
    // Computes expected background depth for each gap pixel by finding max depth of neighbors
    // Supports iterative mode where it can sample from previously computed gap depths
    sdGapDepthEstimatorMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tEdgeMask: { value: null },
            tDepth: { value: null },
            tPreviousGapDepth: { value: null },  // For iterative propagation
            u_resolution: { value: new THREE.Vector2(canvasWidth, canvasHeight) },
            u_maskUsesAlpha: { value: true },
            u_searchRadius: { value: 8.0 },
            u_useIterative: { value: false }  // Enable sampling from previous pass
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tEdgeMask;
            uniform sampler2D tDepth;
            uniform sampler2D tPreviousGapDepth;
            uniform vec2 u_resolution;
            uniform bool u_maskUsesAlpha;
            uniform float u_searchRadius;
            uniform bool u_useIterative;
            varying vec2 vUv;
            
            void main() {
                // Check if this is a gap pixel
                float maskValue = u_maskUsesAlpha ? (1.0 - texture2D(tEdgeMask, vUv).a) : texture2D(tEdgeMask, vUv).r;
                bool isGap = maskValue > 0.5;
                
                if (!isGap) {
                    // Not a gap - output current depth with alpha=1 (valid)
                    float depth = texture2D(tDepth, vUv).r;
                    gl_FragColor = vec4(depth, depth, 0.0, 1.0);
                    return;
                }
                
                // Check if we already have a computed depth from previous pass
                if (u_useIterative) {
                    vec4 prevData = texture2D(tPreviousGapDepth, vUv);
                    if (prevData.a > 0.5) {
                        // Already filled - keep it
                        gl_FragColor = prevData;
                        return;
                    }
                }
                
                // Search neighbors for background depth (max depth = farthest = background)
                vec2 pixelSize = 1.0 / u_resolution;
                float maxDepth = 0.0;
                float minDepth = 1.0;
                bool foundValidNeighbor = false;
                
                // Search in expanding rings
                for (float r = 1.0; r <= u_searchRadius; r += 1.0) {
                    for (float angle = 0.0; angle < 6.28318; angle += 0.7854) { // 8 samples per ring
                        vec2 offset = vec2(cos(angle), sin(angle)) * r * pixelSize;
                        vec2 sampleUV = vUv + offset;
                        
                        if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) continue;
                        
                        // Check if neighbor is NOT a gap (has valid geometry depth)
                        float neighborMask = u_maskUsesAlpha ? (1.0 - texture2D(tEdgeMask, sampleUV).a) : texture2D(tEdgeMask, sampleUV).r;
                        bool neighborIsGap = neighborMask > 0.5;
                        
                        if (!neighborIsGap) {
                            float neighborDepth = texture2D(tDepth, sampleUV).r;
                            if (neighborDepth < 0.9999) { // Valid depth
                                foundValidNeighbor = true;
                                maxDepth = max(maxDepth, neighborDepth);
                                minDepth = min(minDepth, neighborDepth);
                            }
                        } else if (u_useIterative) {
                            // In iterative mode, also sample from previously filled gaps
                            vec4 neighborPrev = texture2D(tPreviousGapDepth, sampleUV);
                            if (neighborPrev.a > 0.5) {
                                foundValidNeighbor = true;
                                maxDepth = max(maxDepth, neighborPrev.r);
                                minDepth = min(minDepth, neighborPrev.r);
                            }
                        }
                    }
                    
                    // Stop early if we found valid neighbors in this ring
                    if (foundValidNeighbor) break;
                }
                
                // Output: R=maxDepth (BG), G=minDepth (FG), B=0, A=validity
                if (foundValidNeighbor) {
                    gl_FragColor = vec4(maxDepth, minDepth, 0.0, 1.0);
                } else {
                    // No valid neighbors found - mark as unfilled (alpha=0)
                    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
                }
            }
        `,
        depthWrite: false,
        depthTest: false
    });
    
    // --- Pull-Push for Gap Depth (Background-Biased) ---
    // Pull: Downsample with weighted average favoring smaller depths (background in normalized space)
    // In normalized depth: 0=far (background), 1=near (foreground)
    gapDepthPullMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tFinerLevel: { value: null },
            u_texelSize: { value: new THREE.Vector2() },
            u_maxBias: { value: 1.0 } // 0 = pure average, 1 = pure min (background)
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tFinerLevel;
            uniform vec2 u_texelSize;
            uniform float u_maxBias;
            varying vec2 vUv;
            
            void main() {
                vec2 offset = u_texelSize * 0.5;
                
                vec4 c1 = texture2D(tFinerLevel, vUv + vec2(-offset.x, -offset.y));
                vec4 c2 = texture2D(tFinerLevel, vUv + vec2( offset.x, -offset.y));
                vec4 c3 = texture2D(tFinerLevel, vUv + vec2(-offset.x,  offset.y));
                vec4 c4 = texture2D(tFinerLevel, vUv + vec2( offset.x,  offset.y));
                
                // Collect valid samples - use MIN depth for background (smaller = farther in normalized space)
                float minDepth = 1.0;
                float avgDepth = 0.0;
                float totalValidity = 0.0;
                
                if (c1.a > 0.01) { minDepth = min(minDepth, c1.r); avgDepth += c1.r * c1.a; totalValidity += c1.a; }
                if (c2.a > 0.01) { minDepth = min(minDepth, c2.r); avgDepth += c2.r * c2.a; totalValidity += c2.a; }
                if (c3.a > 0.01) { minDepth = min(minDepth, c3.r); avgDepth += c3.r * c3.a; totalValidity += c3.a; }
                if (c4.a > 0.01) { minDepth = min(minDepth, c4.r); avgDepth += c4.r * c4.a; totalValidity += c4.a; }
                
                if (totalValidity > 0.01) {
                    avgDepth /= totalValidity;
                    // Blend between average and min (background) based on bias
                    float finalDepth = mix(avgDepth, minDepth, u_maxBias);
                    gl_FragColor = vec4(finalDepth, finalDepth, 0.0, min(totalValidity / 4.0, 1.0));
                } else {
                    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
                }
            }
        `,
        depthWrite: false,
        depthTest: false
    });
    
    // Push: Simple gap filling - use finer where valid, coarse for gaps
    gapDepthPushMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tCurrentLevel: { value: null },
            tCoarserLevel: { value: null }
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tCurrentLevel;
            uniform sampler2D tCoarserLevel;
            varying vec2 vUv;
            
            void main() {
                vec4 currentData = texture2D(tCurrentLevel, vUv);
                vec4 coarseData = texture2D(tCoarserLevel, vUv);
                
                // Simple: use finer where valid, coarse for gaps
                if (currentData.a > 0.5) {
                    gl_FragColor = currentData;
                } else if (coarseData.a > 0.01) {
                    gl_FragColor = vec4(coarseData.r, coarseData.r, 0.0, coarseData.a);
                } else {
                    gl_FragColor = vec4(0.0);
                }
            }
        `,
        depthWrite: false,
        depthTest: false
    });
    
    // (Old iterative fgSubtractionMaterial removed — replaced by runFGSubtraction(),
    //  the local rim-depth method. See its header comment for the algorithm.)

    
    // Seed material: Creates initial gap depth texture from screen depth + edge mask
    // CRITICAL: Excludes gaps AND pixels on the NEAR side of depth discontinuities (FG at edges)
    // Uses dilation to extend FG exclusion zone
    gapDepthSeedMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tDepth: { value: null },
            tEdgeMask: { value: null },
            tLayerMask: { value: null },
            u_maskUsesAlpha: { value: true },
            u_texelSize: { value: new THREE.Vector2() },
            u_depthEdgeThreshold: { value: 0.02 }  // Depth discontinuity threshold
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tDepth;
            uniform sampler2D tEdgeMask;
            uniform sampler2D tLayerMask;
            uniform bool u_maskUsesAlpha;
            uniform vec2 u_texelSize;
            uniform float u_depthEdgeThreshold;
            varying vec2 vUv;
            
            bool isGapAt(vec2 uv, sampler2D depth, sampler2D mask) {
                float maskVal = u_maskUsesAlpha ? (1.0 - texture2D(mask, uv).a) : texture2D(mask, uv).r;
                vec4 d = texture2D(depth, uv);
                return maskVal > 0.5 || d.a < 0.5;
            }
            
            void main() {
                vec4 depthSample = texture2D(tDepth, vUv);
                float myDepth = depthSample.r;
                
                // Check if THIS pixel is a gap
                if (isGapAt(vUv, tDepth, tEdgeMask)) {
                    gl_FragColor = vec4(0.0);
                    return;
                }
                
                // Find the MINIMUM depth (furthest/background) in a larger neighborhood
                float minDepthInRegion = myDepth;
                float radius = 3.0;
                for (float dy = -radius; dy <= radius; dy++) {
                    for (float dx = -radius; dx <= radius; dx++) {
                        vec2 neighborUV = vUv + vec2(dx, dy) * u_texelSize;
                        vec4 neighborDepth = texture2D(tDepth, neighborUV);
                        // Only consider valid non-gap pixels
                        if (neighborDepth.a > 0.5 && !isGapAt(neighborUV, tDepth, tEdgeMask)) {
                            minDepthInRegion = min(minDepthInRegion, neighborDepth.r);
                        }
                    }
                }
                
                // In normalized depth: high = close = FG, low = far = BG
                // If we're much HIGHER (closer) than the background in our region, we're FG
                bool isForeground = (myDepth - minDepthInRegion) > u_depthEdgeThreshold;
                
                if (isForeground) {
                    gl_FragColor = vec4(0.0);  // Exclude FG
                } else {
                    gl_FragColor = vec4(myDepth, myDepth, 0.0, 1.0);
                }
            }
        `,
        depthWrite: false,
        depthTest: false
    });


    dilationMaterial = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, tOriginalDepth: { value: null }, u_resolution: { value: new THREE.Vector2(canvasWidth, canvasHeight) } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, fragmentShader: `uniform sampler2D tDiffuse; uniform sampler2D tOriginalDepth; uniform vec2 u_resolution; varying vec2 vUv; void main() { vec4 centerColor = texture2D(tDiffuse, vUv); if (centerColor.a > 0.01) { gl_FragColor = centerColor; return; } float minDepth = 2.0; vec4 finalColor = vec4(0.0); vec2 pixelSize = 1.0 / u_resolution; const int KERNEL_SIZE = 1; for (int i = -KERNEL_SIZE; i <= KERNEL_SIZE; i++) { for (int j = -KERNEL_SIZE; j <= KERNEL_SIZE; j++) { if (i == 0 && j == 0) continue; vec2 offsetUv = vUv + vec2(float(i), float(j)) * pixelSize; vec4 neighborColor = texture2D(tDiffuse, offsetUv); if (neighborColor.a > 0.01) { float neighborDepth = texture2D(tOriginalDepth, offsetUv).r; if (neighborDepth < minDepth) { minDepth = neighborDepth; finalColor = neighborColor; } } } } gl_FragColor = finalColor; }`, ...standardPPOptions });
    copyMaterial = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv; void main() { gl_FragColor = texture2D(tDiffuse, vUv); }`, ...standardPPOptions });
    normalizeDepthMaterial = new THREE.ShaderMaterial({ uniforms: { tDepth: { value: null }, u_projectionMatrixInverse: { value: new THREE.Matrix4() }, u_normalizationRange: { value: depthContrastRange } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, fragmentShader: `uniform sampler2D tDepth; uniform mat4 u_projectionMatrixInverse; uniform float u_normalizationRange; varying vec2 vUv; void main() { float z = texture2D(tDepth, vUv).r; if (z >= 1.0) { gl_FragColor = vec4(vec3(0.0), 1.0); return; } vec4 clipSpacePos = vec4(vUv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0); vec4 viewSpacePos = u_projectionMatrixInverse * clipSpacePos; viewSpacePos.xyz /= viewSpacePos.w; float linearDepth = abs(viewSpacePos.z); float normalizedZ = 1.0 - smoothstep(0.0, u_normalizationRange, linearDepth); gl_FragColor = vec4(vec3(normalizedZ), 1.0); }`, ...standardPPOptions });

    // --- Pull-Push Materials ---
    maskGeneratorMaterial = new THREE.ShaderMaterial({ 
        uniforms: { 
            tDiffuse: { value: null }, 
            tEdgeMask: { value: null }, 
            tLayerMask: { value: null }, 
            tSceneDepth: { value: null },
            tExpandedGapMask: { value: null },  // From FG subtraction: A=1 means gap or FG occluder
            u_useExpandedMask: { value: false }, // GATE: tExpandedGapMask alpha is only meaningful
                                                 // when FG subtraction actually ran. Other textures
                                                 // (e.g. screenNormalizedDepthTarget) use A=1 for
                                                 // VALID — the inverted meaning — so never read
                                                 // them as an exclusion mask.
            u_maskChannel: { value: 0 }, 
            u_maskUsesAlpha: { value: false },
            u_texelSize: { value: new THREE.Vector2() }
        }, 
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, 
        fragmentShader: `
            uniform sampler2D tDiffuse; 
            uniform sampler2D tEdgeMask; 
            uniform sampler2D tLayerMask; 
            uniform sampler2D tSceneDepth;
            uniform sampler2D tExpandedGapMask;
            uniform bool u_useExpandedMask;
            uniform int u_maskChannel; 
            uniform bool u_maskUsesAlpha;
            uniform vec2 u_texelSize;
            varying vec2 vUv;
            
            void main() { 
                vec4 color = texture2D(tDiffuse, vUv);
                vec4 depthSample = texture2D(tSceneDepth, vUv);
                float depthAlpha = depthSample.a;
                
                // Original gap detection (for fallback)
                float isOriginalGap;
                if (u_maskUsesAlpha) {
                    isOriginalGap = 1.0 - color.a;
                } else {
                    isOriginalGap = texture2D(tEdgeMask, vUv).r;
                }
                if (depthAlpha < 0.5) isOriginalGap = 1.0;
                
                // Check expanded gap mask (from FG subtraction)
                // A=1 means this pixel should be excluded (gap or FG occluder)
                // ONLY meaningful when u_useExpandedMask is set (see uniform comment)
                bool isInExpandedMask = false;
                if (u_useExpandedMask) {
                    vec4 gapMaskSample = texture2D(tExpandedGapMask, vUv);
                    isInExpandedMask = gapMaskSample.a > 0.5;
                }
                
                // Use expanded mask if available, otherwise fall back to original gap detection
                bool isUnknownPixel = isInExpandedMask || (isOriginalGap > 0.5);
                
                float isUnknown;
                if (u_maskChannel < 0) {
                    isUnknown = isUnknownPixel ? 1.0 : 0.0;
                } else {
                    vec2 layerMask = texture2D(tLayerMask, vUv).rg;
                    float isTargetLayer;
                    float isOtherLayer;
                    if (u_maskChannel == 0) {
                        isTargetLayer = layerMask.r;
                        isOtherLayer = layerMask.g;
                    } else {
                        isTargetLayer = layerMask.g;
                        isOtherLayer = layerMask.r;
                    }
                    isUnknown = isUnknownPixel ? step(0.5, isTargetLayer) : 0.0;
                    if (isOtherLayer > 0.5) {
                        color.a = 0.0;
                        color.rgb = vec3(0.0);
                    }
                }
                
                color.a = min(color.a, 1.0 - isUnknown);
                if (!u_maskUsesAlpha) {
                    color.rgb *= (1.0 - isUnknown);
                }
                gl_FragColor = color;
            }`,
        ...standardPPOptions 
    });
    pullMaterial = new THREE.ShaderMaterial({ uniforms: { tFinerLevel: { value: null }, u_texelSize: { value: new THREE.Vector2() } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, fragmentShader: `uniform sampler2D tFinerLevel; uniform vec2 u_texelSize; varying vec2 vUv; void main() { vec2 offset = u_texelSize * 0.5; vec4 c1 = texture2D(tFinerLevel, vUv + vec2(-offset.x, -offset.y)); vec4 c2 = texture2D(tFinerLevel, vUv + vec2( offset.x, -offset.y)); vec4 c3 = texture2D(tFinerLevel, vUv + vec2(-offset.x,  offset.y)); vec4 c4 = texture2D(tFinerLevel, vUv + vec2( offset.x,  offset.y)); float totalValidity = c1.a + c2.a + c3.a + c4.a; vec3 colorSum = c1.rgb * c1.a + c2.rgb * c2.a + c3.rgb * c3.a + c4.rgb * c4.a; if (totalValidity > 0.0001) { gl_FragColor.rgb = colorSum / totalValidity; gl_FragColor.a = totalValidity / 4.0; } else { gl_FragColor = vec4(0.0); } }`, ...standardPPOptions });
    pushMaterial = new THREE.ShaderMaterial({ uniforms: { tCurrentLevel: { value: null }, tCoarserLevel: { value: null } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, fragmentShader: `uniform sampler2D tCurrentLevel; uniform sampler2D tCoarserLevel; varying vec2 vUv; void main() { vec4 currentData = texture2D(tCurrentLevel, vUv); float useCurrent = step(0.001, currentData.a); vec4 coarseData = texture2D(tCoarserLevel, vUv); vec3 finalColor = mix(coarseData.rgb, currentData.rgb, useCurrent); float finalValidity = max(currentData.a, coarseData.a); gl_FragColor = vec4(finalColor, finalValidity); }`, ...standardPPOptions });
    
    // Depth-aware push that rejects FG pixels at occlusion boundaries
    pushMaterialDepthAware = new THREE.ShaderMaterial({ 
        uniforms: { 
            tCurrentLevel: { value: null }, 
            tCoarserLevel: { value: null },
            tSceneDepth: { value: null },
            tGapTargetDepth: { value: null },
            u_depthThreshold: { value: 0.05 }
        }, 
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, 
        fragmentShader: `
            uniform sampler2D tCurrentLevel; 
            uniform sampler2D tCoarserLevel;
            uniform sampler2D tSceneDepth;
            uniform sampler2D tGapTargetDepth;
            uniform float u_depthThreshold;
            varying vec2 vUv;
            
            void main() { 
                vec4 currentData = texture2D(tCurrentLevel, vUv); 
                vec4 coarseData = texture2D(tCoarserLevel, vUv);
                
                // Get depths
                float sceneDepth = texture2D(tSceneDepth, vUv).r;
                float gapTarget = texture2D(tGapTargetDepth, vUv).r;
                
                // Check if current pixel is foreground at an occlusion boundary
                // If scene depth is much HIGHER (closer) than gap target (background), reject it
                bool isForegroundOccluder = (sceneDepth - gapTarget) > u_depthThreshold;
                
                // Use current if valid AND not a foreground occluder
                float useCurrent = step(0.001, currentData.a) * (isForegroundOccluder ? 0.0 : 1.0);
                
                vec3 finalColor = mix(coarseData.rgb, currentData.rgb, useCurrent); 
                float finalValidity = max(currentData.a, coarseData.a); 
                gl_FragColor = vec4(finalColor, finalValidity); 
            }`, 
        ...standardPPOptions 
    });
    
    // --- Improved Depth-Aware Pull with Gap Target Depth ---
    // Uses pre-computed gap target depth instead of averaging neighbor depths
    // Supports hard cutoff mode for crisp boundaries
    pullMaterialDepthAware = new THREE.ShaderMaterial({
        uniforms: {
            tFinerLevel: { value: null },
            tFinerDepth: { value: null },       // Scene depth
            tGapTargetDepth: { value: null },   // Pre-computed gap target depth (can be same as tFinerDepth if not available)
            tLayerMask: { value: null },
            u_maskChannel: { value: 0 },
            u_texelSize: { value: new THREE.Vector2() },
            u_depthTolerance: { value: 0.05 },
            u_depthWeightPower: { value: currentDepthWeightPower },
            u_fillKernelSize: { value: 3 },
            u_useHardCutoff: { value: false },
            u_useGapTargetDepth: { value: true }
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tFinerLevel;
            uniform sampler2D tFinerDepth;
            uniform sampler2D tGapTargetDepth;
            uniform sampler2D tLayerMask;
            uniform int u_maskChannel;
            uniform vec2 u_texelSize;
            uniform float u_depthTolerance;
            uniform float u_depthWeightPower;
            uniform int u_fillKernelSize;
            uniform bool u_useHardCutoff;
            uniform bool u_useGapTargetDepth;
            varying vec2 vUv;
            
            void main() {
                float kernelHalfSize = floor(float(u_fillKernelSize) * 0.5);
                float start = -kernelHalfSize;
                vec2 uvOffset = (mod(float(u_fillKernelSize), 2.0) == 0.0) ? u_texelSize * 0.5 : vec2(0.0);
                vec2 uv = vUv - uvOffset;
                float kernelEnd = (mod(float(u_fillKernelSize), 2.0) == 0.0) ? kernelHalfSize - 1.0 : kernelHalfSize;
                
                // Simple weighted average of valid neighbors
                vec3 colorSum = vec3(0.0);
                float totalWeight = 0.0;
                float totalAlpha = 0.0;
                float sampleCount = 0.0;
                
                for (float y = start; y <= kernelEnd; y++) {
                    for (float x = start; x <= kernelEnd; x++) {
                        vec2 offsetUV = uv + vec2(x, y) * u_texelSize;
                        vec4 neighbor = texture2D(tFinerLevel, offsetUV);
                        totalAlpha += neighbor.a;
                        sampleCount += 1.0;
                        
                        if (neighbor.a > 0.01) {
                            vec4 depthSample = texture2D(tFinerDepth, offsetUV);
                            if (depthSample.a < 0.5) continue; // Skip tunnel pixels
                            
                            float w = neighbor.a;
                            colorSum += neighbor.rgb * w;
                            totalWeight += w;
                        }
                    }
                }
                
                if (totalWeight > 0.0001) {
                    gl_FragColor.rgb = colorSum / totalWeight;
                    gl_FragColor.a = totalAlpha / sampleCount;
                } else {
                    gl_FragColor = vec4(0.0);
                }
            }`,
        ...standardPPOptions
    });

    layerMaskMaterial = new THREE.ShaderMaterial({
        uniforms: { tDepth: { value: null }, u_inpaintingSplitDepth_RAW: { value: 0.5 } },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `uniform sampler2D tDepth; uniform float u_inpaintingSplitDepth_RAW; varying vec2 vUv; void main() { float rawHardwareDepth = texture2D(tDepth, vUv).r; if (rawHardwareDepth < 0.001 || rawHardwareDepth >= 1.0) { gl_FragColor = vec4(0.0); return; } float isFG = 1.0 - step(u_inpaintingSplitDepth_RAW, rawHardwareDepth); float isBG = 1.0 - isFG; gl_FragColor = vec4(isFG, isBG, 0.0, 1.0); }`,
        ...standardPPOptions
    });

    finalCompositeMaterial = createFinalCompositeMaterial();

    debugEdgeMaskMaterial = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv; void main() { gl_FragColor = texture2D(tDiffuse, vUv); }`, ...standardPPOptions });
    
    // Debug: Show which pixels are excluded from COLOR pyramid
    // RED = FG occluder (depth >> gap target depth)
    // BLUE = gap pixels
    // GREEN = near gap but not FG occluder
    debugFGExclusionColorMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tDiffuse: { value: null },
            tEdgeMask: { value: null },
            tSceneDepth: { value: null },
            tGapTargetDepth: { value: null },
            u_maskUsesAlpha: { value: false },
            u_texelSize: { value: new THREE.Vector2() },
            u_fgOcclusionThreshold: { value: 0.05 }
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tDiffuse;
            uniform sampler2D tEdgeMask;
            uniform sampler2D tSceneDepth;
            uniform sampler2D tGapTargetDepth;
            uniform bool u_maskUsesAlpha;
            uniform vec2 u_texelSize;
            uniform float u_fgOcclusionThreshold;
            varying vec2 vUv;
            
            void main() {
                vec4 color = texture2D(tDiffuse, vUv);
                vec4 depthSample = texture2D(tSceneDepth, vUv);
                float myDepth = depthSample.r;
                float depthAlpha = depthSample.a;
                
                // Check if gap
                float isGap;
                if (u_maskUsesAlpha) {
                    isGap = 1.0 - color.a;
                } else {
                    isGap = texture2D(tEdgeMask, vUv).r;
                }
                if (depthAlpha < 0.5) isGap = 1.0;
                
                // Check if FG occluder
                vec4 gapTargetSample = texture2D(tGapTargetDepth, vUv);
                float gapTargetDepth = gapTargetSample.r;
                bool hasGapTarget = gapTargetSample.a > 0.1;
                
                bool isFGOccluder = false;
                if (hasGapTarget && depthAlpha > 0.5 && isGap < 0.5) {
                    float depthDiff = myDepth - gapTargetDepth;
                    if (depthDiff > u_fgOcclusionThreshold) {
                        isFGOccluder = true;
                    }
                }
                
                if (isGap > 0.5) {
                    // Gap pixels = blue
                    gl_FragColor = vec4(0.0, 0.0, 1.0, 1.0);
                } else if (isFGOccluder) {
                    // FG occluder = red overlay (this is the NEW case - entire FG objects over gaps)
                    gl_FragColor = vec4(mix(color.rgb, vec3(1.0, 0.0, 0.0), 0.7), 1.0);
                } else {
                    // Normal pixel
                    gl_FragColor = vec4(color.rgb, 1.0);
                }
            }
        `,
        ...standardPPOptions
    });
    
    // Debug: Show which pixels are excluded from DEPTH pyramid (near gaps)
    // Uses NORMALIZED depth (0=far/BG, 1=near/FG)
    debugFGExclusionDepthMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tDepth: { value: null },
            tEdgeMask: { value: null },
            u_maskUsesAlpha: { value: false },
            u_texelSize: { value: new THREE.Vector2() }
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tDepth;
            uniform sampler2D tEdgeMask;
            uniform bool u_maskUsesAlpha;
            uniform vec2 u_texelSize;
            varying vec2 vUv;
            
            bool isGapAt(vec2 uv) {
                float maskValue = u_maskUsesAlpha ? (1.0 - texture2D(tEdgeMask, uv).a) : texture2D(tEdgeMask, uv).r;
                vec4 depthSample = texture2D(tDepth, uv);
                return maskValue > 0.5 || depthSample.a < 0.5;
            }
            
            void main() {
                vec4 depthSample = texture2D(tDepth, vUv);
                float depth = depthSample.r;
                
                bool isGap = isGapAt(vUv);
                
                // Check if near a gap (dilated)
                bool isNearGap = false;
                if (!isGap) {
                    for (float dy = -2.0; dy <= 2.0; dy++) {
                        for (float dx = -2.0; dx <= 2.0; dx++) {
                            if (dx == 0.0 && dy == 0.0) continue;
                            vec2 neighborUV = vUv + vec2(dx, dy) * u_texelSize;
                            if (isGapAt(neighborUV)) {
                                isNearGap = true;
                                break;
                            }
                        }
                        if (isNearGap) break;
                    }
                }
                
                // Normalized depth: 0=far (dark), 1=near (bright)
                // Display as-is (near=white, far=black)
                
                if (isGap) {
                    // Gap pixels = blue
                    gl_FragColor = vec4(0.0, 0.0, 1.0, 1.0);
                } else if (isNearGap) {
                    // Excluded from depth pyramid = red overlay on depth
                    gl_FragColor = vec4(mix(vec3(depth), vec3(1.0, 0.0, 0.0), 0.7), 1.0);
                } else {
                    // Normal pixel - show depth as grayscale
                    gl_FragColor = vec4(vec3(depth), 1.0);
                }
            }
        `,
        ...standardPPOptions
    });
    debugJfaMaterial = new THREE.ShaderMaterial({ uniforms: { tJFA: { value: null } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, fragmentShader: `uniform sampler2D tJFA; varying vec2 vUv; vec3 hash3( vec2 p ) { vec3 q = vec3( dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3)), dot(p,vec2(419.2,751.9)) ); return fract(sin(q)*43758.5453); } void main() { vec4 jfaData = texture2D(tJFA, vUv); if (jfaData.w < 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; } vec3 color = hash3(jfaData.xy); gl_FragColor = vec4(color, 1.0); }`, ...standardPPOptions });
    debugDepthMaterial = new THREE.ShaderMaterial({ uniforms: { tDepth: { value: null }, u_depthPeekActive: { value: false }, u_depthPeekValue: { value: depthPeekValue }, u_depthPeekTolerance: { value: depthPeekTolerance } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, fragmentShader: `uniform sampler2D tDepth; uniform bool u_depthPeekActive; uniform float u_depthPeekValue; uniform float u_depthPeekTolerance; varying vec2 vUv; void main() { float normalizedDepth = texture2D(tDepth, vUv).r; vec4 finalColor = vec4(vec3(normalizedDepth), 1.0); if (u_depthPeekActive) { if (abs(normalizedDepth - u_depthPeekValue) < u_depthPeekTolerance) { finalColor.rgb = vec3(1.0, 0.0, 0.0); } } gl_FragColor = finalColor; }`, ...standardPPOptions });
    debugJfaToleranceMaterial = new THREE.ShaderMaterial({ uniforms: { tJFA: { value: null }, tOriginalDepth: { value: null }, tEdgeMask: { value: null }, u_projectionMatrixInverse: { value: new THREE.Matrix4() }, u_linearDepthTolerance: { value: 0.03 }, u_maskUsesAlpha: { value: false } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, fragmentShader: `uniform sampler2D tJFA; uniform sampler2D tOriginalDepth; uniform sampler2D tEdgeMask; uniform mat4 u_projectionMatrixInverse; uniform float u_linearDepthTolerance; uniform bool u_maskUsesAlpha; varying vec2 vUv; float linearize_depth(float z, vec2 uv) { if (z >= 1.0) return 9999.0; vec4 clipSpacePos = vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0); vec4 viewSpacePos = u_projectionMatrixInverse * clipSpacePos; return abs(viewSpacePos.z / viewSpacePos.w); } void main() { float maskValue = u_maskUsesAlpha ? (1.0 - texture2D(tEdgeMask, vUv).a) : texture2D(tEdgeMask, vUv).r; if (maskValue < 0.5) discard; vec4 jfaData = texture2D(tJFA, vUv); if (jfaData.w < 0.5) discard; float gapNonLinearDepth = texture2D(tOriginalDepth, vUv).r; float sourceNonLinearDepth = jfaData.z; vec2 sourceUV = jfaData.xy; float linearizedGapDepth = linearize_depth(gapNonLinearDepth, vUv); float linearizedSourceDepth = linearize_depth(sourceNonLinearDepth, sourceUV); if (linearizedSourceDepth < (linearizedGapDepth - u_linearDepthTolerance)) { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); } else { gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0); } }`, ...standardPPOptions });
    debugJfaDepthCompareMaterial = new THREE.ShaderMaterial({ uniforms: { tJFA: { value: null }, tOriginalDepth: { value: null }, tEdgeMask: { value: null }, u_projectionMatrixInverse: { value: new THREE.Matrix4() }, u_maskUsesAlpha: { value: false } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, fragmentShader: `uniform sampler2D tJFA; uniform sampler2D tOriginalDepth; uniform sampler2D tEdgeMask; uniform mat4 u_projectionMatrixInverse; uniform bool u_maskUsesAlpha; varying vec2 vUv; float linearize_depth(float z, vec2 uv) { if (z >= 1.0) return 9999.0; vec4 clipSpacePos = vec4(uv * 2.0 - 1.0, z * 2.0 - 1.0, 1.0); vec4 viewSpacePos = u_projectionMatrixInverse * clipSpacePos; return abs(viewSpacePos.z / viewSpacePos.w); } void main() { float maskValue = u_maskUsesAlpha ? (1.0 - texture2D(tEdgeMask, vUv).a) : texture2D(tEdgeMask, vUv).r; if (maskValue < 0.5) discard; vec4 jfaData = texture2D(tJFA, vUv); if (jfaData.w < 0.5) discard; float gapNonLinearDepth = texture2D(tOriginalDepth, vUv).r; float sourceNonLinearDepth = jfaData.z; vec2 sourceUV = jfaData.xy; float linearizedGapDepth = linearize_depth(gapNonLinearDepth, vUv); float linearizedSourceDepth = linearize_depth(sourceNonLinearDepth, sourceUV); const float epsilon = 0.001; if (linearizedSourceDepth > linearizedGapDepth + epsilon) { gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0); } else if (linearizedSourceDepth < linearizedGapDepth - epsilon) { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); } else { gl_FragColor = vec4(0.0, 0.0, 1.0, 1.0); } }`, ...standardPPOptions });
    
    // Material to show ONLY the inpainted pixels (difference between gapped and inpainted)
    inpaintOnlyMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tGapped: { value: null },
            tInpainted: { value: null },
            u_threshold: { value: 0.02 },
            u_bgColor: { value: new THREE.Color(0x222222) }  // Dark gray background
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tGapped;
            uniform sampler2D tInpainted;
            uniform float u_threshold;
            uniform vec3 u_bgColor;
            varying vec2 vUv;
            
            void main() {
                vec4 gapped = texture2D(tGapped, vUv);
                vec4 inpainted = texture2D(tInpainted, vUv);
                
                // Check if this pixel was inpainted (differs from gapped)
                vec3 diff = abs(inpainted.rgb - gapped.rgb);
                float maxDiff = max(diff.r, max(diff.g, diff.b));
                float alphaDiff = inpainted.a - gapped.a;
                
                // Is this an inpainted pixel?
                bool isInpainted = (maxDiff > u_threshold) || (alphaDiff > 0.3) || (gapped.a < 0.5 && inpainted.a > 0.5);
                
                if (isInpainted) {
                    // Show the inpainted color
                    gl_FragColor = vec4(inpainted.rgb, 1.0);
                } else {
                    // Show background color where NOT inpainted
                    gl_FragColor = vec4(u_bgColor, 1.0);
                }
            }
        `,
        depthWrite: false,
        depthTest: false
    });
    
    // Material to show depth only where inpainting occurred
    // Uses same comparison method as inpaint_only color view
    inpaintOnlyDepthMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tGapped: { value: null },
            tInpainted: { value: null },
            tDepth: { value: null },        // Screen-space normalized depth
            u_threshold: { value: 0.02 }
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tGapped;
            uniform sampler2D tInpainted;
            uniform sampler2D tDepth;
            uniform float u_threshold;
            varying vec2 vUv;
            
            void main() {
                vec4 gapped = texture2D(tGapped, vUv);
                vec4 inpainted = texture2D(tInpainted, vUv);
                
                // Check if this pixel was inpainted (same logic as color view)
                vec3 diff = abs(inpainted.rgb - gapped.rgb);
                float maxDiff = max(diff.r, max(diff.g, diff.b));
                float alphaDiff = inpainted.a - gapped.a;
                
                bool isInpainted = (maxDiff > u_threshold) || (alphaDiff > 0.3) || (gapped.a < 0.5 && inpainted.a > 0.5);
                
                if (!isInpainted) {
                    discard;
                }
                
                // Show depth as grayscale
                float depth = texture2D(tDepth, vUv).r;
                gl_FragColor = vec4(vec3(depth), 1.0);
            }
        `,
        depthWrite: false,
        depthTest: false
    });
    
    ditherMaterial = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, u_strength: { value: 0.0 }, u_resolution: { value: new THREE.Vector2(canvasWidth, canvasHeight) } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, fragmentShader: `uniform sampler2D tDiffuse; uniform float u_strength; uniform vec2 u_resolution; varying vec2 vUv; float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); } void main() { vec4 color = texture2D(tDiffuse, vUv); float noise = hash(gl_FragCoord.xy) - 0.5; color.rgb += noise * (u_strength / 255.0); gl_FragColor = color; }`, ...standardPPOptions });
    ditherCompositeMaterial = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, tMask: { value: null }, u_strength: { value: 0.0 }, u_resolution: { value: new THREE.Vector2(canvasWidth, canvasHeight) }, u_maskUsesAlpha: { value: false } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, fragmentShader: `uniform sampler2D tDiffuse; uniform sampler2D tMask; uniform float u_strength; uniform vec2 u_resolution; uniform bool u_maskUsesAlpha; varying vec2 vUv; float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); } void main() { vec4 color = texture2D(tDiffuse, vUv); float mask; if (u_maskUsesAlpha) { mask = 1.0 - texture2D(tMask, vUv).a; } else { mask = texture2D(tMask, vUv).r; } float noise = hash(gl_FragCoord.xy) - 0.5; float ditherAmount = noise * (u_strength / 255.0); if (mask > 0.5) { color.rgb += ditherAmount; } gl_FragColor = color; }`, ...standardPPOptions });

    masterGapTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, { format: THREE.RedFormat, type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    
    // Target for gap target depth (background depth estimation for gaps)
    // NEAREST filter is CRITICAL: these hold binary masks that get iterated many times.
    // Bilinear filtering + any sub-texel misalignment = the mask creeps in ALL directions
    // (one of the causes of the "sandwich" artifact).
    sdExportGapDepthTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, { 
        minFilter: THREE.NearestFilter, 
        magFilter: THREE.NearestFilter, 
        format: THREE.RGBAFormat, 
        type: THREE.HalfFloatType 
    });
    
    // Second target for iterative propagation (ping-pong)
    sdExportGapDepthTarget2 = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, { 
        minFilter: THREE.NearestFilter, 
        magFilter: THREE.NearestFilter, 
        format: THREE.RGBAFormat, 
        type: THREE.HalfFloatType 
    });
    
    infillAtlasTarget_Color = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false });
    infillAtlasTarget_Depth = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false });
    infillAtlasTarget_Depth_VTF = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: false, stencilBuffer: false });

    additiveBlendMaterial = new THREE.ShaderMaterial({ uniforms: { tBase: { value: null }, tNew: { value: null } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, fragmentShader: `uniform sampler2D tBase; uniform sampler2D tNew; varying vec2 vUv; void main() { float baseMask = texture2D(tBase, vUv).r; float newMask = texture2D(tNew, vUv).r; gl_FragColor = vec4(max(baseMask, newMask), 0.0, 0.0, 1.0); }`, blending: THREE.NoBlending, ...standardPPOptions });
    feedbackOverlayMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tDiffuse: { value: null },   // Screen Color
            tAtlas: { value: null },     // The Accumulating Atlas (UV Space)
            tUVMap: { value: null }      // Screen -> UV Map
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tDiffuse;
            uniform sampler2D tAtlas;
            uniform sampler2D tUVMap;
            varying vec2 vUv;

            void main() {
                vec4 screenColor = texture2D(tDiffuse, vUv);
                
                // 1. Look up where this screen pixel lives on the texture
                vec4 uvMapData = texture2D(tUVMap, vUv);
                vec2 textureUV = uvMapData.xy;
                
                // 2. If this pixel isn't on the mesh (background), draw normal color
                // (Assuming UV Map is cleared to 0.0 or similar)
                if (dot(textureUV, textureUV) < 0.0001) {
                    gl_FragColor = screenColor;
                    return;
                }

                // 3. Check the Atlas at that UV coordinate
                // The accumulator stores 'weight' (validity) in the Alpha channel.
                // Alpha = 0.0 means "Empty/Gap". Alpha > 0.0 means "Has Data".
                float validity = texture2D(tAtlas, textureUV).a;

                // 4. Overlay Red if Validity is low (It's a gap!)
                // We show red where validity is 0.
                float isGap = 1.0 - smoothstep(0.0, 0.5, validity);
                
                vec3 finalColor = mix(screenColor.rgb, vec3(1.0, 0.0, 0.0), isGap * 0.6); // 60% Red opacity
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `,
        depthWrite: false,
        depthTest: false
    });
    gapMaskExtractorMaterial = new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, u_maskUsesAlpha: { value: false } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, fragmentShader: `uniform sampler2D tDiffuse; uniform bool u_maskUsesAlpha; varying vec2 vUv; void main() { float mask; if (u_maskUsesAlpha) { mask = 1.0 - texture2D(tDiffuse, vUv).a; } else { mask = texture2D(tDiffuse, vUv).r; } gl_FragColor = vec4(mask, 0.0, 0.0, 1.0); }`, ...standardPPOptions });
    maskGeneratorDepthMaterial = new THREE.ShaderMaterial({ uniforms: { tDepth: { value: null }, tMask: { value: null } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, fragmentShader: `uniform sampler2D tDepth; uniform sampler2D tMask; varying vec2 vUv; void main() { float depth = texture2D(tDepth, vUv).r; float isGap = texture2D(tMask, vUv).r; gl_FragColor = vec4(vec3(depth), 1.0 - isGap); }`, ...standardPPOptions });

    const textureSpaceVertexShader = `varying vec2 vUv; varying vec4 vScreenPos; void main() { vUv = uv; gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0); vec4 worldPos = modelMatrix * vec4(position, 1.0); vScreenPos = projectionMatrix * viewMatrix * worldPos; }`;
    groundTruthColorAccumulatorMaterial = new THREE.ShaderMaterial({ uniforms: { tSourceColor: { value: null }, tLayerMask: { value: null }, u_resolution: { value: new THREE.Vector2(960, 540) } }, vertexShader: textureSpaceVertexShader, fragmentShader: `uniform sampler2D tSourceColor; uniform sampler2D tLayerMask; uniform vec2 u_resolution; varying vec2 vUv; varying vec4 vScreenPos; void main() { vec3 ndc = vScreenPos.xyz / vScreenPos.w; if (abs(ndc.x) > 1.0 || abs(ndc.y) > 1.0 || ndc.z > 1.0 || ndc.z < 0.0) { discard; } vec2 screenUV = ndc.xy * 0.5 + 0.5; float isFG = texture2D(tLayerMask, screenUV).r; if (isFG > 0.5) { discard; } vec4 sourceColor = texture2D(tSourceColor, screenUV); float weight = 1.0; float edgeDist = min(min(screenUV.x, 1.0 - screenUV.x), min(screenUV.y, 1.0 - screenUV.y)); weight *= smoothstep(0.0, 0.1, edgeDist); if (weight < 0.01) discard; gl_FragColor = vec4(sourceColor.rgb * weight, weight); }`, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
    groundTruthDepthAccumulatorMaterial = new THREE.ShaderMaterial({ uniforms: { tSourceDepth: { value: null }, tLayerMask: { value: null }, u_resolution: { value: new THREE.Vector2(960, 540) } }, vertexShader: textureSpaceVertexShader, fragmentShader: `uniform sampler2D tSourceDepth; uniform sampler2D tLayerMask; varying vec2 vUv; varying vec4 vScreenPos; void main() { vec3 ndc = vScreenPos.xyz / vScreenPos.w; if (abs(ndc.x) > 1.0 || abs(ndc.y) > 1.0 || ndc.z > 1.0 || ndc.z < 0.0) discard; vec2 screenUV = ndc.xy * 0.5 + 0.5; float isFG = texture2D(tLayerMask, screenUV).r; if (isFG > 0.5) discard; float sourceDepth = texture2D(tSourceDepth, screenUV).r; float weight = 1.0; float edgeDist = min(min(screenUV.x, 1.0 - screenUV.x), min(screenUV.y, 1.0 - screenUV.y)); weight *= smoothstep(0.0, 0.1, edgeDist); if (weight < 0.01) discard; gl_FragColor = vec4(sourceDepth * weight, weight, 0.0, 1.0); }`, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
    normalizationMaterial = new THREE.ShaderMaterial({ uniforms: { tAccumulatedData: { value: null }, u_isDepth: { value: false } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, fragmentShader: `uniform sampler2D tAccumulatedData; uniform bool u_isDepth; varying vec2 vUv; void main() { vec4 accum = texture2D(tAccumulatedData, vUv); float weight = 0.0; vec3 data = vec3(0.0); if (u_isDepth) { weight = accum.g; data = vec3(accum.r); } else { weight = accum.a; data = accum.rgb; } if (weight > 0.001) { gl_FragColor = vec4(data / weight, 1.0); } else { gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0); } }`, depthWrite: false, depthTest: false, blending: THREE.NoBlending });

    const postProcessQuad = new THREE.Mesh(postProcessPlane, null);
    postProcessScene.add(postProcessQuad);

    depthColorTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat, type: THREE.UnsignedByteType });
    depthToColorMaterial = new THREE.ShaderMaterial({ uniforms: { tDepth: { value: null } }, vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`, fragmentShader: `uniform sampler2D tDepth; varying vec2 vUv; vec4 packDepthToRGBA( const in float v ) { vec4 r = fract( v * vec4( 1.0, 255.0, 65025.0, 16581375.0 ) ); r.xyz -= r.yzw * ( 1.0 / 255.0 ); return r; } void main() { float depth = texture2D(tDepth, vUv).r; gl_FragColor = (depth >= 1.0) ? vec4(1.0) : packDepthToRGBA(depth); }`, ...standardPPOptions });

    // =================================================================
    // --- NEW: Bake Strategy Materials (ALPHA-AWARE MIN-DEPTH) ---
    // =================================================================

    // 1. Iterative Flood (Smart Dilation)
    fillBackgroundFloodMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tDiffuse: { value: null },
            u_resolution: { value: new THREE.Vector2(canvasWidth, canvasHeight) }
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tDiffuse;
            uniform vec2 u_resolution;
            varying vec2 vUv;

            void main() {
                vec4 current = texture2D(tDiffuse, vUv);
                
                // If Alpha > 0.5, this is valid geometry (even if black). Keep it.
                if (current.a > 0.5) {
                    gl_FragColor = current;
                    return;
                }

                // I am a hole (Alpha 0). Search neighbors.
                // We default to 1.0 (Foreground) so any Background (0.0) will win the min().
                float bestDepth = 1.0; 
                bool found = false;
                vec2 onePixel = 1.0 / u_resolution;

                for (int x = -1; x <= 1; x++) {
                    for (int y = -1; y <= 1; y++) {
                        if (x == 0 && y == 0) continue;
                        
                        vec4 neighbor = texture2D(tDiffuse, vUv + vec2(x, y) * onePixel);
                        
                        // Only consider VALID neighbors (Alpha 1.0)
                        if (neighbor.a > 0.5) {
                            // MIN logic: Prefer 0.0 (Wall) over 1.0 (Person)
                            bestDepth = min(bestDepth, neighbor.r);
                            found = true;
                        }
                    }
                }

                if (found) {
                    gl_FragColor = vec4(vec3(bestDepth), 1.0); // Fill with best depth, mark valid
                } else {
                    gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0); // Still empty
                }
            }
        `,
        depthWrite: false, depthTest: false
    });

    // 2. Max-Depth Pyramid (Downsample) -> ALPHA-AWARE MIN
    fillMaxDepthDownsampleMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tInput: { value: null },
            u_inputResolution: { value: new THREE.Vector2() }
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tInput;
            uniform vec2 u_inputResolution;
            varying vec2 vUv;

            void main() {
                vec2 halfPixel = 0.5 / u_inputResolution;
                
                vec4 s1 = texture2D(tInput, vUv + vec2(-halfPixel.x, -halfPixel.y));
                vec4 s2 = texture2D(tInput, vUv + vec2( halfPixel.x, -halfPixel.y));
                vec4 s3 = texture2D(tInput, vUv + vec2(-halfPixel.x,  halfPixel.y));
                vec4 s4 = texture2D(tInput, vUv + vec2( halfPixel.x,  halfPixel.y));

                // Prepare depths for comparison.
                // If a pixel is Invalid (Alpha 0), treat its depth as 1.0 (Max).
                // This ensures it loses the min() comparison against a valid Background (0.0).
                float d1 = (s1.a < 0.5) ? 1.0 : s1.r;
                float d2 = (s2.a < 0.5) ? 1.0 : s2.r;
                float d3 = (s3.a < 0.5) ? 1.0 : s3.r;
                float d4 = (s4.a < 0.5) ? 1.0 : s4.r;

                // Pick the Deepest (Smallest) valid depth
                float bestD = min(min(d1, d2), min(d3, d4));
                
                // If output is 1.0, it means all 4 were holes (or foreground). 
                // Propagate validity flag.
                float bestA = max(max(s1.a, s2.a), max(s3.a, s4.a));

                // If bestA is 0 (all holes), writes 0,0,0,0
                gl_FragColor = vec4(vec3(bestD), bestA);
            }
        `,
        depthWrite: false, depthTest: false
    });

    // 3. Max-Depth Upsample (Composition) -> Matches Alpha Logic
    fillMaxDepthUpsampleMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tHighRes: { value: null },
            tLowRes: { value: null }
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tHighRes;
            uniform sampler2D tLowRes;
            varying vec2 vUv;

            void main() {
                vec4 original = texture2D(tHighRes, vUv);
                
                // Use Alpha to detect holes
                if (original.a > 0.5) {
                    gl_FragColor = original;
                } else {
                    // Fill gap with the eroded (Background) map
                    gl_FragColor = texture2D(tLowRes, vUv);
                }
            }
        `,
        depthWrite: false, depthTest: false
    });

    // 4. Planar Backplane -> Alpha Aware
    fillPlanarBackplaneMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tDepth: { value: null },
            u_uvA: { value: new THREE.Vector2(0.1, 0.9) }, 
            u_uvB: { value: new THREE.Vector2(0.9, 0.9) },
            u_uvC: { value: new THREE.Vector2(0.5, 0.1) }
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
        fragmentShader: `
            uniform sampler2D tDepth;
            uniform vec2 u_uvA;
            uniform vec2 u_uvB;
            uniform vec2 u_uvC;
            varying vec2 vUv;

            void main() {
                vec4 current = texture2D(tDepth, vUv);
                if (current.a > 0.5) {
                    gl_FragColor = current;
                    return;
                }

                vec4 sA = texture2D(tDepth, u_uvA);
                vec4 sB = texture2D(tDepth, u_uvB);
                vec4 sC = texture2D(tDepth, u_uvC);

                float dA = (sA.a < 0.5) ? 1.0 : sA.r;
                float dB = (sB.a < 0.5) ? 1.0 : sB.r;
                float dC = (sC.a < 0.5) ? 1.0 : sC.r;

                // Safety
                if (dA > 0.99 || dB > 0.99 || dC > 0.99) {
                    gl_FragColor = vec4(vec3(min(dA, min(dB, dC))), 1.0);
                    return;
                }

                float slopeX = (dB - dA) / (u_uvB.x - u_uvA.x);
                float avgTopDepth = (dA + dB) * 0.5;
                float avgTopV = (u_uvA.y + u_uvB.y) * 0.5;
                float slopeY = (avgTopDepth - dC) / (avgTopV - u_uvC.y);

                float newDepth = dA + slopeX * (vUv.x - u_uvA.x) + slopeY * (vUv.y - u_uvA.y);
                gl_FragColor = vec4(vec3(newDepth), 1.0);
            }
        `,
        depthWrite: false, depthTest: false
    });

    // 5. Geometry Inspection Material (Checkerboard)
    geometryInspectionMaterial = new THREE.ShaderMaterial({
        uniforms: { u_tiles: { value: 20.0 }, u_color1: { value: new THREE.Color(0xffffff) }, u_color2: { value: new THREE.Color(0xaaaaaa) }, displacementMap: { value: null }, u_portalPlaneDepthNorm: { value: 0.5 }, u_worldInnerVolumeDepth: { value: 0.0 }, u_worldOuterVolumeDepth: { value: 0.0 }, displacementBias: { value: 0.0 }, u_metricScale: { value: 1.0 } },
        vertexShader: `varying vec2 vUv; uniform sampler2D displacementMap; uniform float u_portalPlaneDepthNorm; uniform float u_worldOuterVolumeDepth; uniform float u_worldInnerVolumeDepth; uniform float displacementBias; void main() { vUv = uv; float vNormalizedDepth = texture2D(displacementMap, vUv).r; float displacement = 0.0; if (vNormalizedDepth < u_portalPlaneDepthNorm) { float t = smoothstep(0.0, u_portalPlaneDepthNorm, vNormalizedDepth); displacement = mix(-u_worldOuterVolumeDepth, 0.0, t); } else { float t = smoothstep(u_portalPlaneDepthNorm, 1.0, vNormalizedDepth); displacement = mix(0.0, u_worldInnerVolumeDepth, t); } vec4 viewPosition = modelViewMatrix * vec4(position, 1.0); viewPosition.z += displacement + displacementBias; gl_Position = projectionMatrix * viewPosition; }`,
        fragmentShader: `varying vec2 vUv; uniform float u_tiles; uniform vec3 u_color1; uniform vec3 u_color2; void main() { vec2 id = floor(vUv * u_tiles); float check = mod(id.x + id.y, 2.0); vec3 color = mix(u_color1, u_color2, check); if (vUv.x < 0.01 || vUv.x > 0.99 || vUv.y < 0.01 || vUv.y > 0.99) { color = vec3(1.0, 0.0, 0.0); } gl_FragColor = vec4(color, 1.0); }`,
        wireframe: false, side: THREE.DoubleSide
    });

    // =================================================================
    // --- HOLE PATCH SYSTEM: Simple Background Patch Layer ---
    // =================================================================
    // Goal: Capture disocclusion holes during camera sweep, create a 
    // background patch layer that fills them when viewing off-axis.
    //
    // SIMPLE APPROACH:
    // 1. Holes = BLACK pixels when rendering with u_useDepthGrad enabled
    // 2. For each hole, the depth should be BACKGROUND depth (deepest neighbor)
    // 3. Accumulate holes to UV/texture space during sweep
    // 4. Render patch mesh with displacement from accumulated depth
    
    // Single texture to store the patch: R=alpha (1=hole), G=depth
    holePatchTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, {
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat, type: THREE.HalfFloatType,
        depthBuffer: false, stencilBuffer: false
    });
    
    // Temp target for per-frame capture
    holeCaptureTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, {
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat, type: THREE.HalfFloatType
    });
    
    // NEW: Color accumulation targets
    // RGB = sum of (color × weight), A = sum of weights
    holePatchColorTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, {
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat, type: THREE.HalfFloatType,
        depthBuffer: false, stencilBuffer: false
    });
    
    // Temp target for per-frame color capture
    holeColorCaptureTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, {
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat, type: THREE.HalfFloatType
    });
    
    // UV position map - stores UV coordinates at each screen pixel
    uvPositionTarget = new THREE.WebGLRenderTarget(canvasWidth, canvasHeight, {
        minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat, type: THREE.HalfFloatType,
        depthBuffer: true  // Need depth for proper occlusion
    });
    
    // Material: Renders UV coordinates to screen space
    // Each pixel stores the UV of the mesh at that screen position
    uvPositionMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tDepthMap: { value: null },
            u_portalPlaneDepthNorm: { value: 0.5 },
            u_worldInnerVolumeDepth: { value: 0.04 },
            u_worldOuterVolumeDepth: { value: 0.02 }
        },
        vertexShader: `
            varying vec2 vUv;
            varying float vDepth;
            uniform sampler2D tDepthMap;
            uniform float u_portalPlaneDepthNorm;
            uniform float u_worldInnerVolumeDepth;
            uniform float u_worldOuterVolumeDepth;
            
            void main() {
                vUv = uv;
                
                // Sample depth and calculate displacement (same as main mesh)
                float depth = texture2D(tDepthMap, uv).r;
                vDepth = depth;
                
                float displacement = 0.0;
                if (depth < u_portalPlaneDepthNorm) {
                    float t = smoothstep(0.0, u_portalPlaneDepthNorm, depth);
                    displacement = mix(-u_worldOuterVolumeDepth, 0.0, t);
                } else {
                    float t = smoothstep(u_portalPlaneDepthNorm, 1.0, depth);
                    displacement = mix(0.0, u_worldInnerVolumeDepth, t);
                }
                
                vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
                viewPos.z += displacement;
                gl_Position = projectionMatrix * viewPos;
            }
        `,
        fragmentShader: `
            varying vec2 vUv;
            varying float vDepth;
            
            void main() {
                // Store UV in RG, depth in B
                gl_FragColor = vec4(vUv, vDepth, 1.0);
            }
        `,
        side: THREE.DoubleSide,
        depthWrite: true,
        depthTest: true
    });

    // Material: Detect holes by COMPARING two renders
    // Render 1: Scene WITHOUT gap detection (full content)
    // Render 2: Scene WITH gap detection (gaps are black)
    // Difference = holes (black content won't trigger because it's black in both)
    holeDetectMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tSceneNoGaps: { value: null },   // Scene rendered WITHOUT gap detection
            tSceneWithGaps: { value: null }, // Scene rendered WITH gap detection
            tDepth: { value: null },         // Normalized depth texture
            u_resolution: { value: new THREE.Vector2(960, 540) },
            u_diffThreshold: { value: 0.1 }  // How different pixels must be to count as hole
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D tSceneNoGaps;
            uniform sampler2D tSceneWithGaps;
            uniform sampler2D tDepth;
            uniform vec2 u_resolution;
            uniform float u_diffThreshold;
            varying vec2 vUv;
            
            void main() {
                vec4 colorNoGaps = texture2D(tSceneNoGaps, vUv);
                vec4 colorWithGaps = texture2D(tSceneWithGaps, vUv);
                
                // Calculate difference between the two renders
                vec3 diff = abs(colorNoGaps.rgb - colorWithGaps.rgb);
                float maxDiff = max(max(diff.r, diff.g), diff.b);
                
                // Also check alpha difference
                float alphaDiff = abs(colorNoGaps.a - colorWithGaps.a);
                
                // Is this pixel a hole? (significant difference between renders)
                bool isHole = (maxDiff > u_diffThreshold) || (alphaDiff > 0.5);
                
                if (!isHole) {
                    // Not a hole - output nothing
                    gl_FragColor = vec4(0.0);
                    return;
                }
                
                // This IS a hole - find the DEEPEST (background) depth nearby
                vec2 pixelSize = 1.0 / u_resolution;
                float maxDepth = 0.0;
                float validSamples = 0.0;
                
                // Sample in expanding rings to find background depth
                for (float r = 1.0; r <= 12.0; r += 1.0) {
                    for (float angle = 0.0; angle < 6.28; angle += 0.785) { // 8 directions
                        vec2 offset = vec2(cos(angle), sin(angle)) * r * pixelSize;
                        vec2 sampleUV = vUv + offset;
                        
                        if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) continue;
                        
                        // Check if neighbor is NOT a hole
                        vec4 neighborNoGaps = texture2D(tSceneNoGaps, sampleUV);
                        vec4 neighborWithGaps = texture2D(tSceneWithGaps, sampleUV);
                        vec3 neighborDiff = abs(neighborNoGaps.rgb - neighborWithGaps.rgb);
                        float neighborMaxDiff = max(max(neighborDiff.r, neighborDiff.g), neighborDiff.b);
                        
                        // Only consider NON-hole pixels for depth reference
                        if (neighborMaxDiff < u_diffThreshold) {
                            float neighborDepth = texture2D(tDepth, sampleUV).r;
                            // We want the DEEPEST depth (background)
                            if (neighborDepth > 0.01 && neighborDepth < 0.99) {
                                maxDepth = max(maxDepth, neighborDepth);
                                validSamples += 1.0;
                            }
                        }
                    }
                }
                
                // If no valid depth found, use far background
                if (validSamples < 1.0 || maxDepth < 0.01) {
                    maxDepth = 0.85; // Default to background
                }
                
                // Output: R = alpha (1.0 = hole), G = background depth
                gl_FragColor = vec4(1.0, maxDepth, 0.0, 1.0);
            }
        `,
        depthWrite: false, depthTest: false
    });

    // Material: Accumulate holes from screen space TO UV space
    // Uses same approach as atlas accumulation: render mesh with UV as gl_Position
    // Format: R=hasHole, G=backgroundDepth, A=weight
    holeAccumulateMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tHoleCapture: { value: null },   // Screen-space holes (R=isHole, G=neighborDepth)
            tExisting: { value: null }       // Previous UV-space accumulation
        },
        vertexShader: `
            varying vec2 vUv;
            varying vec4 vScreenPos;
            
            void main() {
                vUv = uv;
                // Output to UV space (like atlas accumulation)
                gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
                // Project actual vertex position to screen
                vec4 worldPos = modelMatrix * vec4(position, 1.0);
                vScreenPos = projectionMatrix * viewMatrix * worldPos;
            }
        `,
        fragmentShader: `
            uniform sampler2D tHoleCapture;
            uniform sampler2D tExisting;
            varying vec2 vUv;
            varying vec4 vScreenPos;
            
            void main() {
                vec4 existing = texture2D(tExisting, vUv);
                
                // Check if vertex projects to valid screen region
                vec3 ndc = vScreenPos.xyz / vScreenPos.w;
                if (abs(ndc.x) > 1.0 || abs(ndc.y) > 1.0 || ndc.z > 1.0 || ndc.z < 0.0) {
                    gl_FragColor = existing;
                    return;
                }
                
                vec2 screenUV = ndc.xy * 0.5 + 0.5;
                vec4 holeData = texture2D(tHoleCapture, screenUV);
                
                // holeData.r > 0.5 = this screen pixel is a hole
                if (holeData.r > 0.5) {
                    // Mark as hole, keep max depth
                    float newDepth = max(existing.g, holeData.g);
                    gl_FragColor = vec4(1.0, newDepth, 0.0, 1.0);
                } else {
                    gl_FragColor = existing;
                }
            }
        `,
        blending: THREE.NoBlending,  // Shader handles merge logic
        side: THREE.DoubleSide,
        depthTest: false, 
        depthWrite: false
    });

    // NEW: Material to detect holes by comparing GAPPED vs INPAINTED frames
    // This captures the actual filled color from inpainting
    holeColorDetectMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tGapped: { value: null },      // Scene with gaps (transparent holes)
            tInpainted: { value: null },   // Scene with gaps filled by inpainting
            tDepth: { value: null },       // Depth texture for neighbor sampling
            u_resolution: { value: new THREE.Vector2(960, 540) },
            u_diffThreshold: { value: 0.02 }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D tGapped;
            uniform sampler2D tInpainted;
            uniform sampler2D tDepth;
            uniform vec2 u_resolution;
            uniform float u_diffThreshold;
            varying vec2 vUv;
            
            void main() {
                vec4 gapped = texture2D(tGapped, vUv);
                vec4 inpainted = texture2D(tInpainted, vUv);
                
                // Detect hole: where inpainted differs from gapped
                // Gapped has alpha < 1 in holes, inpainted fills them
                vec3 colorDiff = abs(inpainted.rgb - gapped.rgb);
                float maxColorDiff = max(colorDiff.r, max(colorDiff.g, colorDiff.b));
                float alphaDiff = inpainted.a - gapped.a;  // Positive if inpainted filled a hole
                
                // Is this a hole? Either significant color diff OR alpha was filled
                bool isHole = (maxColorDiff > u_diffThreshold) || (alphaDiff > 0.3);
                
                if (!isHole) {
                    discard;
                }
                
                // Find max depth from nearby NON-hole pixels
                vec2 pixelSize = 1.0 / u_resolution;
                float maxDepth = 0.0;
                float validSamples = 0.0;
                
                for (float r = 1.0; r <= 10.0; r += 1.0) {
                    for (float angle = 0.0; angle < 6.28; angle += 0.785) {
                        vec2 offset = vec2(cos(angle), sin(angle)) * r * pixelSize;
                        vec2 sampleUV = vUv + offset;
                        
                        if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) continue;
                        
                        vec4 neighborGapped = texture2D(tGapped, sampleUV);
                        vec4 neighborInpainted = texture2D(tInpainted, sampleUV);
                        vec3 neighborDiff = abs(neighborInpainted.rgb - neighborGapped.rgb);
                        float neighborMaxDiff = max(neighborDiff.r, max(neighborDiff.g, neighborDiff.b));
                        float neighborAlphaDiff = neighborInpainted.a - neighborGapped.a;
                        
                        // Only consider NON-hole pixels
                        if (neighborMaxDiff < u_diffThreshold && neighborAlphaDiff < 0.3) {
                            float neighborDepth = texture2D(tDepth, sampleUV).r;
                            if (neighborDepth > 0.01 && neighborDepth < 0.99) {
                                maxDepth = max(maxDepth, neighborDepth);
                                validSamples += 1.0;
                            }
                        }
                    }
                }
                
                if (validSamples < 1.0 || maxDepth < 0.01) {
                    maxDepth = 0.85;
                }
                
                // Output: R=1 (is hole), G=depth, BA=unused
                // Color is captured separately
                gl_FragColor = vec4(1.0, maxDepth, 0.0, 1.0);
            }
        `,
        depthWrite: false, depthTest: false
    });

    // NEW: Material to capture hole COLOR from inpainted frame
    holeColorCaptureMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tGapped: { value: null },
            tInpainted: { value: null },
            u_diffThreshold: { value: 0.02 },
            u_resolution: { value: new THREE.Vector2(960, 540) }
        },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            uniform sampler2D tGapped;
            uniform sampler2D tInpainted;
            uniform float u_diffThreshold;
            uniform vec2 u_resolution;
            varying vec2 vUv;
            
            void main() {
                vec4 gapped = texture2D(tGapped, vUv);
                vec4 clean = texture2D(tInpainted, vUv);
                
                vec3 colorDiff = abs(clean.rgb - gapped.rgb);
                float maxColorDiff = max(colorDiff.r, max(colorDiff.g, colorDiff.b));
                float alphaDiff = clean.a - gapped.a;
                
                bool isHole = (maxColorDiff > u_diffThreshold) || (alphaDiff > 0.3) || (gapped.a < 0.5);
                
                if (!isHole) {
                    discard;
                }
                
                // Sample colors from nearby NON-hole pixels (edge sampling)
                vec2 pixelSize = 1.0 / u_resolution;
                vec3 colorSum = vec3(0.0);
                float weightSum = 0.0;
                
                // Search outward in rings for valid edge pixels
                for (float r = 1.0; r <= 16.0; r += 1.0) {
                    for (float angle = 0.0; angle < 6.28; angle += 0.393) { // 16 samples per ring
                        vec2 offset = vec2(cos(angle), sin(angle)) * r * pixelSize;
                        vec2 sampleUV = vUv + offset;
                        
                        if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) continue;
                        
                        vec4 neighborGapped = texture2D(tGapped, sampleUV);
                        
                        // Valid pixel = has alpha and not too different from clean
                        if (neighborGapped.a > 0.8) {
                            // Weight by inverse distance (closer = more influence)
                            float weight = 1.0 / r;
                            colorSum += neighborGapped.rgb * weight;
                            weightSum += weight;
                        }
                    }
                    
                    // Stop searching once we have enough samples
                    if (weightSum > 2.0) break;
                }
                
                if (weightSum < 0.01) {
                    // No valid neighbors found - use fallback
                    discard;
                }
                
                vec3 finalColor = colorSum / weightSum;
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `,
        depthWrite: false, depthTest: false
    });

    // NEW: Material to accumulate hole COLORS to UV space
    holeColorAccumulateMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tColorCapture: { value: null },  // Screen-space hole colors (RGB=color, A=weight)
            tExisting: { value: null }       // Previous UV-space color accumulation
        },
        vertexShader: `
            varying vec2 vUv;
            varying vec4 vScreenPos;
            
            void main() {
                vUv = uv;
                gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
                vec4 worldPos = modelMatrix * vec4(position, 1.0);
                vScreenPos = projectionMatrix * viewMatrix * worldPos;
            }
        `,
        fragmentShader: `
            uniform sampler2D tColorCapture;
            uniform sampler2D tExisting;
            varying vec2 vUv;
            varying vec4 vScreenPos;
            
            void main() {
                vec4 existing = texture2D(tExisting, vUv);
                
                vec3 ndc = vScreenPos.xyz / vScreenPos.w;
                if (abs(ndc.x) > 1.0 || abs(ndc.y) > 1.0 || ndc.z > 1.0 || ndc.z < 0.0) {
                    gl_FragColor = existing;
                    return;
                }
                
                vec2 screenUV = ndc.xy * 0.5 + 0.5;
                vec4 colorData = texture2D(tColorCapture, screenUV);
                
                // colorData.a > 0.5 = valid hole color captured
                if (colorData.a > 0.5) {
                    // Additive accumulation: RGB += color, A += weight
                    gl_FragColor = vec4(
                        existing.rgb + colorData.rgb,
                        existing.a + 1.0
                    );
                } else {
                    gl_FragColor = existing;
                }
            }
        `,
        blending: THREE.NoBlending,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false
    });

    // Material: Render the hole patch with per-pixel depth and accumulated color
    holePatchRenderMaterial = new THREE.ShaderMaterial({
        uniforms: {
            tPatch: { value: null },       // R=hasHole, G=depth
            tColor: { value: null },       // RGB=sum(colors), A=weight count
            u_portalPlaneDepthNorm: { value: 0.5 },
            u_worldInnerVolumeDepth: { value: 0.04 },
            u_worldOuterVolumeDepth: { value: 0.02 },
            u_fallbackColor: { value: new THREE.Color(0xff00ff) } // Fallback: magenta
        },
        vertexShader: `
            varying vec2 vUv;
            varying float vDepth;
            uniform sampler2D tPatch;
            uniform float u_portalPlaneDepthNorm;
            uniform float u_worldInnerVolumeDepth;
            uniform float u_worldOuterVolumeDepth;
            
            void main() {
                vUv = uv;
                
                // Sample accumulated depth
                vec4 patchData = texture2D(tPatch, uv);
                float depth = patchData.g;  // G channel has accumulated depth
                vDepth = depth;
                
                // Calculate displacement from depth (same as main mesh)
                float displacement = 0.0;
                if (depth < u_portalPlaneDepthNorm) {
                    float t = smoothstep(0.0, u_portalPlaneDepthNorm, depth);
                    displacement = mix(-u_worldOuterVolumeDepth, 0.0, t);
                } else {
                    float t = smoothstep(u_portalPlaneDepthNorm, 1.0, depth);
                    displacement = mix(0.0, u_worldInnerVolumeDepth, t);
                }
                
                vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
                viewPos.z += displacement;
                gl_Position = projectionMatrix * viewPos;
            }
        `,
        fragmentShader: `
            varying vec2 vUv;
            varying float vDepth;
            uniform sampler2D tPatch;
            uniform sampler2D tColor;
            uniform vec3 u_fallbackColor;
            
            void main() {
                vec4 patchData = texture2D(tPatch, vUv);
                float hasHole = patchData.r;
                
                // Only render where there are holes
                if (hasHole < 0.5) {
                    discard;
                }
                
                // Get accumulated color (normalize by weight)
                vec4 colorData = texture2D(tColor, vUv);
                vec3 finalColor;
                
                if (colorData.a > 0.5) {
                    // Normalize: average color = sum / count
                    finalColor = colorData.rgb / colorData.a;
                } else {
                    // No color accumulated - use fallback
                    finalColor = u_fallbackColor;
                }
                
                gl_FragColor = vec4(finalColor, 1.0);
            }
        `,
        transparent: false,
        side: THREE.DoubleSide,
        depthWrite: true,
        depthTest: true
    });

    initializeInfillAtlasMesh();
}

/**
 * Renders the scene's Linear Depth.
 * FIX: Clears Alpha to 0.0 so we can distinguish "Black Wall" (Alpha 1) from "Empty Void" (Alpha 0).
 */
function renderNormalizedDepthPass() {
    if (!screenNormalizedDepthTarget || !scene || !camera) return;

    const currentRenderTarget = renderer.getRenderTarget();
    const currentClearColor = new THREE.Color();
    renderer.getClearColor(currentClearColor);
    const currentClearAlpha = renderer.getClearAlpha();
    const currentAutoClear = renderer.autoClear;

    renderer.setRenderTarget(screenNormalizedDepthTarget);
    renderer.autoClear = false; 
    
    // CRITICAL FIX: Clear Alpha to 0.0. 
    // RGB doesn't matter, but Alpha 0 marks the "Void".
    renderer.setClearColor(new THREE.Color(0, 0, 0), 0.0); 
    renderer.clear(true, true, true);

    const originalMaterials = new Map();
    const guidesToHide = [portalPlaneGuide, innerVolumeGuide, outerVolumeGuide].concat(wireframeCubes);
    const originalVisibilities = guidesToHide.map(g => g ? g.visible : false);
    guidesToHide.forEach(g => { if(g) g.visible = false; });

    scene.traverse((object) => {
        if (!object.isMesh) return;
        if (object === infillAtlasMesh) return;

        const isMediaLayer = object.material && 
                             object.material.isShaderMaterial &&
                             object.material.uniforms && 
                             object.material.uniforms.u_portalPlaneDepthNorm;

        // The background layer is a completion, not a source: the gap/disocclusion
        // pipeline must keep seeing the FG layer's holes, so BG is invisible to
        // the depth pass (and footprint pass) by design — except when the debug
        // sheet explicitly asks to see the plug as geometry.
        if (isMediaLayer && object.material.uniforms.u_isBackgroundLayer &&
            object.material.uniforms.u_isBackgroundLayer.value && !_depthPassIncludeBG) {
            originalMaterials.set(object, object.material);
            object.material = new THREE.MeshBasicMaterial({ visible: false });
            return;
        }

        if (isMediaLayer) {
            originalMaterials.set(object, object.material);
            let depthMat = depthMaterialCache.get(object.material);

            if (!depthMat) {
                depthMat = object.material.clone();
                depthMat.uniforms = object.material.uniforms;

                // Include full gap detection logic + tunnel detection
                depthMat.fragmentShader = `
                    precision highp float;
                    
                    // Gap detection uniforms (shared with main material)
                    uniform sampler2D displacementMap; // (D8 fix: shared uniform actually bound in image mode)
                    uniform sampler2D map;
                    uniform sampler2D u_edgeMask;
                    uniform vec2 u_textureSize;
                    uniform vec2 u_resolution;
                    
                    uniform bool u_useDepthGrad;   uniform float u_depthGradThreshold;
                    uniform bool u_useLuma;        uniform float u_lumaThreshold;
                    uniform bool u_useChroma;      uniform float u_chromaThreshold;
                    uniform bool u_useSobel;       uniform float u_sobelThreshold;
                    uniform bool u_useCrease;      uniform float u_creaseThreshold;
                    uniform bool u_useCurvature;   uniform float u_curvatureThreshold;
                    uniform bool u_useUVStretch;   uniform float u_uvStretchThreshold;
                    uniform bool u_useGrazingAngle; uniform float u_grazingAngleThreshold;
                    uniform bool u_useEdgeMask;
                    
                    varying vec2 vUv;
                    varying float vNormalizedDepth;
                    varying float vClipW;
                    varying vec3 vViewPosition;
                    
                    float getLuma(vec3 rgb) {
                        return dot(rgb, vec3(0.299, 0.587, 0.114));
                    }
                    
                    float getDepth(vec2 uv) {
                        return texture2D(displacementMap, uv).r;
                    }
                    
                    uniform bool u_isBackgroundLayer;

                    void main() {
                        // BG layer plug: pure depth, no gap detection. The
                        // detectors below fire on the band-boundary cliff and
                        // punch false holes in the plug (depth-pass only).
                        if (u_isBackgroundLayer) {
                            gl_FragColor = vec4(vec3(vNormalizedDepth), 1.0);
                            return;
                        }

                        vec4 originalColor = texture2D(map, vUv);
                        
                        bool isGap = false;
                        bool isTunnel = false; // Track if gap was detected by tunnel logic
                        #define center getDepth(vUv)
                        
                        // TUNNEL DETECTION: Only flag pixels that are clearly interpolating
                        // between FG and BG depths (not just any mismatch)
                        float sourceDepth = texture2D(displacementMap, vUv).r;
                        vec2 texel = 1.0 / u_textureSize;
                        
                        // Sample neighbors to find local depth range in source
                        float d1 = texture2D(displacementMap, vUv + vec2(-texel.x, -texel.y)).r;
                        float d2 = texture2D(displacementMap, vUv + vec2( 0.0,     -texel.y)).r;
                        float d3 = texture2D(displacementMap, vUv + vec2( texel.x, -texel.y)).r;
                        float d4 = texture2D(displacementMap, vUv + vec2(-texel.x,  0.0)).r;
                        float d5 = texture2D(displacementMap, vUv + vec2( texel.x,  0.0)).r;
                        float d6 = texture2D(displacementMap, vUv + vec2(-texel.x,  texel.y)).r;
                        float d7 = texture2D(displacementMap, vUv + vec2( 0.0,      texel.y)).r;
                        float d8 = texture2D(displacementMap, vUv + vec2( texel.x,  texel.y)).r;
                        
                        float maxSourceDepth = max(sourceDepth, max(max(max(d1, d2), max(d3, d4)), max(max(d5, d6), max(d7, d8))));
                        float minSourceDepth = min(sourceDepth, min(min(min(d1, d2), min(d3, d4)), min(min(d5, d6), min(d7, d8))));
                        float sourceRange = maxSourceDepth - minSourceDepth;
                        
                        // Only consider tunnel detection if there's a significant depth discontinuity nearby.
                        // REVIEW: with the pre-torn FG these heuristics are obsolete
                        // (torn cliffs are honest holes) and, once their samplers were
                        // actually bound (D8 fix), they misfire on untorn sub-band
                        // cliffs (striping at the dune/vehicle line). Explicitly off.
                        const bool TUNNEL_HEURISTICS = false;
                        if (TUNNEL_HEURISTICS && sourceRange > 0.04) {
                            // Check if interpolated depth falls BETWEEN the extremes (tunnel interpolation)
                            float marginFromMin = vNormalizedDepth - minSourceDepth;
                            float marginFromMax = maxSourceDepth - vNormalizedDepth;
                            
                            // Strategy 1: Clearly inside the range, not at either extreme
                            if (marginFromMin > 0.015 && marginFromMax > 0.015) {
                                isGap = true;
                                isTunnel = true;
                            }
                            
                            // Strategy 2: High fwidth in discontinuity zone catches remaining streaks
                            if (!isGap) {
                                float interpDepthRate = fwidth(vNormalizedDepth);
                                if (interpDepthRate > sourceRange * 0.15) {
                                    isGap = true;
                                    isTunnel = true;
                                }
                            }
                            
                            // Strategy 3: Direct mismatch - interpolated depth differs from source
                            // This catches diagonal views where UV lands near one extreme
                            if (!isGap) {
                                float depthMismatch = abs(vNormalizedDepth - sourceDepth);
                                // Scale threshold by source range - require mismatch to be significant
                                // relative to the discontinuity size
                                if (depthMismatch > sourceRange * 0.2 && depthMismatch > 0.01) {
                                    isGap = true;
                                    isTunnel = true;
                                }
                            }
                        }
                        
                        // 1. Depth Gradient
                        if (u_useDepthGrad && !isGap) {
                            float depthRate = fwidth(vNormalizedDepth);
                            if (depthRate > u_depthGradThreshold) isGap = true;
                        }
                        
                        // 2. Luma Derivative
                        if (u_useLuma && !isGap) {
                            float luma = getLuma(originalColor.rgb);
                            float lumaRate = fwidth(luma);
                            if (lumaRate > u_lumaThreshold) isGap = true;
                        }
                        
                        // 3. Chroma Derivative
                        if (u_useChroma && !isGap) {
                            vec3 rgbRate = fwidth(originalColor.rgb);
                            if (length(rgbRate) > u_chromaThreshold) isGap = true;
                        }
                        
                        // 4. Sobel
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
                            float dX = tr + 2.0*r + br - (tl + 2.0*l + bl);
                            float dY = bl + 2.0*b + br - (tl + 2.0*t + tr);
                            if (sqrt(dX*dX + dY*dY) > u_sobelThreshold) isGap = true;
                        }
                        
                        // 5. Curvature (Laplacian)
                        if (u_useCurvature && !isGap) {
                            vec2 texel = 1.0 / u_textureSize;
                            float laplacian = getDepth(vUv + vec2(0.0, texel.y))
                                            + getDepth(vUv + vec2(0.0, -texel.y))
                                            + getDepth(vUv + vec2(texel.x, 0.0))
                                            + getDepth(vUv + vec2(-texel.x, 0.0))
                                            - 4.0 * center;
                            float curvature = abs(laplacian) * 50.0;
                            if (curvature > u_curvatureThreshold) isGap = true;
                        }
                        
                        // 6. Normal calculations for Crease and Grazing Angle
                        vec3 faceNormal = vec3(0.0);
                        vec3 unnormalizedNormal = vec3(0.0);
                        float normalLength = 0.0;
                        
                        if (u_useCrease || (isGap && u_useGrazingAngle)) {
                            vec3 dPosDx = dFdx(vViewPosition);
                            vec3 dPosDy = dFdy(vViewPosition);
                            unnormalizedNormal = cross(dPosDx, dPosDy);
                            normalLength = length(unnormalizedNormal);
                            if (normalLength > 1e-6) {
                                faceNormal = unnormalizedNormal / normalLength;
                            } else {
                                faceNormal = vec3(0.0, 0.0, 1.0);
                            }
                        }
                        
                        // 7. Crease (Normal Discontinuity)
                        if (u_useCrease && !isGap) {
                            if (normalLength > 1e-6) {
                                float crease = length(fwidth(unnormalizedNormal)) / normalLength;
                                if (crease > u_creaseThreshold) isGap = true;
                            }
                        }
                        
                        // 8. Inhibitors (skip for tunnel-detected pixels - tunnels should never be un-flagged)
                        if (isGap && !isTunnel) {
                            // UV Stretch inhibitor
                            if (u_useUVStretch) {
                                vec2 dUvDx = dFdx(vUv);
                                vec2 dUvDy = dFdy(vUv);
                                float uvStretch = max(length(dUvDx), length(dUvDy));
                                if (uvStretch * max(u_textureSize.x, u_textureSize.y) > u_uvStretchThreshold * 100.0) {
                                    isGap = false;
                                }
                            }
                            
                            // Grazing Angle inhibitor
                            if (u_useGrazingAngle && isGap) {
                                if (normalLength > 1e-6) {
                                    vec3 viewDir = normalize(-vViewPosition);
                                    float incidence = abs(dot(faceNormal, viewDir));
                                    if (incidence < u_grazingAngleThreshold) {
                                        isGap = false;
                                    }
                                }
                            }
                        }
                        
                        // 9. External Edge Mask
                        if (u_useEdgeMask && !isGap) {
                            vec2 screenUv = gl_FragCoord.xy / u_resolution;
                            if (texture2D(u_edgeMask, screenUv).r > 0.5) isGap = true;
                        }
                        
                        if (isGap) discard;
                        
                        // Output depth
                        gl_FragColor = vec4(vec3(vNormalizedDepth), 1.0);
                    }
                `;

                depthMat.blending = THREE.NoBlending;
                depthMat.transparent = false;
                depthMat.depthTest = true;
                depthMat.depthWrite = true;
                depthMat.side = object.material.side; 

                depthMaterialCache.set(object.material, depthMat);
            }
            object.material = depthMat;
        }
    });

    try {
        renderer.render(scene, camera);
    } catch (e) { console.error("Depth Pass Failed:", e); }

    originalMaterials.forEach((material, object) => { object.material = material; });
    guidesToHide.forEach((g, i) => { if(g) g.visible = originalVisibilities[i]; });

    renderer.setRenderTarget(currentRenderTarget);
    renderer.setClearColor(currentClearColor, currentClearAlpha);
    renderer.autoClear = currentAutoClear;
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
            tOriginal: { value: null },
            tExpandedGapMask: { value: null },  // A=1 for gaps + FG occluders (may be null)
            tSceneDepth: { value: null },       // To detect original gaps (alpha < 0.5)
            u_maskUsesAlpha: { value: true },
            u_hasExpandedMask: { value: false }, // Whether tExpandedGapMask is valid
            u_bgLayerActive: { value: false }    // BG layer covers gaps at plug depth:
                                                 // the screen-space fill must stand down
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
            uniform sampler2D tExpandedGapMask;
            uniform sampler2D tSceneDepth;
            uniform bool u_maskUsesAlpha;
            uniform bool u_hasExpandedMask;
            uniform bool u_bgLayerActive;
            varying vec2 vUv;

            void main() {
                vec4 fgColor = texture2D(tFG, vUv);
                vec4 bgColor = texture2D(tBG, vUv);
                vec4 origColor = texture2D(tOriginal, vUv);
                float mask = texture2D(tLayerMask, vUv).r;
                
                // Check if this is an ORIGINAL gap (needs inpainting)
                vec4 sceneDepth = texture2D(tSceneDepth, vUv);
                bool isTunnel = sceneDepth.a < 0.5;
                // With the BG layer active, the depth pass still reports tunnels
                // (BG is hidden from it BY DESIGN so diagnostics see true holes),
                // but the scene render already contains BG content at plug depth.
                // Painting screen-space fill over that stable reveal is exactly
                // the "two fills fighting" shimmer — so with BG active, only a
                // pixel with no color at all counts as a gap.
                if (u_bgLayerActive) {
                    isTunnel = isTunnel && (origColor.a < 0.5);
                }
                bool isOriginalGap = isTunnel || (u_maskUsesAlpha ? origColor.a < 0.5 : false);
                
                // Check expanded gap mask if available.
                // Contract (see runFGSubtraction): B=1 explicitly marks FG occluders
                // (visible pixels excluded from the pyramid but keeping original color).
                // Using the explicit flag instead of inferring "in mask but not gap"
                // avoids misclassification when gap detection differs between passes.
                bool isFGOccluder = false;
                if (u_hasExpandedMask) {
                    vec4 gapMask = texture2D(tExpandedGapMask, vUv);
                    // B in (0, 0.995): remaining parallax budget = FG occluder.
                    // B == 0: interior gap. B == 1: out-of-mesh border void.
                    isFGOccluder = gapMask.b > 0.004 && gapMask.b < 0.995 && !isOriginalGap;
                }
                
                // Lerp between BG and FG based on the mask
                vec4 inpaintedColor = mix(bgColor, fgColor, mask);
                
                if (isFGOccluder) {
                    // FG occluder: keep ORIGINAL color (don't apply inpainting)
                    gl_FragColor = origColor;
                } else if (isOriginalGap) {
                    // Original gap: use inpainted color if available
                    if (inpaintedColor.a > 0.01) {
                        gl_FragColor = inpaintedColor;
                    } else {
                        // Inpainting didn't reach here, use original (transparent)
                        gl_FragColor = origColor;
                    }
                } else {
                    // Not a gap, not an occluder: use original color
                    gl_FragColor = origColor;
                }
            }
        `,
        transparent: false
    });
}

// ============================================================================
// FOREGROUND SUBTRACTION v2 — "local rim depth" method
//
// The old method compared pixel depth against a PYRAMID-propagated min depth.
// That baseline is non-local: at coarse pyramid levels the minimum depth of
// anything in a huge region (sky, far corners) leaks into the gap, so the
// LOCAL background around the gap tests as "in front of" the target and gets
// falsely marked -> the "sandwich" artifact. No global threshold can fix a
// locally-wrong baseline.
//
// New method:
//   Pass A (seed):   gap pixels -> (R=1.0 sentinel, A=1). valid -> (R=G=depth, A=0)
//   Pass B (rim flood): min-flood INSIDE the gap only. Each gap pixel converges
//                    to the MINIMUM depth on the rim of ITS OWN gap = the local
//                    background rim depth. A gap can never see another gap's rim.
//   Pass C (mark dilation): spread from gap into valid pixels that are strictly
//                    in front of the LOCAL rim depth (myDepth > target + eps).
//                    The BG rim sits AT the target by construction -> can never
//                    be marked. Spread continues through the FG object under a
//                    depth-continuity constraint, stopping at the far silhouette.
//
// OUTPUT CONTRACT for sdExportGapDepthTarget (single source of truth):
//   A = 1        -> exclude from color pyramid (gap OR FG occluder)
//   B = 1        -> FG occluder specifically (visible pixel; keep original color)
//   A = 1, B = 0 -> true gap (needs inpainting)
//   R            -> gap target depth (local BG rim depth); own depth for valid px
//   G            -> pixel's own scene depth (0 inside gaps)
// ============================================================================
let fgSeedMaterialV2 = null;
let fgRimFloodMaterial = null;
let fgMarkDilationMaterial = null;
// Dedicated targets for the FG mask contract. MUST NOT be shared with pyramid
// scratch space: a later pipeline stage re-renders sdExportGapDepthTarget every
// frame, which was silently clobbering the contract before the final composite
// read it. Managed lazily (created/resized inside runFGSubtraction).
let fgMaskTargetA = null;
let fgMaskTargetB = null;
// Mesh footprint: coverage of the displaced mesh WITHOUT tunnel-discard.
// Distinguishes interior disocclusion gaps (inside footprint, two rims) from
// out-of-mesh border void (outside footprint, one rim). Border void must never
// seed occluder marking: its edge-parallel rim bands were sweeping inward and
// tiling the mask with axis-aligned target plateaus.
let fgFootprintTarget = null;
let _depthPassIncludeBG = false; // sheet-only: render the plug into the depth pass
const footprintMaterialCache = new Map();

function renderMeshFootprintPass(w, h) {
    if (!scene || !camera || !renderer) return false;
    if (!fgFootprintTarget || fgFootprintTarget.width !== w || fgFootprintTarget.height !== h) {
        if (fgFootprintTarget) fgFootprintTarget.dispose();
        fgFootprintTarget = new THREE.WebGLRenderTarget(w, h, {
            minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
            format: THREE.RGBAFormat, type: THREE.UnsignedByteType
        });
    }

    const prevTarget = renderer.getRenderTarget();
    const prevClearColor = new THREE.Color();
    renderer.getClearColor(prevClearColor);
    const prevClearAlpha = renderer.getClearAlpha();

    renderer.setRenderTarget(fgFootprintTarget);
    renderer.setViewport(0, 0, w, h);
    renderer.setClearColor(new THREE.Color(0, 0, 0), 0.0);
    renderer.clear(true, true, true);

    const guidesToHide = [portalPlaneGuide, innerVolumeGuide, outerVolumeGuide].concat(wireframeCubes);
    const originalVisibilities = guidesToHide.map(g => g ? g.visible : false);
    guidesToHide.forEach(g => { if (g) g.visible = false; });

    const originalMaterials = new Map();
    scene.traverse((object) => {
        if (!object.isMesh) return;
        if (object === infillAtlasMesh) return;
        const isMediaLayer = object.material && object.material.isShaderMaterial &&
                             object.material.uniforms && object.material.uniforms.u_portalPlaneDepthNorm;
        if (!isMediaLayer) return;
        if (object.material.uniforms.u_isBackgroundLayer &&
            object.material.uniforms.u_isBackgroundLayer.value) return; // BG invisible to footprint
        originalMaterials.set(object, object.material);
        let fpMat = footprintMaterialCache.get(object.material);
        if (!fpMat) {
            // Same displaced vertex shader, but the fragment writes coverage
            // unconditionally — no gap detection, no discard.
            fpMat = object.material.clone();
            fpMat.uniforms = object.material.uniforms;
            fpMat.fragmentShader = 'precision highp float; void main() { gl_FragColor = vec4(1.0); }';
            fpMat.blending = THREE.NoBlending;
            fpMat.transparent = false;
            fpMat.depthTest = true;
            fpMat.depthWrite = true;
            fpMat.side = object.material.side;
            footprintMaterialCache.set(object.material, fpMat);
        }
        object.material = fpMat;
    });

    try { renderer.render(scene, camera); }
    catch (e) { console.error('Footprint pass failed:', e); }

    originalMaterials.forEach((material, object) => { object.material = material; });
    guidesToHide.forEach((g, i) => { if (g) g.visible = originalVisibilities[i]; });
    renderer.setClearColor(prevClearColor, prevClearAlpha);
    renderer.setRenderTarget(prevTarget);
    return true;
}

function runFGSubtraction(colorTexture, useColorAlphaForGaps, fgThreshold) {
    if (!screenNormalizedDepthTarget ||
        !postProcessScene || !postProcessCamera || !copyMaterial) {
        return false;
    }
    // postProcessQuad is not a global in this codebase — every function derives
    // it from the scene (see e.g. the other render helpers).
    const postProcessQuad = postProcessScene.children[0];
    if (!postProcessQuad) return false;

    const w = screenNormalizedDepthTarget.width;
    const h = screenNormalizedDepthTarget.height;
    if (!fgMaskTargetA || fgMaskTargetA.width !== w || fgMaskTargetA.height !== h) {
        if (fgMaskTargetA) fgMaskTargetA.dispose();
        if (fgMaskTargetB) fgMaskTargetB.dispose();
        const opts = {
            minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
            format: THREE.RGBAFormat, type: THREE.HalfFloatType
        };
        fgMaskTargetA = new THREE.WebGLRenderTarget(w, h, opts);
        fgMaskTargetB = new THREE.WebGLRenderTarget(w, h, opts);
    }
    const texel = new THREE.Vector2(1.0 / w, 1.0 / h);

    renderMeshFootprintPass(w, h);

    if (!fgSeedMaterialV2) {
        const vs = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`;

        fgSeedMaterialV2 = new THREE.ShaderMaterial({
            uniforms: {
                tSceneDepth: { value: null },
                tColor: { value: null },
                tFootprint: { value: null },
                u_useColorAlpha: { value: true }
            },
            vertexShader: vs,
            fragmentShader: `
                uniform sampler2D tSceneDepth;
                uniform sampler2D tColor;
                uniform sampler2D tFootprint;
                uniform bool u_useColorAlpha;
                varying vec2 vUv;
                void main() {
                    vec4 d = texture2D(tSceneDepth, vUv);
                    bool isGap = d.a < 0.5;
                    if (u_useColorAlpha && texture2D(tColor, vUv).a < 0.5) isGap = true;
                    if (isGap) {
                        // Interior disocclusion (inside mesh footprint): B = 0.
                        // Out-of-mesh border void: B = 1 -> never seeds marking.
                        float outside = (texture2D(tFootprint, vUv).r < 0.5) ? 1.0 : 0.0;
                        // R = 1.0 sentinel (identity for min), A = 1 marks gap
                        gl_FragColor = vec4(1.0, 0.0, outside, 1.0);
                    } else {
                        // Valid pixel: R = G = own depth, unmarked
                        gl_FragColor = vec4(d.r, d.r, 0.0, 0.0);
                    }
                }
            `,
            depthWrite: false, depthTest: false
        });

        fgRimFloodMaterial = new THREE.ShaderMaterial({
            uniforms: {
                tMask: { value: null },
                u_texelSize: { value: new THREE.Vector2() }
            },
            vertexShader: vs,
            fragmentShader: `
                uniform sampler2D tMask;
                uniform vec2 u_texelSize;
                varying vec2 vUv;
                void main() {
                    vec4 c = texture2D(tMask, vUv);
                    // Valid (non-gap) pixels never change: flood runs INSIDE gaps only.
                    if (c.a < 0.5) { gl_FragColor = c; return; }
                    // R accumulates the rim MIN (background rim depth),
                    // G accumulates the rim MAX (foreground rim depth).
                    // Their span is the gap's local FG-BG separation, used for a
                    // scale-free relative threshold in the mark pass.
                    float bestMin = c.r;
                    float bestMax = c.g;
                    for (int dy = -1; dy <= 1; dy++) {
                        for (int dx = -1; dx <= 1; dx++) {
                            if (dx == 0 && dy == 0) continue;
                            vec2 uv = vUv + vec2(float(dx), float(dy)) * u_texelSize;
                            vec4 n = texture2D(tMask, uv);
                            // Valid neighbor: R = G = its own depth (rim sample).
                            // Gap neighbor:   R = flooded min, G = flooded max.
                            bestMin = min(bestMin, n.r);
                            bestMax = max(bestMax, n.g);
                        }
                    }
                    // Preserve B: 0 = interior gap, 1 = out-of-mesh border void
                    gl_FragColor = vec4(bestMin, bestMax, c.b, 1.0);
                }
            `,
            depthWrite: false, depthTest: false
        });

        fgMarkDilationMaterial = new THREE.ShaderMaterial({
            uniforms: {
                tMask: { value: null },
                tSceneDepth: { value: null },
                u_texelSize: { value: new THREE.Vector2() },
                u_fgThreshold: { value: 0.05 },
                u_tauRel: { value: 0.35 },      // relative entry threshold: fraction of local FG-BG span
                u_fgReachPx: { value: 120.0 },  // parallax budget: pixels of reach per unit depth step
                u_unlimitedBudget: { value: false }, // full-interior flood mode (BG depth construction)
                u_relaxMode: { value: 1 } // 0=first-arrival (no relax), 1=min, 2=harmonic (anchored average)
            },
            vertexShader: vs,
            fragmentShader: `
                uniform sampler2D tMask;
                uniform sampler2D tSceneDepth;
                uniform vec2 u_texelSize;
                uniform float u_fgThreshold;
                uniform float u_tauRel;
                uniform float u_fgReachPx;
                uniform bool u_unlimitedBudget;
                uniform int u_relaxMode;
                varying vec2 vUv;

                // Budget is stored in B, normalized by this constant. B == 0 means
                // "gap" (unmarked); B > 0 means "FG occluder with remaining reach".
                const float BUDGET_NORM = 64.0;

                void main() {
                    vec4 c = texture2D(tMask, vUv);
                    if (c.a > 0.5) {
                        // Gap (interior or outside): frozen — flood already set R/G.
                        bool isGapPx = (c.b < (0.5 / BUDGET_NORM)) || (c.b > 0.995);
                        if (isGapPx) { gl_FragColor = c; return; }
                        // MARKED pixel target relaxation.
                        // Mode 0 (first-arrival): freeze — each pixel keeps its
                        //   nearest rim's depth. LOCALLY correct scale (the snake's
                        //   belly inherits the water right below it, not the far
                        //   cave through a coil opening) but leaves Voronoi seams.
                        // Mode 1 (min): dissolves seams but collapses the whole
                        //   blob to its deepest rim — WRONG on multi-depth rims
                        //   (the "hole stretching far into the bg").
                        // Mode 2 (harmonic): Jacobi-average toward neighbors, with
                        //   the BACKGROUND-side rim as an anchored Dirichlet
                        //   boundary (valid neighbors join the average only when
                        //   their depth is plausibly at plug level — the depth
                        //   guard keeps the FG-side rim from dragging the membrane
                        //   up to foreground). Follows sloped rims, no seams.
                        if (u_relaxMode == 0) { gl_FragColor = c; return; }
                        float relaxSum = 0.0;
                        float relaxCnt = 0.0;
                        float relaxed = c.r;
                        for (int dy = -1; dy <= 1; dy++) {
                            for (int dx = -1; dx <= 1; dx++) {
                                if (dx == 0 && dy == 0) continue;
                                vec2 uv2 = vUv + vec2(float(dx), float(dy)) * u_texelSize;
                                vec4 n2 = texture2D(tMask, uv2);
                                if (n2.a > 0.5 && n2.b < 0.995) {
                                    relaxed = min(relaxed, n2.r);
                                    relaxSum += n2.r; relaxCnt += 1.0;
                                } else if (n2.a < 0.5) {
                                    // Valid pixel: rim anchor iff BG-side
                                    float dv = n2.r; // valid: R = own depth
                                    if (dv <= c.r + u_fgThreshold) { relaxSum += dv; relaxCnt += 1.0; }
                                }
                            }
                        }
                        if (u_relaxMode == 2 && relaxCnt > 0.0) {
                            gl_FragColor = vec4(relaxSum / relaxCnt, c.g, c.b, c.a);
                        } else {
                            gl_FragColor = vec4(relaxed, c.g, c.b, c.a);
                        }
                        return;
                    }
                    vec4 d = texture2D(tSceneDepth, vUv);
                    float myDepth = d.r;

                    float bestTarget = 1.0;
                    float bestBudget = 0.0;
                    bool mark = false;
                    for (int dy = -1; dy <= 1; dy++) {
                        for (int dx = -1; dx <= 1; dx++) {
                            if (dx == 0 && dy == 0) continue;
                            vec2 uv = vUv + vec2(float(dx), float(dy)) * u_texelSize;
                            vec4 n = texture2D(tMask, uv);
                            if (n.a < 0.5) continue;

                            // Out-of-mesh border void (B == 1.0): not a disocclusion,
                            // has no occluder — must neither seed nor relay marking.
                            if (n.b > 0.995) continue;

                            float target = n.r;              // LOCAL rim depth (BG rim)
                            bool nIsGap = n.b < (0.5 / BUDGET_NORM);

                            if (nIsGap) {
                                // ENTRY from the gap. Two-part threshold:
                                //  - absolute floor u_fgThreshold (noise rejection)
                                //  - relative: a fraction of THIS gap's own FG-BG span
                                //    (n.g = rim max), so the test is scale-free: a cup
                                //    5mm proud of a table and a figure against sky use
                                //    the same tau.
                                float span = max(n.g - n.r, 0.0);
                                float entryThresh = max(u_fgThreshold, u_tauRel * span);
                                if (myDepth > target + entryThresh) {
                                    // PARALLAX BUDGET: how far this occluder must be
                                    // excluded = how far it can displace relative to
                                    // the revealed background = reachPx * depth step.
                                    // This bounds the mark to the geometrically
                                    // meaningful band instead of an iteration count.
                                    // Cap at BUDGET_NORM - 1 so marked B stays < 0.995
                                    // and cannot collide with the outside-void flag.
                                    float budgetPx = u_unlimitedBudget
                                        ? (BUDGET_NORM - 1.0)
                                        : clamp(u_fgReachPx * (myDepth - target), 1.0, BUDGET_NORM - 1.0);
                                    mark = true;
                                    bestTarget = min(bestTarget, target);
                                    bestBudget = max(bestBudget, budgetPx);
                                }
                            } else {
                                // PROPAGATION through the occluder. CHAMFER metric:
                                // a diagonal step costs sqrt(2), an orthogonal step
                                // costs 1 — unit cost on an 8-neighborhood is Chebyshev
                                // (L-inf) whose balls are SQUARES, which is what tiled
                                // the mask with axis-aligned rectangles. Chamfer costs
                                // make fronts near-Euclidean octagons.
                                // Near-monotone in depth: ascent free, descent capped
                                // at 0.015/step so the mark cannot slide down the
                                // occluder's far side onto other surfaces.
                                float stepCost = (dx != 0 && dy != 0) ? 1.4142136 : 1.0;
                                float nBudget = u_unlimitedBudget ? BUDGET_NORM : (n.b * BUDGET_NORM);
                                bool hasBudget = nBudget >= stepCost;
                                bool nearMonotone = myDepth >= (n.g - 0.015);
                                if (hasBudget && nearMonotone && myDepth > target + u_fgThreshold) {
                                    mark = true;
                                    bestTarget = min(bestTarget, target);
                                    bestBudget = max(bestBudget, nBudget - stepCost);
                                }
                            }
                        }
                    }

                    if (mark) {
                        // R = inherited rim target, G = own depth (for monotone check),
                        // B = remaining budget (>0 flags FG occluder), A = 1 (excluded)
                        float outB = u_unlimitedBudget ? ((BUDGET_NORM - 1.0) / BUDGET_NORM) : (bestBudget / BUDGET_NORM);
                        gl_FragColor = vec4(bestTarget, myDepth, outB, 1.0);
                    } else {
                        gl_FragColor = c;
                    }
                }
            `,
            depthWrite: false, depthTest: false
        });
    }

    // --- Pass A: seed ---
    postProcessQuad.material = fgSeedMaterialV2;
    fgSeedMaterialV2.uniforms.tSceneDepth.value = screenNormalizedDepthTarget.texture;
    fgSeedMaterialV2.uniforms.tColor.value = colorTexture;
    fgSeedMaterialV2.uniforms.tFootprint.value = fgFootprintTarget ? fgFootprintTarget.texture : null;
    fgSeedMaterialV2.uniforms.u_useColorAlpha.value = !!useColorAlphaForGaps && !!colorTexture;
    renderer.setRenderTarget(fgMaskTargetB);
    renderer.setViewport(0, 0, w, h);
    renderer.clear();
    renderer.render(postProcessScene, postProcessCamera);

    let readT = fgMaskTargetB;
    let writeT = fgMaskTargetA;

    // --- Pass B: rim flood (min depth converges across each gap's interior) ---
    const RIM_FLOOD_ITERATIONS = 48;
    postProcessQuad.material = fgRimFloodMaterial;
    fgRimFloodMaterial.uniforms.u_texelSize.value.copy(texel);
    for (let i = 0; i < RIM_FLOOD_ITERATIONS; i++) {
        fgRimFloodMaterial.uniforms.tMask.value = readT.texture;
        renderer.setRenderTarget(writeT);
        renderer.setViewport(0, 0, w, h);
        renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);
        const t = readT; readT = writeT; writeT = t;
    }

    // --- Pass C: mark dilation into the FG occluder ---
    // Iterations must cover the max parallax budget (BUDGET_NORM in the shader).
    const MARK_ITERATIONS = 64;
    const fgReachPx = parseFloat(document.getElementById('fgReachSlider')?.value || '120');
    postProcessQuad.material = fgMarkDilationMaterial;
    fgMarkDilationMaterial.uniforms.tSceneDepth.value = screenNormalizedDepthTarget.texture;
    fgMarkDilationMaterial.uniforms.u_texelSize.value.copy(texel);
    fgMarkDilationMaterial.uniforms.u_fgThreshold.value = fgThreshold;
    fgMarkDilationMaterial.uniforms.u_fgReachPx.value = fgReachPx;
    fgMarkDilationMaterial.uniforms.u_unlimitedBudget.value = false;
    fgMarkDilationMaterial.uniforms.u_relaxMode.value = 1;
    for (let i = 0; i < MARK_ITERATIONS; i++) {
        fgMarkDilationMaterial.uniforms.tMask.value = readT.texture;
        renderer.setRenderTarget(writeT);
        renderer.setViewport(0, 0, w, h);
        renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);
        const t = readT; readT = writeT; writeT = t;
    }

    // Guarantee the final result lives in fgMaskTargetA
    if (readT !== fgMaskTargetA) {
        postProcessQuad.material = copyMaterial;
        copyMaterial.uniforms.tDiffuse.value = readT.texture;
        renderer.setRenderTarget(fgMaskTargetA);
        renderer.setViewport(0, 0, w, h);
        renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);
    }

    return true;
}

// ============================================================================
// DEBUG CONTACT SHEET EXPORTER
// One click -> one labeled PNG containing every buffer that matters, plus a
// settings/pose stamp. Purpose: a single drag-and-drop artifact that lets an
// external reviewer (human or AI) see the full pipeline state for THIS pose.
// ============================================================================
const MOEBIUS_DEBUG_VERSION = 'FG-SUB rimdepth v3.12.0-bandcut | band-gated FG stretch cut + directional plug + smooth margin';
let _dbgExportTarget = null;
let _dbgPanelMaterial = null;

function exportDebugContactSheet() {
    try {
        if (!renderer || !postProcessScene || !postProcessCamera) { alert('Renderer not ready'); return; }
        const postProcessQuad = postProcessScene.children[0];
        if (!postProcessQuad) { alert('Post-process quad not ready'); return; }

        // --- Refresh the buffers for the CURRENT pose ---
        renderNormalizedDepthPass();
        const thr = parseFloat(document.getElementById('fgSubThresholdSlider')?.value || '0.05');
        let fgOk = false;
        try { fgOk = runFGSubtraction(pingPongRenderTargetB?.texture || null, true, thr); }
        catch (e) { console.error('[DBG-SHEET] FG subtraction failed:', e); }

        // --- Panel render target (8-bit so we can readPixels) ---
        const srcW = renderer.domElement.width, srcH = renderer.domElement.height;
        // Native resolution: 480px panels hid pixel-level structure (we could
        // not diagnose blocky artifacts). The sheet is bigger but lossless.
        const panelW = srcW;
        const panelH = srcH;
        if (!_dbgExportTarget || _dbgExportTarget.width !== panelW || _dbgExportTarget.height !== panelH) {
            if (_dbgExportTarget) _dbgExportTarget.dispose();
            _dbgExportTarget = new THREE.WebGLRenderTarget(panelW, panelH, {
                minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
                format: THREE.RGBAFormat, type: THREE.UnsignedByteType
            });
        }

        if (!_dbgPanelMaterial) {
            _dbgPanelMaterial = new THREE.ShaderMaterial({
                uniforms: { tA: { value: null }, tB: { value: null }, u_mode: { value: 0 } },
                vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
                fragmentShader: `
                    uniform sampler2D tA;
                    uniform sampler2D tB;
                    uniform int u_mode;
                    varying vec2 vUv;
                    void main() {
                        vec4 a = texture2D(tA, vUv);
                        vec4 b = texture2D(tB, vUv);
                        vec3 outC = vec3(0.0);
                        if (u_mode == 0) {            // plain RGB
                            outC = a.rgb;
                        } else if (u_mode == 1) {     // gap mask: white where color OR depth invalid
                            bool gap = (a.a < 0.5) || (b.a < 0.5);
                            outC = vec3(gap ? 1.0 : 0.0);
                        } else if (u_mode == 2) {     // scene depth: gray, red where invalid
                            outC = (a.a < 0.5) ? vec3(0.6, 0.0, 0.0) : vec3(a.r);
                        } else if (u_mode == 3) {     // mask contract over dimmed color
                            vec3 base = b.rgb * 0.45;
                            if (a.b > 0.004 && a.b < 0.995) outC = mix(base, vec3(1.0, 0.1, 0.1), 0.4 + 0.5 * a.b); // FG occluder (brighter = more budget)
                            else if (a.a > 0.5) outC = vec3(0.05, a.r * 0.5, 1.0);           // true gap (G encodes rim depth)
                            else                outC = base;
                        } else if (u_mode == 4) {     // rim target depth in gaps, dim depth elsewhere
                            outC = (a.a > 0.5) ? vec3(a.r) : vec3(b.r * 0.3);
                        } else if (u_mode == 5) {     // raw R channel
                            outC = vec3(a.r);
                        } else if (u_mode == 6) {     // raw G channel
                            outC = vec3(a.g);
                        } else if (u_mode == 7) {     // raw B channel (budget)
                            outC = vec3(a.b);
                        } else if (u_mode == 8) {     // COMPLETED DEPTH (the plug):
                            // valid -> own scene depth; interior gap -> flooded rim
                            // target; border void -> 0 (outpaint region, no geometry)
                            if (b.a > 0.5)            outC = vec3(b.r);
                            else if (a.b > 0.995)     outC = vec3(0.0);
                            else                      outC = vec3(a.r);
                        } else if (u_mode == 9) {     // SD inpaint mask: interior disocclusions only
                            bool interiorGap = (a.a > 0.5) && (a.b < 0.008) && (b.a < 0.5);
                            outC = vec3(interiorGap ? 1.0 : 0.0);
                        } else if (u_mode == 10) {    // SD outpaint mask: border void
                            outC = vec3((a.b > 0.995) ? 1.0 : 0.0);
                        } else if (u_mode == 11) {    // FG occluder mask
                            bool fg = (a.b > 0.008) && (a.b < 0.995);
                            outC = vec3(fg ? 1.0 : 0.0);
                        } else if (u_mode == 12) {    // coverage: white where A > 0.5
                            outC = vec3((a.a > 0.5) ? 1.0 : 0.0);
                        }
                        gl_FragColor = vec4(outC, 1.0);
                    }
                `,
                depthWrite: false, depthTest: false
            });
        }

        const panels = [];
        const addPanel = (label, texA, texB, mode) => {
            const c = _renderBufferToCanvas(postProcessQuad, texA, texB, mode, panelW, panelH);
            if (c) panels.push({ label, canvas: c });
        };

        const colorTex = pingPongRenderTargetB?.texture || null;
        const depthTex = screenNormalizedDepthTarget?.texture || null;
        const maskTex  = fgMaskTargetA?.texture || null;

        // Panel 1: whatever is currently on screen (any mode/debug view the user selected)
        const live = document.createElement('canvas');
        live.width = panelW; live.height = panelH;
        live.getContext('2d').drawImage(renderer.domElement, 0, 0, panelW, panelH);
        panels.push({ label: 'live canvas (current view)', canvas: live });

        if (colorTex && depthTex) addPanel('gap mask (white = hole)', colorTex, depthTex, 1);
        if (depthTex)             addPanel('scene depth (red = invalid)', depthTex, null, 2);
        if (fgFootprintTarget)    addPanel('mesh footprint (white = covered)', fgFootprintTarget.texture, null, 0);
        if (fgOk && maskTex && colorTex) addPanel('FG-sub contract (blue=gap, red=FG)', maskTex, colorTex, 3);
        if (fgOk && maskTex && depthTex) addPanel('rim target depth (in gaps)', maskTex, depthTex, 4);
        if (fgOk && maskTex) addPanel('mask.R raw (rim min / own depth)', maskTex, null, 5);
        if (fgOk && maskTex) addPanel('mask.G raw (rim max / own depth)', maskTex, null, 6);
        if (fgOk && maskTex) addPanel('mask.B raw (parallax budget)', maskTex, null, 7);
        if (fgOk && maskTex && depthTex) addPanel('COMPLETED DEPTH (plug)', maskTex, depthTex, 8);
        // Plug-as-geometry: re-run the depth pass WITH the BG layer so you can
        // see exactly where the plug sits in this pose, then restore.
        if (typeof bgLayerMesh !== 'undefined' && bgLayerMesh) {
            _depthPassIncludeBG = true;
            renderNormalizedDepthPass();
            _depthPassIncludeBG = false;
            addPanel('live depth incl. BG (plug in place)', depthTex, null, 2);
            renderNormalizedDepthPass(); // restore FG-only depth for consistency
        }
        if (colorTex)             addPanel('scene color (pre-inpaint)', colorTex, null, 0);
        if (typeof bgColorTarget !== 'undefined' && bgColorTarget)
            addPanel('BG COLOR baked, one-sided \u2014 acceptance (a\u2032)', bgColorTarget.texture, null, 0);

        // --- Compose sheet ---
        const cols = 3, pad = 10, labelH = 22, footerH = 78;
        const rows = Math.ceil(panels.length / cols);
        const sheet = document.createElement('canvas');
        sheet.width  = cols * panelW + (cols + 1) * pad;
        sheet.height = rows * (panelH + labelH) + (rows + 1) * pad + footerH;
        const ctx = sheet.getContext('2d');
        ctx.fillStyle = '#111'; ctx.fillRect(0, 0, sheet.width, sheet.height);
        ctx.font = '13px monospace';
        panels.forEach((p, i) => {
            const cx = pad + (i % cols) * (panelW + pad);
            const cy = pad + Math.floor(i / cols) * (panelH + labelH + pad);
            ctx.fillStyle = '#8ff';
            ctx.fillText(p.label, cx + 2, cy + 14);
            ctx.drawImage(p.canvas, cx, cy + labelH);
        });

        // --- Settings / pose stamp ---
        const cam = (typeof camera !== 'undefined' && camera) ? camera.position : { x: 0, y: 0, z: 0 };
        const dbgSel = document.getElementById('debugViewSelect')?.value || '?';
        const bias = document.getElementById('useBackgroundBiasToggle')?.checked;
        const reachStamp = document.getElementById('fgReachSlider')?.value || '120';
        const stamp = [
            MOEBIUS_DEBUG_VERSION + ' | ' + new Date().toISOString() + ' | render ' + srcW + 'x' + srcH,
            'cam(' + cam.x.toFixed(3) + ', ' + cam.y.toFixed(3) + ', ' + cam.z.toFixed(3) + ') | view=' + dbgSel + ' | bgBias=' + bias + ' | fgThresh=' + thr + ' | fgReach=' + reachStamp + ' | seed=' + (document.getElementById('bgSeedModeSel')?.value || '0') + ' | bgBuilt=' + (bgBuildStamp || 'NO') + ' | depthPath=' + ((typeof mediaLayers !== 'undefined' && mediaLayers[0] && mediaLayers[0].textures.bgDepthBand) ? 'band' : 'flood') + ' | srcPath=' + ((typeof mediaLayers !== 'undefined' && mediaLayers[0] && mediaLayers[0]._srcSharpApplied) ? 'sharp' : 'raw') + ' | det=' + ((typeof mediaLayers !== 'undefined' && mediaLayers[0] && mediaLayers[0]._detApplied) ? 'slope' : 'mode2') + ' | cut=' + ((typeof mediaLayers !== 'undefined' && mediaLayers[0]?.mesh?.material?.uniforms?.u_cutSharp?.value) ? '0.008' : 'legacy') + ' | live=' + ((typeof mediaLayers !== 'undefined' && mediaLayers[0] && mediaLayers[0]._liveBaked) ? 'bake' : 'records') + ' | relax=' + (document.getElementById('bgRelaxModeSel')?.value || 'min') + ' | fgSubRan=' + fgOk
        ];
        ctx.fillStyle = '#ff8';
        stamp.forEach((s, i) => ctx.fillText(s, pad, sheet.height - footerH + 20 + i * 18));

        renderer.setRenderTarget(null);

        // Synchronous download path: toBlob's async callback loses the user-gesture
        // context in Safari and the download gets silently dropped. toDataURL keeps
        // everything inside the click handler; the anchor must be in the DOM for
        // some browsers to honor the click.
        const dataUrl = sheet.toDataURL('image/png');
        const aEl = document.createElement('a');
        aEl.href = dataUrl;
        aEl.download = 'moebius_debug_' + Date.now() + '.png';
        document.body.appendChild(aEl);
        aEl.click();
        aEl.remove();
        console.log('[DBG-SHEET] exported', aEl.download, '(' + Math.round(dataUrl.length / 1024) + ' KB dataURL)');
    } catch (e) {
        console.error('[DBG-SHEET] export failed:', e);
        alert('Debug sheet export failed - see console');
    }
}

// Shared: render a buffer through _dbgPanelMaterial into an 8-bit canvas.
function _renderBufferToCanvas(postProcessQuad, texA, texB, mode, w, h) {
    if (!_dbgPanelMaterial || !_dbgExportTarget) return null;
    _dbgPanelMaterial.uniforms.tA.value = texA;
    _dbgPanelMaterial.uniforms.tB.value = texB || texA;
    _dbgPanelMaterial.uniforms.u_mode.value = mode;
    postProcessQuad.material = _dbgPanelMaterial;
    renderer.setRenderTarget(_dbgExportTarget);
    renderer.setViewport(0, 0, w, h);
    renderer.clear();
    renderer.render(postProcessScene, postProcessCamera);
    const buf = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(_dbgExportTarget, 0, 0, w, h, buf);
    const flipped = new Uint8ClampedArray(w * h * 4);
    const rowBytes = w * 4;
    for (let y = 0; y < h; y++) {
        flipped.set(buf.subarray(y * rowBytes, (y + 1) * rowBytes), (h - 1 - y) * rowBytes);
    }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').putImageData(new ImageData(flipped, w, h), 0, 0);
    return c;
}

// Minimal STORE-only ZIP writer (no dependencies, no compression).
function _makeZip(files) { // files: [{name, bytes(Uint8Array)}]
    const enc = new TextEncoder();
    const crcTable = (() => {
        const t = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[n] = c >>> 0;
        }
        return t;
    })();
    const crc32 = (d) => {
        let c = 0xFFFFFFFF;
        for (let i = 0; i < d.length; i++) c = crcTable[(c ^ d[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    };
    const chunks = [], central = [];
    let offset = 0;
    const u16 = (v) => new Uint8Array([v & 255, (v >> 8) & 255]);
    const u32 = (v) => new Uint8Array([v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]);
    for (const f of files) {
        const name = enc.encode(f.name);
        const crc = crc32(f.bytes);
        const header = [u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
                        u32(crc), u32(f.bytes.length), u32(f.bytes.length),
                        u16(name.length), u16(0)];
        const localLen = 30 + name.length;
        chunks.push(...header, name, f.bytes);
        central.push([u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
                      u32(crc), u32(f.bytes.length), u32(f.bytes.length),
                      u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0),
                      u32(offset), name]);
        offset += localLen + f.bytes.length;
    }
    let centralSize = 0;
    for (const rec of central) { for (const part of rec) { chunks.push(part); centralSize += part.length; } }
    chunks.push(u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
                u32(centralSize), u32(offset), u16(0));
    let total = 0; for (const c of chunks) total += c.length;
    const out = new Uint8Array(total);
    let p = 0; for (const c of chunks) { out.set(c, p); p += c.length; }
    return out;
}

function _canvasToPngBytes(canvas) {
    const dataUrl = canvas.toDataURL('image/png');
    const b64 = dataUrl.split(',')[1];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

// SD BUNDLE: the diffusion-pipeline handoff. One zip containing, at native
// resolution: the scene color, the COMPLETED DEPTH (valid = scene depth,
// interior gaps = flooded rim target plug, border = 0), the inpaint mask
// (interior disocclusions), the outpaint mask (border void), the FG-occluder
// mask, and a metadata json.
function exportSDBundle() {
    try {
        if (!renderer || !postProcessScene || !postProcessCamera) { alert('Renderer not ready'); return; }
        const postProcessQuad = postProcessScene.children[0];
        if (!postProcessQuad) { alert('Post-process quad not ready'); return; }

        renderNormalizedDepthPass();
        const thr = parseFloat(document.getElementById('fgSubThresholdSlider')?.value || '0.05');
        const reach = parseFloat(document.getElementById('fgReachSlider')?.value || '120');
        let fgOk = false;
        try { fgOk = runFGSubtraction(pingPongRenderTargetB?.texture || null, true, thr); }
        catch (e) { console.error('[SD-BUNDLE] FG subtraction failed:', e); }
        if (!fgOk) { alert('FG subtraction failed - cannot build bundle (see console)'); return; }

        const w = renderer.domElement.width, h = renderer.domElement.height;
        if (!_dbgExportTarget || _dbgExportTarget.width !== w || _dbgExportTarget.height !== h) {
            if (_dbgExportTarget) _dbgExportTarget.dispose();
            _dbgExportTarget = new THREE.WebGLRenderTarget(w, h, {
                minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
                format: THREE.RGBAFormat, type: THREE.UnsignedByteType
            });
        }
        // _dbgPanelMaterial must exist; the sheet exporter creates it lazily,
        // so create-if-missing by borrowing its path: cheapest is to require
        // one sheet export first — instead, fail loudly if missing.
        if (!_dbgPanelMaterial) { alert('Open the Debug Sheet once first (initializes shared material), then export the bundle.'); return; }

        const colorTex = pingPongRenderTargetB.texture;
        const depthTex = screenNormalizedDepthTarget.texture;
        const maskTex  = fgMaskTargetA.texture;

        const files = [];
        const addFile = (name, texA, texB, mode) => {
            const c = _renderBufferToCanvas(postProcessQuad, texA, texB, mode, w, h);
            if (c) files.push({ name, bytes: _canvasToPngBytes(c) });
        };
        addFile('color.png', colorTex, null, 0);
        addFile('depth_completed.png', maskTex, depthTex, 8);
        addFile('mask_inpaint.png', maskTex, depthTex, 9);
        addFile('mask_outpaint.png', maskTex, depthTex, 10);
        addFile('mask_fg_occluder.png', maskTex, depthTex, 11);

        const cam2 = (typeof camera !== 'undefined' && camera) ? camera.position : { x: 0, y: 0, z: 0 };
        const meta = {
            version: MOEBIUS_DEBUG_VERSION,
            timestamp: new Date().toISOString(),
            renderSize: [w, h],
            camera: [cam2.x, cam2.y, cam2.z],
            fgThreshold: thr,
            fgReachPx: reach,
            depthConvention: 'normalized disparity: 1 = near, 0 = far; 0 in gaps = outpaint/no geometry',
            files: {
                'color.png': 'scene color, disoccluded pixels black',
                'depth_completed.png': 'scene depth with interior gaps plugged at local BG rim depth',
                'mask_inpaint.png': 'white = interior disocclusion (diffusion inpaint region)',
                'mask_outpaint.png': 'white = out-of-mesh border (outpaint region)',
                'mask_fg_occluder.png': 'white = foreground occluder band (exclude from fill sampling; keeps original pixels)'
            }
        };
        // Source-space artifacts (view-independent — this is the set the
        // diffusion stage should actually consume; build the BG layer first).
        if (typeof srcBandTargetA !== 'undefined' && srcBandTargetA && bgDepthTarget && bgColorTarget) {
            addFile('src_band_mask.png', srcBandTargetA.texture, null, 12);
            addFile('src_bg_depth_completed.png',
                (typeof mediaLayers !== 'undefined' && mediaLayers[0] && mediaLayers[0].textures.bgDepthBand)
                    ? mediaLayers[0].textures.bgDepthBand : bgDepthTarget.texture, null, 0);
            addFile('src_bg_color_baked.png', bgColorTarget.texture, null, 0);
            meta.files['src_band_mask.png'] = 'SOURCE-SPACE under-FG band (view-independent diffusion inpaint mask)';
            meta.files['src_bg_depth_completed.png'] = 'SOURCE-SPACE background layer depth (band = rim plug)';
            meta.files['src_bg_color_baked.png'] = 'SOURCE-SPACE background color, band coarse-filled (replace with diffusion output)';
        } else {
            console.warn('[SD-BUNDLE] no BG layer built yet — bundle contains screen-space files only');
        }
        // DIRECTIONAL plug bundle — native resolution, view-independent, the exact
        // gap the diffusion stage should inpaint (mask + completed depth + coarse fill).
        if (bgDirectionalExport) {
            const dE = bgDirectionalExport, dpw = dE.pw, dph = dE.ph, dN = dpw*dph;
            const mk = (drawFn) => { const cv = document.createElement('canvas'); cv.width = dpw; cv.height = dph;
                const cc = cv.getContext('2d'); const id = cc.createImageData(dpw, dph); drawFn(id.data); cc.putImageData(id, 0, 0); return _canvasToPngBytes(cv); };
            files.push({ name: 'dir_mask_inpaint.png', bytes: mk(d => { for (let i=0;i<dN;i++){ const v=dE.band[i]?255:0; d[i*4]=v;d[i*4+1]=v;d[i*4+2]=v;d[i*4+3]=255; } }) });
            files.push({ name: 'dir_bg_depth_completed.png', bytes: mk(d => { for (let i=0;i<dN;i++){ const v=Math.max(0,Math.min(255,(dE.plug[i]*255)|0)); d[i*4]=v;d[i*4+1]=v;d[i*4+2]=v;d[i*4+3]=255; } }) });
            files.push({ name: 'dir_bg_color_coarse.png', bytes: mk(d => { for (let i=0;i<dN;i++){ d[i*4]=dE.fill[i*3];d[i*4+1]=dE.fill[i*3+1];d[i*4+2]=dE.fill[i*3+2];d[i*4+3]=255; } }) });
            meta.files['dir_mask_inpaint.png'] = 'DIRECTIONAL plug gap mask (white = disocclusion to inpaint), native res';
            meta.files['dir_bg_depth_completed.png'] = 'DIRECTIONAL completed BG depth (holes capped at far-side rim), native res — ControlNet depth conditioning';
            meta.files['dir_bg_color_coarse.png'] = 'DIRECTIONAL coarse BG fill (replace with diffusion output), native res';
            meta.directionalNativeRes = [dpw, dph];
        }
        // SCENE-EXTENSION / OUTPAINT plate — enlarged canvas (image centred, margin =
        // beyond-frame region the head-tracked view reveals). The diffusion stage should
        // OUTPAINT the white margin using out_color_coarse as seed and out_depth_completed
        // as ControlNet depth, then the result is imported back onto the extended BG layer.
        if (bgExtendExport) {
            const xE = bgExtendExport, xw = xE.EPW, xh = xE.EPH, xN = xw*xh;
            const mk = (drawFn) => { const cv = document.createElement('canvas'); cv.width = xw; cv.height = xh;
                const cc = cv.getContext('2d'); const id = cc.createImageData(xw, xh); drawFn(id.data); cc.putImageData(id, 0, 0); return _canvasToPngBytes(cv); };
            files.push({ name: 'out_mask_outpaint.png', bytes: mk(d => { for (let i=0;i<xN;i++){ const v=xE.mask[i]?255:0; d[i*4]=v;d[i*4+1]=v;d[i*4+2]=v;d[i*4+3]=255; } }) });
            files.push({ name: 'out_color_coarse.png', bytes: mk(d => { for (let i=0;i<xN;i++){ d[i*4]=xE.fill[i*3];d[i*4+1]=xE.fill[i*3+1];d[i*4+2]=xE.fill[i*3+2];d[i*4+3]=255; } }) });
            files.push({ name: 'out_depth_completed.png', bytes: mk(d => { for (let i=0;i<xN;i++){ const v=Math.max(0,Math.min(255,(xE.depth[i]*255)|0)); d[i*4]=v;d[i*4+1]=v;d[i*4+2]=v;d[i*4+3]=255; } }) });
            meta.files['out_mask_outpaint.png'] = 'SCENE-EXTENSION outpaint mask (white = beyond-frame margin to generate), extended res';
            meta.files['out_color_coarse.png'] = 'SCENE-EXTENSION coarse colour (image centred, margin edge-extended) — outpaint seed, extended res';
            meta.files['out_depth_completed.png'] = 'SCENE-EXTENSION completed depth (margin edge-extended) — ControlNet depth conditioning, extended res';
            meta.outpaintExtendedRes = [xw, xh];
            meta.outpaintMarginPx = [xE.mx, xE.my];
            meta.outpaintSourceRes = [xE.pw, xE.ph];
        }
        files.push({ name: 'meta.json', bytes: new TextEncoder().encode(JSON.stringify(meta, null, 2)) });

        renderer.setRenderTarget(null);

        const zipBytes = _makeZip(files);
        // Synchronous download (same Safari constraint as the sheet).
        let bin = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < zipBytes.length; i += CHUNK) {
            bin += String.fromCharCode.apply(null, zipBytes.subarray(i, i + CHUNK));
        }
        const aEl = document.createElement('a');
        aEl.href = 'data:application/zip;base64,' + btoa(bin);
        aEl.download = 'moebius_sd_bundle_' + Date.now() + '.zip';
        document.body.appendChild(aEl);
        aEl.click();
        aEl.remove();
        console.log('[SD-BUNDLE] exported', aEl.download, files.map(f => f.name).join(', '));
    } catch (e) {
        console.error('[SD-BUNDLE] export failed:', e);
        alert('SD bundle export failed - see console');
    }
}

// ============================================================================
// SOURCE-SPACE BACKGROUND LAYER ("the plug becomes geometry")
//
// View-independent by construction: the disocclusion band is a function of the
// SOURCE depth map and the parallax budget alone — no camera involved. We:
//   1. Seed at depth discontinuities in the source depth (FG rim pixels),
//      carrying the local BG rim depth and a parallax budget w = reach * dDelta.
//   2. Dilate INTO the foreground with the SAME mark-dilation shader used in
//      screen space (chamfer metric, monotone constraint, budget decay).
//   3. Build a completed BG depth (band -> rim depth, else source depth) and a
//      baked BG color (one-shot pull-push fill of the band).
//   4. Add a second mesh behind the original: same geometry, BG textures,
//      never discards. Where the FG mesh opens a gap — from ANY angle — the
//      BG layer is already there, at plug depth, with baked color.
// ============================================================================
let bgLayerMesh = null;
// Directional plug data stashed at BG-build for the SD-export bundle (native res,
// top-row-first): the exact gap mask + completed BG depth + coarse fill the
// diffusion stage should consume. { band:Uint8, plug:Float32, fill:Uint8(RGB), pw, ph }
let bgDirectionalExport = null;
let srcBandTargetA = null, srcBandTargetB = null;
let bgDepthTarget = null, bgColorTarget = null;
let bgBuildStamp = null; // last successful BG bake (footer provenance)
/* ===== RUNG LIVE (stage 1): certified bake module, re-landed verbatim =====
   Re-certified this session against the reference artifacts: 37px median-tie
   deltas (max 4/255), 51 borderline mask flips (robustSlope numerics),
   0/64 impact at the regression sample scheme. Refs remain canonical. */
/* ========================================================================
   INLINED: moebius_edgebake.js (certified edge bake + parallax LUT).
   The external <script> tag is now OPTIONAL; if present it loads the
   identical code. Inlined so a single-file drop-in can never lose the
   module (root cause of the lut=OFF | bake=off regression).
   ===================================================================== */
/* ============================================================================
   moebius_edgebake.js — v1.0
   Load-time bake: depth-edge sharpening + slope-relative edge detection,
   plus the parallax LUT / reach math that links head motion to band width.

   This is a 1:1 port of the numpy recipe certified on defaultImgDepth.png
   (certification sheet: moebius_edge_certification.png):
     floorFP 0.58% | reliefFP 0.13% | strong edges 100% | soft edges 96.9%
     silhouette ramps 2-3px -> 1px at every probe row.

   Runs once per asset at image load (~100-300ms at 851x1023). No GLSL —
   certified logic ships verbatim, per the depth-map-first protocol.

   Browser: window.MoebiusEdgeBake.{bakeEdges, parallaxCurve, buildParallaxLUT,
            deltaMaxForReach}
   Node:    module.exports (used by the certification diff harness)
   ========================================================================= */
(function (root) {
'use strict';

function clampi(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function smoothstep(a, b, x) {
  let t = (x - a) / (b - a); t = t < 0 ? 0 : (t > 1 ? 1 : t);
  return t * t * (3 - 2 * t);
}

/* ---- separable box-min (square window, clamp borders) ------------------- */
function boxMin(src, W, H, r, tmp, dst) {
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let m = Infinity;
      for (let k = -r; k <= r; k++) {
        const v = src[row + clampi(x + k, 0, W - 1)];
        if (v < m) m = v;
      }
      tmp[row + x] = m;
    }
  }
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      let m = Infinity;
      for (let k = -r; k <= r; k++) {
        const v = tmp[clampi(y + k, 0, H - 1) * W + x];
        if (v < m) m = v;
      }
      dst[y * W + x] = m;
    }
  }
  return dst;
}

/* ---- np.gradient magnitude (central diff, one-sided borders) ------------ */
function gradMag(d, W, H, out) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const gx = x === 0     ? d[i + 1] - d[i]
               : x === W - 1 ? d[i] - d[i - 1]
               :               (d[i + 1] - d[i - 1]) * 0.5;
      const gy = y === 0     ? d[i + W] - d[i]
               : y === H - 1 ? d[i] - d[i - W]
               :               (d[i + W] - d[i - W]) * 0.5;
      out[i] = Math.hypot(gx, gy);
    }
  }
  return out;
}

/* ---- binary dilation, cross structuring element (scipy default) --------- */
function dilateCross(mask, W, H, iters) {
  let a = mask, b = new Uint8Array(W * H);
  for (let it = 0; it < iters; it++) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        b[i] = a[i]
          || (x > 0     && a[i - 1]) || (x < W - 1 && a[i + 1])
          || (y > 0     && a[i - W]) || (y < H - 1 && a[i + W]) ? 1 : 0;
      }
    }
    const t = a; a = b; b = t;
  }
  return a;
}

/* ---- color-guided weighted-median snap (the sharpener) -------------------
   For every pixel in the edge zone, the depth becomes the weighted median of
   its 5x5 neighborhood, weighted by color similarity — ramp pixels snap to
   whichever side of the edge they actually belong to. Weights are computed
   once from the color image; depth is re-gathered each iteration.           */
function weightedMedianSnap(d, colorRGBA, W, H, zone, iters, sigma) {
  const ys = [], xs = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (zone[y * W + x]) { ys.push(y); xs.push(x); }
  const N = ys.length, K = 25;
  const nIdx = new Int32Array(N * K);
  const wgt  = new Float64Array(N * K);
  const inv2s2 = 1 / (2 * sigma * sigma);
  for (let n = 0; n < N; n++) {
    const y = ys[n], x = xs[n], ci = (y * W + x) * 4;
    const cr = colorRGBA[ci] / 255, cg = colorRGBA[ci + 1] / 255, cb = colorRGBA[ci + 2] / 255;
    let k = 0;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++, k++) {
        const j = clampi(y + dy, 0, H - 1) * W + clampi(x + dx, 0, W - 1);
        nIdx[n * K + k] = j;
        const jc = j * 4;
        const dr = colorRGBA[jc] / 255 - cr,
              dg = colorRGBA[jc + 1] / 255 - cg,
              db = colorRGBA[jc + 2] / 255 - cb;
        wgt[n * K + k] = Math.exp(-(dr * dr + dg * dg + db * db) * inv2s2);
      }
    }
  }
  const vals = new Float64Array(K), ws = new Float64Array(K);
  const ord = new Int32Array(K);
  const dd = Float64Array.from(d);
  for (let it = 0; it < iters; it++) {
    const snap = new Float64Array(N);
    for (let n = 0; n < N; n++) {
      let tot = 0;
      for (let k = 0; k < K; k++) {
        vals[k] = dd[nIdx[n * K + k]];
        ws[k]   = wgt[n * K + k];
        ord[k]  = k;
        tot += ws[k];
      }
      // stable sort by depth value (matches numpy argsort kind='stable')
      const o = Array.from(ord).sort((a, b) => vals[a] - vals[b] || a - b);
      let cw = 0; const half = tot * 0.5;
      for (let k = 0; k < K; k++) {
        cw += ws[o[k]];
        if (cw >= half) { snap[n] = vals[o[k]]; break; }
      }
    }
    for (let n = 0; n < N; n++) dd[ys[n] * W + xs[n]] = snap[n];
  }
  return dd;
}

/* ---- robust local slope: gradmag subsampled x4, 5x5 median, bilinear up -- */
function robustSlope(gm, W, H) {
  const sw = Math.ceil(W / 4), sh = Math.ceil(H / 4);
  const small = new Float64Array(sw * sh);
  for (let j = 0; j < sh; j++)
    for (let i = 0; i < sw; i++)
      small[j * sw + i] = gm[(j * 4) * W + (i * 4)];
  const med = new Float64Array(sw * sh);
  const buf = new Float64Array(25);
  for (let j = 0; j < sh; j++) {
    for (let i = 0; i < sw; i++) {
      let k = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          buf[k++] = small[clampi(j + dy, 0, sh - 1) * sw + clampi(i + dx, 0, sw - 1)];
      med[j * sw + i] = Float64Array.from(buf).sort()[12];
    }
  }
  const slope = new Float64Array(W * H);
  for (let y = 0; y < H; y++) {
    const fy = Math.min(y / 4, sh - 1), y0 = Math.floor(fy),
          y1 = Math.min(y0 + 1, sh - 1), wy = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(x / 4, sw - 1), x0 = Math.floor(fx),
            x1 = Math.min(x0 + 1, sw - 1), wx = fx - x0;
      slope[y * W + x] =
        med[y0 * sw + x0] * (1 - wy) * (1 - wx) + med[y0 * sw + x1] * (1 - wy) * wx +
        med[y1 * sw + x0] * wy * (1 - wx)       + med[y1 * sw + x1] * wy * wx;
    }
  }
  return slope;
}

/* ============================ PUBLIC API ================================= */

/* bakeEdges(depth, colorRGBA, W, H, opts)
     depth     Float32Array|Float64Array (0..1) or Uint8*(0..255), length W*H
     colorRGBA Uint8ClampedArray|Uint8Array, length W*H*4 (ImageData.data)
   Returns { sharpened: Float32Array (0..1),
             edgeMask:  Uint8Array (0|1),
             stats:     { zonePx, edgePx, ms } }                              */
function bakeEdges(depth, colorRGBA, W, H, opts) {
  const t0 = (typeof performance !== 'undefined' ? performance : Date).now();
  const o = Object.assign(
    { absFloor: 0.03, slopeK: 9.0, sigma: 0.08, iters: 2,
      zoneThresh: 0.03, zoneDilate: 4 }, opts || {});
  const N = W * H;
  const d = new Float64Array(N);
  const isByte = depth.BYTES_PER_ELEMENT === 1;
  for (let i = 0; i < N; i++) d[i] = isByte ? depth[i] / 255 : depth[i];

  const tmp = new Float64Array(N), m3 = new Float64Array(N), m6 = new Float64Array(N);
  boxMin(d, W, H, 3, tmp, m3);
  boxMin(d, W, H, 6, tmp, m6);

  // edge zone: concentration test on the ORIGINAL depth, dilated (cross x4)
  const zone0 = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const s3 = d[i] - m3[i], s6 = d[i] - m6[i];
    zone0[i] = (s3 > o.zoneThresh && s3 > 0.6 * s6) ? 1 : 0;
  }
  const zone = dilateCross(zone0, W, H, o.zoneDilate);
  let zonePx = 0; for (let i = 0; i < N; i++) zonePx += zone[i];

  // sharpen, then detect on the sharpened map
  const ds = weightedMedianSnap(d, colorRGBA, W, H, zone, o.iters, o.sigma);
  const gm = gradMag(ds, W, H, new Float64Array(N));
  const slope = robustSlope(gm, W, H);
  boxMin(ds, W, H, 3, tmp, m3);

  const mask = new Uint8Array(N);
  let edgePx = 0;
  for (let i = 0; i < N; i++) {
    const s3 = ds[i] - m3[i];
    const thr = Math.max(o.absFloor, o.slopeK * slope[i]);
    if (s3 > thr) { mask[i] = 1; edgePx++; }
  }
  const ms = ((typeof performance !== 'undefined' ? performance : Date).now()) - t0;
  return { sharpened: Float32Array.from(ds), edgeMask: mask,
           stats: { zonePx, edgePx, ms } };
}

/* parallaxCurve(p) — the exact px-of-parallax curve for the renderer's
   displacement mapping (portal-plane split with smoothstep halves).
     p = { D:            eye-to-window distance (m)  [|camera.z - portalPlaneWorldZ|]
           portalNorm:   currentNormPortalPlane
           outer, inner: outerVolumeDepth, innerVolumeDepth (m)
           windowWidthM: terrariumWidth (m)
           canvasWidthPx,
           deltaM:       lateral eye offset (m),
           samples?: 1024 }
   Returns { lutPx: Float64Array(samples)  — parallax px vs normalizedDepth,
             requiredReachPx               — max |d(parallax)/d(normDepth)|,
             fullSpanPx }                  — parallax across the whole range  */
function parallaxCurve(p) {
  const n = p.samples || 1024;
  const pxPerM = p.canvasWidthPx / p.windowWidthM;
  const lut = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const nd = i / (n - 1);
    const s = nd < p.portalNorm
      ? p.outer * (1 - smoothstep(0, p.portalNorm, nd))   // behind the window
      : -p.inner * smoothstep(p.portalNorm, 1, nd);       // in front of it
    lut[i] = p.deltaM * s / (p.D + s) * pxPerM;
  }
  let worst = 0;
  for (let i = 1; i < n; i++)
    worst = Math.max(worst, Math.abs(lut[i] - lut[i - 1]) * (n - 1));
  return { lutPx: lut, requiredReachPx: worst,
           fullSpanPx: Math.abs(lut[0] - lut[n - 1]) };
}

/* buildParallaxLUT(p, size=32) — Float32Array for a size x 1 DataTexture.
   Shader budget: |LUT(fgDepth) - LUT(bgDepth)| — exact per edge, no scalar. */
function buildParallaxLUT(p, size) {
  const n = size || 32;
  const c = parallaxCurve(Object.assign({}, p, { samples: n }));
  return Float32Array.from(c.lutPx);
}

/* deltaMaxForReach(bakedReachPx, p) — the head-offset clamp: the largest eye
   offset the currently-baked band can cover. requiredReach is linear in
   deltaM, so evaluate at 1m and divide.                                     */
function deltaMaxForReach(bakedReachPx, p) {
  const unit = parallaxCurve(Object.assign({}, p, { deltaM: 1 })).requiredReachPx;
  return unit > 0 ? bakedReachPx / unit : Infinity;
}

const API = { bakeEdges, parallaxCurve, buildParallaxLUT, deltaMaxForReach };
root.MoebiusEdgeBake = API; // inlined copy: ALWAYS attach to the page global,
                            // even if some library leaks a global `module`
if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof self !== 'undefined' ? self : this);

/* === END INLINED MODULE ============================================== */

/* plug_port.js — faithful port of the v5 plug algorithm.
   Requires: sharpened depth (Float32Array), band (Uint8Array), valid (Uint8Array).
   The valid mask = ~fillset, excluding all foreground from anchor selection.
   THIS is the variable that was wrong in every previous attempt. */
(function(root){
'use strict';
function clampi(v,lo,hi){return v<lo?lo:(v>hi?hi:v);}
function boxMinSep(src,W,H,r){
  const N=W*H,tmp=new Float32Array(N),out=new Float32Array(N);
  for(let y=0;y<H;y++){const row=y*W;
    for(let x=0;x<W;x++){let m=Infinity;
      for(let k=-r;k<=r;k++)m=Math.min(m,src[row+clampi(x+k,0,W-1)]);
      tmp[row+x]=m;}}
  for(let x=0;x<W;x++)for(let y=0;y<H;y++){let m=Infinity;
    for(let k=-r;k<=r;k++)m=Math.min(m,tmp[clampi(y+k,0,H-1)*W+x]);
    out[y*W+x]=m;}
  return out;
}
function buildPlugFromValid(depth, band, valid, W, H, sweeps){
  sweeps = sweeps || 220;
  const N=W*H;
  // Step A: locally-far anchors (only from VALID pixels)
  const vinf=new Float32Array(N);
  for(let i=0;i<N;i++) vinf[i]=valid[i]?depth[i]:2.0;
  const far=boxMinSep(vinf,W,H,21);
  const anchor=new Uint8Array(N);
  for(let i=0;i<N;i++) anchor[i]=(valid[i]&&depth[i]<=far[i]+0.08)?1:0;
  // Step B: nearest-anchor depth via 2-pass chamfer
  const extA=new Float32Array(N), dst=new Float32Array(N);
  for(let i=0;i<N;i++){dst[i]=anchor[i]?0:1e9; extA[i]=anchor[i]?depth[i]:0;}
  // forward
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;
    if(x>0){const j=i-1; if(dst[j]+1<dst[i]){dst[i]=dst[j]+1;extA[i]=extA[j];}}
    if(y>0){const j=i-W; if(dst[j]+1<dst[i]){dst[i]=dst[j]+1;extA[i]=extA[j];}}}
  // backward
  for(let y=H-1;y>=0;y--)for(let x=W-1;x>=0;x--){const i=y*W+x;
    if(x<W-1){const j=i+1; if(dst[j]+1<dst[i]){dst[i]=dst[j]+1;extA[i]=extA[j];}}
    if(y<H-1){const j=i+W; if(dst[j]+1<dst[i]){dst[i]=dst[j]+1;extA[i]=extA[j];}}}
  // ring = band pixels 4-adjacent to non-band
  const ring=new Uint8Array(N);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x; if(!band[i])continue;
    if((x>0&&!band[i-1])||(x<W-1&&!band[i+1])||(y>0&&!band[i-W])||(y<H-1&&!band[i+W]))ring[i]=1;}
  // Step C: 220-sweep Jacobi, ring pinned
  let D=new Float32Array(N),D2=new Float32Array(N);
  for(let i=0;i<N;i++) D[i]=band[i]?extA[i]:depth[i];
  for(let i=0;i<N;i++) if(ring[i]) D[i]=extA[i];
  for(let s=0;s<sweeps;s++){
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;
      if(!band[i]||ring[i]){D2[i]=D[i];continue;}
      D2[i]=0.25*(D[y*W+clampi(x-1,0,W-1)]+D[y*W+clampi(x+1,0,W-1)]
                  +D[clampi(y-1,0,H-1)*W+x]+D[clampi(y+1,0,H-1)*W+x]);}
    const t=D;D=D2;D2=t;
    for(let i=0;i<N;i++) if(ring[i]) D[i]=extA[i];
  }
  const plug=new Float32Array(N);
  for(let i=0;i<N;i++) plug[i]=band[i]?D[i]:depth[i];
  return plug;
}
const API={buildPlugFromValid,boxMinSep};
if(typeof module!=='undefined'&&module.exports) module.exports=API;
root.MoebiusPlug=API;
})(typeof self!=='undefined'?self:this);


/* ===== RUNG LIVE PLUG: load band + valid masks at startup =============== */
let bgBandImg = null, bgValidImg = null;
// How the plug's `valid` (anchor-eligible = true background) mask is built:
//   'auto'  — FG/BG split at an Otsu threshold computed from the depth histogram
//             (over non-band pixels). valid = ~band & (depth < otsuThreshold).
//             A GLOBAL depth threshold cleanly excludes thick foreground interiors
//             (the whole troll body), which the shipped defaultBgValid.png and the
//             locally-far anchor gate do NOT (that leak put ~6% of anchors at
//             figure depth and pulled the plug toward the troll). Otsu picks the
//             split automatically per-asset (no manual slider, no baked PNG) and
//             separates cleanly on the bimodal figure-in-front-of-wall case.
//   'split' — same split but from the app's manual point (currentInpaintingSplitDepthNorm).
//   'png'   — legacy: load defaultBgValid.png (kept for A/B comparison).
let bgValidMode = 'auto';
let bgSplitDefault = 0.35; // fallback split if a threshold can't be computed
// Plug construction:
//   'directional' — single directional plug: seal every disocclusion at the depth of
//                   the FAR SIDE of its own edge (revealed rim), grown in by the edge's
//                   parallax budget. Handles background AND glancing-foreground holes,
//                   never protrudes, needs no band/valid PNG (band computed from depth).
//   'global'      — legacy: band(PNG or live) + Otsu valid + harmonic (fg/bg only).
let bgPlugMode = 'directional';
// Scene extension / outpaint (coarse live pass): grow the BG layer beyond the
// image rectangle so the off-axis frustum, as the head sweeps, finds background
// out to the terrarium frame and past it, instead of clear-color void. The
// margin is sized automatically (pillarbox/letterbox gap + max-parallax reveal).
// The coarse pass edge-extends colour+depth into the margin; the SD bundle
// exports a proper outpaint plate (mask + extended colour + extended depth) to
// replace it. Set false to keep the BG layer flush with the image rectangle.
let bgSceneExtend = true;
let bgGlowAttach = false;  // opt-in: attach emissive blobs (lamp glow) to their thin carrier; over-claims on paintings with emissive backgrounds
// ---- MPI (depth-segmented multiplane layers, slice 1) ----
// Partition the torn FG into depth layers: connected components cut ONLY
// along depth cliffs (> fgTearStep), so smooth surfaces (the dune ramp)
// stay whole while occlusion boundaries split. Each layer is a mesh with
// its own index subset over the SHARED geometry buffers and the SHARED
// material/textures — slice 1 is render-identical to the single torn
// mesh by construction; its value is the layer structure itself (per-
// layer depth maps via the shared displacement texture, ordering, and
// the export bundle for per-layer SD completion in slice 2).
// Default OFF at load: the import auto-build runs before the initial
// layout, and hiding the primary mesh at that moment flips the view fit
// (observed: zoomed-out framing that persists for the whole session).
// Enable AFTER load (UI toggle / harness evaluate), then rebuild.
let bgMPIMode = false;
let bgMPIMaxLayers = 10;   // top-K components by area; smaller ones join the nearest layer by mean depth
let mpiLayers = null;      // [{mesh, meanD, tris, texels}] back-to-front
let bgMPIExport = null;    // { pw, ph, layers, texLayer (per-texel layer id), meanD[] }
// ---- MPI slice 2: the UNDER-SHEET (band-limited second depth) ----
// Everything the single plate cannot fix is INTERNAL overlap: cliffs whose
// far side is another part of the same scene stack (arm over torso, fur
// over body, troll limb over cave), where the plate's one-depth-per-texel
// holds the backdrop instead. The under-sheet completes the LOCAL far
// surface in a parallax-budget band behind each such cliff, rendered
// between the backdrop plate and the FG layers — and the cliffs then
// tear against it (far-side match vs the under-sheet's carried depth).
let mpiMidMesh = null;
// Band fill opacity. With the band tightened to a silhouette strip the fill is
// short-range, so it should read as a SOLID, complete inpaint — no streaks AND
// no transparent gaps inside the silhouette. Keep bgFillSolid = true for that.
// (The reach->alpha fade below is retained for the case where the band is
//  widened well past the reveal; it fades the far, purely-stretched reach so it
//  degrades to transparent instead of a smear. Off by default now.)
let bgFillSolid = true;
// Band fill method:
//   'smooth'  — pull-push (pyramid diffusion) from the surrounding real background.
//               Solid and streak-free; for smooth backgrounds (sky, desert) it is
//               near-perfect. The tight band keeps any blur to a few px. DEFAULT.
//   'reflect' — copy/reflect real background across the rim into the gap. Preserves
//               texture (stars, stroke) but striates when the reach is long.
let bgFillMode = 'smooth';
// Streak suppression (only used when bgFillSolid = false): fade the fill's alpha
// with the distance it had to travel from real background (the streak signal).
let bgStreakFadeNearPx = 8;    // reach <= this: fully opaque coarse fill
let bgStreakFadeFarPx  = 40;   // reach >= this: fully transparent (defer to SD)
let bgMarginFadeStartFrac = 0.5; // margin stays opaque until this fraction out, then fades to the edge
// Disocclusion band width cap. The band grows from each silhouette edge INTO the
// occluder by the local parallax budget so the BG layer holds real background
// exactly where the foreground will slide away. Uncapped, a large depth jump
// yields a ~400px budget that floods the whole figure body (the inpaint region
// stops being a clean silhouette strip). Cap it to the disocclusion actually
// revealed at a typical head excursion — a tight strip hugging the silhouette.
// Tune up if you head-track far; the SD plate covers anything past it.
let bgBandMaxGrowPx = 28;
// Seed threshold: a silhouette is only a disocclusion edge if the depth cliff
// to the neighbour exceeds this. Low values (0.06) also fire on internal folds
// and depth-map noise inside the figure, tiling the whole body with band seeds;
// raise it so only genuine figure->background cliffs seed a strip.
let bgBandStep = 0.10;
// BAND-GATED FOREGROUND CUT (the streak fix). The FG mesh is one connected
// sheet: at a depth cliff its triangles STRETCH across the gap, smearing a few
// edge pixels over the whole reveal — that smear IS the streak. Cutting the FG
// globally (screen heuristics) shreds smooth ramps like the ground; not cutting
// leaves the smear covering the plug. The correct rule uses both signals we
// already have:
//   WHERE it is safe to cut = the plug band (source-space, view-independent).
//     Cut region is a subset of plug coverage, so a cut never opens a naked hole.
//   WHEN a fragment must die = it is mid-stretch: the vertex-interpolated depth
//     (vNormalizedDepth) disagrees with the depth texture sampled at the
//     fragment's own UV (getDepth(vUv)). On any honest triangle the two agree;
//     they only diverge on a rubber-band triangle spanning a cliff. Zero false
//     positives on ramps/folds; at rest nothing is stretched, so nothing cuts.
let bgCutFGOnPlug = true;      // master toggle for the band-gated FG cut
// |sampled - interpolated| depth that counts as mid-stretch. The mismatch
// peaks at ~cliff/2 mid-stretch and tapers toward the triangle's vertices.
// Rest-state cliffs are excluded by the gradient gate below, so this can sit
// low enough to catch nearly the whole smear.
let bgBandCutMismatch = 0.01;
// Second gate: only cut fragments whose interpolated depth ramps SLOWLY in
// screen space. At rest a cliff crosses a mesh cell in ~2px (fwidth large);
// a stretched triangle ramps the same cliff over tens of px (fwidth tiny).
// This keeps thin features (staff, glider) fully intact at rest while still
// cutting every real smear. Raise if smears survive, lower if rest erosion.
let bgBandCutMaxGrad = 0.04;
// Direct stretch trigger: a rubber-band triangle advances its UVs far slower
// per screen pixel than an unstretched cell (and the derivative is constant
// across the triangle, so this catches the NEAR half of the smear, where the
// depth mismatch is zero by construction). A fragment cuts when its UV rate
// drops below this fraction of the expected rate (1/canvasWidth per px).
// 0.3 = "stretched more than ~3x". Lower = stricter (less cutting).
let bgBandCutStretchFrac = 0.3;
let bgBandCutDilatePx = 4;     // dilate the cut mask so far-side stretch fragments are covered too
// PRE-TORN FOREGROUND (review-fix): drop FG triangles that span a depth cliff
// at build time, so rubber-band triangles cannot exist at all. Reveals become
// honest holes (the plug / screen-space fill shows through) from any angle,
// zoom, or canvas size — no per-fragment stretch heuristics. When active, the
// band-gated cut is redundant and stays disarmed.
let fgPreTear = true;
let fgTearStep = 0.06;         // min 3-vertex depth span that counts as a cliff
// Coarse-extension data stashed at BG-build for the SD outpaint bundle
// (native/extended res, top-row-first): { mx, my, pw, ph, EPW, EPH,
//  depth:Float32(EPN), fill:Uint8(EPN*3), mask:Uint8(EPN) (1 = margin/outpaint) }
let bgExtendExport = null;
// Otsu threshold (maximize between-class variance) over a value list in [0,1].
function bgOtsuThreshold(values, skip) {
    const B = 256, h = new Float64Array(B); let n = 0;
    for (let k = 0; k < values.length; k++) {
        if (skip && skip[k]) continue;
        let b = (values[k] * B) | 0; if (b < 0) b = 0; else if (b > B - 1) b = B - 1;
        h[b]++; n++;
    }
    if (!n) return bgSplitDefault;
    let sum = 0; for (let i = 0; i < B; i++) sum += i * h[i];
    let sumB = 0, wB = 0, mx = -1, thr = 0;
    for (let i = 0; i < B; i++) {
        wB += h[i]; if (!wB) continue; const wF = n - wB; if (!wF) break;
        sumB += i * h[i];
        const mB = sumB / wB, mF = (sum - sumB) / wF;
        const between = wB * wF * (mB - mF) * (mB - mF);
        if (between > mx) { mx = between; thr = i; }
    }
    return thr / B;
}
// Pull-push (pyramid) fill: diffuse the color of `valid` pixels into the rest,
// streak-free (used to fill plug holes). cpx = RGBA source bytes, valid = Uint8
// mask of usable source pixels. Returns a Uint8Array RGB (all pixels filled).
function bgPullPushFill(cpx, valid, W, H) {
    let levels = [];
    let cw = new Float32Array(W*H*3), ww = new Float32Array(W*H);
    for (let i=0;i<W*H;i++){ if(valid[i]){ ww[i]=1; cw[i*3]=cpx[i*4]; cw[i*3+1]=cpx[i*4+1]; cw[i*3+2]=cpx[i*4+2]; } }
    levels.push({cw, ww, W, H});
    while (levels[levels.length-1].W > 1 && levels[levels.length-1].H > 1) {
        const p = levels[levels.length-1]; const nW=Math.max(1,p.W>>1), nH=Math.max(1,p.H>>1);
        const ncw=new Float32Array(nW*nH*3), nww=new Float32Array(nW*nH);
        for (let y=0;y<nH;y++) for (let x=0;x<nW;x++){ let sw=0,sr=0,sg=0,sb=0;
            for (let dy=0;dy<2;dy++) for (let dx=0;dx<2;dx++){ const sx=Math.min(p.W-1,x*2+dx), sy=Math.min(p.H-1,y*2+dy); const si=sy*p.W+sx;
                const w=p.ww[si]; sw+=w; sr+=p.cw[si*3]; sg+=p.cw[si*3+1]; sb+=p.cw[si*3+2]; }
            const o=y*nW+x, wc=Math.min(1,sw); nww[o]=wc; if(sw>0){ ncw[o*3]=sr/sw*wc; ncw[o*3+1]=sg/sw*wc; ncw[o*3+2]=sb/sw*wc; } }
        levels.push({cw:ncw, ww:nww, W:nW, H:nH});
    }
    // [PERF] unrolled bilinear sample — the array-of-arrays destructuring
    // allocated 5 arrays per unfilled pixel per level. Results identical.
    const _smp = [0, 0, 0];
    function sample(c, fx, fy){ const x0=Math.floor(fx), y0=Math.floor(fy), x1=Math.min(c.W-1,x0+1), y1=Math.min(c.H-1,y0+1);
        const tx=fx-x0, ty=fy-y0; let r=0,g=0,b=0,ws=0;
        let o, w, wt;
        o=Math.max(0,y0)*c.W+Math.max(0,x0); w=c.ww[o]; wt=(1-tx)*(1-ty); if(w>0){ r+=c.cw[o*3]/w*wt; g+=c.cw[o*3+1]/w*wt; b+=c.cw[o*3+2]/w*wt; ws+=wt; }
        o=Math.max(0,y0)*c.W+Math.max(0,x1); w=c.ww[o]; wt=tx*(1-ty);     if(w>0){ r+=c.cw[o*3]/w*wt; g+=c.cw[o*3+1]/w*wt; b+=c.cw[o*3+2]/w*wt; ws+=wt; }
        o=Math.max(0,y1)*c.W+Math.max(0,x0); w=c.ww[o]; wt=(1-tx)*ty;     if(w>0){ r+=c.cw[o*3]/w*wt; g+=c.cw[o*3+1]/w*wt; b+=c.cw[o*3+2]/w*wt; ws+=wt; }
        o=Math.max(0,y1)*c.W+Math.max(0,x1); w=c.ww[o]; wt=tx*ty;         if(w>0){ r+=c.cw[o*3]/w*wt; g+=c.cw[o*3+1]/w*wt; b+=c.cw[o*3+2]/w*wt; ws+=wt; }
        if (ws<=0) return null;
        _smp[0]=r/ws; _smp[1]=g/ws; _smp[2]=b/ws; return _smp; }
    for (let l=levels.length-2; l>=0; l--){ const fine=levels[l], coarse=levels[l+1];
        for (let y=0;y<fine.H;y++) for (let x=0;x<fine.W;x++){ const o=y*fine.W+x;
            if (fine.ww[o] < 0.999){ const s=sample(coarse,(x-0.5)/2,(y-0.5)/2); if(s){ const a=fine.ww[o];
                fine.cw[o*3]+=s[0]*(1-a); fine.cw[o*3+1]+=s[1]*(1-a); fine.cw[o*3+2]+=s[2]*(1-a); fine.ww[o]=1; } } }
    }
    const out=new Uint8Array(W*H*3), L0=levels[0];
    for (let i=0;i<W*H;i++){ const w=L0.ww[i]||1; out[i*3]=Math.max(0,Math.min(255,L0.cw[i*3]/w)); out[i*3+1]=Math.max(0,Math.min(255,L0.cw[i*3+1]/w)); out[i*3+2]=Math.max(0,Math.min(255,L0.cw[i*3+2]/w)); }
    return out;
}
// O(N) sliding window min/max (van Herk–Gil-Werman), 1D strided pass —
// EXACT replacement for naive windowed scans (results identical, cost
// independent of radius). Used by the ramp collapse, cliff-core windows
// and the under-sheet floor. `n` elements at src[base + i*stride].
function bgSlide1D(src, dst, n, r, stride, base, isMin) {
    const k = 2*r + 1;
    if (!bgSlide1D._f || bgSlide1D._f.length < n) { bgSlide1D._f = new Float32Array(n); bgSlide1D._g = new Float32Array(n); }
    const f = bgSlide1D._f, g = bgSlide1D._g;
    for (let i = 0; i < n; i++) {
        const v = src[base + i*stride];
        f[i] = (i % k === 0) ? v : (isMin ? Math.min(f[i-1], v) : Math.max(f[i-1], v));
    }
    for (let i = n - 1; i >= 0; i--) {
        const v = src[base + i*stride];
        g[i] = (i % k === k-1 || i === n-1) ? v : (isMin ? Math.min(g[i+1], v) : Math.max(g[i+1], v));
    }
    for (let i = 0; i < n; i++) {
        const lo = i - r, hi = i + r;
        let v;
        if (lo < 0) v = f[Math.min(hi, n-1)];
        else v = isMin ? Math.min(g[lo], f[Math.min(hi, n-1)]) : Math.max(g[lo], f[Math.min(hi, n-1)]);
        dst[base + i*stride] = v;
    }
}
// separable 2D windowed min/max over a (2r+1)^2 CLAMPED window — exact
function bgSlide2D(src, W, H, r, isMin) {
    const tmp = new Float32Array(W*H), out = new Float32Array(W*H);
    for (let y = 0; y < H; y++) bgSlide1D(src, tmp, W, r, 1, y*W, isMin);
    for (let x = 0; x < W; x++) bgSlide1D(tmp, out, H, r, W, x, isMin);
    return out;
}
// DIRECTIONAL PLUG: the single plug that seals every disocclusion at the depth of
// the FAR SIDE of its own edge (revealed rim) — background behind figures, nearer
// surface for glancing foreground overlaps. Extrudes from the far background, grows
// each edge's near-side strip in by that edge's parallax budget, caps at the rim,
// harmonic-smooths, and is transparent outside the strips. depth = normalized
// 0=far..1=near. Returns { plug: Float32Array, band: Uint8Array }.
function bgDirectionalPlug(depth, W, H, opts) {
    opts = opts || {};
    const N = W*H, STEP = opts.step || bgBandStep || 0.06, DELTA = opts.delta || 0.12, SWEEPS = opts.sweeps || 120;
    // parallax px LUT (matches the app's parallaxCurve), used for per-edge budget
    const lut = new Float32Array(1024);
    for (let i=0;i<1024;i++){ const nd=i/1023; const t=Math.min(Math.max(nd/0.5,0),1); const slo=0.02*(1-(t*t*(3-2*t)));
        const t2=Math.min(Math.max((nd-0.5)/0.5,0),1); const shi=-0.04*(t2*t2*(3-2*t2)); const s=nd<0.5?slo:shi; lut[i]=DELTA*s/(0.20+s)*(W/0.16); }
    const pxAt = dv => lut[Math.min(1023,Math.max(0,(dv*1023)|0))];
    const band = new Uint8Array(N), rim = new Float32Array(N), budget = new Int32Array(N), rimSrc = new Int32Array(N).fill(-1);
    const q = new Int32Array(N); let qt = 0;   // [PERF] typed queue (each pixel enqueued at most once)
    const MAXW = opts.maxGrowPx || bgBandMaxGrowPx || 40;
    for (let y=0;y<H;y++) for (let x=0;x<W;x++){ const i=y*W+x;
        const di = depth[i]; let bestFar=1e9, bestJ=-1, isE=false;
        // [PERF] unrolled neighbours — no per-pixel array allocation
        if (x>0)   { const j=i-1; if (di-depth[j] > STEP){ isE=true; if(depth[j]<bestFar){bestFar=depth[j];bestJ=j;} } }
        if (x<W-1) { const j=i+1; if (di-depth[j] > STEP){ isE=true; if(depth[j]<bestFar){bestFar=depth[j];bestJ=j;} } }
        if (y>0)   { const j=i-W; if (di-depth[j] > STEP){ isE=true; if(depth[j]<bestFar){bestFar=depth[j];bestJ=j;} } }
        if (y<H-1) { const j=i+W; if (di-depth[j] > STEP){ isE=true; if(depth[j]<bestFar){bestFar=depth[j];bestJ=j;} } }
        if (isE){ band[i]=1; rim[i]=bestFar; rimSrc[i]=bestJ;
            budget[i]=Math.min(MAXW, Math.max(4,Math.ceil(Math.abs(pxAt(di)-pxAt(bestFar))))+2); q[qt++]=i; } }
    for (let h=0;h<qt;h++){ const i=q[h]; if(budget[i]<=0)continue; const x=i%W,y=(i/W)|0;
        const ri = rim[i]+STEP, rv = rim[i], rs = rimSrc[i], b1 = budget[i]-1;
        let j;
        if (x>0)   { j=i-1; if(!band[j] && depth[j]>=ri){ band[j]=1; rim[j]=rv; rimSrc[j]=rs; budget[j]=b1; q[qt++]=j; } }
        if (x<W-1) { j=i+1; if(!band[j] && depth[j]>=ri){ band[j]=1; rim[j]=rv; rimSrc[j]=rs; budget[j]=b1; q[qt++]=j; } }
        if (y>0)   { j=i-W; if(!band[j] && depth[j]>=ri){ band[j]=1; rim[j]=rv; rimSrc[j]=rs; budget[j]=b1; q[qt++]=j; } }
        if (y<H-1) { j=i+W; if(!band[j] && depth[j]>=ri){ band[j]=1; rim[j]=rv; rimSrc[j]=rs; budget[j]=b1; q[qt++]=j; } } }
    const plug = new Float32Array(N); for (let i=0;i<N;i++) plug[i]=band[i]?rim[i]:depth[i];
    const ring = new Uint8Array(N);
    // TOPOLOGY (slope continuation): ring pixels adjacent to the TRUE far-side
    // surface anchor at that surface's OWN depth instead of the carried rim
    // value. The harmonic sweeps then interpolate between real surface
    // anchors at the reveal edge and the flat rim cap deep inside — the plug
    // CONTINUES the surface's slope across the reveal (a ground plane keeps
    // being a ground plane) instead of plateauing at the rim sample. Anchors
    // are only taken from neighbours within STEP of the rim (same surface
    // class), so the plug can never anchor to the occluder and protrude.
    for (let y=0;y<H;y++) for (let x=0;x<W;x++){ const i=y*W+x; if(!band[i])continue;
        let isRing = false, anchor = -1, anchorD = 1e9;
        let j;
        if (x>0)   { j=i-1; if(!band[j]){ isRing=true; if(Math.abs(depth[j]-rim[i])<=STEP && depth[j]<anchorD){ anchorD=depth[j]; anchor=j; } } }
        if (x<W-1) { j=i+1; if(!band[j]){ isRing=true; if(Math.abs(depth[j]-rim[i])<=STEP && depth[j]<anchorD){ anchorD=depth[j]; anchor=j; } } }
        if (y>0)   { j=i-W; if(!band[j]){ isRing=true; if(Math.abs(depth[j]-rim[i])<=STEP && depth[j]<anchorD){ anchorD=depth[j]; anchor=j; } } }
        if (y<H-1) { j=i+W; if(!band[j]){ isRing=true; if(Math.abs(depth[j]-rim[i])<=STEP && depth[j]<anchorD){ anchorD=depth[j]; anchor=j; } } }
        if (isRing){ ring[i]=1; if(anchor>=0) plug[i]=depth[anchor]; } }
    // [PERF] harmonic sweeps over a COMPACT interior list with precomputed
    // clamped neighbour indices (was SWEEPS x full-frame = 300M visits to
    // update the band interior only). Untouched pixels are equal in both
    // buffers by initialisation — results identical.
    {
        let nInt = 0;
        for (let i=0;i<N;i++) if (band[i] && !ring[i]) nInt++;
        const IL = new Int32Array(nInt), NBI = new Int32Array(nInt*4);
        nInt = 0;
        for (let y=0;y<H;y++) for (let x=0;x<W;x++){ const i=y*W+x; if(!band[i]||ring[i]) continue;
            IL[nInt] = i;
            NBI[nInt*4]   = y*W+Math.max(0,x-1);
            NBI[nInt*4+1] = y*W+Math.min(W-1,x+1);
            NBI[nInt*4+2] = Math.max(0,y-1)*W+x;
            NBI[nInt*4+3] = Math.min(H-1,y+1)*W+x;
            nInt++; }
        let A=plug.slice(), B=plug.slice();
        for (let s=0;s<SWEEPS;s++){
            for (let k=0;k<nInt;k++){ const i=IL[k];
                B[i]=0.25*(A[NBI[k*4]]+A[NBI[k*4+1]]+A[NBI[k*4+2]]+A[NBI[k*4+3]]); }
            const t=A;A=B;B=t; }
        for (let i=0;i<N;i++) if(band[i]) plug[i]=A[i];
    }
    return { plug, band, rimSrc };
}
(function(){
    const bImg = new Image(); bImg.onload = function(){
        bgBandImg = bImg;
        console.log('[RUNG-PLUG] band mask loaded (' + bImg.naturalWidth + 'x' + bImg.naturalHeight + ')');
    }; bImg.onerror = function(){ console.warn('[RUNG-PLUG] defaultBgBand.png missing'); };
    bImg.src = 'defaultBgBand.png';
    const vImg = new Image(); vImg.onload = function(){
        bgValidImg = vImg;
        console.log('[RUNG-PLUG] valid mask loaded (' + vImg.naturalWidth + 'x' + vImg.naturalHeight + ')');
    }; vImg.onerror = function(){ console.warn('[RUNG-PLUG] defaultBgValid.png missing'); };
    vImg.src = 'defaultBgValid.png';
})();

// // RUNG P loader (v3.9.6 identity): the band-of-record loads at STARTUP,
// independent of ingestion path; one [RUNG-P] console line per session. The
// certified-asset gate now compares 64 pseudo-random samples of the LOADED
// depth against BAKED CONSTANTS of the certified asset's raw depth — the
// record's interiors legitimately differ from raw (record v3), so the record
// itself can no longer serve as the identity reference.
let bandOfRecordImg = null;
(function loadBandOfRecord() {
    const img = new Image();
    img.onload = function () {
        bandOfRecordImg = img;
        console.log('[RUNG-P] band-of-record loaded (' + img.naturalWidth + 'x' + img.naturalHeight + ')');
    };
    img.onerror = function () {
        bandOfRecordImg = null;
        console.warn('[RUNG-P] defaultBgDepthBand.png missing; depth path stays on flood');
    };
    img.src = 'defaultBgDepthBand.png';
})();
function bandCertifiedFor(L) {
    if (!bandOfRecordImg || !L || !L.textures) return false;
    if (L._bandCertified !== undefined) return L._bandCertified;
    const dImg = (L.elements && L.elements.depth) ||
                 (L.textures.depth && L.textures.depth.image);
    if (!dImg) { L._bandCertified = false; return false; }
    const w = dImg.naturalWidth || dImg.width, h = dImg.naturalHeight || dImg.height;
    if (w !== bandOfRecordImg.naturalWidth || h !== bandOfRecordImg.naturalHeight) {
        L._bandCertified = false; return false;
    }
    try {
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const cx = cv.getContext('2d', { willReadFrequently: true });
        cx.drawImage(dImg, 0, 0, w, h);
        const a = cx.getImageData(0, 0, w, h).data;
        const FP = [80,59,55,56,76,156,107,94,111,184,95,48,147,230,128,47,40,133,152,174,77,70,37,36,101,71,142,76,101,158,78,79,28,147,217,77,82,62,168,179,67,60,60,25,140,164,96,143,118,164,77,60,57,21,2,202,100,125,122,184,98,47,42,57]; // certified asset raw-depth samples (v3.9.6)
        let hit = 0; const N = 64;
        for (let i = 1; i <= N; i++) {
            const p = (((i * 2654435761) >>> 0) % (w * h)) * 4;
            if (Math.abs(a[p] - FP[i - 1]) <= 2) hit++;
        }
        L._bandCertified = (hit >= Math.floor(N * 0.7));
    } catch (e) { L._bandCertified = false; }
    if (L._bandCertified) {
        const bTex = new THREE.Texture(bandOfRecordImg); bTex.needsUpdate = true;
        L.textures.bgDepthBand = bTex;
        console.log('[RUNG-P] certified-asset fingerprint MATCHED; depth path = band');
    } else {
        console.log('[RUNG-P] asset not certified for the band-of-record; depth path = flood');
    }
    return L._bandCertified;
}
// v3.9.3 RUNG A: the certified SHARPENED source (0-diff port reference; snap only
// reassigns existing 8-bit values, so the PNG is lossless). Loads at startup —
// one [RUNG-A] line guaranteed per session — and swaps in via the SAME
// certified-asset fingerprint gate, BEFORE any pass consumes depth. Detector,
// budgets, cut, and the color-firewall binding are untouched: one variable.
let sharpOfRecordImg = null;
(function loadSharpOfRecord() {
    const img = new Image();
    img.onload = function () {
        sharpOfRecordImg = img;
        console.log('[RUNG-A] sharpened source loaded (' + img.naturalWidth + 'x' + img.naturalHeight + ')');
    };
    img.onerror = function () {
        sharpOfRecordImg = null;
        console.warn('[RUNG-A] defaultImgDepth_sharpened.png missing; source stays raw');
    };
    img.src = 'defaultImgDepth_sharpened.png';
})();
function applyCertifiedSource(L) {
    if (!L || L._srcSharpApplied) return;
    if (!sharpOfRecordImg) return;
    if (!bandCertifiedFor(L)) return;
    const sTex = new THREE.Texture(sharpOfRecordImg); sTex.needsUpdate = true;
    L.textures.depth = sTex;
    if (L.mesh && L.mesh.material && L.mesh.material.uniforms &&
        L.mesh.material.uniforms.displacementMap) {
        L.mesh.material.uniforms.displacementMap.value = sTex;
    }
    if (L.mesh && L.mesh.material && L.mesh.material.uniforms &&
        L.mesh.material.uniforms.u_cutSharp) {
        L.mesh.material.uniforms.u_cutSharp.value = true;
        console.log('[RUNG-CUT] certified asset: FG cut threshold -> 0.008 (skins discard onto the clean plate)');
    }
    L._srcSharpApplied = true;
    console.log('[RUNG-A] certified asset: source depth -> SHARPENED record (FG mesh rebound)');
}
// v3.9.4 RUNG D: the certified slope-relative detector record (0-diff shipping
// recipe). Startup-loaded — one [RUNG-D] line per session — gated per asset.
let edgeMaskOfRecordImg = null;
(function loadEdgeMaskOfRecord() {
    const img = new Image();
    img.onload = function () {
        edgeMaskOfRecordImg = img;
        console.log('[RUNG-D] detector record loaded (' + img.naturalWidth + 'x' + img.naturalHeight + ')');
    };
    img.onerror = function () {
        edgeMaskOfRecordImg = null;
        console.warn('[RUNG-D] defaultEdgeMask.png missing; detector stays mode-2');
    };
    img.src = 'defaultEdgeMask.png';
})();
function applyCertifiedDetector(L) {
    if (!L || L._detApplied) return;
    if (!edgeMaskOfRecordImg) return;
    if (!bandCertifiedFor(L)) return;
    const mTex = new THREE.Texture(edgeMaskOfRecordImg); mTex.needsUpdate = true;
    L.textures.edgeMask = mTex;
    L._detApplied = true;
    console.log('[RUNG-D] certified asset: detector -> slope-relative record');
}
let liveBakeBusy = false;
function applyLiveBake(L) {
    if (!L || L._liveBaked || liveBakeBusy) return false;
    if (typeof MoebiusEdgeBake === 'undefined' || !MoebiusEdgeBake.bakeEdges) return false;
    const dImg = (L.elements && L.elements.depth) || (L.textures.depth && L.textures.depth.image);
    const cImg = (L.elements && L.elements.color) || (L.textures.color && L.textures.color.image);
    if (!dImg || !cImg) return false;
    const w = dImg.naturalWidth || dImg.width, h = dImg.naturalHeight || dImg.height;
    if (!w || !h) return false;
    const isReference = bandCertifiedFor(L); // fingerprint on RAW depth, before any swap
    try {
        liveBakeBusy = true;
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const cx = cv.getContext('2d', { willReadFrequently: true });
        cx.drawImage(dImg, 0, 0, w, h);
        const dpx = cx.getImageData(0, 0, w, h).data;
        const depth = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) depth[i] = dpx[i * 4] / 255;
        cx.clearRect(0, 0, w, h); cx.drawImage(cImg, 0, 0, w, h);
        const cpx = cx.getImageData(0, 0, w, h).data;
        const t0 = Date.now();
        L._rawDepth = depth.slice(); L._rawDepthW = w; L._rawDepthH = h; // pre-bake depth for tear decisions
        const out = MoebiusEdgeBake.bakeEdges(depth, cpx, w, h, {});
        // NEAR-PROTECTION CLAMP (review, v2): the colour-guided weighted
        // median leaks FAR depth into dark/thin NEAR features (staff shaft
        // perforated, hood interior blacked out — far-depth holes inside the
        // figure in the depth composite; the RAW map is clean). Rule, global-
        // class-free: a pixel sitting ON its local near plateau (raw >=
        // boxMax(raw, 2px) - 0.02) may never end up farther than raw. Ramp
        // pixels (raw below the local max) may snap either way — that is the
        // bake\'s legitimate job.
        {
            const N = w * h, r2 = 2;
            const tmpM = new Float32Array(N), bmax = new Float32Array(N);
            for (let y = 0; y < h; y++) { const row = y * w;
                for (let x = 0; x < w; x++) { let m = -1;
                    for (let k = -r2; k <= r2; k++) { const xx = Math.min(w-1, Math.max(0, x+k)); const v = depth[row+xx]; if (v > m) m = v; }
                    tmpM[row+x] = m; } }
            for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) { let m = -1;
                for (let k = -r2; k <= r2; k++) { const yy = Math.min(h-1, Math.max(0, y+k)); const v = tmpM[yy*w+x]; if (v > m) m = v; }
                bmax[y*w+x] = m; } }
            // local far minimum (same window) for skin binarization
            const bmin = new Float32Array(N);
            for (let y = 0; y < h; y++) { const row = y * w;
                for (let x = 0; x < w; x++) { let m = 2;
                    for (let k = -r2; k <= r2; k++) { const xx = Math.min(w-1, Math.max(0, x+k)); const v = depth[row+xx]; if (v < m) m = v; }
                    tmpM[row+x] = m; } }
            for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) { let m = 2;
                for (let k = -r2; k <= r2; k++) { const yy = Math.min(h-1, Math.max(0, y+k)); const v = tmpM[yy*w+x]; if (v < m) m = v; }
                bmin[y*w+x] = m; } }
            let clamped = 0, nans = 0, snapped = 0;
            for (let i = 0; i < N; i++) {
                const s = out.sharpened[i];
                if (!isFinite(s)) { out.sharpened[i] = depth[i]; nans++; continue; }
                // NaN-proof comparison: !(s >= x) also catches NaN
                if (depth[i] >= bmax[i] - 0.02 && !(s >= depth[i] - 0.02)) { out.sharpened[i] = depth[i]; clamped++; continue; }
                // SKIN BINARIZATION: within the sharpened silhouette skin a pixel
                // must be the local near plateau or the local far minimum — the
                // bake's pepper (intermediate values) poisons the plug's rim
                // depths (mid-gray slabs floating in the reveals) and the tear.
                if (bmax[i] - bmin[i] > 0.06) {
                    const dN = Math.abs(s - bmax[i]), dF = Math.abs(s - bmin[i]);
                    if (dN > 0.05 && dF > 0.05) { out.sharpened[i] = (dN < dF) ? bmax[i] : bmin[i]; snapped++; }
                }
            }
            if (clamped || nans || snapped) console.log('[RUNG-A] bake regularized: ' + clamped + 'px plateau-restored, ' + snapped + 'px skin-binarized, ' + nans + 'px NaN');
        }
        // REVIEW (depth-space fix): upload the sharpened depth as a FLOAT
        // DataTexture, NOT a canvas. Browsers gamma-convert canvas uploads
        // (UNPACK colorspace), so a canvas displacementMap arrives ~v^2.2 in
        // the vertex shader while the plug's DataTexture carries raw values —
        // the FG and the plate lived in two different depth spaces (the real
        // source of plate-in-front-of-FG protrusion and weld mismatch).
        const sfN = w * h; const sf = new Float32Array(sfN);
        for (let y = 0; y < h; y++) { const s = y*w, d = (h-1-y)*w;
            for (let x = 0; x < w; x++) sf[d+x] = out.sharpened[s+x]; }
        // keep a canvas copy for code paths that read .image via drawImage
        const oc = document.createElement('canvas'); oc.width = w; oc.height = h;
        const octx = oc.getContext('2d');
        const oid = octx.createImageData(w, h);
        for (let i = 0; i < w * h; i++) {
            const v = Math.max(0, Math.min(255, Math.round(out.sharpened[i] * 255)));
            oid.data[i*4] = v; oid.data[i*4+1] = v; oid.data[i*4+2] = v; oid.data[i*4+3] = 255;
        }
        octx.putImageData(oid, 0, 0);
        const mc = document.createElement('canvas'); mc.width = w; mc.height = h;
        const mctx = mc.getContext('2d');
        const mid = mctx.createImageData(w, h);
        for (let i = 0; i < w * h; i++) {
            const v = out.edgeMask[i] ? 255 : 0;
            mid.data[i*4] = v; mid.data[i*4+1] = v; mid.data[i*4+2] = v; mid.data[i*4+3] = 255;
        }
        mctx.putImageData(mid, 0, 0);
        const sTex = new THREE.DataTexture(sf, w, h, THREE.RedFormat, THREE.FloatType);
        sTex.needsUpdate = true; sTex.flipY = false;
        sTex.minFilter = THREE.LinearFilter; sTex.magFilter = THREE.LinearFilter;
        sTex.generateMipmaps = false;
        if ('colorSpace' in sTex) sTex.colorSpace = THREE.NoColorSpace;
        sTex.image2d = oc;   // CPU-readable copy for drawImage consumers
        const mTex = new THREE.Texture(mc); mTex.needsUpdate = true;
        L.textures.depth = sTex;
        L.textures.edgeMask = mTex;
        if (L.mesh && L.mesh.material && L.mesh.material.uniforms) {
            if (L.mesh.material.uniforms.displacementMap) L.mesh.material.uniforms.displacementMap.value = sTex;
            if (L.mesh.material.uniforms.u_cutSharp) L.mesh.material.uniforms.u_cutSharp.value = true;
        }
        L._liveBaked = true; L._srcSharpApplied = true; L._detApplied = true;
        console.log('[RUNG-LIVE] bake ' + (Date.now() - t0) + 'ms at ' + w + 'x' + h +
                    ' \u2014 sharpen + detector + cut computed live (' + out.stats.edgePx + ' edge px)');
        if (isReference && sharpOfRecordImg) { // records demoted to regression fixtures
            cx.clearRect(0, 0, w, h); cx.drawImage(sharpOfRecordImg, 0, 0, w, h);
            const rpx = cx.getImageData(0, 0, w, h).data;
            let okc = 0;
            for (let i = 1; i <= 64; i++) {
                const p = (((i * 2654435761) >>> 0) % (w * h)) * 4;
                if (Math.abs(oid.data[p] - rpx[p]) <= 2) okc++;
            }
            console.log('[RUNG-LIVE] regression vs sharpened record: ' + okc + '/64 ' + (okc >= 62 ? 'PASS' : 'FAIL'));
        }
        return true;
    } catch (e) {
        console.warn('[RUNG-LIVE] live bake failed; record/fallback path engages:', e);
        return false;
    } finally { liveBakeBusy = false; }
}
let srcBandSeedMaterial = null, bgCombineMaterial = null, bgColorSeedMaterial = null;
let bgMorphMaterial = null; // grayscale erode/dilate for the depth opening (unused since v3.1)
let bgLakeMaterial = null;  // v3.7: outside-flag propagation + interior-lake fill

function buildBackgroundLayer() {
    try {
        const L = (typeof mediaLayers !== 'undefined') ? mediaLayers[0] : null;
        if (!L || !L.mesh || L.type !== 'image' || !L.textures?.color || !L.textures?.depth) {
            alert('BG layer v1 needs an image layer with color + depth (layer 0).');
            return false;
        }
        // RUNG LIVE (stage 1): the certified pipeline runs on ANY asset at
        // build time; serialized records are demoted to regression fixtures
        // and fallback (they engage only if the live bake fails).
        if (!applyLiveBake(L)) {
            applyCertifiedSource(L);   // fallback: certified sharpened record
            applyCertifiedDetector(L); // fallback: certified detector record
        }
        if (!fgMarkDilationMaterial) {
            alert('Run one frame of the FG pipeline first (materials not initialized).');
            return false;
        }
        const postProcessQuad = postProcessScene.children[0];
        const w = renderer.domElement.width, h = renderer.domElement.height;
        const texel = new THREE.Vector2(1.0 / w, 1.0 / h);

        const near = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat, type: THREE.HalfFloatType };
        const lin  = { minFilter: THREE.LinearFilter,  magFilter: THREE.LinearFilter,  format: THREE.RGBAFormat, type: THREE.HalfFloatType };
        const need = (t, opts) => (!t || t.width !== w || t.height !== h) ? new THREE.WebGLRenderTarget(w, h, opts) : t;
        if (srcBandTargetA && (srcBandTargetA.width !== w || srcBandTargetA.height !== h)) { srcBandTargetA.dispose(); srcBandTargetA = null; }
        if (srcBandTargetB && (srcBandTargetB.width !== w || srcBandTargetB.height !== h)) { srcBandTargetB.dispose(); srcBandTargetB = null; }
        if (bgDepthTarget  && (bgDepthTarget.width  !== w || bgDepthTarget.height  !== h)) { bgDepthTarget.dispose();  bgDepthTarget  = null; }
        if (bgColorTarget  && (bgColorTarget.width  !== w || bgColorTarget.height  !== h)) { bgColorTarget.dispose();  bgColorTarget  = null; }
        srcBandTargetA = need(srcBandTargetA, near);
        srcBandTargetB = need(srcBandTargetB, near);
        bgDepthTarget  = need(bgDepthTarget,  lin);
        bgColorTarget  = need(bgColorTarget,  lin);

        const vs = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`;
        if (!srcBandSeedMaterial) {
            srcBandSeedMaterial = new THREE.ShaderMaterial({
                uniforms: { tSrcDepth: { value: null }, u_texelSize: { value: new THREE.Vector2() },
                            u_edgeThresh: { value: 0.03 }, u_reachPx: { value: 120.0 },
                            tEdgeBake: { value: null },      // RUNG D: certified detector record
                            u_useEdgeBake: { value: false }, // gate only when certified
                            u_seedMode: { value: 0 } }, // 0=sharp(r1, v3.1) 1=soft(r1+r3) 2=concentrated
                vertexShader: vs,
                fragmentShader: `
                    uniform sampler2D tSrcDepth;
                    uniform vec2 u_texelSize;
                    uniform float u_edgeThresh;
                    uniform float u_reachPx;
                    uniform int u_seedMode;
                    uniform sampler2D tEdgeBake;
                    uniform bool u_useEdgeBake;
                    varying vec2 vUv;
                    void main() {
                        float d = texture2D(tSrcDepth, vUv).r;
                        // RUNG D: on the certified asset, only the certified
                        // slope-relative detector record may seed.
                        if (u_useEdgeBake && texture2D(tEdgeBake, vUv).r < 0.5) {
                            gl_FragColor = vec4(d, d, 0.0, 0.0);
                            return;
                        }
                        // Seed-mode A/B (see dropdown):
                        //   0 SHARP (v3.1): radius-1 step only. Never false-seeds
                        //     on relief, but misses soft silhouettes (unplugged
                        //     cave root -> magenta in plug-error).
                        //   1 SOFT (rings 1+3): catches soft edges, but also fires
                        //     on smooth gradients -> BG clones FG (v3.2 regression).
                        //   2 CONCENTRATED: ring-3 step accepted only when it is
                        //     the majority of the ring-6 step (localized ramp =
                        //     silhouette; extended ramp = slope). Untested against
                        //     rounded relief lobes -- that is what the A/B decides.
                        float min1 = d;
                        float min3 = d;
                        float min6 = d;
                        for (int dy = -1; dy <= 1; dy++) {
                            for (int dx = -1; dx <= 1; dx++) {
                                if (dx == 0 && dy == 0) continue;
                                vec2 o = vec2(float(dx), float(dy));
                                float d1 = texture2D(tSrcDepth, vUv + o * u_texelSize).r;
                                float d3 = texture2D(tSrcDepth, vUv + o * 3.0 * u_texelSize).r;
                                float d6 = texture2D(tSrcDepth, vUv + o * 6.0 * u_texelSize).r;
                                min1 = min(min1, d1);
                                min3 = min(min3, min(d1, d3));
                                min6 = min(min6, min(min(d1, d3), d6));
                            }
                        }
                        float minNbr = d;
                        float step_ = 0.0;
                        if (u_seedMode == 0) {
                            minNbr = min1;
                            step_ = d - min1;
                        } else if (u_seedMode == 1) {
                            minNbr = min3;
                            step_ = d - min3;
                        } else {
                            float step3 = d - min3;
                            float step6 = d - min6;
                            minNbr = min3;
                            step_ = (step3 > 0.6 * step6) ? step3 : 0.0;
                        }
                        if (step_ > u_edgeThresh) {
                            // FG rim pixel: seed the under-FG band. Same channel
                            // contract as screen space (R=rim, G=own, B=budget, A=1).
                            float budget = clamp(u_reachPx * step_, 1.0, 63.0) / 64.0;
                            gl_FragColor = vec4(minNbr, d, budget, 1.0);
                        } else {
                            gl_FragColor = vec4(d, d, 0.0, 0.0);
                        }
                    }
                `,
                depthWrite: false, depthTest: false
            });
            bgCombineMaterial = new THREE.ShaderMaterial({
                uniforms: { tBand: { value: null }, tSrcDepth: { value: null } },
                vertexShader: vs,
                fragmentShader: `
                    uniform sampler2D tBand;
                    uniform sampler2D tSrcDepth;
                    varying vec2 vUv;
                    void main() {
                        vec4 b = texture2D(tBand, vUv);
                        float d = (b.a > 0.5) ? b.r : texture2D(tSrcDepth, vUv).r;
                        gl_FragColor = vec4(d, d, d, 1.0);
                    }
                `,
                depthWrite: false, depthTest: false
            });
            bgMorphMaterial = new THREE.ShaderMaterial({
                uniforms: { tSrc: { value: null }, u_texelSize: { value: new THREE.Vector2() }, u_op: { value: 0 } },
                vertexShader: vs,
                fragmentShader: `
                    uniform sampler2D tSrc;
                    uniform vec2 u_texelSize;
                    uniform int u_op; // 0 = erode (min), 1 = dilate (max)
                    varying vec2 vUv;
                    void main() {
                        float v = texture2D(tSrc, vUv).r;
                        for (int dy = -1; dy <= 1; dy++) {
                            for (int dx = -1; dx <= 1; dx++) {
                                if (dx == 0 && dy == 0) continue;
                                float n = texture2D(tSrc, vUv + vec2(float(dx), float(dy)) * u_texelSize).r;
                                v = (u_op == 0) ? min(v, n) : max(v, n);
                            }
                        }
                        gl_FragColor = vec4(v, v, v, 1.0);
                    }
                `,
                depthWrite: false, depthTest: false
            });
            bgLakeMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    tBand: { value: null },   // mark field (A=1 marked)
                    tFlag: { value: null },   // outside-reachability field (R=1 outside)
                    tSrcDepth: { value: null },
                    u_texelSize: { value: new THREE.Vector2() },
                    u_mode: { value: 0 }      // 0 = propagate outside flag, 1 = fill lakes
                },
                vertexShader: vs,
                fragmentShader: `
                    uniform sampler2D tBand;
                    uniform sampler2D tFlag;
                    uniform sampler2D tSrcDepth;
                    uniform vec2 u_texelSize;
                    uniform int u_mode;
                    varying vec2 vUv;
                    void main() {
                        if (u_mode == 0) {
                            // OUTSIDE-FLAG PROPAGATION with a SEALED wall (v3.8).
                            // Measured on the live mask: the budget frontier is
                            // porous at exactly 1px -- the outside flag threaded
                            // through stipple channels into the interiors, so the
                            // v3.7 closure correctly refused to fill regions that
                            // topology said were reachable. Sealing the wall by a
                            // 1px dilation raised captured lake area 8.6x on the
                            // real data (8,084 -> 69,758 px). The wall here is
                            // therefore the DILATED mark field; propagation relays
                            // only from already-flagged neighbors, which respects
                            // walls implicitly (a wall pixel never gets flagged).
                            bool wall = texture2D(tBand, vUv).a > 0.5;
                            for (int dy = -1; dy <= 1 && !wall; dy++) {
                                for (int dx = -1; dx <= 1; dx++) {
                                    if (dx == 0 && dy == 0) continue;
                                    if (texture2D(tBand, vUv + vec2(float(dx), float(dy)) * u_texelSize).a > 0.5) { wall = true; break; }
                                }
                            }
                            if (wall) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
                            bool border = vUv.x < u_texelSize.x || vUv.y < u_texelSize.y ||
                                          vUv.x > 1.0 - u_texelSize.x || vUv.y > 1.0 - u_texelSize.y;
                            if (border) { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); return; }
                            if (texture2D(tFlag, vUv).r > 0.5) { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); return; }
                            for (int dy = -1; dy <= 1; dy++) {
                                for (int dx = -1; dx <= 1; dx++) {
                                    if (dx == 0 && dy == 0) continue;
                                    if (texture2D(tFlag, vUv + vec2(float(dx), float(dy)) * u_texelSize).r > 0.5) {
                                        gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); return;
                                    }
                                }
                            }
                            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
                        } else {
                            // LAKE FILL: unmarked + not outside-reachable = enclosed.
                            // Grow marking inward from the shoreline, inheriting the
                            // minimum neighboring rim target, so the harmonic pass
                            // sees only the true OUTER rim as boundary.
                            vec4 band = texture2D(tBand, vUv);
                            if (band.a > 0.5) { gl_FragColor = band; return; }
                            if (texture2D(tFlag, vUv).r > 0.5) { gl_FragColor = band; return; } // true BG
                            float bestR = 1.0;
                            bool touch = false;
                            for (int dy = -1; dy <= 1; dy++) {
                                for (int dx = -1; dx <= 1; dx++) {
                                    if (dx == 0 && dy == 0) continue;
                                    vec2 uv2 = vUv + vec2(float(dx), float(dy)) * u_texelSize;
                                    vec4 nb = texture2D(tBand, uv2);
                                    if (nb.a > 0.5 && nb.b < 0.995) { touch = true; bestR = min(bestR, nb.r); }
                                }
                            }
                            if (touch) {
                                float own = texture2D(tSrcDepth, vUv).r;
                                gl_FragColor = vec4(bestR, own, 62.0 / 64.0, 1.0);
                            } else {
                                gl_FragColor = band;
                            }
                        }
                    }
                `,
                depthWrite: false, depthTest: false
            });
            bgColorSeedMaterial = new THREE.ShaderMaterial({
                uniforms: { tColor: { value: null }, tSrcDepth: { value: null }, tBgDepth: { value: null },
                            u_texel: { value: new THREE.Vector2() } },
                vertexShader: vs,
                fragmentShader: `
                    uniform sampler2D tColor;
                    uniform sampler2D tSrcDepth;
                    uniform sampler2D tBgDepth;
                    uniform vec2 u_texel;
                    varying vec2 vUv;
                    void main() {
                        // COLOR follows DEPTH (v3.9). Previously color was filled
                        // only inside the parallax band while depth was flooded
                        // across the whole interior -- so the BG layer carried the
                        // foreground's PICTURE wallpapered at plug depth, and the
                        // BG-solo view was guaranteed to show a "clone" regardless
                        // of any depth fix. Contract now: wherever the plug
                        // replaced the depth, the color is inpainted too; wherever
                        // depth passed through, the layer is simply the source.
                        // v3.9.1 ONE-SIDED SOURCES: a pixel may feed the color
                        // pyramid only if the depth plug replaced NOTHING within
                        // 2px of it. Dilating the replaced set covers band +
                        // closure + filled lakes identically to whatever the
                        // depth combine consumed; the dilation IS the
                        // silhouette-fringe erosion, from the source side.
                        bool invalid = false;
                        for (int dy = -2; dy <= 2; dy++)
                        for (int dx = -2; dx <= 2; dx++) {
                            vec2 uv2 = vUv + vec2(float(dx), float(dy)) * u_texel;
                            float s2 = texture2D(tSrcDepth, uv2).r;
                            float b2 = texture2D(tBgDepth, uv2).r;
                            if (s2 - b2 > 0.02) { invalid = true; }
                        }
                        if (invalid) { gl_FragColor = vec4(0.0); }
                        else { gl_FragColor = vec4(texture2D(tColor, vUv).rgb, 1.0); }
                    }
                `,
                depthWrite: false, depthTest: false
            });
        }

        const reach = parseFloat(document.getElementById('fgReachSlider')?.value || '120');
        const thr = parseFloat(document.getElementById('fgSubThresholdSlider')?.value || '0.05');

        // --- Pass 0: BG DEPTH = FULL-INTERIOR RIM FLOOD ---
        // The morphological opening (previous construction) used a SQUARE
        // structuring element (Chebyshev again) and, more fundamentally, cannot
        // remove foreground WIDER than its radius — wide FG survived as hard
        // rectangular slabs at FG depth (the protrusions in BG-solo, and the
        // solid red in plug-error where gaps overlapped them). Instead: seed at
        // every silhouette and run the SAME monotone rim-carrying dilation with
        // UNLIMITED budget until the entire FG interior is flooded. Fronts
        // follow the depth field (no structuring-element geometry), blob width
        // is irrelevant, and continuity at the silhouette is by construction.
        {
            postProcessQuad.material = srcBandSeedMaterial;
            srcBandSeedMaterial.uniforms.tSrcDepth.value = L.textures.depth;
            srcBandSeedMaterial.uniforms.tEdgeBake.value = L.textures.edgeMask || null;
            srcBandSeedMaterial.uniforms.u_useEdgeBake.value = !!L.textures.edgeMask;
            srcBandSeedMaterial.uniforms.u_texelSize.value.copy(texel);
            srcBandSeedMaterial.uniforms.u_edgeThresh.value = Math.max(thr, 0.03);
            srcBandSeedMaterial.uniforms.u_reachPx.value = 120.0; // irrelevant in unlimited mode
            srcBandSeedMaterial.uniforms.u_seedMode.value = parseInt(document.getElementById('bgSeedModeSel')?.value || '0');
            renderer.setRenderTarget(srcBandTargetB);
            renderer.setViewport(0, 0, w, h);
            renderer.clear();
            renderer.render(postProcessScene, postProcessCamera);

            let rT = srcBandTargetB, wT = srcBandTargetA;
            postProcessQuad.material = fgMarkDilationMaterial;
            fgMarkDilationMaterial.uniforms.tSceneDepth.value = L.textures.depth;
            fgMarkDilationMaterial.uniforms.u_texelSize.value.copy(texel);
            fgMarkDilationMaterial.uniforms.u_fgThreshold.value = thr;
            fgMarkDilationMaterial.uniforms.u_unlimitedBudget.value = true;
            const relaxSel = document.getElementById('bgRelaxModeSel')?.value || 'min';
            const FULL_FLOOD_ITERS = 192; // must exceed the widest FG blob's radius in px

            // v3.7 LAKE CLOSURE, run between coverage (Phase A) and smoothing
            // (Phase B). Uses the fgMask ping-pong pair as scratch for the
            // outside-reachability field.
            const runLakeClosure = () => {
                console.log('[BG-LAYER] lake closure: sealed-wall flag flood (256) + lake fill (128)');
                if (!fgMaskTargetA || fgMaskTargetA.width !== w || fgMaskTargetA.height !== h) {
                    if (fgMaskTargetA) fgMaskTargetA.dispose();
                    if (fgMaskTargetB) fgMaskTargetB.dispose();
                    const o = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
                                format: THREE.RGBAFormat, type: THREE.HalfFloatType };
                    fgMaskTargetA = new THREE.WebGLRenderTarget(w, h, o);
                    fgMaskTargetB = new THREE.WebGLRenderTarget(w, h, o);
                }
                bgLakeMaterial.uniforms.tSrcDepth.value = L.textures.depth;
                bgLakeMaterial.uniforms.u_texelSize.value.copy(texel);
                // A2: propagate outside flag through unmarked pixels (band in rT)
                let fr = fgMaskTargetB, fw = fgMaskTargetA;
                renderer.setRenderTarget(fr); renderer.setViewport(0, 0, w, h);
                renderer.setClearColor(new THREE.Color(0, 0, 0), 1.0); renderer.clear();
                bgLakeMaterial.uniforms.u_mode.value = 0;
                bgLakeMaterial.uniforms.tBand.value = rT.texture;
                postProcessQuad.material = bgLakeMaterial;
                const FLAG_ITERS = 256;
                for (let i = 0; i < FLAG_ITERS; i++) {
                    bgLakeMaterial.uniforms.tFlag.value = fr.texture;
                    renderer.setRenderTarget(fw);
                    renderer.setViewport(0, 0, w, h);
                    renderer.clear();
                    renderer.render(postProcessScene, postProcessCamera);
                    const t = fr; fr = fw; fw = t;
                }
                // A3: fill lakes inward from their shorelines
                bgLakeMaterial.uniforms.u_mode.value = 1;
                bgLakeMaterial.uniforms.tFlag.value = fr.texture;
                const LAKE_ITERS = 128;
                for (let i = 0; i < LAKE_ITERS; i++) {
                    bgLakeMaterial.uniforms.tBand.value = rT.texture;
                    renderer.setRenderTarget(wT);
                    renderer.setViewport(0, 0, w, h);
                    renderer.clear();
                    renderer.render(postProcessScene, postProcessCamera);
                    const t = rT; rT = wT; wT = t;
                }
            };

            if (relaxSel === 'harmonic') {
                // v3.2 plan: first-arrival coverage, then anchored Jacobi averaging.
                fgMarkDilationMaterial.uniforms.u_relaxMode.value = 0;
                for (let i = 0; i < FULL_FLOOD_ITERS; i++) {
                    fgMarkDilationMaterial.uniforms.tMask.value = rT.texture;
                    renderer.setRenderTarget(wT);
                    renderer.setViewport(0, 0, w, h);
                    renderer.clear();
                    renderer.render(postProcessScene, postProcessCamera);
                    const t = rT; rT = wT; wT = t;
                }
                runLakeClosure();
                postProcessQuad.material = fgMarkDilationMaterial;
                fgMarkDilationMaterial.uniforms.u_relaxMode.value = 2;
                const HARMONIC_ITERS = 96;
                for (let i = 0; i < HARMONIC_ITERS; i++) {
                    fgMarkDilationMaterial.uniforms.tMask.value = rT.texture;
                    renderer.setRenderTarget(wT);
                    renderer.setViewport(0, 0, w, h);
                    renderer.clear();
                    renderer.render(postProcessScene, postProcessCamera);
                    const t = rT; rT = wT; wT = t;
                }
            } else {
                // v3.1 plan: min relaxation throughout (the trusted baseline).
                fgMarkDilationMaterial.uniforms.u_relaxMode.value = 1;
                for (let i = 0; i < FULL_FLOOD_ITERS; i++) {
                    fgMarkDilationMaterial.uniforms.tMask.value = rT.texture;
                    renderer.setRenderTarget(wT);
                    renderer.setViewport(0, 0, w, h);
                    renderer.clear();
                    renderer.render(postProcessScene, postProcessCamera);
                    const t = rT; rT = wT; wT = t;
                }
                runLakeClosure();
            }
            fgMarkDilationMaterial.uniforms.u_unlimitedBudget.value = false;
            fgMarkDilationMaterial.uniforms.u_relaxMode.value = 1;

            // Combine: flooded FG interior -> carried rim depth; else source depth
            postProcessQuad.material = bgCombineMaterial;
            bgCombineMaterial.uniforms.tBand.value = rT.texture;
            bgCombineMaterial.uniforms.tSrcDepth.value = L.textures.depth;
            renderer.setRenderTarget(bgDepthTarget);
            renderer.setViewport(0, 0, w, h);
            renderer.clear();
            renderer.render(postProcessScene, postProcessCamera);
        }

        // --- Pass 1: seed at source depth discontinuities ---
        postProcessQuad.material = srcBandSeedMaterial;
        srcBandSeedMaterial.uniforms.tSrcDepth.value = L.textures.depth;
        srcBandSeedMaterial.uniforms.tEdgeBake.value = L.textures.edgeMask || null;
        srcBandSeedMaterial.uniforms.u_useEdgeBake.value = !!L.textures.edgeMask;
        srcBandSeedMaterial.uniforms.u_texelSize.value.copy(texel);
        srcBandSeedMaterial.uniforms.u_edgeThresh.value = Math.max(thr, 0.03);
        srcBandSeedMaterial.uniforms.u_reachPx.value = reach;
        renderer.setRenderTarget(srcBandTargetB);
        renderer.setViewport(0, 0, w, h);
        renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);

        // --- Pass 2: dilate with the SAME mark shader (source depth as scene depth) ---
        let readT = srcBandTargetB, writeT = srcBandTargetA;
        postProcessQuad.material = fgMarkDilationMaterial;
        fgMarkDilationMaterial.uniforms.tSceneDepth.value = L.textures.depth;
        fgMarkDilationMaterial.uniforms.u_texelSize.value.copy(texel);
        fgMarkDilationMaterial.uniforms.u_fgThreshold.value = thr;
        fgMarkDilationMaterial.uniforms.u_fgReachPx.value = reach;
        fgMarkDilationMaterial.uniforms.u_unlimitedBudget.value = false;
        fgMarkDilationMaterial.uniforms.u_relaxMode.value = 1;
        for (let i = 0; i < 64; i++) {
            fgMarkDilationMaterial.uniforms.tMask.value = readT.texture;
            renderer.setRenderTarget(writeT);
            renderer.setViewport(0, 0, w, h);
            renderer.clear();
            renderer.render(postProcessScene, postProcessCamera);
            const t = readT; readT = writeT; writeT = t;
        }
        if (readT !== srcBandTargetA) {
            postProcessQuad.material = copyMaterial;
            copyMaterial.uniforms.tDiffuse.value = readT.texture;
            renderer.setRenderTarget(srcBandTargetA);
            renderer.clear();
            renderer.render(postProcessScene, postProcessCamera);
        }

        // (Old Pass 3, band-carved depth, removed: bgDepthTarget already holds
        //  the morphological opening from Pass 0 — cliff-free by construction.)

        // --- Pass 4: baked BG color (one-shot pull-push over the band) ---
        if (pullPyramidTargets.length >= 2 && pullMaterial && pushMaterial) {
            postProcessQuad.material = bgColorSeedMaterial;
            bgColorSeedMaterial.uniforms.tColor.value = L.textures.color;
            bgColorSeedMaterial.uniforms.tSrcDepth.value = L.textures.depth;
            bgColorSeedMaterial.uniforms.tBgDepth.value = bgDepthTarget.texture;
            bgColorSeedMaterial.uniforms.u_texel.value.copy(texel);
            renderer.setRenderTarget(pullPyramidTargets[0]);
            renderer.setViewport(0, 0, pullPyramidTargets[0].width, pullPyramidTargets[0].height);
            renderer.clear();
            renderer.render(postProcessScene, postProcessCamera);

            const n = pullPyramidTargets.length;
            postProcessQuad.material = pullMaterial;
            for (let i = 1; i < n; i++) {
                pullMaterial.uniforms.tFinerLevel.value = pullPyramidTargets[i - 1].texture;
                pullMaterial.uniforms.u_texelSize.value.set(1.0 / pullPyramidTargets[i - 1].width, 1.0 / pullPyramidTargets[i - 1].height);
                renderer.setRenderTarget(pullPyramidTargets[i]);
                renderer.setViewport(0, 0, pullPyramidTargets[i].width, pullPyramidTargets[i].height);
                renderer.clear();
                renderer.render(postProcessScene, postProcessCamera);
            }
            postProcessQuad.material = copyMaterial;
            copyMaterial.uniforms.tDiffuse.value = pullPyramidTargets[n - 1].texture;
            renderer.setRenderTarget(pushPyramidTargets[n - 1]);
            renderer.setViewport(0, 0, pushPyramidTargets[n - 1].width, pushPyramidTargets[n - 1].height);
            renderer.render(postProcessScene, postProcessCamera);
            postProcessQuad.material = pushMaterial;
            for (let i = n - 2; i >= 0; i--) {
                pushMaterial.uniforms.tCurrentLevel.value = pullPyramidTargets[i].texture;
                pushMaterial.uniforms.tCoarserLevel.value = pushPyramidTargets[i + 1].texture;
                renderer.setRenderTarget(pushPyramidTargets[i]);
                renderer.setViewport(0, 0, pushPyramidTargets[i].width, pushPyramidTargets[i].height);
                renderer.clear();
                renderer.render(postProcessScene, postProcessCamera);
            }
            postProcessQuad.material = copyMaterial;
            copyMaterial.uniforms.tDiffuse.value = pushPyramidTargets[0].texture;
            renderer.setRenderTarget(bgColorTarget);
            renderer.setViewport(0, 0, w, h);
            renderer.clear();
            renderer.render(postProcessScene, postProcessCamera);
            bgBuildStamp = new Date().toISOString().slice(11, 19);
        } else {
            console.warn('[BG-LAYER] pyramid targets unavailable; BG color = source color');
            postProcessQuad.material = copyMaterial;
            copyMaterial.uniforms.tDiffuse.value = L.textures.color;
            renderer.setRenderTarget(bgColorTarget);
            renderer.clear();
            renderer.render(postProcessScene, postProcessCamera);
        }
        renderer.setRenderTarget(null);

        // --- Pass 5: the mesh ---
        if (bgLayerMesh) {
            scene.remove(bgLayerMesh);
            bgLayerMesh.material.dispose();
            // dispose our own oversized geometry, but never the shared FG geometry
            if (bgLayerMesh.geometry && L.mesh && bgLayerMesh.geometry !== L.mesh.geometry) bgLayerMesh.geometry.dispose();
            bgLayerMesh = null;
        }
        const mat = L.mesh.material.clone();
        mat.uniforms.map.value = bgColorTarget.texture;
        // RUNG LIVE PLUG: compute correct plug on CPU from loaded PNGs.
        // No GPU readback, no encoding guesses — all three inputs are verified offline.
        // [PERF] coarse stage timer — logged as one line at build end
        const _pt0 = Date.now(); let _ptPrev = _pt0; const _perf = [];
        const _mark = (n) => { const t = Date.now(); if (t - _ptPrev > 15) _perf.push(n + ' ' + (t - _ptPrev) + 'ms'); _ptPrev = t; };
        let _plugTex = bgDepthTarget.texture;
        let _fillTex = null; // nearest-valid color fill for the plug holes (Law 4)
        let bgExtGeom = null; // oversized geometry when scene extension is on (else reuse FG geom)
        let _midBand = null, _midDepthV = null, _midRimC = null, _midFillRGB = null, _midPW = 0, _midPH = 0, _midFrontD = null; // under-sheet (MPI slice 2)
        bgExtendExport = null;
        const _depthImgReady = L.textures.depth && (L.textures.depth.image || L.textures.depth.isDataTexture);
        if (_depthImgReady && (bgPlugMode === 'directional' || (typeof MoebiusPlug !== 'undefined' && bgBandImg && (bgValidImg || bgValidMode !== 'png')))) {
            try {
                const t0 = Date.now();
                // CRITICAL: run the plug at the asset's NATIVE resolution, NOT the
                // renderer canvas size (w/h). renderer.domElement is sized to the
                // window (e.g. 860x484 landscape) while the asset is 851x1023
                // portrait; drawing the band/valid/depth into a canvas of the wrong
                // size resamples the masks onto an aspect-distorted grid, so the
                // isotropic boxMin(21)/Jacobi run on a stretched field and the plug
                // extrudes. The mesh samples displacementMap by UV, so a native-res
                // texture aligns regardless of canvas size. Native dims come from the
                // depth image (== band/valid PNG native = 851x1023 on the reference).
                const dSrc = L.textures.depth;
                const dImg = dSrc.image;
                const pw = (dImg && (dImg.naturalWidth || dImg.width)) || (bgBandImg && bgBandImg.naturalWidth) || w;
                const ph = (dImg && (dImg.naturalHeight || dImg.height)) || (bgBandImg && bgBandImg.naturalHeight) || h;
                const PN = pw * ph;
                const cv = document.createElement('canvas'); cv.width = pw; cv.height = ph;
                const cx = cv.getContext('2d', { willReadFrequently: true });
                // read sharpened depth from the layer's depth texture (img/canvas =
                // top-row-first, matching the band/valid PNGs read below)
                if (dSrc.image2d) {
                    cx.drawImage(dSrc.image2d, 0, 0, pw, ph);
                } else if (dImg && dImg.tagName) {
                    cx.drawImage(dImg, 0, 0, pw, ph);
                } else {
                    // DataTexture fallback — render to a temp target and read back.
                    // readRenderTargetPixels is bottom-row-first (GL origin), so flip
                    // vertically into the canvas to keep it top-row-first like the PNGs.
                    const rt = new THREE.WebGLRenderTarget(pw, ph, {type: THREE.UnsignedByteType});
                    const cm = new THREE.ShaderMaterial({uniforms:{t:{value:dSrc}},
                        vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position,1.0);}',
                        fragmentShader:'uniform sampler2D t;varying vec2 vUv;void main(){gl_FragColor=texture2D(t,vUv);}'});
                    const q = new THREE.Mesh(new THREE.PlaneGeometry(2,2), cm);
                    const s2 = new THREE.Scene(); s2.add(q);
                    const c2 = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
                    renderer.setRenderTarget(rt); renderer.render(s2, c2);
                    const px = new Uint8Array(PN*4);
                    renderer.readRenderTargetPixels(rt, 0, 0, pw, ph, px);
                    renderer.setRenderTarget(null);
                    rt.dispose(); cm.dispose();
                    const id = cx.createImageData(pw, ph);
                    for (let y = 0; y < ph; y++) {
                        const s = (ph-1-y)*pw*4, d = y*pw*4;
                        for (let k = 0; k < pw*4; k++) id.data[d+k] = px[s+k];
                    }
                    cx.putImageData(id, 0, 0);
                }
                const dpx = cx.getImageData(0, 0, pw, ph).data;
                const depth = new Float32Array(PN);
                for (let i = 0; i < PN; i++) depth[i] = dpx[i * 4] / 255;
                _mark('depth-read');
                let thinM = null;       // thin near-class features (staff, glider): protected + depth-haloed
                let haloM = null;       // pixels raised by the thin-feature depth halo (rigid ribbon skirt)
                let dispDepth = depth;  // DISPLAYED depth (haloed when the halo applies this build)
                let floorField = null;  // local lower envelope (shared: floor rind + under-sheet)
                let midBand = null;     // under-sheet band (internal-overlap near-side footprint)
                let midDepthV = null;   // carried LOCAL far-side depth per under-sheet pixel
                let midRimC = null;     // carried far-side rim pixel index (colour base)
                let midFillRGB = null;  // under-sheet colours (depth-consistent continuation at carried depth)
                let band, plugDepth, rimSrc = null;
                let bandCutMask = null; // dilated band; where the FG may cut AND the fill must be opaque
                let underMask = null;   // occluder rind removed from the plug depth (world-without-FG)
                let underRimC = null;   // per-completed-pixel LOCAL rim source index (fill colour)
                // ---- SOURCE-DEPTH DESPECKLE / GLOW-ATTACH (review-fix v5) ----
                // Soft mid-depth blobs floating over the smooth far field (the lamp
                // glow, sparkle haze) are source depth-map defects: their ramps
                // (~0.01/px over tens of px) are below every tear detector, so they
                // anchor stretched displacement walls that the depth pass's
                // glancing-angle discards then chop into dash-row streaks. Detect
                // raised-vs-local-floor components that are SOFT everywhere (ink-
                // edged objects — birds, crystals, people — are sharp somewhere and
                // are kept; big regions like continuous dune ramps are size-capped).
                // A soft blob touching a NEAR structure attaches to it (glow rides
                // the staff; its rim is freed by the halo-edge tear); an isolated
                // one flattens into the local floor. Self-idempotent on rebuilds.
                {
                    const otsuD = bgOtsuThreshold(depth, null);
                    const ds = 4, dw2 = Math.ceil(pw/ds), dh2 = Math.ceil(ph/ds);
                    let dmin = new Float32Array(dw2*dh2).fill(2);
                    for (let y = 0; y < ph; y++) { const r0 = ((y/ds)|0)*dw2, r1 = y*pw;
                        for (let x = 0; x < pw; x++) { const j = r0 + ((x/ds)|0);
                            const v = depth[r1+x]; if (v < dmin[j]) dmin[j] = v; } }
                    const RD = 6; // 24px full-res floor window: wider than the glow blobs
                    const tmpD = new Float32Array(dw2*dh2);
                    for (let y = 0; y < dh2; y++) for (let x = 0; x < dw2; x++) { let m = 2;
                        for (let o = -RD; o <= RD; o++) { const xx = x+o; if (xx<0||xx>=dw2) continue;
                            const v = dmin[y*dw2+xx]; if (v<m) m=v; } tmpD[y*dw2+x]=m; }
                    for (let x = 0; x < dw2; x++) for (let y = 0; y < dh2; y++) { let m = 2;
                        for (let o = -RD; o <= RD; o++) { const yy = y+o; if (yy<0||yy>=dh2) continue;
                            const v = tmpD[yy*dw2+x]; if (v<m) m=v; } dmin[y*dw2+x]=m; }
                    const bmin = (i) => dmin[((((i/pw)|0)/ds)|0)*dw2 + ((((i%pw))/ds)|0)];
                    // Preliminary THIN mask (the official one comes later, band-
                    // excluded): a floating lamp hangs off a THIN carrier (staff,
                    // pole, string); broad emissive fields — sunbursts, cave light
                    // shafts — lean against LARGE bodies and must never attach
                    // (they are painted background, not detached lamp light).
                    const nearP = new Uint8Array(PN);
                    for (let i = 0; i < PN; i++) nearP[i] = depth[i] >= otsuD ? 1 : 0;
                    let EP = nearP;
                    for (let p = 0; p < 2; p++) { const ne = new Uint8Array(PN);
                        for (let y = 1; y < ph - 1; y++) for (let x = 1; x < pw - 1; x++) { const i = y*pw+x;
                            if (EP[i] && EP[i-1] && EP[i+1] && EP[i-pw] && EP[i+pw]) ne[i] = 1; }
                        EP = ne; }
                    // 8 geodesic passes (vs the 3 of the tear-protection thin mask):
                    // a fur fringe is thin but hugs its body within a few px — only
                    // structures extending FAR from any thick core (a staff) qualify
                    // as carriers.
                    let RP = EP;
                    for (let p = 0; p < 8; p++) { const nr = new Uint8Array(PN);
                        for (let y = 1; y < ph - 1; y++) for (let x = 1; x < pw - 1; x++) { const i = y*pw+x;
                            if (!nearP[i]) continue;
                            if (RP[i] || RP[i-1] || RP[i+1] || RP[i-pw] || RP[i+pw]) nr[i] = 1; }
                        RP = nr; }
                    const thinP = new Uint8Array(PN);
                    for (let i = 0; i < PN; i++) if (nearP[i] && !RP[i]) thinP[i] = 1;
                    const raised = new Uint8Array(PN);
                    for (let i = 0; i < PN; i++) if (depth[i] < otsuD && depth[i] - bmin(i) > fgTearStep) raised[i] = 1;
                    const label = new Int32Array(PN);
                    const qq = new Int32Array(PN);
                    const CAP = (PN/100)|0;
                    let comp = 0, nAttach = 0, nFlat = 0, nKeep = 0, pxChanged = 0;
                    for (let s = 0; s < PN; s++) {
                        if (!raised[s] || label[s]) continue;
                        comp++;
                        let head = 0, tail = 0; qq[tail++] = s; label[s] = comp;
                        let maxRim = 0, attachD = -1, bodyAdj = false;
                        const members = [];
                        while (head < tail) {
                            const i = qq[head++]; members.push(i);
                            const x = i%pw, y = (i/pw)|0;
                            const nbs = [x>0?i-1:-1, x<pw-1?i+1:-1, y>0?i-pw:-1, y<ph-1?i+pw:-1];
                            for (const j of nbs) {
                                if (j < 0) continue;
                                if (raised[j]) { if (!label[j]) { label[j] = comp; qq[tail++] = j; } continue; }
                                // softness is judged on the BOUNDARY only: an ink-edged
                                // object (bird, ship, crystal) is sharp around its rim;
                                // a glow fades softly into the sky everywhere. Internal
                                // sharpness (a bright lamp core) must not veto. Steps
                                // onto NEAR pixels are the attach interface, not a rim.
                                if (depth[j] >= otsuD) {
                                    if (thinP[j]) { if (depth[j] > attachD) attachD = depth[j]; }
                                    else bodyAdj = true;
                                    continue;
                                }
                                const st = Math.abs(depth[i]-depth[j]); if (st > maxRim) maxRim = st;
                            }
                        }
                        if (members.length > CAP || maxRim >= fgTearStep) { nKeep++; continue; }
                        if (attachD > 0) {          // hangs off a THIN carrier: ride it
                            if (!haloM) haloM = new Uint8Array(PN);
                            for (const i of members) { depth[i] = attachD; haloM[i] = 1; }
                            nAttach++; pxChanged += members.length;
                        } else if (bodyAdj) {        // leans on a large body: painted
                            nKeep++;                 // relief/highlight — leave it be
                        } else {
                            for (const i of members) depth[i] = bmin(i);
                            nFlat++; pxChanged += members.length;
                        }
                    }
                    // GLOW-ATTACH: bright emissive blobs painted at FLOOR depth —
                    // the lamp flame, its rays and halo: the depth generator never
                    // saw them, so they ride the sky and shear off their staff at
                    // off-axis poses (the measured +65px light detach). Detect
                    // brightness ANOMALIES against the local background level
                    // (the pale distant plain is its own local norm — not an
                    // anomaly; isolated stars attach to nothing and are skipped),
                    // at floor depth, touching a NEAR structure: assign them that
                    // structure's depth and mark them into the rigid ribbon so
                    // the halo-edge tear frees their rim.
                    // DEFAULT OFF (bgGlowAttach): works exactly as intended on a
                    // lamp-on-a-staff painting (verified: the starwatcher lamp and
                    // its full glow ride the staff), but colour brightness alone
                    // cannot reliably separate "detached lamp light" from painted
                    // emissive BACKGROUND (sunbursts, cave light shafts) — on such
                    // paintings it over-claims. Missing-object depth belongs to the
                    // depth-regeneration stage; flip this flag per-import until then.
                    if (bgGlowAttach) {
                        const cImgD = (L.textures.color && L.textures.color.image) || (L.elements && L.elements.color);
                        if (cImgD) {
                            cx.clearRect(0, 0, pw, ph);
                            cx.drawImage(cImgD, 0, 0, pw, ph);
                            const cpxD = cx.getImageData(0, 0, pw, ph).data;
                            const luma = new Float32Array(PN);
                            for (let i = 0; i < PN; i++) luma[i] = (cpxD[i*4] + 2*cpxD[i*4+1] + cpxD[i*4+2]) / 4;
                            // local background luma: ds=8 box mean, radius 10 (~80px)
                            const ds8 = 8, dw8 = Math.ceil(pw/ds8), dh8 = Math.ceil(ph/ds8);
                            const sum8 = new Float64Array(dw8*dh8), cnt8 = new Float64Array(dw8*dh8);
                            for (let y = 0; y < ph; y++) { const r0 = ((y/ds8)|0)*dw8, r1 = y*pw;
                                for (let x = 0; x < pw; x++) { const j = r0 + ((x/ds8)|0); sum8[j] += luma[r1+x]; cnt8[j]++; } }
                            for (let j = 0; j < dw8*dh8; j++) sum8[j] /= Math.max(1, cnt8[j]);
                            const R8 = 10, mean8 = new Float64Array(dw8*dh8), t8 = new Float64Array(dw8*dh8);
                            for (let y = 0; y < dh8; y++) for (let x = 0; x < dw8; x++) { let s3 = 0, c3 = 0;
                                for (let o = -R8; o <= R8; o++) { const xx = x+o; if (xx<0||xx>=dw8) continue; s3 += sum8[y*dw8+xx]; c3++; }
                                t8[y*dw8+x] = s3/c3; }
                            for (let x = 0; x < dw8; x++) for (let y = 0; y < dh8; y++) { let s3 = 0, c3 = 0;
                                for (let o = -R8; o <= R8; o++) { const yy = y+o; if (yy<0||yy>=dh8) continue; s3 += t8[yy*dw8+x]; c3++; }
                                mean8[y*dw8+x] = s3/c3; }
                            const bgL = (i) => mean8[((((i/pw)|0)/ds8)|0)*dw8 + ((((i%pw))/ds8)|0)];
                            const glowM = new Uint8Array(PN);
                            for (let i = 0; i < PN; i++)
                                if (depth[i] < otsuD && depth[i] - bmin(i) < 0.02 && luma[i] - bgL(i) > 45) glowM[i] = 1;
                            const label2 = new Int32Array(PN);
                            const glowClaim = new Uint8Array(PN);
                            let comp2 = 0, nGlowAttach = 0;
                            for (let s = 0; s < PN; s++) {
                                if (!glowM[s] || label2[s]) continue;
                                comp2++;
                                let head = 0, tail = 0; qq[tail++] = s; label2[s] = comp2;
                                let attachD = -1;
                                const members = [];
                                while (head < tail) {
                                    const i = qq[head++]; members.push(i);
                                    const x = i%pw, y = (i/pw)|0;
                                    const nbs = [x>0?i-1:-1, x<pw-1?i+1:-1, y>0?i-pw:-1, y<ph-1?i+pw:-1];
                                    for (const j of nbs) {
                                        if (j < 0) continue;
                                        if (glowM[j]) { if (!label2[j]) { label2[j] = comp2; qq[tail++] = j; } }
                                        // only a THIN carrier attaches (lamp on a staff);
                                        // sunbursts / light shafts leaning on bodies stay
                                        else if (depth[j] >= otsuD && thinP[j] && depth[j] > attachD) attachD = depth[j];
                                    }
                                }
                                if (attachD <= 0 || members.length > CAP) continue; // stars, shafts, big pale fields
                                if (!haloM) haloM = new Uint8Array(PN);
                                for (const i of members) { depth[i] = attachD; haloM[i] = 1; glowClaim[i] = 1; }
                                nGlowAttach++; pxChanged += members.length;
                            }
                            // The glow's DIM outer halo sits below the anomaly
                            // threshold and would stay on the sky as a detached
                            // ghost disc. Grow the attachment geodesically from
                            // the attached cores through the contiguous fading
                            // halo — luma must DECAY outward (+6 noise slack), so
                            // the growth cannot cross dark sky into stars or
                            // unrelated content. Bounded at 80px.
                            if (nGlowAttach > 0) {
                                let head = 0, tail = 0;
                                const gen = new Int16Array(PN);
                                for (let i = 0; i < PN; i++) if (haloM[i] && glowM[i]) { qq[tail++] = i; gen[i] = 1; }
                                let grown = 0;
                                while (head < tail) {
                                    const i = qq[head++];
                                    if (gen[i] > 80) continue;
                                    const x = i%pw, y = (i/pw)|0;
                                    const nbs = [x>0?i-1:-1, x<pw-1?i+1:-1, y>0?i-pw:-1, y<ph-1?i+pw:-1];
                                    for (const j of nbs) {
                                        if (j < 0 || gen[j] || haloM[j]) continue;
                                        if (depth[j] >= otsuD) continue;
                                        if (depth[j] - bmin(j) >= 0.02) continue;
                                        if (luma[j] - bgL(j) <= 8) continue;
                                        if (luma[j] > luma[i] + 6) continue;
                                        depth[j] = depth[i]; haloM[j] = 1; gen[j] = gen[i] + 1; glowClaim[j] = 1;
                                        qq[tail++] = j; grown++;
                                    }
                                }
                                pxChanged += grown;
                                // The luma-decay growth stops at the dark ink strokes
                                // drawn THROUGH the glow (the staff loop is a luma
                                // moat), stranding the halo beyond them as a ghost
                                // annulus. The glow is radially symmetric around the
                                // lamp, so close it as a DISC: per claimed cluster,
                                // centroid + max radius, then claim every floor-depth
                                // far pixel within 2x that radius (capped at 120px) —
                                // ink ring, stars-in-glow and all ride the lamp.
                                const label3 = new Int32Array(PN);
                                let comp3 = 0, discPx = 0;
                                for (let s = 0; s < PN; s++) {
                                    if (!glowClaim[s] || label3[s]) continue;
                                    comp3++;
                                    let head3 = 0, tail3 = 0; qq[tail3++] = s; label3[s] = comp3;
                                    let sxs = 0, sys = 0, cN = 0, aD = 0;
                                    const mem3 = [];
                                    while (head3 < tail3) {
                                        const i = qq[head3++]; mem3.push(i);
                                        const x = i%pw, y = (i/pw)|0;
                                        sxs += x; sys += y; cN++;
                                        if (depth[i] > aD) aD = depth[i];
                                        // 8-connected so ink strokes don't split the cluster
                                        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
                                            const yy = y+oy, xx = x+ox;
                                            if (yy<0||yy>=ph||xx<0||xx>=pw) continue;
                                            const j = yy*pw+xx;
                                            if (glowClaim[j] && !label3[j]) { label3[j] = comp3; qq[tail3++] = j; }
                                        }
                                    }
                                    if (cN < 50) continue;      // specks: no disc
                                    const cxm = sxs/cN, cym = sys/cN;
                                    let r2max = 0;
                                    for (const i of mem3) { const dx2 = (i%pw)-cxm, dy2 = ((i/pw)|0)-cym;
                                        const r2 = dx2*dx2+dy2*dy2; if (r2 > r2max) r2max = r2; }
                                    const R2 = Math.min(120, Math.sqrt(r2max) * 2);
                                    const x0 = Math.max(0, (cxm-R2)|0), x1 = Math.min(pw-1, (cxm+R2)|0);
                                    const y0 = Math.max(0, (cym-R2)|0), y1 = Math.min(ph-1, (cym+R2)|0);
                                    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
                                        const dx2 = x-cxm, dy2 = y-cym;
                                        if (dx2*dx2+dy2*dy2 > R2*R2) continue;
                                        const i = y*pw+x;
                                        if (haloM[i] || depth[i] >= otsuD) continue;
                                        if (depth[i] - bmin(i) >= 0.02) continue;
                                        depth[i] = aD; haloM[i] = 1; discPx++;
                                    }
                                }
                                pxChanged += discPx;
                                console.log('[RUNG-PLUG] glow-attach: ' + nGlowAttach + ' emissive blobs attached, halo grown +' + grown + 'px, disc closure +' + discPx + 'px');
                            }
                        }
                    }
                    // ---- RAMP COLLAPSE (review-fix v6): the streak generator ----
                    // The bake leaves 3-10px transition APRONS along silhouettes,
                    // quantized into terrace treads. Every tread is an intermediate-
                    // depth texel band below fgTearStep: no tear rule can touch it,
                    // and under parallax each tread shears horizontally by its own
                    // depth — rendered as the parallel streak bands (FG-only depth
                    // attribution: the eagle, boots and staff surroundings shred
                    // into terraces). Cutting one line through the ramp (the NMS
                    // core tear) leaves the remaining treads still connected, still
                    // shearing. So remove the INTERMEDIATE DEPTHS themselves:
                    // binarize every ramp pixel (local +/-2px window span > step)
                    // to whichever side — window min or max — is closer in value.
                    // Silhouette aprons become 1-texel cliffs (the sharp tear
                    // handles them); smooth real slopes (window span < step) are
                    // untouched; the bake's silhouette pepper collapses with it.
                    {
                        const d0 = depth.slice();
                        // [PERF] van Herk windowed min/max, exact — the naive 5x5
                        // scan was 63M reads. Interior loop bounds unchanged.
                        const w2mn = bgSlide2D(d0, pw, ph, 2, true), w2mx = bgSlide2D(d0, pw, ph, 2, false);
                        let snapped = 0;
                        for (let y = 2; y < ph-2; y++) for (let x = 2; x < pw-2; x++) {
                            const i = y*pw+x;
                            const mn2 = w2mn[i], mx2 = w2mx[i];
                            if (mx2 - mn2 <= fgTearStep) continue;
                            const v = d0[i];
                            const t2 = (v - mn2 <= mx2 - v) ? mn2 : mx2;
                            if (Math.abs(t2 - v) > 0.002) { depth[i] = t2; snapped++; }
                        }
                        if (snapped > 0) { pxChanged += snapped; console.log('[RUNG-PLUG] ramp collapse: ' + snapped + 'px binarized'); }
                    }
                _mark('despeckle+collapse');
                    if (pxChanged > 0) {
                        const hf2 = new Float32Array(PN);
                        for (let y = 0; y < ph; y++) { const s2 = y*pw, d2 = (ph-1-y)*pw;
                            for (let x = 0; x < pw; x++) hf2[d2+x] = depth[s2+x]; }
                        const hc2 = document.createElement('canvas'); hc2.width = pw; hc2.height = ph;
                        const hx2 = hc2.getContext('2d'); const hid2 = hx2.createImageData(pw, ph);
                        for (let i = 0; i < PN; i++) { const v = Math.max(0, Math.min(255, Math.round(depth[i] * 255)));
                            hid2.data[i*4] = v; hid2.data[i*4+1] = v; hid2.data[i*4+2] = v; hid2.data[i*4+3] = 255; }
                        hx2.putImageData(hid2, 0, 0);
                        const hTex2 = new THREE.DataTexture(hf2, pw, ph, THREE.RedFormat, THREE.FloatType);
                        hTex2.needsUpdate = true; hTex2.flipY = false;
                        hTex2.minFilter = THREE.LinearFilter; hTex2.magFilter = THREE.LinearFilter;
                        hTex2.generateMipmaps = false;
                        if ('colorSpace' in hTex2) hTex2.colorSpace = THREE.NoColorSpace;
                        hTex2.image2d = hc2;
                        L.textures.depth = hTex2;
                        if (L.mesh?.material?.uniforms?.displacementMap) L.mesh.material.uniforms.displacementMap.value = hTex2;
                        console.log('[RUNG-PLUG] despeckle: ' + nAttach + ' attached, ' + nFlat +
                            ' flattened (' + pxChanged + 'px total w/ collapse), ' + nKeep + ' kept (sharp/big)');
                    }
                }
                if (bgPlugMode === 'directional') {
                    // Single directional plug computed straight from the depth: seal each
                    // disocclusion at the far side of its own edge, grown in by the edge's
                    // parallax budget. No band/valid PNG needed.
                    const dr = bgDirectionalPlug(depth, pw, ph, {});
                    band = dr.band; plugDepth = dr.plug; rimSrc = dr.rimSrc;
                    let bandN = 0; for (let i = 0; i < PN; i++) bandN += band[i];
                    console.log('[RUNG-PLUG] inputs: directional plug ' + pw + 'x' + ph + ' (canvas ' + w + 'x' + h + ')' +
                        ' band ' + bandN + 'px (' + (100*bandN/PN).toFixed(1) + '%)');
                _mark('directional-plug');
                } else {
                    // legacy global fg/bg plug: band (PNG) + Otsu valid + harmonic
                    cx.clearRect(0, 0, pw, ph);
                    cx.drawImage(bgBandImg, 0, 0, pw, ph);
                    const bpx = cx.getImageData(0, 0, pw, ph).data;
                    band = new Uint8Array(PN);
                    for (let i = 0; i < PN; i++) band[i] = bpx[i * 4] > 128 ? 1 : 0;
                    const SEAM_DILATE = 3;
                    for (let it = 0; it < SEAM_DILATE; it++) { const nb = band.slice();
                        for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const i = y*pw+x; if (band[i]) continue;
                            if ((x>0&&band[i-1])||(x<pw-1&&band[i+1])||(y>0&&band[i-pw])||(y<ph-1&&band[i+pw])) nb[i]=1; }
                        band.set(nb); }
                    const valid = new Uint8Array(PN); let validSrc;
                    if (bgValidMode === 'auto' || bgValidMode === 'split') {
                        let splitNorm = (bgValidMode === 'auto') ? bgOtsuThreshold(depth, band)
                            : ((typeof currentInpaintingSplitDepthNorm === 'number') ? currentInpaintingSplitDepthNorm : bgSplitDefault);
                        for (let i = 0; i < PN; i++) valid[i] = (!band[i] && depth[i] < splitNorm) ? 1 : 0;
                        validSrc = (bgValidMode === 'auto' ? 'otsu<' : 'split<') + splitNorm.toFixed(3);
                    } else {
                        cx.clearRect(0, 0, pw, ph); cx.drawImage(bgValidImg, 0, 0, pw, ph);
                        const vpx = cx.getImageData(0, 0, pw, ph).data;
                        for (let i = 0; i < PN; i++) valid[i] = vpx[i * 4] > 128 ? 1 : 0;
                        validSrc = 'png';
                    }
                    let bandN=0,validN=0; for(let i=0;i<PN;i++){bandN+=band[i];validN+=valid[i];}
                    console.log('[RUNG-PLUG] inputs: plug ' + pw + 'x' + ph + ' (canvas ' + w + 'x' + h + ')' +
                        ' band ' + bandN + 'px (' + (100*bandN/PN).toFixed(1) + '%)' +
                        ' valid[' + validSrc + '] ' + validN + 'px (' + (100*validN/PN).toFixed(1) + '%)');
                    plugDepth = MoebiusPlug.buildPlugFromValid(depth, band, valid, pw, ph, 220);
                }
                // ---- THIN FEATURES: detect + depth-halo (review-fix v4) ----
                // A 1-2px feature (staff, glider) is ALL edge triangles: under
                // parallax it renders as a diluted smear, and tearing it deletes
                // it. Fix its rigidity in the DISPLACEMENT domain: dilate the
                // feature's depth ~2px into its background neighbours (colour
                // untouched). The rubber boundary moves off the feature onto
                // sky-coloured cells, which stretch invisibly over the plate;
                // the feature's own pixels displace as a rigid body.
                {
                    const oT = bgOtsuThreshold(depth, band); // band-excluded: null-skip lands ABOVE the figure on ground-heavy histograms and unprotects the staff
                    const nearM = new Uint8Array(PN);
                    for (let i = 0; i < PN; i++) nearM[i] = depth[i] >= oT ? 1 : 0;
                    let E = nearM;
                    for (let p = 0; p < 2; p++) { const ne = new Uint8Array(PN);
                        for (let y = 1; y < ph - 1; y++) for (let x = 1; x < pw - 1; x++) { const i = y*pw+x;
                            if (E[i] && E[i-1] && E[i+1] && E[i-pw] && E[i+pw]) ne[i] = 1; }
                        E = ne; }
                    // Thin = near-class pixel that the eroded core cannot reach
                    // GEODESICALLY (through the near mask). A plain window test
                    // marks the staff shaft "thick" just because the figure's
                    // core is nearby — and the shaft got torn ("carved away").
                    let R = E;
                    for (let p = 0; p < 3; p++) { const nr = new Uint8Array(PN);
                        for (let y = 1; y < ph - 1; y++) for (let x = 1; x < pw - 1; x++) { const i = y*pw+x;
                            if (!nearM[i]) continue;
                            if (R[i] || R[i-1] || R[i+1] || R[i-pw] || R[i+pw]) nr[i] = 1; }
                        R = nr; }
                    thinM = new Uint8Array(PN);
                    let nThin = 0;
                    for (let i = 0; i < PN; i++) if (nearM[i] && !R[i]) { thinM[i] = 1; nThin++; }
                    if (nThin > 0 && !L._thinHaloApplied) {
                        const hd = depth.slice(); let changed = 0;
                        if (!haloM) haloM = new Uint8Array(PN);
                        // [PERF] the 5x5 max can only be nonzero within Chebyshev
                        // distance 2 of a thin pixel: gate the window scan to an
                        // 8-connected double dilation of thinM (exact same support)
                        let tGate = thinM.slice();
                        for (let p = 0; p < 2; p++) { const ng = tGate.slice();
                            for (let y = 1; y < ph - 1; y++) for (let x = 1; x < pw - 1; x++) { const i = y*pw+x;
                                if (tGate[i]) continue;
                                if (tGate[i-1] || tGate[i+1] || tGate[i-pw] || tGate[i+pw] ||
                                    tGate[i-pw-1] || tGate[i-pw+1] || tGate[i+pw-1] || tGate[i+pw+1]) ng[i] = 1; }
                            tGate = ng; }
                        // frame border: the interior-only dilation can miss it — scan it unconditionally (tiny)
                        for (let x = 0; x < pw; x++) { tGate[x] = 1; tGate[pw+x] = 1; tGate[(ph-1)*pw+x] = 1; tGate[(ph-2)*pw+x] = 1; }
                        for (let y = 0; y < ph; y++) { const r = y*pw; tGate[r] = 1; tGate[r+1] = 1; tGate[r+pw-1] = 1; tGate[r+pw-2] = 1; }
                        for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const i = y*pw+x;
                            if (thinM[i] || !tGate[i]) continue;
                            let m = -1;
                            for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
                                const yy = y + oy, xx = x + ox;
                                if (yy < 0 || yy >= ph || xx < 0 || xx >= pw) continue;
                                const j = yy * pw + xx;
                                if (thinM[j] && depth[j] > m) m = depth[j];
                            }
                            if (m > hd[i] + 0.004) { hd[i] = m; haloM[i] = 1; changed++; }
                        }
                        dispDepth = hd;
                        if (changed > 0) {
                            const hf = new Float32Array(PN);
                            for (let y = 0; y < ph; y++) { const s = y*pw, d = (ph-1-y)*pw;
                                for (let x = 0; x < pw; x++) hf[d+x] = hd[s+x]; }
                            const hc = document.createElement('canvas'); hc.width = pw; hc.height = ph;
                            const hx = hc.getContext('2d'); const hid = hx.createImageData(pw, ph);
                            for (let i = 0; i < PN; i++) { const v = Math.max(0, Math.min(255, Math.round(hd[i] * 255)));
                                hid.data[i*4] = v; hid.data[i*4+1] = v; hid.data[i*4+2] = v; hid.data[i*4+3] = 255; }
                            hx.putImageData(hid, 0, 0);
                            const hTex = new THREE.DataTexture(hf, pw, ph, THREE.RedFormat, THREE.FloatType);
                            hTex.needsUpdate = true; hTex.flipY = false;
                            hTex.minFilter = THREE.LinearFilter; hTex.magFilter = THREE.LinearFilter;
                            hTex.generateMipmaps = false;
                            if ('colorSpace' in hTex) hTex.colorSpace = THREE.NoColorSpace;
                            hTex.image2d = hc;
                            L.textures.depth = hTex;
                            if (L.mesh?.material?.uniforms?.displacementMap) L.mesh.material.uniforms.displacementMap.value = hTex;
                            L._thinHaloApplied = true;
                            console.log('[RUNG-PLUG] thin-feature depth halo: ' + nThin + 'px thin, ' + changed + 'px haloed');
                _mark('thin-halo');
                        }
                    }
                }
                // rim colour source: step a few px past the rim, away from the
                // occluder — the immediate far-side pixel at a contact edge is
                // usually the cast shadow / ink line (it filled the reveal next
                // to the boot with shadow-navy instead of sand).
                const rimColorSrc = (bandI, rs) => {
                    if (rs < 0) return rs;
                    const bx = bandI % pw, by = (bandI / pw) | 0;
                    const rx = rs % pw, ry = (rs / pw) | 0;
                    const dx = Math.sign(rx - bx), dy = Math.sign(ry - by);
                    for (let step = 4; step >= 2; step--) {
                        const nx = rx + dx * step, ny = ry + dy * step;
                        if (nx < 0 || nx >= pw || ny < 0 || ny >= ph) continue;
                        const j = ny * pw + nx;
                        if (!band[j]) return j;
                    }
                    return rs;
                };
                // ---- PLUG DEPTH COMPLETION: bury the plug's own cliff ----
                // Outside the band the plug reverts to SOURCE depth, so the
                // band's inner boundary is a figure-sized cliff in the PLUG's
                // displacement map — and the BG mesh rubber-stretches across it
                // exactly like the FG did, smearing figure colours through the
                // fill texture's bilinear edge (the residual streak, confirmed
                // by BG-only renders). Fix: carve a deep rind out of every
                // occluder (bounded flood — deep enough that no parallax can
                // reveal the relocated cliff, bounded so it cannot leak through
                // an occluder's feet into the whole ground) and diffuse
                // background/rim depth underneath. The visible plug becomes a
                // cliff-free "world without the foreground" surface.
                {
                    // REVIEW FIX v2 (interior cliff, locally correct): the flood
                    // keeps the author's PER-EDGE rim depths (criterion 1: legs
                    // complete to the dune behind them, the torso to the sky) but
                    // the RIND budget goes away — bounded completion merely
                    // relocated the plug's cliff inward, and the BG rubber sheet
                    // climbed it (the doppelganger). Leak containment moves from
                    // the budget to an OTSU FLOOR: growth requires the pixel to be
                    // in the near (occluder) depth class, so a sky-rim front that
                    // reaches the feet cannot spill past them into the far-class
                    // ground. Result: the whole near-class occluder is completed
                    // with local rims and the plug has no interior cliff.
                    const otsuThr = bgOtsuThreshold(depth, band);
                    // UNIFIED COMPLETION FLOOD, nearest-rim-first (review v5).
                    // First-come BFS let FAR-rim fronts (torso->sky/plain) walk
                    // down through low-contrast ground contacts and claim the
                    // legs and nearby dune — the reveal then showed the DISTANT
                    // blue sand through the pink sand. Fronts are processed in
                    // DESCENDING rim depth (the local surface claims its own
                    // occluder before any far front arrives), and the entry gate
                    // is +0.02 so a leg only ~0.05 nearer than its dune still
                    // admits the dune's rim.
                    const fgm = new Uint8Array(PN), rimV = new Float32Array(PN);
                    const rimC = new Int32Array(PN).fill(-1);
                    const NB = 32, buckets = [];
                    for (let k = 0; k < NB; k++) buckets.push([]);
                    const bkt = (r) => Math.max(0, Math.min(NB - 1, ((1 - r) * NB) | 0)); // near rim -> low bucket
                    for (let i = 0; i < PN; i++) if (band[i]) {
                        const x = i % pw, y = (i / pw) | 0;
                        const nbs = [x>0?i-1:-1, x<pw-1?i+1:-1, y>0?i-pw:-1, y<ph-1?i+pw:-1];
                        for (const j of nbs) if (j >= 0 && !band[j] && !fgm[j] && depth[j] >= plugDepth[i] + 0.02) {
                            fgm[j] = 1; rimV[j] = plugDepth[i];
                            rimC[j] = (rimSrc && rimSrc[i] >= 0) ? rimColorSrc(i, rimSrc[i]) : j;
                            buckets[bkt(plugDepth[i])].push(j);
                        }
                    }
                    for (let bi = 0; bi < NB; bi++) {
                        const q2 = buckets[bi];
                        for (let h = 0; h < q2.length; h++) { const i = q2[h];
                            const x = i % pw, y = (i / pw) | 0;
                            const nbs = [x>0?i-1:-1, x<pw-1?i+1:-1, y>0?i-pw:-1, y<ph-1?i+pw:-1];
                            for (const j of nbs) if (j >= 0 && !band[j] && !fgm[j] && depth[j] >= rimV[i] + 0.02) {
                                fgm[j] = 1; rimV[j] = rimV[i]; rimC[j] = rimC[i];
                                const tb = bkt(rimV[i]);
                                if (tb === bi) q2.push(j); else buckets[tb].push(j);
                            }
                        }
                    }
                    console.log('[RUNG-PLUG] completion flood: unified nearest-rim-first, gate 0.02');
                    // FLOOR RIND (generality): the flood only enters through BAND
                    // seeds — dark-on-dark soft silhouettes never seed a band, so
                    // their near content stayed in the plate (measured: the
                    // dancer's-thigh doppelganger blob on the cave asset). An
                    // occluder is anything standing ABOVE ITS LOCAL FLOOR — the
                    // under-sheet's own field, no global class threshold. Sweep
                    // the missed pixels into the rind; they take diffused +
                    // membrane depth and continuation colours (no carried rim).
                    floorField = bgSlide2D(depth, pw, ph, bgBandMaxGrowPx | 0, true);
                    {
                        // sweep radius = 4x the band budget (~ the maximum parallax
                        // shift): plate content deeper inside an occluder than the
                        // maximum reveal can never be exposed, so this radius covers
                        // every exposable pixel — wide occluders included (the
                        // budget-radius floor saw a wide core as its own floor).
                        const floorBig = bgSlide2D(depth, pw, ph, (bgBandMaxGrowPx | 0) * 4, true);
                        let nFloorAdd = 0;
                        for (let i = 0; i < PN; i++) {
                            if (fgm[i] || band[i]) continue;
                            if (depth[i] - floorBig[i] > fgTearStep) { fgm[i] = 1; nFloorAdd++; }
                        }
                        if (nFloorAdd) console.log('[RUNG-PLUG] floor rind: +' + nFloorAdd + 'px above-local-floor (band-less silhouettes)');
                    }
                    // Reject rims that are themselves under an occluder (internal
                    // figure cliffs: arm-over-torso seeds carry FIGURE colours —
                    // bright dashes in the fill). Those pixels fall back to the
                    // diffusion wash.
                    for (let i = 0; i < PN; i++) if (rimC[i] >= 0 && (fgm[rimC[i]] || band[rimC[i]])) rimC[i] = -1;
                    underRimC = rimC;
                    console.log('[RUNG-PLUG] completion flood: unbounded, otsu floor ' + otsuThr.toFixed(3));
                    let nFg = 0; for (let i = 0; i < PN; i++) nFg += fgm[i];
                    if (nFg > 0) {
                        // diffuse surrounding plug depth (background + pinned band rims)
                        // into the rind — 8-bit gray through the pyramid fill; the
                        // visible band keeps its float-precision values untouched.
                        const dpx4 = new Uint8Array(PN * 4), dval = new Uint8Array(PN);
                        for (let i = 0; i < PN; i++) {
                            const ok = fgm[i] ? 0 : 1; dval[i] = ok;
                            const v = ok ? Math.max(0, Math.min(255, (plugDepth[i] * 255) | 0)) : 0;
                            dpx4[i*4] = v; dpx4[i*4+1] = v; dpx4[i*4+2] = v; dpx4[i*4+3] = 255;
                        }
                        const dsm = bgPullPushFill(dpx4, dval, pw, ph);
                        for (let i = 0; i < PN; i++) if (fgm[i]) plugDepth[i] = dsm[i*3] / 255;
                        underMask = fgm;
                        console.log('[RUNG-PLUG] plug depth completed under occluders (' + nFg + 'px rind, diffused)');
                _mark('completion-flood');
                // ---- MEMBRANE CORRECTION (topology): the plug must CONTINUE the
                // surfaces it fills across, not plateau at carried rim values. The
                // nearest-rim-first flood prefers NEAR rims (right for ground
                // contacts) but behind TALL objects it extends the ground upward
                // above the horizon — the depth analog of the colour bug fixed in
                // the doppelganger addendum. Correction: where a completed pixel's
                // row (and/or column) is bounded on BOTH sides by non-completed
                // surface pixels of the SAME class (within bgBandStep), its depth
                // moves to the inverse-distance-weighted blend of those linear
                // continuation lines. Sky rows bridge sky across the mountain; the
                // horizon stripe continues itself; the under-leg corridor stays
                // dune (its row line IS dune). One-sided reveals keep the flood
                // value. Anchors are real visible surfaces, so the result is
                // bounded by them — no protrusion channel.
                {
                    const setP = new Uint8Array(PN);
                    for (let i = 0; i < PN; i++) setP[i] = (band[i] || (underMask && underMask[i])) ? 1 : 0;
                    const sR = new Int32Array(PN), sL = new Int32Array(PN), sD = new Int32Array(PN), sU = new Int32Array(PN);
                    for (let y = 0; y < ph; y++) {
                        let nxt = -1;
                        for (let x = pw-1; x >= 0; x--) { const i = y*pw+x; sR[i] = nxt; if (!setP[i]) nxt = i; }
                        nxt = -1;
                        for (let x = 0; x < pw; x++) { const i = y*pw+x; sL[i] = nxt; if (!setP[i]) nxt = i; }
                    }
                    for (let x = 0; x < pw; x++) {
                        let nxt = -1;
                        for (let y = ph-1; y >= 0; y--) { const i = y*pw+x; sD[i] = nxt; if (!setP[i]) nxt = i; }
                        nxt = -1;
                        for (let y = 0; y < ph; y++) { const i = y*pw+x; sU[i] = nxt; if (!setP[i]) nxt = i; }
                    }
                    let corrected = 0;
                    const SAME = bgBandStep;   // same-surface gate, existing constant
                    for (let i = 0; i < PN; i++) {
                        if (!setP[i]) continue;
                        let num = 0, den = 0;
                        const aL = sL[i], aR = sR[i];
                        if (aL >= 0 && aR >= 0) {
                            const dl = depth[aL], dr = depth[aR];
                            if (Math.abs(dl - dr) <= SAME) {
                                const distL = i - aL, distR = aR - i;   // same row: index distance = x distance
                                const v = dl + (dr - dl) * (distL / (distL + distR));
                                const w = 1 / (distL + distR);
                                num += v * w; den += w;
                            }
                        }
                        const aU = sU[i], aD = sD[i];
                        if (aU >= 0 && aD >= 0) {
                            const du = depth[aU], dd2 = depth[aD];
                            if (Math.abs(du - dd2) <= SAME) {
                                const distU = (i - aU) / pw, distD = (aD - i) / pw;
                                const v = du + (dd2 - du) * (distU / (distU + distD));
                                const w = 1 / (distU + distD);
                                num += v * w; den += w;
                            }
                        }
                        if (den > 0) {
                            const v = num / den;
                            // ONE-SIDED: the flood value is the contract's lower bound
                            // (the LOCAL far rim). The membrane may move the plug
                            // FARTHER (ground wrongly carried above the horizon → sky)
                            // but never meaningfully NEARER: in CONCAVE scenes (cave
                            // corridors, gaps between bodies) both row anchors are
                            // near walls and the bridge would cross the passage
                            // between them — measured as plate protrusions on the
                            // cave and warrior assets. Within one tear-step is
                            // allowed (contact smoothing).
                            if (v - plugDepth[i] <= fgTearStep && Math.abs(v - plugDepth[i]) > 0.002) { plugDepth[i] = v; corrected++; }
                        }
                    }
                    console.log('[RUNG-PLUG] membrane correction: ' + corrected + 'px re-anchored to surface continuation lines');
                    _mark('membrane');
                }
                    }
                }
                // The plug array is top-row-first (like an <img>). The FG mesh's own
                // displacementMap is an image/canvas THREE.Texture (flipY=true), and
                // this BG mesh reuses the FG geometry/UVs — so the plug must present
                // the same orientation. flipY is a no-op for DataTexture in WebGL
                // (UNPACK_FLIP_Y_WEBGL ignores ArrayBufferView uploads), so flip the
                // rows in data to match the flipY=true image convention.
                const plugFlipped = new Float32Array(PN);
                for (let y = 0; y < ph; y++) {
                    const s = y*pw, d = (ph-1-y)*pw;
                    for (let x = 0; x < pw; x++) plugFlipped[d+x] = plugDepth[s+x];
                }
                // Float32 DataTexture — no colorspace, no image decode
                const plugDT = new THREE.DataTexture(plugFlipped, pw, ph, THREE.RedFormat, THREE.FloatType);
                plugDT.needsUpdate = true;
                plugDT.flipY = false; // orientation handled in data above
                plugDT.minFilter = THREE.LinearFilter;
                plugDT.magFilter = THREE.LinearFilter;
                if ('colorSpace' in plugDT) plugDT.colorSpace = THREE.NoColorSpace;
                _plugTex = plugDT;
                console.log('[RUNG-PLUG] live plug computed: ' + (Date.now()-t0) + 'ms');
                _mark('plug-texture');

                // --- BAND-GATED FG STRETCH CUT: bake the cut mask ---
                // Dilate the band a few px so the far-side half of a stretched
                // triangle (whose UVs land just past the cliff) is covered too,
                // then hand it to the FG material. The trigger is per-fragment
                // (depth mismatch), so dilation only widens where cutting is
                // ALLOWED — at rest nothing is stretched and nothing cuts.
                {
                    const cut = band.slice();
                    for (let it = 0; it < (bgBandCutDilatePx|0); it++) {
                        const nb = cut.slice();
                        for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
                            const i = y*pw+x; if (cut[i]) continue;
                            if ((x>0&&cut[i-1])||(x<pw-1&&cut[i+1])||(y>0&&cut[i-pw])||(y<ph-1&&cut[i+pw])) nb[i] = 1;
                        }
                        cut.set(nb);
                    }
                    bandCutMask = cut; // the fill below must be opaque everywhere the FG may cut
                    // rows flipped to match the FG mesh's flipY=true image textures
                    // (same convention as the plug DataTexture above)
                    const cutF = new Float32Array(PN);
                    for (let y = 0; y < ph; y++) { const s = y*pw, d = (ph-1-y)*pw;
                        for (let x = 0; x < pw; x++) cutF[d+x] = cut[s+x]; }
                    const cutDT = new THREE.DataTexture(cutF, pw, ph, THREE.RedFormat, THREE.FloatType);
                    cutDT.needsUpdate = true; cutDT.flipY = false;
                    cutDT.minFilter = THREE.NearestFilter; cutDT.magFilter = THREE.NearestFilter;
                    if ('colorSpace' in cutDT) cutDT.colorSpace = THREE.NoColorSpace;
                    const fu = L.mesh.material.uniforms;
                    if (fu && fu.u_bandMask) {
                        if (fu.u_bandMask.value && fu.u_bandMask.value.dispose) fu.u_bandMask.value.dispose();
                        fu.u_bandMask.value = cutDT;
                        // With the FG pre-torn there are no rubber triangles to
                        // cut — the stretch heuristics stay disarmed (they misfire
                        // at rest on slow-ramp cliffs; see review D1b).
                        fu.u_useBandCut.value = !!bgCutFGOnPlug && !fgPreTear;
                        // Same rationale for the per-fragment gap discards
                        // (u_useDepthGrad was hard-on: `checked || true`). On the
                        // walls the tear deliberately KEEPS (far-mismatch overlaps,
                        // thin ribbons), fwidth straddles the threshold under
                        // parallax, so the discards render them as dash-row streak
                        // patterns — in the colour pass AND the depth pass, which
                        // shares these uniforms. Geometry tears are the cut now;
                        // kept walls render solid.
                        if (fgPreTear) {
                            for (const gk of ['u_useDepthGrad','u_useSobel','u_useLuma','u_useChroma',
                                              'u_useCurvature','u_useCrease','u_useUVStretch','u_useGrazingAngle']) {
                                if (fu[gk]) fu[gk].value = false;
                            }
                        }
                        fu.u_bandCutMismatch.value = bgBandCutMismatch;
                        if (fu.u_bandCutMaxGrad) fu.u_bandCutMaxGrad.value = bgBandCutMaxGrad;
                        // expected UV rate: the mesh spans UV 0..1 over roughly the
                        // canvas width; a rubber triangle runs at a small fraction of it
                        const _uvRateThr = bgBandCutStretchFrac / Math.max(1, w);
                        if (fu.u_bandCutUvRate) fu.u_bandCutUvRate.value = _uvRateThr;
                        _mark('bandcut-bake');
                        console.log('[RUNG-PLUG] band-gated FG cut armed (dilate ' + bgBandCutDilatePx + 'px, mismatch ' + bgBandCutMismatch + ', maxGrad ' + bgBandCutMaxGrad + ', uvRate<' + _uvRateThr.toExponential(2) + ')');
                    }
                }

                // ---- PRE-TORN FOREGROUND (review-fix v2): remove cliff-spanning
                // triangles, but only where the hole is SAFE and the feature is
                // not destroyed:
                //   gate 1 (plug-backed): a triangle tears only if a vertex texel
                //     lies in the dilated band (bandCutMask) — every hole opens
                //     over opaque plug at the local rim depth. Sub-band cliffs
                //     (mountains, tents) keep their v3.12 behaviour instead of
                //     tearing onto nothing (that painted ink-black).
                //   gate 2 (thin features): if the triangle's near side vanishes
                //     under a 2px erosion of the near-class mask (staff, glider),
                //     it is NOT torn — deleting it deletes the feature. Those
                //     features keep their (small) rubber smear for now; the MPI
                //     step is the real fix.
                if (fgPreTear && bandCutMask && L.mesh && L.mesh.geometry && L.mesh.geometry.index && L.mesh.geometry.parameters) {
                    try {
                        // Thin-feature protection is the RIBBON itself (feature +
                        // halo): only triangles touching it are vetoed. The old 3px
                        // thinDil collar also protected every THICK structure's
                        // cliff that happened to pass near a thin feature (the
                        // arm/shoulder silhouette where the staff crosses it) —
                        // those kept their rubber walls, and the depth pass's
                        // glancing-angle discards chopped them into the residual
                        // streak block. thinDil remains only as the fallback when
                        // no halo mask exists this build (rebuild path).
                        let thinDil = null;
                        if (thinM && !haloM) {
                            thinDil = thinM.slice();
                            for (let p = 0; p < 3; p++) { const nb = thinDil.slice();
                                for (let y = 1; y < ph - 1; y++) for (let x = 1; x < pw - 1; x++) { const i = y*pw+x;
                                    if (thinDil[i]) continue;
                                    if (thinDil[i-1] || thinDil[i+1] || thinDil[i-pw] || thinDil[i+pw]) nb[i] = 1; }
                                thinDil = nb; }
                        }
                        const g = L.mesh.geometry, gp = g.parameters;
                        const vw = ((gp.widthSegments || 1) | 0) + 1, vh = ((gp.heightSegments || 1) | 0) + 1;
                        if (!g.userData._fullIndex) g.userData._fullIndex = g.index.array.slice();
                        // span tests on the COLLAPSED displayed depth: the ramp
                        // collapse binarized every silhouette apron (including the
                        // bake's 1-2px pepper skin, which lives inside those
                        // aprons), so cliffs are 1-texel sharp and pepper cannot
                        // shred. The old raw-depth indirection existed only for
                        // pepper immunity — raw's soft ramps also made the
                        // far-side test unreliable (mid-ramp minima).
                        const tearD = depth;
                        // SOFT-CLIFF CORE (review-fix v5): the bake spreads some
                        // silhouettes into 3-10px ramps whose per-triangle span never
                        // exceeds fgTearStep, so the mesh rubbers instead of tearing
                        // (silverwarrior's fur-edge streak smears). Detect the ramp
                        // with a ±2px window span and tear only its steepest 1-2px
                        // core (gradient non-maximum suppression, Canny-style), so
                        // the rest-state gap stays as thin as a sharp-cliff tear.
                        const cliffCore = new Uint8Array(PN);
                        const cliffFar = new Float32Array(PN);  // window min at each core px: the ramp's local far side
                        {
                            // [PERF] van Herk windowed min/max, exact
                            const c2mn = bgSlide2D(tearD, pw, ph, 2, true), c2mx = bgSlide2D(tearD, pw, ph, 2, false);
                            const gm = (j) => Math.max(Math.abs(tearD[j+1]-tearD[j-1]), Math.abs(tearD[j+pw]-tearD[j-pw]));
                            for (let y = 2; y < ph-2; y++) for (let x = 2; x < pw-2; x++) {
                                const i = y*pw+x;
                                if (c2mx[i] - c2mn[i] <= fgTearStep) continue;
                                const gx = Math.abs(tearD[i+1]-tearD[i-1]), gy2 = Math.abs(tearD[i+pw]-tearD[i-pw]);
                                const g0 = Math.max(gx, gy2);
                                const a = gx >= gy2 ? i-1 : i-pw, b = gx >= gy2 ? i+1 : i+pw;
                                if (g0 > 0 && g0 >= gm(a) && g0 >= gm(b)) { cliffCore[i] = 1; cliffFar[i] = c2mn[i]; }
                            }
                        }
                        // ---- MPI SLICE 2: UNDER-SHEET as a FLOOR FIELD ----
                        // Behind any near clutter lies the LOCAL LOWER ENVELOPE of
                        // the surface: the torso behind the arm, the body behind the
                        // fur field. A per-cliff carried depth fragments into micro-
                        // terraces on clutter (fur) — the streak problem one level
                        // down. The floor (separable min of displayed depth over the
                        // parallax-budget radius) is one coherent smooth sheet by
                        // construction. Sheet exists where the front stands above
                        // its floor AND the backdrop plate does not already carry
                        // that floor. Colours: row-continuation at floor depth;
                        // pixels with no continuation anywhere are pruned (a tiny
                        // far sliver — the backdrop is the true next surface).
                        if (bgMPIMode) {
                            const RB = bgBandMaxGrowPx | 0;
                            const fl = floorField || bgSlide2D(depth, pw, ph, RB, true);   // shared with the floor rind
                            midBand = new Uint8Array(PN);
                            midDepthV = fl;
                            midRimC = new Int32Array(PN).fill(-1);
                            let nSheet = 0;
                            for (let i = 0; i < PN; i++) {
                                if (depth[i] - fl[i] <= fgTearStep) continue;                 // front is ON its floor
                                if (Math.abs(plugDepth[i] - fl[i]) <= fgTearStep) continue;   // backdrop already carries the floor
                                midBand[i] = 1; nSheet++;
                            }
                            if (nSheet > 0) console.log('[MPI] under-sheet floor: ' + nSheet + 'px above-floor (radius ' + RB + 'px)');
                            else { midBand = null; midDepthV = null; midRimC = null; }
                            _mark('undersheet-floor');
                        }
                        const src = g.userData._fullIndex;
                        const out = new src.constructor(src.length);
                        const sx = (pw - 1) / Math.max(1, vw - 1), sy = (ph - 1) / Math.max(1, vh - 1);
                        const idMap = (vw === pw && vh === ph);   // [PERF] 1 vertex/texel: ti === vi
                        const tiv = new Int32Array(3), dv = new Float32Array(3);
                        let n = 0, dropped = 0, keptThin = 0, keptUnbacked = 0, droppedHalo = 0, droppedCore = 0, droppedMid = 0;
                        // [PERF] flat masks instead of per-vertex closure calls / float math
                        const ribMask = new Uint8Array(PN);
                        if (thinM) for (let i = 0; i < PN; i++) if (thinM[i]) ribMask[i] = 1;
                        if (haloM) for (let i = 0; i < PN; i++) if (haloM[i]) ribMask[i] = 1;
                        const coreOKMask = new Uint8Array(PN);
                        for (let i = 0; i < PN; i++) if (cliffCore[i] &&
                            (Math.abs(plugDepth[i] - cliffFar[i]) <= 2*fgTearStep ||
                             (midBand && midBand[i] && Math.abs(midDepthV[i] - cliffFar[i]) <= 2*fgTearStep))) coreOKMask[i] = 1;
                        for (let t = 0; t < src.length; t += 3) {
                            let mn = 2, mx = -1, nRib = 0, coreOK = false, thinVeto = false, midOK = false;
                            let dmn = 2, dmx = -1, mnTi = -1;
                            for (let k = 0; k < 3; k++) {
                                const vi = src[t + k];
                                const ti = idMap ? vi : (Math.round(((vi / vw) | 0) * sy) * pw + Math.round((vi % vw) * sx));
                                tiv[k] = ti;
                                const d = tearD[ti]; dv[k] = d;
                                if (d < mn) mn = d;
                                if (d > mx) mx = d;
                                const dd = dispDepth[ti];
                                if (dd < dmn) { dmn = dd; mnTi = ti; }
                                if (dd > dmx) dmx = dd;
                                if (ribMask[ti]) nRib++;
                                if (coreOKMask[ti]) coreOK = true;
                                if (thinDil && thinDil[ti]) thinVeto = true;
                            }
                            // under-sheet backing: evaluated after dmn is final
                            if (midBand) for (let k = 0; k < 3 && !midOK; k++) {
                                const ti = tiv[k];
                                if (midBand[ti] && Math.abs(midDepthV[ti] - dmn) <= fgTearStep) midOK = true;
                            }
                            // FAR-SIDE MATCH — the one gate all three rules share: a
                            // cliff tears iff the plate behind it carries the cliff's
                            // OWN far side (within fgTearStep). This is what makes a
                            // tear safe by construction: the hole opens onto the same
                            // surface the cliff falls to. It tears figure-over-DUNE
                            // ground contacts (plate = dune there — the nearest-rim
                            // flood guarantees it), which the old near/far-class proxy
                            // never could, and still keeps arm-over-torso overlaps
                            // (plate = sky behind the arm: mismatch) until MPI.
                            // The far side is identified in the DISPLAYED (sharpened)
                            // depth: raw silhouettes are soft ramps, so a triangle's
                            // raw min is a mid-ramp value that never matches the true
                            // far plate (probe: the whole figure ringed by kept walls).
                            const farMatch = mnTi >= 0 && Math.abs(plugDepth[mnTi] - dmn) <= fgTearStep;
                            let keep = true;
                            // HALO-EDGE TEAR: the thin-feature ribbon (feature + halo)
                            // stays rigid and intact; the triangles that SPAN its outer
                            // boundary are the depth-channel rubber filaments (colour-
                            // invisible sky-over-sky stretch). Their cliff exists only
                            // in the DISPLAYED (haloed) depth — raw has no step there.
                            // Backing: the backdrop plate (farMatch) OR the under-sheet
                            // (midOK) — fur ribbons over a body tear against the body
                            // floor, not the sky (their rubber was the residual smear).
                            if (nRib > 0 && nRib < 3 && dmx - dmn > fgTearStep && (farMatch || midOK)) {
                                droppedHalo++; keep = false;
                            }
                            else if (nRib > 0 || thinVeto) {
                                // ribbon interior / fallback collar: never torn
                                if (mx - mn > fgTearStep) keptThin++;
                            }
                            // SOFT-CLIFF CORE TEAR: sub-threshold ramps the band never
                            // seeded (D3) — the full-frame plate is opaque everywhere,
                            // so the thin gap always opens onto content.
                            else if (coreOK) {
                                droppedCore++; keep = false;
                            }
                            else if (mx - mn > fgTearStep) {
                                if (farMatch) { dropped++; keep = false; }
                                else if (midOK) { droppedMid++; keep = false; }  // internal overlap: the under-sheet carries the local far side
                                else keptUnbacked++;   // no sheet holds this cliff's far side: rubber (rare once the under-sheet exists)
                            }
                            if (keep) { out[n++] = src[t]; out[n++] = src[t+1]; out[n++] = src[t+2]; }
                        }
                        g.setIndex(new THREE.BufferAttribute(out.subarray(0, n), 1));
                        _mark('tear-loop');
                        console.log('[RUNG-PLUG] FG pre-torn (far-side match): ' + dropped +
                            ' dropped, ' + droppedHalo + ' halo-edge, ' + droppedCore + ' soft-core, ' + droppedMid + ' under-sheet, ' +
                            keptThin + ' thin-feature kept, ' + keptUnbacked +
                            ' far-mismatch kept, of ' + (src.length / 3));

                        // ---- MPI SLICE 1: depth-layer partition of the torn FG ----
                        if (bgMPIMode) {
                            const tM = Date.now();
                            // cleanup from a previous build
                            if (mpiLayers) { for (const Lr of mpiLayers) { scene.remove(Lr.mesh); Lr.mesh.geometry.dispose(); } mpiLayers = null; }
                            L.mesh.visible = true;
                            // connected components; adjacency broken across cliffs
                            const compL = new Int32Array(PN);
                            const qq3 = new Int32Array(PN);
                            let nc = 0;
                            for (let s = 0; s < PN; s++) {
                                if (compL[s]) continue;
                                nc++;
                                let h3 = 0, t3 = 0; qq3[t3++] = s; compL[s] = nc;
                                while (h3 < t3) {
                                    const i = qq3[h3++]; const x = i%pw, y = (i/pw)|0;
                                    const di = depth[i];
                                    // [PERF] unrolled neighbours (no per-pixel array alloc)
                                    let j;
                                    if (x > 0)    { j = i-1;  if (!compL[j] && Math.abs(di - depth[j]) <= fgTearStep) { compL[j] = nc; qq3[t3++] = j; } }
                                    if (x < pw-1) { j = i+1;  if (!compL[j] && Math.abs(di - depth[j]) <= fgTearStep) { compL[j] = nc; qq3[t3++] = j; } }
                                    if (y > 0)    { j = i-pw; if (!compL[j] && Math.abs(di - depth[j]) <= fgTearStep) { compL[j] = nc; qq3[t3++] = j; } }
                                    if (y < ph-1) { j = i+pw; if (!compL[j] && Math.abs(di - depth[j]) <= fgTearStep) { compL[j] = nc; qq3[t3++] = j; } }
                                }
                            }
                            const szC = new Float64Array(nc+1), sdC = new Float64Array(nc+1);
                            for (let i = 0; i < PN; i++) { szC[compL[i]]++; sdC[compL[i]] += depth[i]; }
                            const orderC = Array.from({length: nc}, (_, k) => k+1).sort((a,b) => szC[b]-szC[a]);
                            const K = Math.min(bgMPIMaxLayers, nc);
                            const keptC = orderC.slice(0, K);
                            const layerOf = new Int32Array(nc+1);
                            keptC.forEach((c, idx) => layerOf[c] = idx+1);
                            const meanD = keptC.map(c => sdC[c]/szC[c]);
                            // small components join the nearest kept layer by mean depth
                            // (assignment decides only which mesh carries them and which
                            // completion scope they belong to — their per-texel depth is
                            // already correct in the shared displacement texture)
                            for (let c = 1; c <= nc; c++) {
                                if (layerOf[c]) continue;
                                const m = sdC[c]/szC[c];
                                let best = 0, bd = 9;
                                for (let k2 = 0; k2 < K; k2++) { const d2 = Math.abs(meanD[k2]-m); if (d2 < bd) { bd = d2; best = k2; } }
                                layerOf[c] = best+1;
                            }
                            const texLayer = new Uint8Array(PN);
                            for (let i = 0; i < PN; i++) texLayer[i] = layerOf[compL[i]];
                            // partition the torn index by majority texel layer (kept
                            // triangles never span a cliff, so votes rarely split)
                            // [PERF] two-pass counted fill into typed arrays (the JS-
                            // array push version was 15M pushes) + identity fast path
                            const fIdx = g.index.array;
                            const idMap2 = (vw === pw && vh === ph);
                            const triLayer = new Uint8Array(fIdx.length / 3);
                            const cnt = new Int32Array(K);
                            for (let t4 = 0, tr = 0; t4 < fIdx.length; t4 += 3, tr++) {
                                const v0 = fIdx[t4], v1 = fIdx[t4+1], v2 = fIdx[t4+2];
                                const l0 = texLayer[idMap2 ? v0 : (Math.round(((v0 / vw) | 0) * sy) * pw + Math.round((v0 % vw) * sx))];
                                const l1 = texLayer[idMap2 ? v1 : (Math.round(((v1 / vw) | 0) * sy) * pw + Math.round((v1 % vw) * sx))];
                                const l2 = texLayer[idMap2 ? v2 : (Math.round(((v2 / vw) | 0) * sy) * pw + Math.round((v2 % vw) * sx))];
                                const lw = (l1 === l2) ? l1 : l0;
                                triLayer[tr] = lw;
                                cnt[lw-1] += 3;
                            }
                            const bucketsL = Array.from({length: K}, (_, k2) => new fIdx.constructor(cnt[k2]));
                            const fillPos = new Int32Array(K);
                            for (let t4 = 0, tr = 0; t4 < fIdx.length; t4 += 3, tr++) {
                                const k2 = triLayer[tr] - 1;
                                const b = bucketsL[k2]; let fp = fillPos[k2];
                                b[fp] = fIdx[t4]; b[fp+1] = fIdx[t4+1]; b[fp+2] = fIdx[t4+2];
                                fillPos[k2] = fp + 3;
                            }
                            // back-to-front meshes over the SHARED attributes + material
                            const rankOrder = Array.from({length: K}, (_, k) => k).sort((a,b) => meanD[a]-meanD[b]);
                            mpiLayers = [];
                            let texCount = new Float64Array(K+1);
                            for (let i = 0; i < PN; i++) texCount[texLayer[i]]++;
                            rankOrder.forEach((k2, rank) => {
                                if (!bucketsL[k2].length) return;
                                const lg = new THREE.BufferGeometry();
                                lg.setAttribute('position', g.attributes.position);
                                lg.setAttribute('uv', g.attributes.uv);
                                if (g.attributes.normal) lg.setAttribute('normal', g.attributes.normal);
                                lg.setIndex(new THREE.BufferAttribute(new fIdx.constructor(bucketsL[k2]), 1));
                                const lm = new THREE.Mesh(lg, L.mesh.material); // shared material: uniforms stay in sync
                                lm.position.copy(L.mesh.position);
                                lm.rotation.copy(L.mesh.rotation);
                                lm.scale.copy(L.mesh.scale);
                                lm.renderOrder = (L.mesh.renderOrder || 0) + rank * 1e-3; // back-to-front hint; z-buffer decides
                                scene.add(lm);
                                mpiLayers.push({ mesh: lm, meanD: meanD[k2], tris: bucketsL[k2].length/3, texels: texCount[k2+1] });
                            });
                            // the partition replaces the monolithic torn mesh
                            L.mesh.visible = false;
                            bgMPIExport = { pw, ph, layers: K, texLayer, meanD };
                            window._mpiDebug = { pw, ph, K, texLayer, meanD, comp: compL, nc };
                            _mark('mpi-partition');
                        console.log('[MPI] ' + K + ' layers from ' + nc + ' components (' + (Date.now()-tM) + 'ms): ' +
                                mpiLayers.map(Lr => Lr.tris + 't@' + Lr.meanD.toFixed(2)).join(', '));
                        }
                    } catch (e) { console.warn('[RUNG-PLUG] pre-tear failed:', e); }
                }

                // --- FILL COLOR (Law 4): DEPTH-GUIDED EXEMPLAR (onion-peel). Fill each
                // hole rim-first by copying the best-matching REAL background patch (SSD
                // over known neighbours; sources restricted to true background at similar
                // depth). Preserves the painting's texture (stars, stroke) instead of a
                // smooth ghost, and only ever samples background — never the foreground.
                // This is the LIVE preview fill; the SD-export plate is the high-quality
                // replacement. Alpha = band (BG material discards outside). Rows flipped.
                const cImg2 = (L.textures.color && L.textures.color.image) || (L.elements && L.elements.color);
                if (cImg2) {
                    cx.clearRect(0, 0, pw, ph);
                    cx.drawImage(cImg2, 0, 0, pw, ph);
                    const cpx = cx.getImageData(0, 0, pw, ph).data;
                    // fill SOURCE = background only (exclude band, dark ink, occluder bodies).
                    // The occluder RIND (underMask) is excluded wholesale: without it the
                    // figure's interior colours feed the pull-push diffusion and tint the
                    // band fill tan right where it is most visible (at the silhouette).
                    const fillSrc = new Uint8Array(PN);
                    for (let i = 0; i < PN; i++) { const lum=(cpx[i*4]+cpx[i*4+1]+cpx[i*4+2])/3;
                        fillSrc[i] = (!band[i] && !(underMask && underMask[i]) && lum>=45) ? 1 : 0; }
                    if (rimSrc) { // [PERF] unrolled — no per-pixel array allocation
                        const rej = (i, j) => band[j] && depth[i] > depth[rimSrc[j] >= 0 ? rimSrc[j] : i] + 0.06;
                        for (let y=0;y<ph;y++) for (let x=0;x<pw;x++){ const i=y*pw+x; if(!fillSrc[i])continue;
                            if ((x>0 && rej(i, i-1)) || (x<pw-1 && rej(i, i+1)) || (y>0 && rej(i, i-pw)) || (y<ph-1 && rej(i, i+pw))) fillSrc[i]=0; } }
                    const tF = Date.now();
                    const smoothBase = bgPullPushFill(cpx, fillSrc, pw, ph); // fallback base
                _mark('fillsrc+pullpush');
                    // debug capture (harness probes): which path coloured each pixel
                    const dbgFB = (typeof window !== 'undefined' && window._dbgFillCapture) ? new Uint8Array(PN) : null;
                    const fillRGB = new Float32Array(PN * 3);
                    for (let i = 0; i < PN; i++) { fillRGB[i*3]=cpx[i*4]; fillRGB[i*3+1]=cpx[i*4+1]; fillRGB[i*3+2]=cpx[i*4+2]; }
                    // DIRECTIONAL BACKGROUND EXTENSION: for each hole, march to the nearest
                    // far-side background rim, then REFLECT the real background across the rim
                    // into the hole — copies actual sky/desert texture (stars, stroke), never
                    // the foreground and never a muddy blend. Fall back to the smooth base only
                    // where the reflected sample isn't valid background.
                    const DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
                    // bandReach[i] = px the fill had to travel to reach real background at i
                    // (the streak signal). 1e6 = none found -> pull-push ghost -> transparent.
                    const bandReach = new Float32Array(PN);
                    for (let i = 0; i < PN; i++){ if(!band[i])continue; const x=i%pw,y=(i/pw)|0;
                        let bestSteps=1e9,bxx=0,byy=0,rX=0,rY=0;
                        for (const d of DIRS){ const dx=d[0],dy=d[1]; let cxp=x,cyp=y,st=0;
                            while(st<400){ cxp+=dx;cyp+=dy;st++; if(cxp<0||cxp>=pw||cyp<0||cyp>=ph){st=1e9;break;} if(!band[cyp*pw+cxp])break; }
                            if(st<bestSteps && st<1e9 && fillSrc[cyp*pw+cxp]){ bestSteps=st;bxx=dx;byy=dy;rX=cxp;rY=cyp; } }
                        if(bestSteps<1e9){ const sxp=rX+bxx*bestSteps, syp=rY+byy*bestSteps;
                            if(sxp>=0&&sxp<pw&&syp>=0&&syp<ph && fillSrc[syp*pw+sxp]){ const s=syp*pw+sxp; fillRGB[i*3]=cpx[s*4];fillRGB[i*3+1]=cpx[s*4+1];fillRGB[i*3+2]=cpx[s*4+2]; }
                            else { const r=rY*pw+rX; fillRGB[i*3]=cpx[r*4];fillRGB[i*3+1]=cpx[r*4+1];fillRGB[i*3+2]=cpx[r*4+2]; }
                            bandReach[i]=bestSteps; }
                        else { fillRGB[i*3]=smoothBase[i*3];fillRGB[i*3+1]=smoothBase[i*3+1];fillRGB[i*3+2]=smoothBase[i*3+2];
                            bandReach[i]=1e6; }
                    }
                    // 'smooth' mode: replace the band colour with the pull-push diffusion
                    // fill — solid and streak-free (the reflection above only sets bandReach,
                    // used by the optional fade). Keeps the interior clean, no striation.
                    if (bgFillMode === 'smooth') {
                        // v4: band pixels take their OWN edge's rim colour (local),
                        // not the global diffusion wash — the wash painted sky-gray
                        // into ground-level reveals (blue patches under the legs).
                        // Rims under an occluder are rejected (figure colours).
                        for (let i = 0; i < PN; i++) if (band[i]) {
                            const rs0 = rimSrc ? rimSrc[i] : -1;
                            const rs = rs0 >= 0 ? rimColorSrc(i, rs0) : -1;
                            if (rs >= 0 && !band[rs] && !(underMask && underMask[rs])) { fillRGB[i*3]=cpx[rs*4]; fillRGB[i*3+1]=cpx[rs*4+1]; fillRGB[i*3+2]=cpx[rs*4+2]; if (dbgFB) dbgFB[i]=1; }
                            else { fillRGB[i*3]=smoothBase[i*3]; fillRGB[i*3+1]=smoothBase[i*3+1]; fillRGB[i*3+2]=smoothBase[i*3+2]; if (dbgFB) dbgFB[i]=2; }
                        }
                    }
                    // reach -> alpha: opaque for short reach, faded to transparent for long
                    // (streaks). smoothstep between the two configured thresholds.
                    const _reachAlpha = (r) => {
                        if (bgFillSolid) return 255;                 // solid fill: no gaps inside the silhouette
                        if (r >= 1e6) return 255;                    // ghost (smooth-filled) still solid, not empty
                        if (r <= bgStreakFadeNearPx) return 255;
                        if (r >= bgStreakFadeFarPx) return 0;
                        const t = (r - bgStreakFadeNearPx) / (bgStreakFadeFarPx - bgStreakFadeNearPx);
                        return Math.round(255 * (1 - t*t*(3-2*t)));
                    };
                    const bandAlpha = new Uint8Array(PN);
                    for (let i = 0; i < PN; i++) bandAlpha[i] = band[i] ? _reachAlpha(bandReach[i]) : 0;
                    // REVIEW FIX v3 — FULL-FRAME PLATE: the plug is opaque
                    // everywhere, not only over band/ring/rind. Outside the
                    // completed regions its RGB is simply the source image and its
                    // depth the source depth (0.004 behind the FG), so it is
                    // invisible at rest — but ANY reveal, of any width, opens onto
                    // real content at the right depth. This is what fills the
                    // parallax sweep behind THIN occluders (staff, glider): their
                    // source-space band can never be wider than the feature
                    // itself, so a patch-plug leaves most of their reveal naked
                    // (the composite painted it ink-black).
                    for (let i = 0; i < PN; i++) if (!band[i] && !bandAlpha[i]) bandAlpha[i] = 255;
                    // The FG stretch cut is allowed in the DILATED band (bandCutMask), so
                    // the plug must be opaque there too — a discard over transparent plug
                    // is a naked hole. RGB for the ring comes from the bleed below.
                    if (bandCutMask) for (let i = 0; i < PN; i++) if (!band[i] && bandCutMask[i]) bandAlpha[i] = 255;
                    // The occluder rind (depth-completed, smooth) carries opaque
                    // background wash: never the figure's own colours, so nothing
                    // figure-tinted exists on the plug for bilinear edges to smear.
                    if (underMask) {
                        // Fill each completed pixel with its OWN edge's rim colour
                        // (carried by the flood) — legs fill dune, torso fills sky.
                        // The global pull-push mixed sky down the under-figure
                        // corridor (blue patches on the dune between the legs).
                        for (let i = 0; i < PN; i++) if (underMask[i] && !band[i]) {
                            bandAlpha[i] = 255;
                            const rc = (underRimC && underRimC[i] >= 0) ? underRimC[i] : -1;
                            if (rc >= 0) { fillRGB[i*3] = cpx[rc*4]; fillRGB[i*3+1] = cpx[rc*4+1]; fillRGB[i*3+2] = cpx[rc*4+2]; if (dbgFB) dbgFB[i]=3; }
                            else { fillRGB[i*3] = smoothBase[i*3]; fillRGB[i*3+1] = smoothBase[i*3+1]; fillRGB[i*3+2] = smoothBase[i*3+2]; if (dbgFB) dbgFB[i]=4; }
                        }
                        // DEPTH-CONSISTENT LOCAL CONTINUATION (v5): a completed
                        // pixel's colour must come from background at ITS OWN
                        // completed depth, found along its own row/column — not
                        // from whichever rim's flood claimed it first. The flood
                        // carries DEPTH correctly, but its colour rode along: a
                        // dark LOW rim (the figure's horizon-contact ink) claimed
                        // plate territory far above its own height and painted
                        // the sky behind the torso near-black (the "black blob"
                        // doppelgänger at look-up). Sampling background of the
                        // pixel's own depth on the pixel's own scanline gives
                        // sky rows sky, the horizon stripe its own continuation,
                        // and the under-leg corridor dune — one rule, no knobs
                        // (tolerance/bound reused from the existing fill logic).
                        {
                            const tolD = 0.06, REACH = 400;
                            let fixedN = 0;
                            // [PERF] skip tables: the march spent most of the build
                            // stepping 1px at a time ACROSS the completed set. These
                            // teleport to the next non-set pixel in each direction
                            // (distance counted exactly as stepping would have) —
                            // identical results, ~10x fewer iterations.
                            const setM = new Uint8Array(PN);
                            for (let i = 0; i < PN; i++) setM[i] = (band[i] || (underMask && underMask[i])) ? 1 : 0;
                            const skipR = new Int32Array(PN), skipL = new Int32Array(PN);
                            const skipD = new Int32Array(PN), skipU = new Int32Array(PN);
                            for (let y = 0; y < ph; y++) {
                                let nxt = -1;
                                for (let x = pw-1; x >= 0; x--) { const i = y*pw+x; skipR[i] = nxt; if (!setM[i]) nxt = i; }
                                nxt = -1;
                                for (let x = 0; x < pw; x++) { const i = y*pw+x; skipL[i] = nxt; if (!setM[i]) nxt = i; }
                            }
                            for (let x = 0; x < pw; x++) {
                                let nxt = -1;
                                for (let y = ph-1; y >= 0; y--) { const i = y*pw+x; skipD[i] = nxt; if (!setM[i]) nxt = i; }
                                nxt = -1;
                                for (let y = 0; y < ph; y++) { const i = y*pw+x; skipU[i] = nxt; if (!setM[i]) nxt = i; }
                            }
                            // march one direction: teleport while in-set, step while out
                            const march = (i0, td, skip, delta, distDiv, rowLocal) => {
                                let j = i0, st = 0;
                                const row0 = (i0 / pw) | 0;
                                while (st < REACH) {
                                    if (j === i0 || setM[j]) {
                                        const nj = skip[j];
                                        if (nj < 0) return -1;
                                        st += Math.abs(nj - j) / distDiv;
                                        j = nj;
                                    } else {
                                        j += delta; st += 1;
                                        if (j < 0 || j >= PN) return -1;
                                        if (rowLocal && ((j / pw) | 0) !== row0) return -1;
                                    }
                                    if (st > REACH) return -1;   // original tested up to st === REACH inclusive
                                    if (!setM[j] && fillSrc[j] && Math.abs(depth[j] - td) <= tolD) return j; // hit
                                }
                                return -1;
                            };
                            // (march returns the hit index; cost recovered from geometry)
                            for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
                                const i = y*pw+x;
                                if (!setM[i]) continue;
                                const td = plugDepth[i];
                                let bestJ = -1, bestCost = 1e9;
                                {
                                    const hR = march(i, td, skipR, 1, 1, true);
                                    if (hR >= 0) { const c = (hR - i); if (c < bestCost) { bestCost = c; bestJ = hR; } }
                                    const hL = march(i, td, skipL, -1, 1, true);
                                    if (hL >= 0) { const c = (i - hL); if (c < bestCost) { bestCost = c; bestJ = hL; } }
                                    const hD = march(i, td, skipD, pw, pw, false);
                                    if (hD >= 0) { const c = 2 * ((hD - i) / pw); if (c < bestCost) { bestCost = c; bestJ = hD; } }
                                    const hU = march(i, td, skipU, -pw, pw, false);
                                    if (hU >= 0) { const c = 2 * ((i - hU) / pw); if (c < bestCost) { bestCost = c; bestJ = hU; } }
                                }
                                if (bestJ >= 0) {
                                    // step a few px deeper past the rim (same escape the
                                    // rim-colour sampler uses) to clear contact shading
                                    const bx = bestJ % pw, by = (bestJ / pw) | 0;
                                    const sx2 = Math.sign(bx - x), sy2 = Math.sign(by - y);
                                    for (let s = 4; s >= 0; s--) {
                                        const ex = bx + sx2*s, ey = by + sy2*s;
                                        if (ex < 0 || ex >= pw || ey < 0 || ey >= ph) continue;
                                        const ej = ey*pw+ex;
                                        if (fillSrc[ej] && Math.abs(depth[ej] - td) <= tolD) { bestJ = ej; break; }
                                    }
                                    fillRGB[i*3] = cpx[bestJ*4]; fillRGB[i*3+1] = cpx[bestJ*4+1]; fillRGB[i*3+2] = cpx[bestJ*4+2];
                                    fixedN++;
                                }
                                // no depth-compatible background in reach: keep the
                                // flood-carried rim colour (still never foreground)
                            }
                            console.log('[RUNG-PLUG] depth-consistent continuation: ' + fixedN + 'px recoloured');
                _mark('continuation');
                        }
                        // ---- UNDER-SHEET COLOURS (MPI slice 2): same rule, target =
                        // the sheet's carried far-side depth. The sheet behind the
                        // arm is torso-coloured because torso pixels at torso depth
                        // sit on the same rows; fallback = the carried rim pixel.
                        if (midBand) {
                            const tolD = 0.06, REACH = 400;
                            midFillRGB = new Uint8Array(PN*3);
                            let midCont = 0;
                            for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
                                const i = y*pw+x;
                                if (!midBand[i]) continue;
                                const td = midDepthV[i];
                                let bestJ = -1, bestCost = 1e9;
                                for (let k = 0; k < 4; k++) {
                                    const dx = (k===0)?1:(k===1)?-1:0, dy = (k===2)?1:(k===3)?-1:0;
                                    const pen = (k >= 2) ? 2 : 1;
                                    let cx2 = x, cy2 = y, st = 0;
                                    while (st < REACH) {
                                        cx2 += dx; cy2 += dy; st++;
                                        if (cx2 < 0 || cx2 >= pw || cy2 < 0 || cy2 >= ph) break;
                                        const j = cy2*pw+cx2;
                                        if (midBand[j]) continue;
                                        // ANY visible surface at the carried depth qualifies —
                                        // including figure-class content: the far side of an
                                        // internal cliff IS the figure (torso behind arm).
                                        // The backdrop's background-only source rules do not
                                        // apply to the under-sheet; excluding underMask here
                                        // starved the sheet onto dark rim inks (slab bug).
                                        if (Math.abs(depth[j] - td) <= tolD) {
                                            if (st * pen < bestCost) { bestCost = st * pen; bestJ = j; }
                                            break;
                                        }
                                    }
                                }
                                // No visible surface anywhere at the carried depth: there
                                // is nothing plausible to extend (a tiny far sliver — the
                                // glider's innards, a staff ornament). No sheet pixel:
                                // the cliff opens onto the backdrop, which IS the next
                                // real surface beyond the sliver. Painting the rim ink
                                // instead manufactured dark slabs.
                                if (bestJ < 0) { midBand[i] = 0; midRimC[i] = -1; continue; }
                                midCont++;
                                midFillRGB[i*3] = cpx[bestJ*4]; midFillRGB[i*3+1] = cpx[bestJ*4+1]; midFillRGB[i*3+2] = cpx[bestJ*4+2];
                            }
                            // soften flat patches (Jacobi, sheet only; 24 passes — the
                            // same count the backdrop plate needed to kill the per-row
                            // source-alternation comb, for the same reason)
                            // [PERF] compact member list + precomputed in-band
                            // neighbours (the full-frame scan with per-pixel array
                            // allocation dominated this stage). Results identical.
                            {
                                let nM2 = 0;
                                for (let y = 1; y < ph-1; y++) for (let x = 1; x < pw-1; x++) if (midBand[y*pw+x]) nM2++;
                                const ML = new Int32Array(nM2); nM2 = 0;
                                for (let y = 1; y < ph-1; y++) for (let x = 1; x < pw-1; x++) { const i = y*pw+x; if (midBand[i]) ML[nM2++] = i; }
                                const NB4 = new Int32Array(nM2*4);
                                for (let q3 = 0; q3 < nM2; q3++) { const i = ML[q3];
                                    NB4[q3*4]   = midBand[i-1]  ? i-1  : -1;
                                    NB4[q3*4+1] = midBand[i+1]  ? i+1  : -1;
                                    NB4[q3*4+2] = midBand[i-pw] ? i-pw : -1;
                                    NB4[q3*4+3] = midBand[i+pw] ? i+pw : -1;
                                }
                                let A3 = new Float32Array(PN*3);
                                for (let i = 0; i < PN; i++) if (midBand[i]) { A3[i*3]=midFillRGB[i*3]; A3[i*3+1]=midFillRGB[i*3+1]; A3[i*3+2]=midFillRGB[i*3+2]; }
                                let B3 = A3.slice();
                                for (let p = 0; p < 24; p++) {
                                    for (let q3 = 0; q3 < nM2; q3++) { const i = ML[q3], i3 = i*3;
                                        let s0 = A3[i3], s1 = A3[i3+1], s2 = A3[i3+2], c0 = 1;
                                        for (let k3 = 0; k3 < 4; k3++) { const j = NB4[q3*4+k3];
                                            if (j >= 0) { const j3 = j*3; s0 += A3[j3]; s1 += A3[j3+1]; s2 += A3[j3+2]; c0++; } }
                                        B3[i3] = s0/c0; B3[i3+1] = s1/c0; B3[i3+2] = s2/c0;
                                    }
                                    const tt = A3; A3 = B3; B3 = tt;
                                }
                                for (let i = 0; i < PN; i++) if (midBand[i]) {
                                    midFillRGB[i*3]=Math.max(0,Math.min(255,A3[i*3]|0));
                                    midFillRGB[i*3+1]=Math.max(0,Math.min(255,A3[i*3+1]|0));
                                    midFillRGB[i*3+2]=Math.max(0,Math.min(255,A3[i*3+2]|0));
                                }
                            }
                            console.log('[MPI] under-sheet colours: ' + midCont + 'px row-continued, rest pruned (no continuation exists)');
                _mark('midsheet-colours');
                            // hoist for the mesh build at function end (outside this block's scope)
                            _midBand = midBand; _midDepthV = midDepthV; _midRimC = midRimC; _midFillRGB = midFillRGB; _midPW = pw; _midPH = ph; _midFrontD = depth;
                        }
                        if (dbgFB) window._dbgFill = { pw, ph, fb: dbgFB, pre: fillRGB.slice(), smoothBase, band, underMask, plug: plugDepth, srcDepth: depth,
                            thinM, haloM, dispD: dispDepth, rawD: (L._rawDepth && L._rawDepthW === pw) ? L._rawDepth : depth, bandCutMask };
                        // soften the flat rim-colour patches (Jacobi, completed set
                        // only). 24 passes: along busy silhouettes (vehicle line at
                        // the dune edge) adjacent rims alternate dark/light and 8
                        // passes left a visible vertical comb; ~5px diffusion
                        // radius kills the period.
                        // [PERF] compact index list + ping-pong over BOTH buffers
                        // (results identical to the full-frame scan: untouched
                        // pixels are equal in both buffers by initialisation).
                        {
                            let nJ = 0;
                            for (let y = 1; y < ph - 1; y++) for (let x = 1; x < pw - 1; x++) { const i = y*pw+x;
                                if (underMask[i] || band[i]) nJ++; }
                            const JL = new Int32Array(nJ);
                            nJ = 0;
                            for (let y = 1; y < ph - 1; y++) for (let x = 1; x < pw - 1; x++) { const i = y*pw+x;
                                if (underMask[i] || band[i]) JL[nJ++] = i; }
                            // planar channels: 3 independent streams, better cache
                            // behaviour than interleaved (results identical)
                            const P0a = new Float32Array(PN), P1a = new Float32Array(PN), P2a = new Float32Array(PN);
                            for (let i = 0; i < PN; i++) { P0a[i] = fillRGB[i*3]; P1a[i] = fillRGB[i*3+1]; P2a[i] = fillRGB[i*3+2]; }
                            let A0 = P0a, A1 = P1a, A2p = P2a;
                            let B0 = P0a.slice(), B1 = P1a.slice(), B2p = P2a.slice();
                            for (let p = 0; p < 24; p++) {
                                for (let q2 = 0; q2 < nJ; q2++) { const i = JL[q2];
                                    const l = i-1, r = i+1, u = i-pw, d = i+pw;
                                    // float grouping kept EXACTLY as the original (0.2*self + 0.2*sum4)
                                    B0[i] = 0.2 * A0[i] + 0.2 * (A0[l] + A0[r] + A0[u] + A0[d]);
                                    B1[i] = 0.2 * A1[i] + 0.2 * (A1[l] + A1[r] + A1[u] + A1[d]);
                                    B2p[i] = 0.2 * A2p[i] + 0.2 * (A2p[l] + A2p[r] + A2p[u] + A2p[d]);
                                }
                                let t2 = A0; A0 = B0; B0 = t2;
                                t2 = A1; A1 = B1; B1 = t2;
                                t2 = A2p; A2p = B2p; B2p = t2;
                            }
                            for (let q2 = 0; q2 < nJ; q2++) { const i = JL[q2];
                                fillRGB[i*3] = A0[i]; fillRGB[i*3+1] = A1[i]; fillRGB[i*3+2] = A2p[i]; }
                        }
                    }
                _mark('jacobi-main');
                    const order = { length: 0 }; // (retained name for the log below)
                    for (let i = 0; i < PN; i++) if (band[i]) order.length++;
                    // Stash directional gap data for the SD-export bundle (native res, top-row-first)
                    if (bgPlugMode === 'directional') {
                        const fillU8 = new Uint8Array(PN*3);
                        for (let k = 0; k < PN*3; k++) fillU8[k] = Math.max(0, Math.min(255, fillRGB[k]|0));
                        bgDirectionalExport = { band: band, plug: plugDepth, fill: fillU8, pw: pw, ph: ph };
                    }
                    // Bleed the band's fill colour a few px OUT into the surrounding
                    // non-band so the fill texture's bilinear edge blends fill->fill,
                    // not fill->black. Alpha stays sharp (= band); only RGB is bled.
                    { // [PERF] frontier generations instead of BLEED full-frame passes
                      // with buffer copies. Exact: candidates are discovered from the
                      // previous generation, then coloured by checking their own
                      // neighbours in the ORIGINAL l,r,u,d priority against the
                      // previous-generation state — identical pixels, identical colours.
                      const filled = new Uint8Array(PN);
                      for (let i = 0; i < PN; i++) filled[i] = band[i] ? 1 : 0;
                      const BLEED = Math.max(3, (bgBandCutDilatePx|0) + 1); // must cover the cut ring
                      let frontier = [];
                      for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) { const i = y*pw+x;
                          if (!filled[i]) continue;
                          if ((x>0&&!filled[i-1])||(x<pw-1&&!filled[i+1])||(y>0&&!filled[i-pw])||(y<ph-1&&!filled[i+pw])) frontier.push(i); }
                      const stamp = new Int32Array(PN);
                      for (let p = 1; p <= BLEED; p++) {
                          const cand = [];
                          for (let f = 0; f < frontier.length; f++) {
                              const i = frontier[f]; const x = i%pw, y = (i/pw)|0;
                              let j;
                              if (x > 0)    { j = i-1;  if (!filled[j] && stamp[j] !== p) { stamp[j] = p; cand.push(j); } }
                              if (x < pw-1) { j = i+1;  if (!filled[j] && stamp[j] !== p) { stamp[j] = p; cand.push(j); } }
                              if (y > 0)    { j = i-pw; if (!filled[j] && stamp[j] !== p) { stamp[j] = p; cand.push(j); } }
                              if (y < ph-1) { j = i+pw; if (!filled[j] && stamp[j] !== p) { stamp[j] = p; cand.push(j); } }
                          }
                          for (let c = 0; c < cand.length; c++) {
                              const i = cand[c]; const x = i%pw, y = (i/pw)|0;
                              // original neighbour priority: left, right, up, down (prev state)
                              const j = (x>0&&filled[i-1]) ? i-1 : (x<pw-1&&filled[i+1]) ? i+1 : (y>0&&filled[i-pw]) ? i-pw : (y<ph-1&&filled[i+pw]) ? i+pw : -1;
                              if (j >= 0) { fillRGB[i*3]=fillRGB[j*3]; fillRGB[i*3+1]=fillRGB[j*3+1]; fillRGB[i*3+2]=fillRGB[j*3+2]; }
                          }
                          for (let c = 0; c < cand.length; c++) filled[cand[c]] = 1;
                          frontier = cand;
                      }
                    }
                    const fill = new Uint8Array(PN * 4);
                    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
                        const i = y*pw+x, o = ((ph-1-y)*pw+x)*4;
                        // RGB written everywhere (fill inside band, bled colour just
                        // outside, source elsewhere); alpha = reach-confidence (streaks
                        // fade out), 0 outside the band.
                        fill[o]=fillRGB[i*3]; fill[o+1]=fillRGB[i*3+1]; fill[o+2]=fillRGB[i*3+2];
                        fill[o+3] = bandAlpha[i];
                    }
                    _mark('bleed+filltex');
                        const fillDT = new THREE.DataTexture(fill, pw, ph, THREE.RGBAFormat, THREE.UnsignedByteType);
                    fillDT.needsUpdate = true; fillDT.flipY = false;
                    fillDT.minFilter = THREE.LinearFilter; fillDT.magFilter = THREE.LinearFilter;
                    if ('encoding' in fillDT) fillDT.encoding = THREE.sRGBEncoding;         // r128
                    if ('colorSpace' in fillDT) fillDT.colorSpace = THREE.SRGBColorSpace;   // r152+
                    _fillTex = fillDT;
                    console.log('[RUNG-PLUG] fill: directional bg extension/reflection (' + order.length + ' holes, ' + (Date.now()-tF) + 'ms)');

                    // ---- SCENE EXTENSION / OUTPAINT (coarse live pass) ----
                    // Grow the BG layer past the image rectangle so the off-axis frustum,
                    // as the head sweeps, finds background out to the terrarium frame and
                    // a little beyond, not clear-color void. Margin (auto) = the fixed
                    // pillarbox/letterbox gap between the image and the frame, PLUS the
                    // max-parallax reveal of the far plane across the head-track range:
                    // a far point (z = portal - sOuter) shifts on the portal by
                    // dEx * sOuter/(Ez + sOuter). Coarse fill = edge-replicate colour+depth
                    // into the margin (SD plate replaces it). Centre keeps band alpha so the
                    // FG still shows in front; the margin is opaque scene backdrop.
                    if (bgSceneExtend && L.mesh && L.mesh.geometry && L.mesh.geometry.parameters) {
                        const gp = L.mesh.geometry.parameters;
                        const origW = gp.width, origH = gp.height;
                        const segW0 = gp.widthSegments || 1, segH0 = gp.heightSegments || 1;
                        const ax = origW / pw, ay = origH / ph;               // world units / source texel
                        const hAngle = parseFloat(document.getElementById('autoSweepAngleHorizSlider')?.value || 45) / 400.0;
                        const vAngle = parseFloat(document.getElementById('autoSweepAngleVertSlider')?.value  || 45) / 400.0;
                        const Ez = Math.max(1e-3, Math.abs(((camera && camera.position) ? camera.position.z : 0.17) - portalPlaneWorldZ));
                        const sOuter = Math.max(1e-4, outerVolumeDepth * metricScaleFactor);
                        const parX = sOuter / (Ez + sOuter);                  // portal shift per unit eye-x
                        const PAD = 1.15;
                        // margin in WORLD units from the image edge: pillarbox gap + parallax reveal
                        const mWx = Math.max(0, (terrariumWidth  - origW) / 2) + hAngle * parX;
                        const mWy = Math.max(0, (terrariumHeight - origH) / 2) + vAngle * parX;
                        let mx = Math.ceil((mWx / ax) * PAD), my = Math.ceil((mWy / ay) * PAD);
                        mx = Math.max(0, Math.min(mx, pw));  my = Math.max(0, Math.min(my, ph)); // sane clamp
                        if (mx > 0 || my > 0) {
                            const tX = Date.now();
                            const EPW = pw + 2*mx, EPH = ph + 2*my, EPN = EPW*EPH;
                            const extDepth = new Float32Array(EPN);   // top-row-first
                            const extFill  = new Uint8Array(EPN*3);   // top-row-first RGB
                            const extMask  = new Uint8Array(EPN);     // 1 = margin (outpaint region)
                            // Margin content by pull-push DIFFUSION, not edge
                            // replication: replicating the rim row/column outward
                            // manufactures 1-D ribbons (streaks) by construction.
                            // Diffusing from the whole rim gives a soft wash that
                            // reads as continuation — the SD plate replaces it
                            // with real content. Color and depth both diffuse
                            // (replicated depth carries the rim's profile outward
                            // as shading ridges — same streak, in geometry).
                            const extValid = new Uint8Array(EPN);
                            const extCpx = new Uint8Array(EPN*4);   // RGBA, colour source
                            const extDpx = new Uint8Array(EPN*4);   // RGBA, depth encoded as gray
                            // Margin seeds = SOURCE image colour + FRONT-surface depth, not the
                            // plate fill. A beyond-frame reveal shows the front world continuing
                            // past the frame (the near dune keeps going below the bottom edge),
                            // and a near-depth skirt parallax-slides with the FG silhouette to
                            // cover the gap. Seeding from the plate put the occluded-world wash
                            // (inpaint blues, starved blacks, fill striations) at FAR depth in
                            // the margin: it stayed put under parallax and rendered as the
                            // striped off-colour band along the frame edge at look-up poses.
                            for (let Y = 0; Y < ph; Y++) for (let X = 0; X < pw; X++) {
                                const si = Y*pw+X, di = (Y+my)*EPW+(X+mx);
                                extValid[di] = 1;
                                extCpx[di*4]   = cpx[si*4];
                                extCpx[di*4+1] = cpx[si*4+1];
                                extCpx[di*4+2] = cpx[si*4+2];
                                extCpx[di*4+3] = 255;
                                const dz = Math.max(0, Math.min(255, (depth[si]*255)|0));
                                extDpx[di*4] = dz; extDpx[di*4+1] = dz; extDpx[di*4+2] = dz; extDpx[di*4+3] = 255;
                            }
                            const extColorSmooth = bgPullPushFill(extCpx, extValid, EPW, EPH);
                            const extDepthSmooth = bgPullPushFill(extDpx, extValid, EPW, EPH);
                            for (let Y = 0; Y < EPH; Y++) for (let X = 0; X < EPW; X++) {
                                const di = Y*EPW+X;
                                const inCenter = extValid[di] === 1;
                                if (inCenter) {
                                    const si = (Y-my)*pw+(X-mx);
                                    extDepth[di] = plugDepth[si];
                                    extFill[di*3]   = Math.max(0, Math.min(255, fillRGB[si*3]|0));
                                    extFill[di*3+1] = Math.max(0, Math.min(255, fillRGB[si*3+1]|0));
                                    extFill[di*3+2] = Math.max(0, Math.min(255, fillRGB[si*3+2]|0));
                                } else {
                                    // one-quantum setback: the margin depth passed through an
                                    // 8-bit channel; quantization UP can exceed the plate's
                                    // z-bias under bilinear sampling and win the z-test over
                                    // the FG at the frame weld (measured protrusion seam).
                                    extDepth[di] = Math.max(0, extDepthSmooth[di*3] - 1) / 255;
                                    extFill[di*3]   = extColorSmooth[di*3];
                                    extFill[di*3+1] = extColorSmooth[di*3+1];
                                    extFill[di*3+2] = extColorSmooth[di*3+2];
                                }
                                extMask[di] = inCenter ? 0 : 1;
                            }
                            // WELD RING: the outermost few CENTER texels take front-surface
                            // depth + source colour, matching the margin skirt. Without it,
                            // the plate(far)->skirt(near) depth cliff sits exactly on the
                            // frame boundary and its one-texel transition quad renders as a
                            // fold wall textured with the plate<->skirt colour blend — the
                            // thin dark seam line hugging the FG silhouette at look-up. The
                            // ring is never legitimately visible as plate (the FG edge rows
                            // cover it at rest; the skirt covers it in reveals), so moving
                            // the cliff a few texels inboard hides the fold behind the skirt.
                            const WELD = 3;
                            for (let Y = 0; Y < ph; Y++) for (let X = 0; X < pw; X++) {
                                if (Math.min(X, Y, pw-1-X, ph-1-Y) >= WELD) continue;
                                const si = Y*pw+X, di = (Y+my)*EPW+(X+mx);
                                extDepth[di] = depth[si];
                                extFill[di*3]   = cpx[si*4];
                                extFill[di*3+1] = cpx[si*4+1];
                                extFill[di*3+2] = cpx[si*4+2];
                            }
                            // extended plug-depth texture (RedFloat, rows flipped for GL like the native one)
                            const eplug = new Float32Array(EPN);
                            for (let y = 0; y < EPH; y++) { const s = y*EPW, d = (EPH-1-y)*EPW;
                                for (let x = 0; x < EPW; x++) eplug[d+x] = extDepth[s+x]; }
                            const eplugDT = new THREE.DataTexture(eplug, EPW, EPH, THREE.RedFormat, THREE.FloatType);
                            eplugDT.needsUpdate = true; eplugDT.flipY = false;
                            eplugDT.minFilter = THREE.LinearFilter; eplugDT.magFilter = THREE.LinearFilter;
                            if ('colorSpace' in eplugDT) eplugDT.colorSpace = THREE.NoColorSpace;
                            _plugTex = eplugDT;
                            // extended fill texture. Centre alpha = the interior reach
                            // confidence (streaks fade, FG shows in front). Margin alpha
                            // stays opaque near the frame then fades to transparent toward
                            // the outer edge (the far, purely-stretched reach — no smear at
                            // the rim; the SD outpaint plate fills it solid). Rows flipped.
                            const efill = new Uint8Array(EPN*4);
                            for (let Y = 0; Y < EPH; Y++) { const inRowY = (Y>=my && Y<my+ph);
                                const dY = (Y<my)?(my-Y):(Y>=my+ph?(Y-(my+ph)+1):0);
                                const fracY = my>0 ? dY/my : 0;
                                for (let X = 0; X < EPW; X++) {
                                    const si = Y*EPW+X, o = ((EPH-1-Y)*EPW+X)*4;
                                    const inCenter = inRowY && (X>=mx && X<mx+pw);
                                    efill[o]=extFill[si*3]; efill[o+1]=extFill[si*3+1]; efill[o+2]=extFill[si*3+2];
                                    let a;
                                    if (inCenter) { a = bandAlpha[(Y-my)*pw + (X-mx)]; }
                                    else {
                                        const dX = (X<mx)?(mx-X):(X>=mx+pw?(X-(mx+pw)+1):0);
                                        const fracX = mx>0 ? dX/mx : 0;
                                        const frac = Math.max(fracX, fracY);        // Chebyshev reach into margin
                                        if (frac <= bgMarginFadeStartFrac) a = 255;
                                        else { const t=(frac-bgMarginFadeStartFrac)/(1-bgMarginFadeStartFrac);
                                               a = Math.round(255*(1 - t*t*(3-2*t))); }
                                    }
                                    efill[o+3] = a;
                                }
                            }
                            const efillDT = new THREE.DataTexture(efill, EPW, EPH, THREE.RGBAFormat, THREE.UnsignedByteType);
                            efillDT.needsUpdate = true; efillDT.flipY = false;
                            efillDT.minFilter = THREE.LinearFilter; efillDT.magFilter = THREE.LinearFilter;
                            if ('encoding' in efillDT) efillDT.encoding = THREE.sRGBEncoding;
                            if ('colorSpace' in efillDT) efillDT.colorSpace = THREE.SRGBColorSpace;
                            _fillTex = efillDT;
                            // oversized geometry, same vertex density, centred on the portal
                            const gW = origW + 2*mx*ax, gH = origH + 2*my*ay;
                            const segW = Math.max(1, Math.round(segW0 * gW / origW));
                            const segH = Math.max(1, Math.round(segH0 * gH / origH));
                            bgExtGeom = new THREE.PlaneGeometry(gW, gH, segW, segH);
                            // stash for the SD outpaint bundle (top-row-first, extended res)
                            bgExtendExport = { mx, my, pw, ph, EPW, EPH, depth: extDepth, fill: extFill, mask: extMask };
                            _mark('scene-extension');
                        console.log('[RUNG-PLUG] scene extension: +' + mx + 'x' + my + 'px margin -> ' +
                                EPW + 'x' + EPH + ' (' + (Date.now()-tX) + 'ms)');
                        }
                    }
                }
            } catch(e) {
                console.warn('[RUNG-PLUG] CPU plug failed, using GPU fallback:', e);
            }
        } else {
            console.log('[RUNG-PLUG] masks not loaded, using GPU depth path');
        }
        mat.uniforms.displacementMap.value = _plugTex;
        if (_fillTex) mat.uniforms.map.value = _fillTex; // nearest-valid color fill in the holes
        mat.uniforms.u_isBackgroundLayer.value = true;
        mat.uniforms.u_useEdgeMask.value = false;
        // The clone may inherit an armed band cut from the FG (rebuild case);
        // the BG never cuts — clear it so no stale texture stays bound.
        if (mat.uniforms.u_useBandCut) { mat.uniforms.u_useBandCut.value = false; mat.uniforms.u_bandMask.value = null; }
        // Tiny push back so the BG never z-fights the FG where their depths match.
        mat.uniforms.displacementBias.value = (mat.uniforms.displacementBias.value || 0) - 0.004;
        bgLayerMesh = new THREE.Mesh(bgExtGeom || L.mesh.geometry, mat);
        bgLayerMesh.position.copy(L.mesh.position);
        bgLayerMesh.rotation.copy(L.mesh.rotation);
        bgLayerMesh.scale.copy(L.mesh.scale);
        bgLayerMesh.renderOrder = (L.mesh.renderOrder || 0) - 1;
        const show = document.getElementById('bgLayerToggle');
        bgLayerMesh.visible = show ? show.checked : true;
        scene.add(bgLayerMesh);

        // ---- UNDER-SHEET MESH (MPI slice 2): between plate and FG ----
        if (mpiMidMesh) { scene.remove(mpiMidMesh); mpiMidMesh.geometry.dispose(); mpiMidMesh.material.dispose(); mpiMidMesh = null; }
        if (_midBand && _midFillRGB && L.mesh.geometry && L.mesh.geometry.parameters) {
            const midBand = _midBand, midDepthV = _midDepthV, midFillRGB = _midFillRGB, depth = _midFrontD;
            try {
                const gU = L.mesh.geometry, gpU = gU.parameters;
                const pww = _midPW, phh = _midPH;
                // depth texture: front surface outside the band (welds seamlessly),
                // carried far depth inside
                const mD = new Float32Array(midBand.length);
                const mF = new Uint8Array(midBand.length * 4);
                for (let y = 0; y < phh; y++) { const s = y*pww, d = (phh-1-y)*pww;
                    for (let x = 0; x < pww; x++) {
                        const i = s+x, o = (d+x)*4;
                        // outside the band: FRONT surface with a small setback (the
                        // plate's own bias constant), so half-texel bilinear blends at
                        // the sheet boundary can never beat the FG's z (measured
                        // protrusion flecks at ribbon/sheet boundaries)
                        mD[d+x] = midBand[i] ? midDepthV[i] : Math.max(0, depth[i] - 0.004);
                        if (midBand[i]) { mF[o]=midFillRGB[i*3]; mF[o+1]=midFillRGB[i*3+1]; mF[o+2]=midFillRGB[i*3+2]; mF[o+3]=255; }
                        else { mF[o+3]=0; }
                    }
                }
                const mDT = new THREE.DataTexture(mD, pww, phh, THREE.RedFormat, THREE.FloatType);
                mDT.needsUpdate = true; mDT.flipY = false;
                mDT.minFilter = THREE.LinearFilter; mDT.magFilter = THREE.LinearFilter;
                if ('colorSpace' in mDT) mDT.colorSpace = THREE.NoColorSpace;
                const mFT = new THREE.DataTexture(mF, pww, phh, THREE.RGBAFormat, THREE.UnsignedByteType);
                mFT.needsUpdate = true; mFT.flipY = false;
                mFT.minFilter = THREE.LinearFilter; mFT.magFilter = THREE.LinearFilter;
                if ('encoding' in mFT) mFT.encoding = THREE.sRGBEncoding;
                if ('colorSpace' in mFT) mFT.colorSpace = THREE.SRGBColorSpace;
                // triangles touching the band only
                const full = gU.userData._fullIndex || gU.index.array;
                const vw2 = ((gpU.widthSegments || 1) | 0) + 1, vh2 = ((gpU.heightSegments || 1) | 0) + 1;
                const sx2 = (pww - 1) / Math.max(1, vw2 - 1), sy2 = (phh - 1) / Math.max(1, vh2 - 1);
                // INTERIOR triangles only: a boundary triangle spans floor depth
                // (near) inside the band to front depth (sky) outside — a one-
                // texel wall stretched across the full parallax, rendered as the
                // semi-transparent smear along silhouettes. All 3 vertices in.
                const midIdx = [];
                for (let t = 0; t < full.length; t += 3) {
                    let all3 = true;
                    for (let k = 0; k < 3 && all3; k++) {
                        const vi = full[t+k];
                        const tx = Math.round((vi % vw2) * sx2), ty = Math.round(((vi / vw2) | 0) * sy2);
                        if (!midBand[ty*pww+tx]) all3 = false;
                    }
                    if (all3) midIdx.push(full[t], full[t+1], full[t+2]);
                }
                if (midIdx.length) {
                    const mg = new THREE.BufferGeometry();
                    mg.setAttribute('position', gU.attributes.position);
                    mg.setAttribute('uv', gU.attributes.uv);
                    if (gU.attributes.normal) mg.setAttribute('normal', gU.attributes.normal);
                    mg.setIndex(new THREE.BufferAttribute(new full.constructor(midIdx), 1));
                    const mm = L.mesh.material.clone();
                    mm.uniforms.displacementMap.value = mDT;
                    mm.uniforms.map.value = mFT;
                    mm.uniforms.u_isBackgroundLayer.value = true;
                    mm.uniforms.u_useEdgeMask.value = false;
                    if (mm.uniforms.u_useBandCut) { mm.uniforms.u_useBandCut.value = false; mm.uniforms.u_bandMask.value = null; }
                    mm.uniforms.displacementBias.value = (mm.uniforms.displacementBias.value || 0) - 0.002; // between FG (0) and plate (-0.004)
                    mpiMidMesh = new THREE.Mesh(mg, mm);
                    mpiMidMesh.position.copy(L.mesh.position);
                    mpiMidMesh.rotation.copy(L.mesh.rotation);
                    mpiMidMesh.scale.copy(L.mesh.scale);
                    mpiMidMesh.renderOrder = (L.mesh.renderOrder || 0) - 0.5;
                    scene.add(mpiMidMesh);
                    console.log('[MPI] under-sheet mesh: ' + (midIdx.length/3) + ' tris between plate and FG');
                }
            } catch (e) { console.warn('[MPI] under-sheet mesh failed:', e); }
        }

        _mark('meshes');
        console.log('[PERF] build ' + (Date.now() - _pt0) + 'ms | ' + _perf.join(' | '));
        console.log('[BG-LAYER] built: band + plug depth + baked color, mesh added behind layer 0');
        return true;
    } catch (e) {
        console.error('[BG-LAYER] build failed:', e);
        alert('BG layer build failed - see console');
        return false;
    }
}

// CSP-clean wiring for the debug-sheet button and threshold readout.
// (The page's Content-Security-Policy forbids inline on* attributes, which is
// also the codebase convention — everything else is wired via addEventListener.)
// readyState-safe: runs immediately if the DOM is already parsed, otherwise
// waits for DOMContentLoaded. Logs a marker so a missing log line = stale JS.
function _wireDebugSheetControls() {
    // On-page build badge: self-reporting from the JS constant, so the page
    // always testifies to the build actually running — screenshot-verifiable,
    // immune to file mix-ups.
    const badge = document.getElementById('buildBadge');
    if (badge) badge.textContent = MOEBIUS_DEBUG_VERSION;

    const btn = document.getElementById('debugSheetBtn');
    if (btn) {
        btn.addEventListener('click', exportDebugContactSheet);
        console.log('[DBG-SHEET] button wired (build v17)');
    } else {
        console.warn('[DBG-SHEET] #debugSheetBtn not found — HTML is older than this JS');
    }
    const _thrSlider = document.getElementById('fgSubThresholdSlider');
    const _thrValue = document.getElementById('fgSubThresholdSliderValue');
    if (_thrSlider && _thrValue) {
        _thrSlider.addEventListener('input', () => {
            _thrValue.textContent = parseFloat(_thrSlider.value).toFixed(2);
        });
    }
    document.getElementById('sdBundleBtn')?.addEventListener('click', exportSDBundle);
    document.getElementById('bgLayerBuildBtn')?.addEventListener('click', buildBackgroundLayer);
    document.getElementById('bgColorImport')?.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        if (!bgLayerMesh) { alert('Build the BG layer first, then import the diffused color.'); return; }
        const img = new Image();
        img.onload = () => {
            const tex = new THREE.Texture(img);
            tex.needsUpdate = true;
            bgLayerMesh.material.uniforms.map.value = tex;
            console.log('[BG-LAYER] imported diffused BG color:', file.name, img.width + 'x' + img.height);
        };
        img.onerror = () => alert('Could not load image: ' + file.name);
        img.src = URL.createObjectURL(file);
        e.target.value = '';
    });
    document.getElementById('bgLayerToggle')?.addEventListener('change', (e) => {
        if (bgLayerMesh) bgLayerMesh.visible = e.target.checked;
        // The FG stretch cut is only safe while the plug is there to back it —
        // disarm it whenever the BG layer is hidden, re-arm when shown.
        const fu = mediaLayers[0]?.mesh?.material?.uniforms;
        if (fu && fu.u_useBandCut) fu.u_useBandCut.value = e.target.checked && !!bgCutFGOnPlug && !!fu.u_bandMask.value;
    });
    document.getElementById('bgSoloToggle')?.addEventListener('change', (e) => {
        const L0 = (typeof mediaLayers !== 'undefined') ? mediaLayers[0] : null;
        if (L0 && L0.mesh) L0.mesh.visible = !e.target.checked;
    });
    const _reachSlider = document.getElementById('fgReachSlider');
    const _reachValue = document.getElementById('fgReachSliderValue');
    if (_reachSlider && _reachValue) {
        _reachSlider.addEventListener('input', () => {
            _reachValue.textContent = _reachSlider.value;
        });
    }
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _wireDebugSheetControls);
} else {
    _wireDebugSheetControls();
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

function updateCameraAndProjection() {
    if (!camera || !canvasElement) return;

    // --- 1. Handle Dolly Zoom & Subject Lock ---
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

    // --- 2. Handle Face Tracking & Gyro ---
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

    if (!isSweeping) {
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
    }

    camera.updateProjectionMatrix();
    const pbl = new THREE.Vector3(-terrariumWidth/2,-terrariumHeight/2,portalPlaneWorldZ);
    const pbr = new THREE.Vector3(terrariumWidth/2,-terrariumHeight/2,portalPlaneWorldZ);
    const ptl = new THREE.Vector3(-terrariumWidth/2,terrariumHeight/2,portalPlaneWorldZ);
    frameCorners(camera, pbl, pbr, ptl);

    // --- 3. Update Dynamic Layer Uniforms ---
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
            uniforms.u_splitPeekActive.value = isDraggingSplit;
            uniforms.u_splitPeekValue.value = depthPeekValue;
            uniforms.u_metricScale.value = metricScaleFactor;

            // --- NEW: Sync Ghost Mesh Uniforms ---
            if (layer.ghostMesh && layer.ghostMesh.material.uniforms) {
                const gu = layer.ghostMesh.material.uniforms;
                
                layer.ghostMesh.position.z = layer.mesh.position.z; // Align Z
                
                // Copy all vital displacement params so Ghost matches Main mesh
                gu.u_portalPlaneDepthNorm.value = uniforms.u_portalPlaneDepthNorm.value;
                gu.u_worldOuterVolumeDepth.value = uniforms.u_worldOuterVolumeDepth.value;
                gu.u_worldInnerVolumeDepth.value = uniforms.u_worldInnerVolumeDepth.value;
                gu.u_metricScale.value = uniforms.u_metricScale.value;
                
                // Sync textures if they change dynamically
                // (Note: Shader materials might use specific names based on type)
                if (gu.map && uniforms.map) gu.map.value = uniforms.map.value;
                if (gu.displacementMap && uniforms.displacementMap) gu.displacementMap.value = uniforms.displacementMap.value;
                if (gu.rgbTexture && uniforms.rgbTexture) gu.rgbTexture.value = uniforms.rgbTexture.value;
                if (gu.depthTexture && uniforms.depthTexture) gu.depthTexture.value = uniforms.depthTexture.value;
                if (gu.videoTexture && uniforms.videoTexture) gu.videoTexture.value = uniforms.videoTexture.value;
            }
        }
    }

    // --- 4. Update Infill Atlas Mesh Uniforms (Legacy/Fallback) ---
    // Kept for compatibility if you still use the Atlas logic
    if (infillAtlasMesh && infillAtlasMesh.material && infillAtlasMesh.material.uniforms) {
        infillAtlasMesh.position.z = portalPlaneWorldZ; 
        const uniforms = infillAtlasMesh.material.uniforms;
        
        // Displacement Params
        if (uniforms.u_portalPlaneDepthNorm) uniforms.u_portalPlaneDepthNorm.value = currentNormPortalPlane;
        if (uniforms.u_worldInnerVolumeDepth) uniforms.u_worldInnerVolumeDepth.value = innerVolumeDepth;
        if (uniforms.u_worldOuterVolumeDepth) uniforms.u_worldOuterVolumeDepth.value = outerVolumeDepth;
        if (uniforms.u_metricScale) uniforms.u_metricScale.value = metricScaleFactor;
        
        // Debug Params
        if (uniforms.displacementBias) uniforms.displacementBias.value = 0.0;
        
        // Ensure texture maps are correct
        if (infillAtlasTarget_Color && infillAtlasTarget_Depth) {
             if (uniforms.map) uniforms.map.value = infillAtlasTarget_Color.texture;
             if (uniforms.displacementMap) uniforms.displacementMap.value = infillAtlasTarget_Depth.texture; 
             if (uniforms.depthTexture) uniforms.depthTexture.value = infillAtlasTarget_Depth.texture; 
        }
        
        if (uniforms.u_viewMatrix) uniforms.u_viewMatrix.value.copy(camera.matrixWorldInverse);
        if (uniforms.u_projectionMatrix) uniforms.u_projectionMatrix.value.copy(camera.projectionMatrix);
    }

    updateVolumeGuidesPositionsAndScales();
}

/**
 * Runs one frame of texture-space accumulation.
 * Renders the SCENE MESH(es) unwrapped into the atlas targets.
 */
function runAccumulationPass(layerMaskTexture, uvMapTexture, sourceColorTexture, sourceDepthTexture) {
    if (!renderer || !infillAtlasTarget_Color || !infillAtlasTarget_Depth || 
        !groundTruthColorAccumulatorMaterial || !groundTruthDepthAccumulatorMaterial ||
        !sourceColorTexture || !sourceDepthTexture || !layerMaskTexture) {
        return;
    }

    // NEW: We want to bake ALL valid mesh layers, even if hidden in the view
    // This allows exporting maps even if the user has hidden the mesh to see the background.
    const validLayers = mediaLayers.filter(l => l.mesh);
    
    if (validLayers.length === 0) return;

    // --- Pass 1: Accumulate Color ---
    renderer.setRenderTarget(infillAtlasTarget_Color);
    // DO NOT CLEAR (We are accumulating additively)

    for (const layer of validLayers) {
        // Store visibility state
        const wasVisible = layer.mesh.visible;
        
        // Force visible for the bake step
        layer.mesh.visible = true;

        // Override material with Accumulator
        const originalMaterial = layer.mesh.material;
        layer.mesh.material = groundTruthColorAccumulatorMaterial;

        // Update Uniforms
        groundTruthColorAccumulatorMaterial.uniforms.tSourceColor.value = sourceColorTexture;
        groundTruthColorAccumulatorMaterial.uniforms.tLayerMask.value = layerMaskTexture;
        
        // Render geometry unwrapped
        renderer.render(layer.mesh, camera);

        // Restore material and visibility
        layer.mesh.material = originalMaterial;
        layer.mesh.visible = wasVisible;
    }

    // --- Pass 2: Accumulate Depth ---
    renderer.setRenderTarget(infillAtlasTarget_Depth);
    // DO NOT CLEAR

    for (const layer of validLayers) {
        // Store visibility state
        const wasVisible = layer.mesh.visible;
        
        // Force visible for the bake step
        layer.mesh.visible = true;

        const originalMaterial = layer.mesh.material;
        layer.mesh.material = groundTruthDepthAccumulatorMaterial;

        groundTruthDepthAccumulatorMaterial.uniforms.tSourceDepth.value = sourceDepthTexture;
        groundTruthDepthAccumulatorMaterial.uniforms.tLayerMask.value = layerMaskTexture;

        renderer.render(layer.mesh, camera);

        layer.mesh.material = originalMaterial;
        layer.mesh.visible = wasVisible;
    }
}

/**
 * Renders the screen with a red overlay showing gaps in the atlas.
 * Uses UV Mapping to ensure the overlay aligns perfectly with content.
 */
function renderFeedbackOverlay(imageTexture) {
    if (!renderer || !postProcessScene || !postProcessCamera || !imageTexture ||
        !feedbackOverlayMaterial || !infillAtlasTarget_Color?.texture || !uvMapRenderTarget?.texture) {
        return;
    }

    const postProcessQuad = postProcessScene.children[0];

    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
    
    postProcessQuad.material = feedbackOverlayMaterial;
    feedbackOverlayMaterial.uniforms.tDiffuse.value = imageTexture; 
    feedbackOverlayMaterial.uniforms.tAtlas.value = infillAtlasTarget_Color.texture; // The UV-Space Atlas
    feedbackOverlayMaterial.uniforms.tUVMap.value = uvMapRenderTarget.texture;       // The Screen-Space UV Map
    
    renderer.render(postProcessScene, postProcessCamera);
}
/**
 * Bakes the final Infill Atlas using the selected filling strategy.
 */

async function bakeInfillAtlas() {
    console.log(`--- Starting Ground Truth Atlas Bake (${currentBakeFillMethod}) ---`);
    isSweeping = true;
    
    // Buttons to manage
    const manualBtn = document.getElementById('manualAccumulationButton');
    const quickBtn = document.getElementById('autoSweepQuickButton');
    const fullBtn = document.getElementById('autoSweepFullButton');
    
    // Check resources
    if (!normalizationMaterial || !pingPongRenderTargetA || !pingPongRenderTargetB) {
        console.error("Bake failed: Missing resources.");
        return;
    }

    const postProcessQuad = postProcessScene.children[0];

    // --- Step 1: Normalize Accumulation Buffers (WAA) ---
    if (manualBtn) manualBtn.textContent = "Baking... (Normalize)";
    
    // Normalize Color -> PingPongA
    postProcessQuad.material = normalizationMaterial;
    normalizationMaterial.uniforms.tAccumulatedData.value = infillAtlasTarget_Color.texture;
    normalizationMaterial.uniforms.u_isDepth.value = false;
    renderer.setRenderTarget(pingPongRenderTargetA);
    renderer.clear();
    renderer.render(postProcessScene, postProcessCamera);

    // Normalize Depth -> PingPongB
    normalizationMaterial.uniforms.tAccumulatedData.value = infillAtlasTarget_Depth.texture;
    normalizationMaterial.uniforms.u_isDepth.value = true;
    renderer.setRenderTarget(pingPongRenderTargetB);
    renderer.clear();
    renderer.render(postProcessScene, postProcessCamera);

    // --- Step 2: Fill Color Holes (Pull-Push) ---
    runColorPullPush(pingPongRenderTargetA.texture, infillAtlasTarget_Color);

    // --- Step 3: Fill Depth Holes (Strategy) ---
    if (manualBtn) manualBtn.textContent = `Baking... (${currentBakeFillMethod})`;

    const sourceDepth = pingPongRenderTargetB.texture; // Normalized Depth with Holes

    if (currentBakeFillMethod === 'flood') {
        let readTarget = pingPongRenderTargetB;
        let writeTarget = pingPongRenderTargetA;
        const iterations = 64; 

        postProcessQuad.material = fillBackgroundFloodMaterial;
        fillBackgroundFloodMaterial.uniforms.u_resolution.value.set(renderer.domElement.width, renderer.domElement.height);

        for (let i = 0; i < iterations; i++) {
            fillBackgroundFloodMaterial.uniforms.tDiffuse.value = readTarget.texture;
            renderer.setRenderTarget(writeTarget);
            renderer.clear();
            renderer.render(postProcessScene, postProcessCamera);
            let temp = readTarget; readTarget = writeTarget; writeTarget = temp;
        }
        
        postProcessQuad.material = copyMaterial;
        copyMaterial.uniforms.tDiffuse.value = readTarget.texture;
        renderer.setRenderTarget(infillAtlasTarget_Depth);
        renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);

    } else if (currentBakeFillMethod === 'pyramid') {
        // 1. Build Pyramid
        postProcessQuad.material = copyMaterial;
        copyMaterial.uniforms.tDiffuse.value = sourceDepth;
        renderer.setRenderTarget(pullPyramidTargets[0]);
        renderer.render(postProcessScene, postProcessCamera);

        postProcessQuad.material = fillMaxDepthDownsampleMaterial;
        const numLevels = Math.min(pullPyramidTargets.length, 8);

        for (let i = 1; i < numLevels; i++) {
            const finer = pullPyramidTargets[i-1];
            const coarser = pullPyramidTargets[i];
            
            fillMaxDepthDownsampleMaterial.uniforms.tInput.value = finer.texture;
            fillMaxDepthDownsampleMaterial.uniforms.u_inputResolution.value.set(finer.width, finer.height);
            
            renderer.setRenderTarget(coarser);
            renderer.clear();
            renderer.render(postProcessScene, postProcessCamera);
        }

        // 2. Resolve
        postProcessQuad.material = fillMaxDepthUpsampleMaterial;
        fillMaxDepthUpsampleMaterial.uniforms.tHighRes.value = sourceDepth;
        fillMaxDepthUpsampleMaterial.uniforms.tLowRes.value = pullPyramidTargets[numLevels-1].texture; 
        
        renderer.setRenderTarget(infillAtlasTarget_Depth);
        renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);

    } else if (currentBakeFillMethod === 'planar') {
        postProcessQuad.material = fillPlanarBackplaneMaterial;
        fillPlanarBackplaneMaterial.uniforms.tDepth.value = sourceDepth;
        
        renderer.setRenderTarget(infillAtlasTarget_Depth);
        renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);
    }

    // --- Step 4: Pack Depth for VTF ---
    if (manualBtn) manualBtn.textContent = "Baking... (VTF Pack)";
    
    postProcessQuad.material = copyMaterial;
    copyMaterial.uniforms.tDiffuse.value = infillAtlasTarget_Depth.texture;
    renderer.setRenderTarget(infillAtlasTarget_Depth_VTF);
    renderer.clear();
    renderer.render(postProcessScene, postProcessCamera);

    // --- Cleanup & Reset Buttons ---
    useStaticInfillAtlas = true;
    isAccumulatingGaps = false;
    isSweeping = false;
    
    initializeInfillAtlasMesh();

    console.log("--- Ground Truth Atlas Bake Complete ---");
    
    // --- CRITICAL FIX: Reset ALL buttons ---
    if (manualBtn) {
        manualBtn.textContent = 'Start Live Sweep';
        manualBtn.disabled = false;
        manualBtn.style.backgroundColor = '';
    }
    if (quickBtn) {
        quickBtn.textContent = 'Run Quick Bake (Grid)';
        quickBtn.disabled = false;
    }
    if (fullBtn) {
        fullBtn.textContent = 'Run Full Bake (Continuous)';
        fullBtn.disabled = false;
    }
}

// Helper for Color Inpainting (Standard Pull-Push)
function runColorPullPush(sourceTexture, destinationTarget) {
    const postProcessQuad = postProcessScene.children[0];
    const coarsestIndex = Math.min(pullPyramidTargets.length, maxPyramidLevels) - 1;

    // 1. Init
    postProcessQuad.material = copyMaterial;
    copyMaterial.uniforms.tDiffuse.value = sourceTexture;
    renderer.setRenderTarget(pullPyramidTargets[0]);
    renderer.clear();
    renderer.render(postProcessScene, postProcessCamera);

    // 2. Pull
    postProcessQuad.material = pullMaterial;
    for (let i = 1; i <= coarsestIndex; i++) {
        const finer = pullPyramidTargets[i-1];
        const coarser = pullPyramidTargets[i];
        pullMaterial.uniforms.tFinerLevel.value = finer.texture;
        pullMaterial.uniforms.u_texelSize.value.set(1.0 / finer.width, 1.0 / finer.height);
        renderer.setRenderTarget(coarser);
        renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);
    }

    // 3. Push
    postProcessQuad.material = copyMaterial;
    copyMaterial.uniforms.tDiffuse.value = pullPyramidTargets[coarsestIndex].texture;
    renderer.setRenderTarget(pushPyramidTargets[coarsestIndex]);
    renderer.render(postProcessScene, postProcessCamera);

    postProcessQuad.material = pushMaterial;
    for (let i = coarsestIndex - 1; i >= 0; i--) {
        pushMaterial.uniforms.tCoarserLevel.value = pushPyramidTargets[i+1].texture;
        pushMaterial.uniforms.tCurrentLevel.value = pullPyramidTargets[i].texture;
        renderer.setRenderTarget(pushPyramidTargets[i]);
        renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);
    }

    // 4. Output
    postProcessQuad.material = copyMaterial;
    copyMaterial.uniforms.tDiffuse.value = pushPyramidTargets[0].texture;
    renderer.setRenderTarget(destinationTarget);
    renderer.render(postProcessScene, postProcessCamera);
}


/**
 * Runs a 5x5 grid sweep to accumulate ground truth, then bakes the atlas.
 */
async function runAutomatedSweep() {
    // If a manual sweep is active, stop it before starting automated sweep.
    if (isAccumulatingGaps) {
        const manualBtn = document.getElementById('manualAccumulationButton');
        if (manualBtn) manualBtn.click(); // Simulate stop click
        return;
    }
    if (isSweeping) return;

    // Check for mesh layers
    const firstLayer = mediaLayers.find(l => l.mesh);
    if (!firstLayer) {
        console.error("Sweep failed: No mesh layers found.");
        const quickBtn = document.getElementById('autoSweepQuickButton');
        if (quickBtn) { quickBtn.disabled = false; quickBtn.textContent = 'Run Quick Bake (Grid)'; }
        return;
    }

    // Reset previous data before starting
    resetAccumulation();

    isSweeping = true;
    useStaticInfillAtlas = false;
    console.log("Starting Quick Bake (Grid) - Ground Truth WAA (Texture Space)");
    
    const quickBtn = document.getElementById('autoSweepQuickButton');
    const fullBtn = document.getElementById('autoSweepFullButton');
    const manualBtn = document.getElementById('manualAccumulationButton');
    if (quickBtn) { quickBtn.disabled = true; quickBtn.textContent = "Sweeping... (0/25)"; }
    if (fullBtn) fullBtn.disabled = true;
    if (manualBtn) manualBtn.disabled = true;
    
    const origCamPos = camera.position.clone();
    
    const hAngle = parseFloat(document.getElementById('autoSweepAngleHorizSlider')?.value || 45) / 400.0;
    const vAngle = parseFloat(document.getElementById('autoSweepAngleVertSlider')?.value || 20) / 400.0;

    const steps = 5; // 5x5 grid
    let count = 0;

    for (let i = 0; i < steps; i++) {
        for (let j = 0; j < steps; j++) {
            // Handle edge case where steps=1
            const u = (steps > 1) ? (i / (steps - 1)) * 2.0 - 1.0 : 0.0; // -1 to 1
            const v = (steps > 1) ? (j / (steps - 1)) * 2.0 - 1.0 : 0.0; // -1 to 1
            
            camera.position.x = origCamPos.x + u * hAngle;
            camera.position.y = origCamPos.y + v * vAngle;
            
            updateCameraAndProjection();
            
            // --- Unified Accumulation Step ---
            stepAccumulation();
            // ---------------------------------

            renderFeedbackOverlay(sceneRenderTarget.texture);

            count++;
            if (quickBtn) quickBtn.textContent = `Sweeping... (${count}/25)`;

            await new Promise(resolve => requestAnimationFrame(resolve)); 
        }
    }
    
    camera.position.copy(origCamPos);
    updateCameraAndProjection();
    
    await bakeInfillAtlas(); 
    console.log("Quick Bake Complete (Ground Truth WAA)");
}

/**
 * Runs a 3-second continuous sweep to accumulate ground truth, then bakes the atlas.
 */
async function runContinuousSweep() {
    // If a manual sweep is active, stop it before starting automated sweep.
    if (isAccumulatingGaps) {
        const manualBtn = document.getElementById('manualAccumulationButton');
        if (manualBtn) manualBtn.click();
        return;
    }
    if (isSweeping) return;

    // Check for mesh layers
    const firstLayer = mediaLayers.find(l => l.mesh);
    if (!firstLayer) {
        console.error("Sweep failed: No mesh layers found.");
        const fullBtn = document.getElementById('autoSweepFullButton');
        if (fullBtn) { fullBtn.disabled = false; fullBtn.textContent = 'Run Full Bake (Continuous)'; }
        return;
    }

    // Reset previous data before starting
    resetAccumulation();

    isSweeping = true;
    useStaticInfillAtlas = false;
    console.log("Starting Full Bake (Continuous) - Ground Truth WAA (Texture Space)");
    
    const quickBtn = document.getElementById('autoSweepQuickButton');
    const fullBtn = document.getElementById('autoSweepFullButton');
    const manualBtn = document.getElementById('manualAccumulationButton');
    if (quickBtn) quickBtn.disabled = true;
    if (fullBtn) { fullBtn.disabled = true; fullBtn.textContent = "Sweeping... (0%)"; }
    if (manualBtn) manualBtn.disabled = true;
    
    const origCamPos = camera.position.clone();
    
    const hAngle = parseFloat(document.getElementById('autoSweepAngleHorizSlider')?.value || 45) / 400.0;
    const vAngle = parseFloat(document.getElementById('autoSweepAngleVertSlider')?.value || 20) / 400.0;
    
    const totalFrames = 180; // ~3 seconds at 60fps
    
    for (let frame = 0; frame < totalFrames; frame++) {
        const t = frame / (totalFrames - 1); // 0 to 1
        
        camera.position.x = origCamPos.x + hAngle * Math.sin(t * Math.PI * 2 * 3); // 3 horizontal loops
        camera.position.y = origCamPos.y + vAngle * Math.sin(t * Math.PI * 2 * 2); // 2 vertical loops
        
        updateCameraAndProjection();

        // --- Unified Accumulation Step ---
        stepAccumulation();
        // ---------------------------------
        
        renderFeedbackOverlay(sceneRenderTarget.texture);

        if (frame % 10 === 0 && fullBtn) {
            fullBtn.textContent = `Sweeping... (${Math.round(t*100)}%)`;
        }
        
        // Yield control
        await new Promise(resolve => requestAnimationFrame(resolve));
    }
    
    camera.position.copy(origCamPos);
    updateCameraAndProjection();
    
    await bakeInfillAtlas(); 
    console.log("Full Bake Complete (Ground Truth WAA)");
}

// =============================================================================
// --- HOLE PATCH SYSTEM: Functions ---
// =============================================================================

/**
 * Resets the hole patch accumulation buffer
 */
function resetHolePatchAccumulation() {
    if (!renderer) return;
    
    console.log("--- Resetting Hole Patch Accumulation ---");
    
    // Reset accumulation counter
    if (typeof holeAccumulationCount !== 'undefined') {
        holeAccumulationCount = 0;
    }
    
    if (holePatchTarget) {
        renderer.setRenderTarget(holePatchTarget);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        console.log("Cleared holePatchTarget");
    }
    
    if (holeCaptureTarget) {
        renderer.setRenderTarget(holeCaptureTarget);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        console.log("Cleared holeCaptureTarget");
    }
    
    if (holePatchPingPongTarget) {
        renderer.setRenderTarget(holePatchPingPongTarget);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        console.log("Cleared holePatchPingPongTarget");
    }
    
    // Clear color accumulation targets
    if (holePatchColorTarget) {
        renderer.setRenderTarget(holePatchColorTarget);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        console.log("Cleared holePatchColorTarget");
    }
    
    if (holePatchColorPingPong) {
        renderer.setRenderTarget(holePatchColorPingPong);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        console.log("Cleared holePatchColorPingPong");
    }
    
    if (holeColorCaptureTarget) {
        renderer.setRenderTarget(holeColorCaptureTarget);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        console.log("Cleared holeColorCaptureTarget");
    }
    
    renderer.setRenderTarget(null);
    
    // Remove existing patch mesh
    if (holePatchMesh) {
        scene.remove(holePatchMesh);
        if (holePatchMesh.geometry) holePatchMesh.geometry.dispose();
        holePatchMesh = null;
        console.log("Removed existing hole patch mesh");
    }
    
    // Reset view mode
    if (showHolePatchOnly) {
        showHolePatchOnly = false;
        for (const layer of mediaLayers) {
            if (layer.mesh) layer.mesh.visible = true;
        }
        if (infillAtlasMesh) infillAtlasMesh.visible = useStaticInfillAtlas;
        
        const btn = document.getElementById('toggleHolePatchButton');
        if (btn) btn.textContent = '👁️ Show Patch Only';
    }
    
    renderer.setRenderTarget(null);
    console.log("Hole patch accumulation reset complete");
}

/**
 * Steps hole patch accumulation using GAPPED vs INPAINTED comparison.
 * Captures both hole mask/depth AND color from inpainting.
 * 
 * KEY INSIGHT: Compare the scene with gaps to the scene with inpainting applied.
 * WHERE they differ = holes, WHAT inpainted shows = fill color
 */
function stepHoleAccumulation() {
    if (!renderer || !holeColorDetectMaterial) {
        console.warn("stepHoleAccumulation: missing renderer or holeColorDetectMaterial");
        return;
    }
    
    if (!holePatchTarget || !holeCaptureTarget) {
        console.warn("stepHoleAccumulation: missing render targets");
        return;
    }
    
    holeAccumulationCount++;
    console.log(`--- stepHoleAccumulation #${holeAccumulationCount} START ---`);
    
    const postProcessQuad = postProcessScene.children[0];
    
    // Save the user's current gap detection settings
    const savedSettings = {
        useDepthGrad: document.getElementById('useDepthGradCheck')?.checked || false,
        useSobel: document.getElementById('useSobelCheck')?.checked || false,
        useLuma: document.getElementById('useLumaCheck')?.checked || false,
        useChroma: document.getElementById('useChromaCheck')?.checked || false,
        useCrease: document.getElementById('useCreaseCheck')?.checked || false,
        useCurvature: document.getElementById('useCurvatureCheck')?.checked || false,
        useUVStretch: document.getElementById('useUVStretchCheck')?.checked || false,
        useGrazingAngle: document.getElementById('useGrazingAngleCheck')?.checked || false,
        useEdgeMask: document.getElementById('useEdgeMaskCheck')?.checked || false
    };
    
    // Check if ANY gap detection is enabled
    const hasAnyGapDetection = Object.values(savedSettings).some(v => v);
    if (!hasAnyGapDetection) {
        console.warn("No gap detection enabled!");
        return;
    }
    
    // --- Step 1: Render scene WITH gap detection (gaps are transparent) ---
    setAllLayerUniforms('u_useDepthGrad', savedSettings.useDepthGrad);
    setAllLayerUniforms('u_useSobel', savedSettings.useSobel);
    setAllLayerUniforms('u_useLuma', savedSettings.useLuma);
    setAllLayerUniforms('u_useChroma', savedSettings.useChroma);
    setAllLayerUniforms('u_useCrease', savedSettings.useCrease);
    setAllLayerUniforms('u_useCurvature', savedSettings.useCurvature);
    setAllLayerUniforms('u_useUVStretch', savedSettings.useUVStretch);
    setAllLayerUniforms('u_useGrazingAngle', savedSettings.useGrazingAngle);
    setAllLayerUniforms('u_useEdgeMask', savedSettings.useEdgeMask);
    
    renderer.setRenderTarget(pingPongRenderTargetB);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    
    // --- Step 2: Render clean scene (no gaps) for color source ---
    renderNormalizedDepthPass();
    
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
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(scene, camera);
    
    // Restore gap settings for future renders
    setAllLayerUniforms('u_useDepthGrad', savedSettings.useDepthGrad);
    setAllLayerUniforms('u_useSobel', savedSettings.useSobel);
    setAllLayerUniforms('u_useLuma', savedSettings.useLuma);
    setAllLayerUniforms('u_useChroma', savedSettings.useChroma);
    setAllLayerUniforms('u_useCrease', savedSettings.useCrease);
    setAllLayerUniforms('u_useCurvature', savedSettings.useCurvature);
    setAllLayerUniforms('u_useUVStretch', savedSettings.useUVStretch);
    setAllLayerUniforms('u_useGrazingAngle', savedSettings.useGrazingAngle);
    setAllLayerUniforms('u_useEdgeMask', savedSettings.useEdgeMask);
    
    // --- Step 3: Detect holes by comparing gapped vs clean scene ---
    postProcessQuad.material = holeColorDetectMaterial;
    holeColorDetectMaterial.uniforms.tGapped.value = pingPongRenderTargetB.texture;
    // Compare with clean scene (no gaps) to find where gaps exist
    holeColorDetectMaterial.uniforms.tInpainted.value = sceneRenderTarget.texture;
    holeColorDetectMaterial.uniforms.tDepth.value = screenNormalizedDepthTarget?.texture;
    holeColorDetectMaterial.uniforms.u_resolution.value.set(renderer.domElement.width, renderer.domElement.height);
    
    renderer.setRenderTarget(holeCaptureTarget);
    renderer.clear();
    renderer.render(postProcessScene, postProcessCamera);
    
    // --- Step 4: Capture hole COLORS ---
    // Sample colors from edges of holes (nearby valid pixels)
    if (holeColorCaptureMaterial && holeColorCaptureTarget) {
        postProcessQuad.material = holeColorCaptureMaterial;
        holeColorCaptureMaterial.uniforms.tGapped.value = pingPongRenderTargetB.texture;
        holeColorCaptureMaterial.uniforms.tInpainted.value = sceneRenderTarget.texture;
        holeColorCaptureMaterial.uniforms.u_resolution.value.set(renderer.domElement.width, renderer.domElement.height);
        
        renderer.setRenderTarget(holeColorCaptureTarget);
        renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);
    }
    
    // --- Step 5: Accumulate holes to UV space by rendering mesh ---
    
    const validLayers = mediaLayers.filter(l => l.mesh);
    if (validLayers.length === 0) {
        console.warn("No valid layers for UV accumulation");
        renderer.setRenderTarget(null);
        return;
    }
    
    const primaryLayer = validLayers[0];
    
    // Ensure camera matrices are up to date
    camera.updateMatrixWorld(true);
    primaryLayer.mesh.updateMatrixWorld(true);
    
    // Create ping-pong targets if needed
    if (!holePatchPingPongTarget) {
        holePatchPingPongTarget = new THREE.WebGLRenderTarget(
            holePatchTarget.width, holePatchTarget.height,
            { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.HalfFloatType }
        );
    }
    if (!holePatchColorPingPong && holePatchColorTarget) {
        holePatchColorPingPong = new THREE.WebGLRenderTarget(
            holePatchColorTarget.width, holePatchColorTarget.height,
            { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat, type: THREE.HalfFloatType }
        );
    }
    
    // Ping-pong for hole mask + depth
    const readTarget = (holeAccumulationCount % 2 === 1) ? holePatchTarget : holePatchPingPongTarget;
    const writeTarget = (holeAccumulationCount % 2 === 1) ? holePatchPingPongTarget : holePatchTarget;
    
    const originalMaterial = primaryLayer.mesh.material;
    const wasVisible = primaryLayer.mesh.visible;
    
    // Accumulate hole mask + depth
    holeAccumulateMaterial.uniforms.tHoleCapture.value = holeCaptureTarget.texture;
    holeAccumulateMaterial.uniforms.tExisting.value = readTarget.texture;
    
    primaryLayer.mesh.material = holeAccumulateMaterial;
    primaryLayer.mesh.visible = true;
    
    renderer.setRenderTarget(writeTarget);
    renderer.clear();
    renderer.render(primaryLayer.mesh, camera);
    
    // Accumulate color if available
    if (holeColorAccumulateMaterial && holePatchColorTarget && holePatchColorPingPong && holeColorCaptureTarget) {
        const colorReadTarget = (holeAccumulationCount % 2 === 1) ? holePatchColorTarget : holePatchColorPingPong;
        const colorWriteTarget = (holeAccumulationCount % 2 === 1) ? holePatchColorPingPong : holePatchColorTarget;
        
        holeColorAccumulateMaterial.uniforms.tColorCapture.value = holeColorCaptureTarget.texture;
        holeColorAccumulateMaterial.uniforms.tExisting.value = colorReadTarget.texture;
        
        primaryLayer.mesh.material = holeColorAccumulateMaterial;
        
        renderer.setRenderTarget(colorWriteTarget);
        renderer.clear();
        renderer.render(primaryLayer.mesh, camera);
    }
    
    // Restore
    primaryLayer.mesh.material = originalMaterial;
    primaryLayer.mesh.visible = wasVisible;
    
    renderer.setRenderTarget(null);
    renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
    
    console.log(`--- stepHoleAccumulation #${holeAccumulationCount} COMPLETE ---`);
}

/**
 * Bakes the hole patch - creates the mesh with accumulated data
 */
async function bakeHolePatch() {
    console.log("--- Baking Hole Patch ---");
    
    if (!renderer || !holePatchTarget) {
        console.error("Hole patch bake failed: missing renderer or holePatchTarget");
        return;
    }
    
    if (!holePatchRenderMaterial) {
        console.error("Hole patch bake failed: missing holePatchRenderMaterial");
        return;
    }
    
    // Create or update the hole patch mesh
    initializeHolePatchMesh();
    
    console.log("Hole Patch bake complete.");
}

let isHolePatchSweeping = false;

/**
 * Runs a 5x5 grid sweep for hole patch accumulation
 */
async function runHolePatchQuickSweep() {
    if (isHolePatchSweeping || isSweeping) return;
    
    const firstLayer = mediaLayers.find(l => l.mesh);
    if (!firstLayer) {
        console.error("Hole patch sweep failed: No mesh layers found.");
        return;
    }
    
    isHolePatchSweeping = true;
    isSweeping = true;  // Disable face tracking/gyro
    resetHolePatchAccumulation();
    
    const quickBtn = document.getElementById('holePatchQuickSweepBtn');
    const fullBtn = document.getElementById('holePatchFullSweepBtn');
    if (quickBtn) { quickBtn.disabled = true; quickBtn.textContent = "Sweeping... (0/25)"; }
    if (fullBtn) fullBtn.disabled = true;
    
    console.log("=== Starting Hole Patch Quick Sweep (5x5 Grid) ===");
    
    const origCamPos = camera.position.clone();
    console.log("Original camera position:", origCamPos.x.toFixed(4), origCamPos.y.toFixed(4), origCamPos.z.toFixed(4));
    
    // Use the same angle sliders as atlas accumulation
    const hAngle = parseFloat(document.getElementById('autoSweepAngleHorizSlider')?.value || 45) / 400.0;
    const vAngle = parseFloat(document.getElementById('autoSweepAngleVertSlider')?.value || 20) / 400.0;
    console.log("Sweep angles - H:", hAngle.toFixed(4), "V:", vAngle.toFixed(4));

    const steps = 5;
    let count = 0;

    for (let i = 0; i < steps; i++) {
        for (let j = 0; j < steps; j++) {
            const u = (steps > 1) ? (i / (steps - 1)) * 2.0 - 1.0 : 0.0;
            const v = (steps > 1) ? (j / (steps - 1)) * 2.0 - 1.0 : 0.0;
            
            camera.position.x = origCamPos.x + u * hAngle;
            camera.position.y = origCamPos.y + v * vAngle;
            
            updateCameraAndProjection();
            
            if (count === 0 || count === 12 || count === 24) {
                console.log(`Frame ${count}: Camera at (${camera.position.x.toFixed(4)}, ${camera.position.y.toFixed(4)})`);
            }
            
            stepHoleAccumulation();

            count++;
            if (quickBtn) quickBtn.textContent = `Sweeping... (${count}/25)`;

            await new Promise(resolve => requestAnimationFrame(resolve)); 
        }
    }
    
    camera.position.copy(origCamPos);
    updateCameraAndProjection();
    
    console.log("=== Sweep complete, baking patch ===");
    await bakeHolePatch();
    
    isHolePatchSweeping = false;
    isSweeping = false;  // Re-enable face tracking/gyro
    if (quickBtn) { quickBtn.disabled = false; quickBtn.textContent = "Quick Sweep (Grid)"; }
    if (fullBtn) fullBtn.disabled = false;
    
    console.log("=== Hole Patch Quick Sweep Complete ===");
}

/**
 * Runs a continuous sweep for hole patch accumulation
 */
async function runHolePatchFullSweep() {
    if (isHolePatchSweeping || isSweeping) return;
    
    const firstLayer = mediaLayers.find(l => l.mesh);
    if (!firstLayer) {
        console.error("Hole patch sweep failed: No mesh layers found.");
        return;
    }
    
    isHolePatchSweeping = true;
    isSweeping = true;  // Disable face tracking/gyro
    resetHolePatchAccumulation();
    
    const quickBtn = document.getElementById('holePatchQuickSweepBtn');
    const fullBtn = document.getElementById('holePatchFullSweepBtn');
    if (quickBtn) quickBtn.disabled = true;
    if (fullBtn) { fullBtn.disabled = true; fullBtn.textContent = "Sweeping... (0%)"; }
    
    console.log("Starting Hole Patch Full Sweep (Continuous)");
    
    const origCamPos = camera.position.clone();
    
    const hAngle = parseFloat(document.getElementById('autoSweepAngleHorizSlider')?.value || 45) / 400.0;
    const vAngle = parseFloat(document.getElementById('autoSweepAngleVertSlider')?.value || 20) / 400.0;
    
    const totalFrames = 180; // ~3 seconds at 60fps
    
    for (let frame = 0; frame < totalFrames; frame++) {
        const t = frame / (totalFrames - 1);
        
        camera.position.x = origCamPos.x + hAngle * Math.sin(t * Math.PI * 2 * 3);
        camera.position.y = origCamPos.y + vAngle * Math.sin(t * Math.PI * 2 * 2);
        
        updateCameraAndProjection();
        stepHoleAccumulation();

        if (frame % 10 === 0 && fullBtn) {
            fullBtn.textContent = `Sweeping... (${Math.round(t*100)}%)`;
        }
        
        await new Promise(resolve => requestAnimationFrame(resolve));
    }
    
    camera.position.copy(origCamPos);
    updateCameraAndProjection();
    
    await bakeHolePatch();
    
    isHolePatchSweeping = false;
    isSweeping = false;  // Re-enable face tracking/gyro
    if (quickBtn) quickBtn.disabled = false;
    if (fullBtn) { fullBtn.disabled = false; fullBtn.textContent = "Full Sweep (Continuous)"; }
    
    console.log("Hole Patch Full Sweep Complete");
}

// Live sweep state
let isHolePatchLiveSweeping = false;
let liveSweepFrameCounter = 0;
let liveSweepLastCamX = 0;
let liveSweepLastCamY = 0;

/**
 * Toggles live sweep mode - accumulates holes using face tracking
 */
function toggleHolePatchLiveSweep() {
    const liveBtn = document.getElementById('holePatchLiveSweepBtn');
    
    if (isHolePatchLiveSweeping) {
        // Stop live sweep
        isHolePatchLiveSweeping = false;
        if (liveBtn) {
            liveBtn.textContent = "🎥 Live Sweep (Head Tracking)";
            liveBtn.style.backgroundColor = "#f39c12";
        }
        console.log("Live Sweep STOPPED - baking patch...");
        
        // Auto-bake when stopping
        bakeHolePatch();
    } else {
        // Start live sweep
        const firstLayer = mediaLayers.find(l => l.mesh);
        if (!firstLayer) {
            console.error("Live sweep failed: No mesh layers found.");
            alert("No mesh layers found. Load an image first.");
            return;
        }
        
        // Check gap detection is enabled
        const hasGap = document.getElementById('useSobelCheck')?.checked ||
                       document.getElementById('useDepthGradCheck')?.checked;
        if (!hasGap) {
            alert("Enable gap detection (Sobel or Depth Gradient) first!");
            return;
        }
        
        // Reset accumulation when starting
        resetHolePatchAccumulation();
        liveSweepFrameCounter = 0;
        liveSweepLastCamX = camera.position.x;
        liveSweepLastCamY = camera.position.y;
        
        isHolePatchLiveSweeping = true;
        if (liveBtn) {
            liveBtn.textContent = "⏹️ Stop & Bake";
            liveBtn.style.backgroundColor = "#e74c3c";
        }
        console.log("Live Sweep STARTED - move your head to accumulate holes");
    }
}

/**
 * Called each frame during live sweep (from render loop)
 * Only captures when camera has moved enough
 */
function updateLiveSweepAccumulation() {
    if (!isHolePatchLiveSweeping) return;
    
    liveSweepFrameCounter++;
    
    // Only check every 3 frames to reduce overhead
    if (liveSweepFrameCounter % 3 !== 0) return;
    
    // Check if camera moved enough
    const dx = camera.position.x - liveSweepLastCamX;
    const dy = camera.position.y - liveSweepLastCamY;
    const dist = Math.sqrt(dx*dx + dy*dy);
    
    // Log every 30 frames to show it's running
    if (liveSweepFrameCounter % 30 === 0) {
        console.log(`Live sweep frame ${liveSweepFrameCounter}, cam movement: ${dist.toFixed(5)}`);
    }
    
    // Only capture if moved more than threshold (lowered threshold)
    if (dist > 0.0005) {
        console.log(`Live sweep capturing at dist=${dist.toFixed(5)}`);
        stepHoleAccumulationQuiet();  // Use quiet version (no logs/alerts)
        liveSweepLastCamX = camera.position.x;
        liveSweepLastCamY = camera.position.y;
        holeAccumulationCount++;
    }
}

/**
 * Quiet version of stepHoleAccumulation for live sweep (no console spam, no alerts)
 */
function stepHoleAccumulationQuiet() {
    if (!renderer || !holeDetectMaterial || !holePatchTarget || !holeCaptureTarget) {
        console.warn("stepHoleAccumulationQuiet: missing resources", {
            renderer: !!renderer,
            holeDetectMaterial: !!holeDetectMaterial,
            holePatchTarget: !!holePatchTarget,
            holeCaptureTarget: !!holeCaptureTarget
        });
        return;
    }
    
    const postProcessQuad = postProcessScene.children[0];
    if (!postProcessQuad) {
        console.warn("stepHoleAccumulationQuiet: no postProcessQuad");
        return;
    }
    
    // Get gap settings
    const savedSettings = {
        useDepthGrad: document.getElementById('useDepthGradCheck')?.checked || false,
        useSobel: document.getElementById('useSobelCheck')?.checked || false,
        useLuma: document.getElementById('useLumaCheck')?.checked || false,
        useChroma: document.getElementById('useChromaCheck')?.checked || false,
        useCrease: document.getElementById('useCreaseCheck')?.checked || false,
        useCurvature: document.getElementById('useCurvatureCheck')?.checked || false,
        useUVStretch: document.getElementById('useUVStretchCheck')?.checked || false,
        useGrazingAngle: document.getElementById('useGrazingAngleCheck')?.checked || false,
        useEdgeMask: document.getElementById('useEdgeMaskCheck')?.checked || false
    };
    
    const hasAnyGapDetection = Object.values(savedSettings).some(v => v);
    if (!hasAnyGapDetection) return;
    
    // Step 1: Render scene WITHOUT gap detection
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
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(scene, camera);
    
    postProcessQuad.material = copyMaterial;
    copyMaterial.uniforms.tDiffuse.value = sceneRenderTarget.texture;
    renderer.setRenderTarget(pingPongRenderTargetA);
    renderer.clear();
    renderer.render(postProcessScene, postProcessCamera);
    
    // Step 2: Render scene WITH gap detection
    setAllLayerUniforms('u_useDepthGrad', savedSettings.useDepthGrad);
    setAllLayerUniforms('u_useSobel', savedSettings.useSobel);
    setAllLayerUniforms('u_useLuma', savedSettings.useLuma);
    setAllLayerUniforms('u_useChroma', savedSettings.useChroma);
    setAllLayerUniforms('u_useCrease', savedSettings.useCrease);
    setAllLayerUniforms('u_useCurvature', savedSettings.useCurvature);
    setAllLayerUniforms('u_useUVStretch', savedSettings.useUVStretch);
    setAllLayerUniforms('u_useGrazingAngle', savedSettings.useGrazingAngle);
    setAllLayerUniforms('u_useEdgeMask', savedSettings.useEdgeMask);
    
    renderer.setRenderTarget(sceneRenderTarget);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(scene, camera);
    
    copyMaterial.uniforms.tDiffuse.value = sceneRenderTarget.texture;
    renderer.setRenderTarget(pingPongRenderTargetB);
    renderer.clear();
    renderer.render(postProcessScene, postProcessCamera);
    
    // Step 3: Render depth
    renderNormalizedDepthPass();
    
    // Step 4: Detect holes
    postProcessQuad.material = holeDetectMaterial;
    holeDetectMaterial.uniforms.tSceneNoGaps.value = pingPongRenderTargetA.texture;
    holeDetectMaterial.uniforms.tSceneWithGaps.value = pingPongRenderTargetB.texture;
    holeDetectMaterial.uniforms.tDepth.value = screenNormalizedDepthTarget?.texture;
    holeDetectMaterial.uniforms.u_resolution.value.set(renderer.domElement.width, renderer.domElement.height);
    
    renderer.setRenderTarget(holeCaptureTarget);
    renderer.clear();
    renderer.render(postProcessScene, postProcessCamera);
    
    // Step 5: Accumulate to UV space
    const validLayers = mediaLayers.filter(l => l.mesh);
    if (validLayers.length === 0) {
        renderer.setRenderTarget(null);
        return;
    }
    
    const primaryLayer = validLayers[0];
    camera.updateMatrixWorld(true);
    primaryLayer.mesh.updateMatrixWorld(true);
    
    if (!holePatchPingPongTarget) {
        holePatchPingPongTarget = new THREE.WebGLRenderTarget(
            holePatchTarget.width, holePatchTarget.height,
            { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat }
        );
    }
    
    // True ping-pong: alternate between targets each frame
    const readTarget = (holeAccumulationCount % 2 === 0) ? holePatchTarget : holePatchPingPongTarget;
    const writeTarget = (holeAccumulationCount % 2 === 0) ? holePatchPingPongTarget : holePatchTarget;
    
    holeAccumulateMaterial.uniforms.tHoleCapture.value = holeCaptureTarget.texture;
    holeAccumulateMaterial.uniforms.tExisting.value = readTarget.texture;
    
    renderer.setRenderTarget(writeTarget);
    renderer.clear();
    
    const originalMaterial = primaryLayer.mesh.material;
    const wasVisible = primaryLayer.mesh.visible;
    
    primaryLayer.mesh.material = holeAccumulateMaterial;
    primaryLayer.mesh.visible = true;
    renderer.render(primaryLayer.mesh, camera);
    
    primaryLayer.mesh.material = originalMaterial;
    primaryLayer.mesh.visible = wasVisible;
    
    renderer.setRenderTarget(null);
}

/**
 * Creates/updates the hole patch mesh
 */
function initializeHolePatchMesh() {
    console.log("--- Initializing Hole Patch Mesh ---");
    
    const primaryLayer = mediaLayers.find(l => l.mesh);
    if (!primaryLayer) {
        console.warn("No primary layer for hole patch mesh");
        return;
    }
    
    // Remove existing if any
    if (holePatchMesh) {
        console.log("Removing existing hole patch mesh");
        scene.remove(holePatchMesh);
        if (holePatchMesh.geometry) holePatchMesh.geometry.dispose();
    }
    
    // Clone geometry from primary layer
    const geometry = primaryLayer.mesh.geometry.clone();
    console.log("Cloned geometry from primary layer");
    
    // Use the target that was last written to (based on accumulation count)
    const currentPatchTarget = (holeAccumulationCount % 2 === 1) ? holePatchPingPongTarget : holePatchTarget;
    const currentColorTarget = (holeAccumulationCount % 2 === 1) ? holePatchColorPingPong : holePatchColorTarget;
    
    // Update render material uniforms
    holePatchRenderMaterial.uniforms.tPatch.value = currentPatchTarget?.texture || holePatchTarget.texture;
    holePatchRenderMaterial.uniforms.tColor.value = currentColorTarget?.texture || holePatchColorTarget?.texture || null;
    holePatchRenderMaterial.uniforms.u_portalPlaneDepthNorm.value = currentNormPortalPlane;
    holePatchRenderMaterial.uniforms.u_worldInnerVolumeDepth.value = innerVolumeDepth;
    holePatchRenderMaterial.uniforms.u_worldOuterVolumeDepth.value = outerVolumeDepth;
    
    console.log("Material uniforms set:", {
        portalPlaneDepthNorm: currentNormPortalPlane,
        innerVolumeDepth: innerVolumeDepth,
        outerVolumeDepth: outerVolumeDepth,
        accumulationCount: holeAccumulationCount,
        usingTarget: (holeAccumulationCount % 2 === 1) ? 'holePatchPingPongTarget' : 'holePatchTarget',
        hasColorTarget: !!currentColorTarget
    });
    
    // Create mesh
    holePatchMesh = new THREE.Mesh(geometry, holePatchRenderMaterial);
    holePatchMesh.name = "HolePatchMesh";
    
    // IMPORTANT: Copy transform from primary layer so patch aligns
    holePatchMesh.position.copy(primaryLayer.mesh.position);
    holePatchMesh.rotation.copy(primaryLayer.mesh.rotation);
    holePatchMesh.scale.copy(primaryLayer.mesh.scale);
    holePatchMesh.updateMatrix();
    holePatchMesh.updateMatrixWorld(true);
    
    console.log("Primary layer transform:", {
        position: primaryLayer.mesh.position.toArray(),
        rotation: primaryLayer.mesh.rotation.toArray(),
        scale: primaryLayer.mesh.scale.toArray()
    });
    
    holePatchMesh.renderOrder = -2; // Behind main content
    holePatchMesh.frustumCulled = false;
    holePatchMesh.visible = true;
    
    scene.add(holePatchMesh);
    
    console.log("Hole Patch mesh created. Position:", holePatchMesh.position, "renderOrder:", holePatchMesh.renderOrder);
}

/**
 * Toggles showing ONLY the hole patch (hides main layers)
 */
function toggleHolePatchOnlyView() {
    showHolePatchOnly = !showHolePatchOnly;
    
    console.log("Toggle Hole Patch Only View:", showHolePatchOnly);
    
    // Toggle main layer visibility
    for (const layer of mediaLayers) {
        if (layer.mesh) {
            layer.mesh.visible = !showHolePatchOnly;
            console.log("Layer", layer.name || "unnamed", "visible:", layer.mesh.visible);
        }
    }
    
    // Hide infill atlas too
    if (infillAtlasMesh) {
        infillAtlasMesh.visible = !showHolePatchOnly;
    }
    
    // Ensure patch is visible (if it exists)
    if (holePatchMesh) {
        holePatchMesh.visible = true;
        console.log("Hole patch mesh visible:", holePatchMesh.visible);
    } else {
        console.warn("No hole patch mesh exists! Run 'Bake Patch Mesh' first.");
        if (showHolePatchOnly) {
            alert("No patch mesh exists yet!\n\n1. Click 'Capture Current View' to capture holes\n2. Click 'Bake Patch Mesh' to create the mesh\n3. Then try 'Show Patch Only' again");
        }
    }
    
    // Update button text
    const btn = document.getElementById('toggleHolePatchButton');
    if (btn) {
        btn.textContent = showHolePatchOnly ? '👁️ Show Full Scene' : '👁️ Show Patch Only';
    }
}

/**
 * Exports hole patch alpha and depth as PNGs
 */
async function exportHolePatchMaps() {
    if (!holePatchTarget?.texture) {
        alert("Please run a sweep and bake first to generate hole patch data.");
        return;
    }
    
    const width = holePatchTarget.width;
    const height = holePatchTarget.height;
    
    // Read the combined patch data (R=alpha, G=depth)
    // Need to use Float32Array for HalfFloatType targets
    const buffer = new Float32Array(width * height * 4);
    renderer.readRenderTargetPixels(holePatchTarget, 0, 0, width, height, buffer);
    
    // Create flipped versions (WebGL Y is flipped)
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = width;
    exportCanvas.height = height;
    const ctx = exportCanvas.getContext('2d');
    
    // Export Alpha (white = hole) - from R channel
    const alphaFlipped = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const srcIdx = ((height - 1 - y) * width + x) * 4;
            const dstIdx = (y * width + x) * 4;
            const alpha = Math.min(255, Math.max(0, Math.round(buffer[srcIdx] * 255))); // R channel
            alphaFlipped[dstIdx] = alpha;
            alphaFlipped[dstIdx + 1] = alpha;
            alphaFlipped[dstIdx + 2] = alpha;
            alphaFlipped[dstIdx + 3] = 255;
        }
    }
    ctx.putImageData(new ImageData(new Uint8ClampedArray(alphaFlipped), width, height), 0, 0);
    const alphaBlob = await new Promise(r => exportCanvas.toBlob(r, 'image/png'));
    downloadBlob(alphaBlob, 'hole_patch_alpha.png');
    
    // Export Depth (grayscale) - from G channel
    const depthFlipped = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const srcIdx = ((height - 1 - y) * width + x) * 4;
            const dstIdx = (y * width + x) * 4;
            const depth = Math.min(255, Math.max(0, Math.round(buffer[srcIdx + 1] * 255))); // G channel
            depthFlipped[dstIdx] = depth;
            depthFlipped[dstIdx + 1] = depth;
            depthFlipped[dstIdx + 2] = depth;
            depthFlipped[dstIdx + 3] = 255;
        }
    }
    ctx.putImageData(new ImageData(new Uint8ClampedArray(depthFlipped), width, height), 0, 0);
    const depthBlob = await new Promise(r => exportCanvas.toBlob(r, 'image/png'));
    downloadBlob(depthBlob, 'hole_patch_depth.png');
    
    console.log("Hole patch maps exported.");
    alert("Exported hole_patch_alpha.png and hole_patch_depth.png");
}

/**
 * Helper to download blob as file
 */
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// --- Stub functions for old SD pipeline (kept for compatibility) ---
async function captureSDExportData() {
    console.log("captureSDExportData: This function is deprecated. Use the Hole Patch system instead.");
    return null;
}

async function exportSDPipelineData() {
    alert("The old SD Pipeline export is deprecated.\n\nUse the new Hole Patch system:\n1. Click 'Capture Current View' to capture holes\n2. Move camera and repeat\n3. Click 'Bake Patch Mesh'\n4. Click 'Export Maps' to export alpha and depth");
}

async function snapshotAndFill() {
    console.log("snapshotAndFill: Running stepHoleAccumulation instead.");
    stepHoleAccumulation();
}

/**
 * Imports SD inpainted images back into the scene as a patch mesh
 */
async function importSDInpaintedPatch() {
    console.log("--- Importing SD Inpainted Patch ---");
    
    // Create file inputs for color and depth
    const colorInput = document.createElement('input');
    colorInput.type = 'file';
    colorInput.accept = 'image/*';
    
    const depthInput = document.createElement('input');
    depthInput.type = 'file';
    depthInput.accept = 'image/*';

    // Prompt for color image first
    alert("Select the inpainted COLOR image first, then the DEPTH image.");
    
    const colorFile = await new Promise((resolve) => {
        colorInput.onchange = (e) => resolve(e.target.files[0]);
        colorInput.click();
    });
    
    if (!colorFile) {
        console.log("Import cancelled - no color file selected.");
        return;
    }

    const depthFile = await new Promise((resolve) => {
        depthInput.onchange = (e) => resolve(e.target.files[0]);
        depthInput.click();
    });

    if (!depthFile) {
        console.log("Import cancelled - no depth file selected.");
        return;
    }

    // Load both images as textures
    const loadTexture = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const texture = new THREE.Texture(img);
                texture.needsUpdate = true;
                resolve(texture);
            };
            img.onerror = reject;
            img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });

    try {
        const [colorTexture, depthTexture] = await Promise.all([
            loadTexture(colorFile),
            loadTexture(depthFile)
        ]);

        // Create or update the inpaint patch mesh
        createInpaintPatchMesh(colorTexture, depthTexture);
        
        console.log("SD Inpaint patch imported successfully!");
        alert("Inpainted patch imported! It will be rendered behind the foreground.");
        
    } catch (e) {
        console.error("Failed to import SD patch:", e);
        alert("Failed to import patch images. Please check the file formats.");
    }
}

/**
 * Creates a mesh for the imported SD inpaint patch
 */
function createInpaintPatchMesh(colorTexture, depthTexture) {
    // Find the primary layer to clone geometry from
    const primaryLayer = mediaLayers.find(l => l.mesh && l.mesh.visible);
    if (!primaryLayer) {
        console.error("No primary layer found to base patch mesh on.");
        return;
    }

    // Remove existing patch mesh if any
    if (sdExportInpaintPatchMesh) {
        scene.remove(sdExportInpaintPatchMesh);
        sdExportInpaintPatchMesh.geometry.dispose();
        sdExportInpaintPatchMesh.material.dispose();
    }

    // Clone geometry from primary layer
    const geometry = primaryLayer.mesh.geometry.clone();

    // Create material using our SD inpaint material
    const material = sdInpaintPatchMaterial.clone();
    material.uniforms.tColor.value = colorTexture;
    material.uniforms.tDepth.value = depthTexture;
    material.uniforms.tMask.value = sdExportGapMaskTarget?.texture; // Use captured gap mask
    material.uniforms.u_portalPlaneDepthNorm.value = currentNormPortalPlane;
    material.uniforms.u_worldInnerVolumeDepth.value = innerVolumeDepth;
    material.uniforms.u_worldOuterVolumeDepth.value = outerVolumeDepth;

    // Create mesh
    sdExportInpaintPatchMesh = new THREE.Mesh(geometry, material);
    sdExportInpaintPatchMesh.renderOrder = -2; // Render behind everything else
    sdExportInpaintPatchMesh.frustumCulled = false;
    
    scene.add(sdExportInpaintPatchMesh);
    
    console.log("Inpaint patch mesh created.");
}

/**
 * Toggles visibility of the imported SD patch
 */
function toggleSDPatchVisibility() {
    if (sdExportInpaintPatchMesh) {
        sdExportInpaintPatchMesh.visible = !sdExportInpaintPatchMesh.visible;
        console.log("SD Patch visibility:", sdExportInpaintPatchMesh.visible);
    } else {
        console.log("No SD patch mesh to toggle.");
    }
}

// --- Helper for Debug Views ---
// Calculates black bars (letterbox/pillarbox) to preserve aspect ratio for 2D textures
function setLetterboxedViewport(targetAspect) {
    if (!renderer) return;
    
    const screenW = renderer.domElement.width;
    const screenH = renderer.domElement.height;
    const screenAspect = screenW / screenH;

    let viewW, viewH, viewX, viewY;

    if (screenAspect > targetAspect) {
        // Screen is wider (Pillarbox)
        viewH = screenH;
        viewW = screenH * targetAspect;
        viewX = (screenW - viewW) / 2;
        viewY = 0;
    } else {
        // Screen is taller (Letterbox)
        viewW = screenW;
        viewH = screenW / targetAspect;
        viewX = 0;
        viewY = (screenH - viewH) / 2;
    }

    // Clear background to black first (turn scissor off to clear whole screen)
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, screenW, screenH);
    renderer.clear();

    // Set viewport for content (turn scissor on to clip content)
    renderer.setViewport(viewX, viewY, viewW, viewH);
    renderer.setScissor(viewX, viewY, viewW, viewH);
    renderer.setScissorTest(true);
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
    
    // 1. Update Camera and Render Order
    updateCameraAndProjection();
    
    // Live sweep accumulation (if enabled)
    if (isHolePatchLiveSweeping) {
        updateLiveSweepAccumulation();
    }

    // --- Render Order and Static Atlas Logic ---
    if (infillAtlasMesh) {
        infillAtlasMesh.visible = useStaticInfillAtlas;
    }
    const foregroundRenderOrderBase = useStaticInfillAtlas ? 1 : 0;
    for (const layer of mediaLayers) {
        if (layer.mesh) {
            if (layer.mesh.userData.baseRenderOrder === undefined) {
                layer.mesh.userData.baseRenderOrder = layer.mesh.renderOrder;
            }
            layer.mesh.renderOrder = layer.mesh.userData.baseRenderOrder + foregroundRenderOrderBase;
        }
    }

    // ========================================================================
    // START: ATLAS DEBUG VIEWS (Hoisted)
    // These view the baked textures directly and don't need scene rendering.
    // ========================================================================
    if (debugView === 'atlas_depth') {
        if (infillAtlasTarget_Depth && depthToColorMaterial && postProcessQuad) {
            // FIX: Use letterboxing
            setLetterboxedViewport(contentAspectRatio);
            
            postProcessQuad.material = depthToColorMaterial;
            depthToColorMaterial.uniforms.tDepth.value = infillAtlasTarget_Depth.texture;
            renderer.render(postProcessScene, postProcessCamera);

            // Restore scissor
            renderer.setScissorTest(false);
        } else {
            console.warn("Debug View 'atlas_depth' failed: Missing targets/materials.");
        }
        return;
    }
    if (debugView === 'atlas_holes') {
        if (infillAtlasTarget_Depth && sobelEdgeMaterial && postProcessQuad) {
            // FIX: Use letterboxing
            setLetterboxedViewport(contentAspectRatio);

            postProcessQuad.material = sobelEdgeMaterial;
            sobelEdgeMaterial.uniforms.tDiffuse.value = infillAtlasTarget_Depth.texture;
            sobelEdgeMaterial.uniforms.u_resolution.value.set(infillAtlasTarget_Depth.width, infillAtlasTarget_Depth.height);
            sobelEdgeMaterial.uniforms.u_threshold.value = 0.01;
            renderer.render(postProcessScene, postProcessCamera);

            // Restore scissor
            renderer.setScissorTest(false);
        } else {
            console.warn("Debug View 'atlas_holes' failed: Missing targets/materials.");
        }
        return;
    }
    
    // --- SD PIPELINE DEBUG VIEWS ---
    if (debugView === 'sd_gap_mask') {
        // Capture SD data first (updates targets)
        captureSDExportData().then(() => {
            if (sdExportGapMaskTarget && copyMaterial && postProcessQuad) {
                setLetterboxedViewport(contentAspectRatio);
                postProcessQuad.material = copyMaterial;
                copyMaterial.uniforms.tDiffuse.value = sdExportGapMaskTarget.texture;
                renderer.render(postProcessScene, postProcessCamera);
                renderer.setScissorTest(false);
            }
        });
        return;
    }
    if (debugView === 'sd_gap_depth') {
        // Capture SD data first
        captureSDExportData().then(() => {
            if (sdExportGapDepthTarget && copyMaterial && postProcessQuad) {
                setLetterboxedViewport(contentAspectRatio);
                postProcessQuad.material = copyMaterial;
                copyMaterial.uniforms.tDiffuse.value = sdExportGapDepthTarget.texture;
                renderer.render(postProcessScene, postProcessCamera);
                renderer.setScissorTest(false);
            }
        });
        return;
    }
    
    // --- HOLE PATCH DEBUG VIEW ---
    // holePatchTarget is UV space (use letterboxing), holeCaptureTarget is screen space
    if (debugView === 'hole_patch') {
        if (holePatchTarget && copyMaterial && postProcessQuad) {
            setLetterboxedViewport(contentAspectRatio);
            postProcessQuad.material = copyMaterial;
            copyMaterial.uniforms.tDiffuse.value = holePatchTarget.texture;
            renderer.render(postProcessScene, postProcessCamera);
            renderer.setScissorTest(false);
        } else {
            console.warn("Debug View 'hole_patch' failed: Missing holePatchTarget");
        }
        return;
    }
    
    if (debugView === 'hole_capture') {
        if (holeCaptureTarget && copyMaterial && postProcessQuad) {
            renderer.setRenderTarget(null);
            renderer.setScissorTest(false);
            renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
            postProcessQuad.material = copyMaterial;
            copyMaterial.uniforms.tDiffuse.value = holeCaptureTarget.texture;
            renderer.render(postProcessScene, postProcessCamera);
        } else {
            console.warn("Debug View 'hole_capture' failed: Missing holeCaptureTarget");
        }
        return;
    }
    
    if (debugView === 'uv_position') {
        // Render UV position map on the fly
        if (uvPositionMaterial && uvPositionTarget) {
            const validLayers = mediaLayers.filter(l => l.mesh);
            if (validLayers.length > 0) {
                const layer = validLayers[0];
                const layerMat = layer.mesh.material;
                const depthTex = layerMat.uniforms?.depthTexture?.value || 
                                 layerMat.uniforms?.displacementMap?.value;
                
                if (depthTex) {
                    uvPositionMaterial.uniforms.tDepthMap.value = depthTex;
                    uvPositionMaterial.uniforms.u_portalPlaneDepthNorm.value = currentNormPortalPlane;
                    uvPositionMaterial.uniforms.u_worldInnerVolumeDepth.value = innerVolumeDepth;
                    uvPositionMaterial.uniforms.u_worldOuterVolumeDepth.value = outerVolumeDepth;
                    
                    const originalMat = layer.mesh.material;
                    layer.mesh.material = uvPositionMaterial;
                    
                    renderer.setRenderTarget(uvPositionTarget);
                    renderer.setClearColor(0x000000, 0);
                    renderer.clear();
                    renderer.render(layer.mesh, camera);
                    
                    layer.mesh.material = originalMat;
                    
                    // Display the UV position map
                    renderer.setRenderTarget(null);
                    renderer.setScissorTest(false);
                    renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
                    postProcessQuad.material = copyMaterial;
                    copyMaterial.uniforms.tDiffuse.value = uvPositionTarget.texture;
                    renderer.render(postProcessScene, postProcessCamera);
                }
            }
        }
        return;
    }
    // ========================================================================


    // ========================================================================
    // HOISTED DEPTH READBACK (Works in both Static and Dynamic modes)
    // ========================================================================
    if (depthReadbackRequest.requested) {
        // We need a clean depth buffer.
        setAllLayerUniforms('u_useDepthGrad', false);
        setAllLayerUniforms('u_useSobel', false);
        setAllLayerUniforms('u_useLuma', false);
        setAllLayerUniforms('u_useChroma', false);
        setAllLayerUniforms('u_useCrease', false);
        setAllLayerUniforms('u_useCurvature', false);
        setAllLayerUniforms('u_useUVStretch', false);
        setAllLayerUniforms('u_useGrazingAngle', false);
        setAllLayerUniforms('u_useEdgeMask', false);

        // Hide Atlas Mesh to read true geometry depth
        const wasAtlasVisibleForReadback = infillAtlasMesh ? infillAtlasMesh.visible : false;
        if (infillAtlasMesh) infillAtlasMesh.visible = false;

        if (sceneRenderTarget) {
            renderer.setRenderTarget(sceneRenderTarget);
            renderer.clear();
            renderer.render(scene, camera);

            if (depthToColorMaterial && depthColorTarget && postProcessQuad) {
                postProcessQuad.material = depthToColorMaterial;
                depthToColorMaterial.uniforms.tDepth.value = sceneRenderTarget.depthTexture;
                renderer.setRenderTarget(depthColorTarget);
                renderer.clear();
                renderer.render(postProcessScene, postProcessCamera);
                
                const x = depthReadbackRequest.x;
                const y = depthReadbackRequest.y;
                const readBuffer = new Uint8Array(4);
                try {
                    renderer.readRenderTargetPixels(depthColorTarget, x, depthColorTarget.height - 1 - y, 1, 1, readBuffer);
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
                } catch (e) { console.error("Error reading depth:", e); }
            }
        }
        
        // Restore Atlas visibility
        if (infillAtlasMesh) infillAtlasMesh.visible = wasAtlasVisibleForReadback;
        depthReadbackRequest.requested = false;
    }
    
    // --- STATIC ATLAS RENDER PATH (OPTIMIZED) ---
    // Only use this path if we are BAKED AND viewing the FINAL result.
    if (useStaticInfillAtlas && debugView === 'final') {
        
        // 1. Enable in-shader gap detection (affects FG layers)
        setAllLayerUniforms('u_useDepthGrad', document.getElementById('useDepthGradCheck')?.checked || false);
        setAllLayerUniforms('u_useSobel', document.getElementById('useSobelCheck')?.checked || false);
        setAllLayerUniforms('u_useLuma', document.getElementById('useLumaCheck')?.checked || false);
        setAllLayerUniforms('u_useChroma', document.getElementById('useChromaCheck')?.checked || false);
        setAllLayerUniforms('u_useCrease', document.getElementById('useCreaseCheck')?.checked || false);
        setAllLayerUniforms('u_useCurvature', document.getElementById('useCurvatureCheck')?.checked || false);
        setAllLayerUniforms('u_useUVStretch', document.getElementById('useUVStretchCheck')?.checked || false);
        setAllLayerUniforms('u_useGrazingAngle', document.getElementById('useGrazingAngleCheck')?.checked || false);
        setAllLayerUniforms('u_useEdgeMask', false);

        // FIX: RESET VIEWPORT/SCISSOR to prevent smooshing
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);

        // 2. Render the "sandwich" (Atlas at 0, FG w/ holes at 1+)
        renderer.setRenderTarget(null);
        renderer.clear();
        renderer.render(scene, camera);
        
        // 3. Disable gap detection globally (Cleanup for next frame)
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
    
    // --- DYNAMIC RENDER PATH (Real-time Inpainting / Live Sweep / Debugging) ---
    
    const renderToScreen = (finalImageTexture) => {
        if (!finalImageTexture) {
            console.warn("renderToScreen called with no texture.");
            renderer.setRenderTarget(null);
            renderer.clear();
            return;
        }

        // FIX: RESET VIEWPORT/SCISSOR for Final Output
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);

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
            renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
        }
        
        // Apply Dither or Copy
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

        // --- Final overlay pass (Ground Truth) ---
        if (showFeedbackOverlay) {
            renderFeedbackOverlay(pingPongRenderTargetA.texture);
        }
    };

    if (debugDepthMaterial) {
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
        if(scene && camera) renderer.render(scene, camera); 
        return;
    }

    renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);

    // --- CASE 1: Inpainting Disabled (and not accumulating) ---
    if (!useInpainting && debugView === 'final' && !(isAccumulatingGaps && !isSweeping)) {
        
        setAllLayerUniforms('u_useDepthGrad', document.getElementById('useDepthGradCheck')?.checked || false);
        setAllLayerUniforms('u_useSobel', document.getElementById('useSobelCheck')?.checked || false);
        setAllLayerUniforms('u_useLuma', document.getElementById('useLumaCheck')?.checked || false);
        setAllLayerUniforms('u_useChroma', document.getElementById('useChromaCheck')?.checked || false);
        setAllLayerUniforms('u_useCrease', document.getElementById('useCreaseCheck')?.checked || false);
        setAllLayerUniforms('u_useCurvature', document.getElementById('useCurvatureCheck')?.checked || false);
        setAllLayerUniforms('u_useUVStretch', document.getElementById('useUVStretchCheck')?.checked || false);
        setAllLayerUniforms('u_useGrazingAngle', document.getElementById('useGrazingAngleCheck')?.checked || false);
        setAllLayerUniforms('u_useEdgeMask', false);

        renderer.setRenderTarget(null);
        renderer.clear();
        renderer.render(scene, camera);
        
        setAllLayerUniforms('u_useDepthGrad', false);
        setAllLayerUniforms('u_useSobel', false);
        setAllLayerUniforms('u_useLuma', false);
        setAllLayerUniforms('u_useChroma', false);
        setAllLayerUniforms('u_useCrease', false);
        setAllLayerUniforms('u_useCurvature', false);
        setAllLayerUniforms('u_useUVStretch', false);
        setAllLayerUniforms('u_useGrazingAngle', false);
        
        return; 
    }

    // --- CASE 2: Inpainting Enabled OR a Debug View is Active OR Live Sweeping ---
    
    const hasMeshLayers = mediaLayers.some(l => l.mesh);
    const hasRenderableContent = hasMeshLayers || useSolidBackground;

    const firstLayer = mediaLayers.find(l => l.mesh && l.mesh.material && l.mesh.material.uniforms);
    let sourceColorTexture = null;
    let sourceDepthTexture = null; 

    if (firstLayer) {
        const uniforms = firstLayer.mesh.material.uniforms;
        if (uniforms.map) sourceColorTexture = uniforms.map.value; 
        else if (uniforms.rgbTexture) sourceColorTexture = uniforms.rgbTexture.value; 
        else if (uniforms.videoTexture) sourceColorTexture = uniforms.videoTexture.value; 
        
        if (uniforms.displacementMap) sourceDepthTexture = uniforms.displacementMap.value; 
        else if (uniforms.depthTexture) sourceDepthTexture = uniforms.depthTexture.value; 
        else if (uniforms.videoTexture) sourceDepthTexture = uniforms.videoTexture.value; 
    }

    if (!hasRenderableContent) {
         renderer.setRenderTarget(null); renderer.clear(); return; 
    }

    const requiresDepthFeatures = useInpainting || debugView !== 'final' || (isAccumulatingGaps && !isSweeping);
    if (requiresDepthFeatures && (!sourceColorTexture || !sourceDepthTexture)) {
        setAllLayerUniforms('u_useDepthGrad', false);
        setAllLayerUniforms('u_useSobel', false);
        setAllLayerUniforms('u_useLuma', false);
        setAllLayerUniforms('u_useChroma', false);
        setAllLayerUniforms('u_useCrease', false);
        setAllLayerUniforms('u_useCurvature', false);
        setAllLayerUniforms('u_useUVStretch', false);
        setAllLayerUniforms('u_useGrazingAngle', false);
        setAllLayerUniforms('u_useEdgeMask', false);
        renderer.setRenderTarget(null); renderer.clear(); renderer.render(scene, camera);
        return;
    }

    // --- CRITICAL FIX: Force-Hide Atlas for Dynamic Generation ---
    const hasVisibleForeground = mediaLayers.some(l => l.mesh && l.mesh.visible);
    const wasAtlasVisible = infillAtlasMesh ? infillAtlasMesh.visible : false;

    // CASE A: User hid the main mesh. Show Atlas & Bypass Inpainting.
    if (!hasVisibleForeground) {
        if (infillAtlasMesh) infillAtlasMesh.visible = true;

        renderer.setRenderTarget(sceneRenderTarget);
        renderer.clear();
        renderer.render(scene, camera);

        renderToScreen(sceneRenderTarget.texture);

        // Reset visibility for next loop
        if (infillAtlasMesh) infillAtlasMesh.visible = wasAtlasVisible;
        return; 
    }

    // CASE B: Foreground visible. Hide Atlas to detect gaps.
    if (infillAtlasMesh) {
        infillAtlasMesh.visible = false;
    }

    // --- PRE-PASS: Render CLEAN scene (Color + Depth) ---
    setAllLayerUniforms('u_useDepthGrad', false);
    setAllLayerUniforms('u_useSobel', false);
    setAllLayerUniforms('u_useLuma', false);
    setAllLayerUniforms('u_useChroma', false);
    setAllLayerUniforms('u_useCrease', false);
    setAllLayerUniforms('u_useCurvature', false);
    setAllLayerUniforms('u_useUVStretch', false);
    setAllLayerUniforms('u_useGrazingAngle', false);
    setAllLayerUniforms('u_useEdgeMask', false);
    
    if (!sceneRenderTarget) { console.error("sceneRenderTarget is not initialized!"); return; }
    renderer.setRenderTarget(sceneRenderTarget);
    renderer.clear();
    renderer.render(scene, camera);
    
    let cleanColorTexture = sceneRenderTarget.texture;
    let cleanDepthTexture = sceneRenderTarget.depthTexture;

    // Render UV Map
    renderUVMap();

    // Generate FG/BG Layer Mask
    if (!layerMaskMaterial || !layerMaskTarget) { console.error("layerMaskMaterial or layerMaskTarget not initialized!"); return; }
    postProcessQuad.material = layerMaskMaterial;
    layerMaskMaterial.uniforms.tDepth.value = cleanDepthTexture;
    layerMaskMaterial.uniforms.u_inpaintingSplitDepth_RAW.value = currentInpaintingSplitDepthNorm;
    renderer.setRenderTarget(layerMaskTarget); renderer.clear();
    renderer.render(postProcessScene, postProcessCamera);

   // --- NEW: Live Sweep Accumulation Logic (Unified) ---
    if (isAccumulatingGaps && !isSweeping) {
        stepAccumulation(); // Handles Depth, UVs, Masks, and Accumulation
    }

    // --- PASS: Generate Gaps/Edges ---
    setAllLayerUniforms('u_useDepthGrad', document.getElementById('useDepthGradCheck')?.checked || false);
    setAllLayerUniforms('u_useSobel', document.getElementById('useSobelCheck')?.checked || false);
    setAllLayerUniforms('u_useLuma', document.getElementById('useLumaCheck')?.checked || false);
    setAllLayerUniforms('u_useChroma', document.getElementById('useChromaCheck')?.checked || false);
    setAllLayerUniforms('u_useCrease', document.getElementById('useCreaseCheck')?.checked || false);
    setAllLayerUniforms('u_useCurvature', document.getElementById('useCurvatureCheck')?.checked || false);
    setAllLayerUniforms('u_useUVStretch', document.getElementById('useUVStretchCheck')?.checked || false);
    setAllLayerUniforms('u_useGrazingAngle', document.getElementById('useGrazingAngleCheck')?.checked || false);
    setAllLayerUniforms('u_useEdgeMask', false);

    if (!pingPongRenderTargetB) { console.error("pingPongRenderTargetB not initialized!"); return; }
    renderer.setRenderTarget(pingPongRenderTargetB); renderer.clear();
    renderer.render(scene, camera);
    
    let finalEdgeMaskTexture = pingPongRenderTargetB.texture;
    let maskUsesAlpha = true; 
    
    setAllLayerUniforms('u_useDepthGrad', false);
    setAllLayerUniforms('u_useSobel', false);
    setAllLayerUniforms('u_useLuma', false);
    setAllLayerUniforms('u_useChroma', false);
    setAllLayerUniforms('u_useCrease', false);
    setAllLayerUniforms('u_useCurvature', false);
    setAllLayerUniforms('u_useUVStretch', false);
    setAllLayerUniforms('u_useGrazingAngle', false);

    // --- Restore Atlas Visibility ---
    if (infillAtlasMesh) {
        infillAtlasMesh.visible = wasAtlasVisible; 
    }
    
    // --- Handle Debug Views ---
    if (debugView === 'layer_mask') {
        renderToScreen(layerMaskTarget.texture);
        return; 
    }
    if (debugView === 'plug_error') {
        if (!bgLayerMesh) {
            console.warn('[PLUG-ERR] no BG layer built');
            renderToScreen(pingPongRenderTargetB.texture);
            return;
        }
        // 1. FG-only depth + fresh classification (defines gaps + expected plug depth)
        renderNormalizedDepthPass();
        const peThr = parseFloat(document.getElementById('fgSubThresholdSlider')?.value || '0.05');
        try { runFGSubtraction(pingPongRenderTargetB?.texture || null, maskUsesAlpha, peThr); } catch (e) { console.error(e); }
        // 2. Depth WITH the plug in place
        _depthPassIncludeBG = true;
        renderNormalizedDepthPass();
        _depthPassIncludeBG = false;

        renderer.setRenderTarget(sceneRenderTarget);
        renderer.setViewport(0, 0, sceneRenderTarget.width, sceneRenderTarget.height);
        renderer.clear();
        if (!window._plugErrMaterial) {
            window._plugErrMaterial = new THREE.ShaderMaterial({
                uniforms: { tMask: { value: null }, tDepthBG: { value: null }, tColor: { value: null }, u_scale: { value: 12.0 }, u_texelSize: { value: new THREE.Vector2() } },
                vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
                fragmentShader: `
                    uniform sampler2D tMask;    // FG-only classification (a>0.5 & b<0.008 = interior gap)
                    uniform sampler2D tDepthBG; // depth WITH the BG layer included
                    uniform sampler2D tColor;
                    uniform float u_scale;
                    uniform vec2 u_texelSize;
                    varying vec2 vUv;

                    // SEAM METRIC (v3.6). The old metric compared the plug against
                    // the screen-space min-rim expectation — obsolete once the plug
                    // became a harmonic membrane: on void-rimmed gaps the CORRECT
                    // membrane legitimately deviates from min, saturating red.
                    // What actually defines a correct plug is (a) coverage and
                    // (b) CONTINUITY: the plugged depth must meet the adjacent
                    // visible background without a step. So: gap-boundary pixels
                    // are scored by their depth step to BG-side valid neighbors;
                    // interior gap pixels (no valid neighbor) are shown dim green;
                    // magenta still means the plug is MISSING entirely.
                    void main() {
                        vec4 m = texture2D(tMask, vUv);
                        bool interiorGap = (m.a > 0.5) && (m.b < 0.008);
                        if (!interiorGap) {
                            gl_FragColor = vec4(texture2D(tColor, vUv).rgb * 0.35, 1.0);
                            return;
                        }
                        vec4 dbg = texture2D(tDepthBG, vUv);
                        if (dbg.a < 0.5) {
                            gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0); // MISSING
                            return;
                        }
                        float plug = dbg.r;
                        vec2 texel = u_texelSize;
                        float worst = -1.0;
                        for (int dy = -1; dy <= 1; dy++) {
                            for (int dx = -1; dx <= 1; dx++) {
                                if (dx == 0 && dy == 0) continue;
                                vec2 uv2 = vUv + vec2(float(dx), float(dy)) * texel;
                                vec4 nm = texture2D(tMask, uv2);
                                if (nm.a < 0.5) {
                                    // valid scene neighbor; BG-side only (a FG-side
                                    // neighbor SHOULD differ from the plug — that
                                    // step is the occlusion itself, not a seam)
                                    float nd = texture2D(tDepthBG, uv2).r;
                                    if (nd <= plug + 0.06) {
                                        worst = max(worst, abs(plug - nd));
                                    }
                                }
                            }
                        }
                        if (worst < 0.0) {
                            // interior gap pixel: continuity holds by construction
                            gl_FragColor = vec4(0.05, 0.35, 0.08, 1.0);
                            return;
                        }
                        float err = worst * u_scale;
                        gl_FragColor = vec4(clamp(err, 0.0, 1.0), clamp(2.0 - err, 0.0, 1.0) * 0.9, 0.0, 1.0);
                    }
                `,
                depthWrite: false, depthTest: false
            });
        }
        const pem = window._plugErrMaterial;
        pem.uniforms.tMask.value = fgMaskTargetA.texture;
        pem.uniforms.tDepthBG.value = screenNormalizedDepthTarget.texture;
        pem.uniforms.tColor.value = pingPongRenderTargetB.texture;
        pem.uniforms.u_texelSize.value.set(1.0 / fgMaskTargetA.width, 1.0 / fgMaskTargetA.height);
        postProcessScene.children[0].material = pem;
        renderer.render(postProcessScene, postProcessCamera);
        renderNormalizedDepthPass(); // restore FG-only depth for the rest of the pipeline
        renderToScreen(sceneRenderTarget.texture);
        return;
    }
    if (debugView === 'fg_exclusion_color' || debugView === 'fg_exclusion_depth') {
        if (!screenNormalizedDepthTarget) {
            console.error("screenNormalizedDepthTarget not available for FG exclusion debug");
            return;
        }

        // Render fresh depth for the CURRENT camera pose...
        renderNormalizedDepthPass();

        // ...and run the FG subtraction FRESH for the same pose.
        // (Previously this branch displayed sdExportGapDepthTarget from the LAST
        // pipeline run — a different camera pose — producing an offset "ghost"
        // silhouette that looked like a second red layer behind the gap.)
        const dbgThreshold = parseFloat(document.getElementById('fgSubThresholdSlider')?.value || '0.05');
        let dbgRan = false;
        try {
            dbgRan = runFGSubtraction(pingPongRenderTargetB?.texture || null, maskUsesAlpha, dbgThreshold);
        } catch (e) {
            console.error("[FG-SUB] debug view: runFGSubtraction threw:", e);
        }
        if (!dbgRan) {
            console.error("runFGSubtraction failed in debug view");
            return;
        }
        const expandedGapMask = fgMaskTargetA.texture;

        // Render debug view to sceneRenderTarget (avoid pingPongRenderTargetA which renderToScreen uses)
        renderer.setRenderTarget(sceneRenderTarget);
        renderer.setViewport(0, 0, sceneRenderTarget.width, sceneRenderTarget.height);
        renderer.clear();

        if (!window._fgExclusionDebugMaterial) {
            window._fgExclusionDebugMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    tDiffuse: { value: null },
                    tExpandedGapMask: { value: null },
                    tSceneDepth: { value: null },
                    u_showDepth: { value: false }
                },
                vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
                fragmentShader: `
                    uniform sampler2D tDiffuse;
                    uniform sampler2D tExpandedGapMask;
                    uniform sampler2D tSceneDepth;
                    uniform bool u_showDepth;
                    varying vec2 vUv;
                    void main() {
                        vec4 mask = texture2D(tExpandedGapMask, vUv);
                        vec4 sceneDepth = texture2D(tSceneDepth, vUv);
                        vec3 base = u_showDepth ? vec3(sceneDepth.r) : texture2D(tDiffuse, vUv).rgb;

                        // Channel contract (runFGSubtraction):
                        //   A=1,B=0 -> true gap        -> BLUE
                        //   B=1     -> FG occluder     -> RED overlay
                        //   green tint on the gap encodes the LOCAL rim target depth
                        bool isExcluded = mask.a > 0.5;
                        bool isFG = mask.b > 0.004 && mask.b < 0.995; // B: budget in (0,1); 1.0 = border void

                        if (isExcluded && !isFG) {
                            // True gap: blue, with target depth in green for inspection
                            gl_FragColor = vec4(0.0, mask.r * 0.5, 1.0, 1.0);
                        } else if (isFG) {
                            gl_FragColor = vec4(mix(base, vec3(1.0, 0.0, 0.0), 0.7), 1.0);
                        } else {
                            gl_FragColor = vec4(base, 1.0);
                        }
                    }
                `,
                depthWrite: false, depthTest: false
            });
        }
        const dbgMat = window._fgExclusionDebugMaterial;
        dbgMat.uniforms.tDiffuse.value = pingPongRenderTargetB.texture;
        dbgMat.uniforms.tExpandedGapMask.value = expandedGapMask;
        dbgMat.uniforms.tSceneDepth.value = screenNormalizedDepthTarget.texture;
        dbgMat.uniforms.u_showDepth.value = (debugView === 'fg_exclusion_depth');
        postProcessQuad.material = dbgMat;
        renderer.render(postProcessScene, postProcessCamera);

        // Use renderToScreen for proper aspect ratio handling
        renderToScreen(sceneRenderTarget.texture);
        return;
    }
    if (debugView === 'gap_target_depth') {
        // Show the computed gap target depth (what BG depth should be everywhere)
        if (!sdExportGapDepthTarget) {
            console.error("sdExportGapDepthTarget not available");
            return;
        }
        renderToScreen(sdExportGapDepthTarget.texture);
        return;
    }
    if (debugView === 'depth') { 
        // FIX: Use letterboxing
        setLetterboxedViewport(contentAspectRatio);

        postProcessQuad.material = debugDepthMaterial;
        debugDepthMaterial.uniforms.tDepth.value = sourceDepthTexture;
        debugDepthMaterial.uniforms.u_depthPeekActive.value = true;
        renderer.render(postProcessScene, postProcessCamera);

        // Restore scissor
        renderer.setScissorTest(false);
        return;
    }
    if (debugView === 'gaps') {
        renderToScreen(pingPongRenderTargetB.texture); 
        return;
    }
    if (debugView === 'jfa') {
        if (!jfaSeedMaterial || !jfaFloodMaterial || !jfaResolveMaterial || !jfaPingTarget || !jfaPongTarget || !finalEdgeMaskTexture || !debugJfaMaterial) { console.error("Missing resources for JFA debug view!"); return; }
        
        // Use normalized depth when background bias is enabled
        const useBackgroundBias = document.getElementById('useBackgroundBiasToggle')?.checked ?? true;
        let jfaDepthTexture = sourceDepthTexture;
        if (useBackgroundBias && screenNormalizedDepthTarget) {
            renderNormalizedDepthPass();
            jfaDepthTexture = screenNormalizedDepthTarget.texture;
        }
        
        const jfaEdgeMaskTextureDebug = finalEdgeMaskTexture;
        jfaSeedMaterial.uniforms.tEdgeMask.value = jfaEdgeMaskTextureDebug; jfaSeedMaterial.uniforms.u_maskUsesAlpha.value = maskUsesAlpha;
        postProcessQuad.material = jfaSeedMaterial; jfaSeedMaterial.uniforms.tDepth.value = jfaDepthTexture; jfaSeedMaterial.uniforms.u_seedDensity.value = jfaSeedDensity;
        renderer.setRenderTarget(jfaPingTarget); renderer.clear(); renderer.render(postProcessScene, postProcessCamera);
        postProcessQuad.material = jfaFloodMaterial; let readTarget = jfaPingTarget, writeTarget = jfaPongTarget; const numPasses = Math.ceil(Math.log2(Math.max(renderer.domElement.width, renderer.domElement.height)));
        for (let i = 0; i < numPasses; i++) { const step = Math.pow(2, numPasses - 1 - i); jfaFloodMaterial.uniforms.u_step.value = step; jfaFloodMaterial.uniforms.tJFA.value = readTarget.texture; renderer.setRenderTarget(writeTarget); renderer.clear(); renderer.render(postProcessScene, postProcessCamera); [readTarget, writeTarget] = [writeTarget, readTarget]; }
        let finalJfaTextureDebug = readTarget.texture;
        renderer.setRenderTarget(null); renderer.clear();
        postProcessQuad.material = debugJfaMaterial; debugJfaMaterial.uniforms.tJFA.value = finalJfaTextureDebug;
        renderer.render(postProcessScene, postProcessCamera); return;
    }
    if (debugView === 'jfa_tolerance') {
         if (!jfaSeedMaterial || !jfaFloodMaterial || !jfaPingTarget || !jfaPongTarget || !finalEdgeMaskTexture || !cleanColorTexture || !copyMaterial || !debugJfaToleranceMaterial) { console.error("Missing resources for JFA tolerance debug view!"); return; }
        
        // Use normalized depth when background bias is enabled
        const useBackgroundBias = document.getElementById('useBackgroundBiasToggle')?.checked ?? true;
        let jfaDepthTexture = sourceDepthTexture;
        if (useBackgroundBias && screenNormalizedDepthTarget) {
            renderNormalizedDepthPass();
            jfaDepthTexture = screenNormalizedDepthTarget.texture;
        }
        
        const jfaEdgeMaskTextureDebug = finalEdgeMaskTexture;
        jfaSeedMaterial.uniforms.tEdgeMask.value = jfaEdgeMaskTextureDebug; jfaSeedMaterial.uniforms.u_maskUsesAlpha.value = maskUsesAlpha;
        postProcessQuad.material = jfaSeedMaterial; jfaSeedMaterial.uniforms.tDepth.value = jfaDepthTexture; jfaSeedMaterial.uniforms.u_seedDensity.value = jfaSeedDensity;
        renderer.setRenderTarget(jfaPingTarget); renderer.clear(); renderer.render(postProcessScene, postProcessCamera);
        postProcessQuad.material = jfaFloodMaterial; let readTarget = jfaPingTarget, writeTarget = jfaPongTarget; const numPasses = Math.ceil(Math.log2(Math.max(renderer.domElement.width, renderer.domElement.height)));
        for (let i = 0; i < numPasses; i++) { const step = Math.pow(2, numPasses - 1 - i); jfaFloodMaterial.uniforms.u_step.value = step; jfaFloodMaterial.uniforms.tJFA.value = readTarget.texture; renderer.setRenderTarget(writeTarget); renderer.clear(); renderer.render(postProcessScene, postProcessCamera); [readTarget, writeTarget] = [writeTarget, readTarget]; }
        let finalJfaTextureDebug = readTarget.texture;
        const toleranceSliderDebug = document.getElementById('linearDepthToleranceSlider');
        const toleranceValueDebug = toleranceSliderDebug ? parseFloat(toleranceSliderDebug.value) : 0.03;
        renderer.setRenderTarget(null); renderer.clear();
        postProcessQuad.material = copyMaterial; copyMaterial.uniforms.tDiffuse.value = cleanColorTexture;
        renderer.render(postProcessScene, postProcessCamera);
        postProcessQuad.material = debugJfaToleranceMaterial;
        debugJfaToleranceMaterial.uniforms.tJFA.value = finalJfaTextureDebug;
        debugJfaToleranceMaterial.uniforms.tOriginalDepth.value = jfaDepthTexture;
        debugJfaToleranceMaterial.uniforms.tEdgeMask.value = jfaEdgeMaskTextureDebug;
        debugJfaToleranceMaterial.uniforms.u_linearDepthTolerance.value = toleranceValueDebug;
        renderer.autoClear = false;
        renderer.render(postProcessScene, postProcessCamera);
        renderer.autoClear = true;
        return;
    }
    if (debugView === 'jfa_depth_compare') {
        if (!jfaSeedMaterial || !jfaFloodMaterial || !jfaPingTarget || !jfaPongTarget || !finalEdgeMaskTexture || !debugJfaDepthCompareMaterial) { console.error("Missing resources for JFA depth compare debug view!"); return; }
        
        // Use normalized depth when background bias is enabled
        const useBackgroundBias = document.getElementById('useBackgroundBiasToggle')?.checked ?? true;
        let jfaDepthTexture = sourceDepthTexture;
        if (useBackgroundBias && screenNormalizedDepthTarget) {
            renderNormalizedDepthPass();
            jfaDepthTexture = screenNormalizedDepthTarget.texture;
        }
        
        const jfaEdgeMaskTextureDebug = finalEdgeMaskTexture;
        jfaSeedMaterial.uniforms.tEdgeMask.value = jfaEdgeMaskTextureDebug; jfaSeedMaterial.uniforms.u_maskUsesAlpha.value = maskUsesAlpha;
        postProcessQuad.material = jfaSeedMaterial; jfaSeedMaterial.uniforms.tDepth.value = jfaDepthTexture; jfaSeedMaterial.uniforms.u_seedDensity.value = jfaSeedDensity;
        renderer.setRenderTarget(jfaPingTarget); renderer.clear(); renderer.render(postProcessScene, postProcessCamera);
        postProcessQuad.material = jfaFloodMaterial; let readTarget = jfaPingTarget, writeTarget = jfaPongTarget; const numPasses = Math.ceil(Math.log2(Math.max(renderer.domElement.width, renderer.domElement.height)));
        for (let i = 0; i < numPasses; i++) { const step = Math.pow(2, numPasses - 1 - i); jfaFloodMaterial.uniforms.u_step.value = step; jfaFloodMaterial.uniforms.tJFA.value = readTarget.texture; renderer.setRenderTarget(writeTarget); renderer.clear(); renderer.render(postProcessScene, postProcessCamera); [readTarget, writeTarget] = [writeTarget, readTarget]; }
        let finalJfaTextureDebug = readTarget.texture;
        renderer.setRenderTarget(null); renderer.clear();
        postProcessQuad.material = debugJfaDepthCompareMaterial;
        debugJfaDepthCompareMaterial.uniforms.tJFA.value = finalJfaTextureDebug;
        debugJfaDepthCompareMaterial.uniforms.tOriginalDepth.value = jfaDepthTexture;
        debugJfaDepthCompareMaterial.uniforms.tEdgeMask.value = jfaEdgeMaskTextureDebug;
        renderer.render(postProcessScene, postProcessCamera);
        return;
    }
    if (debugView === 'pull_coarsest') {
        if (pullPyramidTargets.length === 0 || !copyMaterial || !pingPongRenderTargetB?.texture || !finalEdgeMaskTexture || !pullMaterialDepthAware) { console.error("Missing resources for PullPush coarsest debug view prep!"); return; }
        if (!maskGeneratorMaterial) {console.error("maskGeneratorMaterial missing!"); return;}
        postProcessQuad.material = maskGeneratorMaterial;
        maskGeneratorMaterial.uniforms.u_maskUsesAlpha.value = maskUsesAlpha;
        maskGeneratorMaterial.uniforms.tLayerMask.value = layerMaskTarget.texture;
        maskGeneratorMaterial.uniforms.u_maskChannel.value = 0; 
        maskGeneratorMaterial.uniforms.tDiffuse.value = maskUsesAlpha ? pingPongRenderTargetB.texture : cleanColorTexture;
        maskGeneratorMaterial.uniforms.tEdgeMask.value = maskUsesAlpha ? null : finalEdgeMaskTexture;
        maskGeneratorMaterial.uniforms.tSceneDepth.value = screenNormalizedDepthTarget?.texture || null;
        maskGeneratorMaterial.uniforms.tExpandedGapMask.value = screenNormalizedDepthTarget?.texture || null;
        maskGeneratorMaterial.uniforms.u_useExpandedMask.value = false; // depth target has INVERTED alpha semantics — never use as exclusion mask
        maskGeneratorMaterial.uniforms.u_texelSize.value.set(1.0 / renderer.domElement.width, 1.0 / renderer.domElement.height);
        renderer.setRenderTarget(pullPyramidTargets[0]); renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);
        
        // Use normalized depth when background bias is enabled
        const useBackgroundBias = document.getElementById('useBackgroundBiasToggle')?.checked ?? true;
        let depthTextureDebug = sourceDepthTexture;
        if (useBackgroundBias && screenNormalizedDepthTarget) {
            renderNormalizedDepthPass();
            depthTextureDebug = screenNormalizedDepthTarget.texture;
        }
        
        // Read new depth options
        const useHardCutoff = document.getElementById('useHardCutoffToggle')?.checked ?? false;
        const useGapTargetDepth = document.getElementById('useGapTargetDepthToggle')?.checked ?? true;
        
        let pullShaderMaterialDebug = pullMaterialDepthAware;
        
        // Set new uniforms
        if (pullShaderMaterialDebug.uniforms.u_useHardCutoff) {
            pullShaderMaterialDebug.uniforms.u_useHardCutoff.value = useHardCutoff;
        }
        if (pullShaderMaterialDebug.uniforms.u_useGapTargetDepth) {
            pullShaderMaterialDebug.uniforms.u_useGapTargetDepth.value = useGapTargetDepth;
        }
        
        postProcessQuad.material = pullShaderMaterialDebug;
        const numLevelsToUseDebug = Math.min(pullPyramidTargets.length, maxPyramidLevels);
        const coarsestIndexDebug = numLevelsToUseDebug - 1;
        for (let i = 1; i <= coarsestIndexDebug; i++) {
            const finerTarget = pullPyramidTargets[i-1]; const coarserTarget = pullPyramidTargets[i];
            if (!finerTarget?.texture || !coarserTarget) break;
            pullShaderMaterialDebug.uniforms.tFinerLevel.value = finerTarget.texture;
            pullShaderMaterialDebug.uniforms.u_texelSize.value.set(1.0 / finerTarget.width, 1.0 / finerTarget.height);
            pullShaderMaterialDebug.uniforms.tFinerDepth.value = depthTextureDebug;
            if (pullShaderMaterialDebug.uniforms.tGapTargetDepth) {
                pullShaderMaterialDebug.uniforms.tGapTargetDepth.value = depthTextureDebug;
            }
            pullShaderMaterialDebug.uniforms.tLayerMask.value = layerMaskTarget.texture; 
            pullShaderMaterialDebug.uniforms.u_maskChannel.value = 0;
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
        maskGeneratorMaterial.uniforms.u_maskChannel.value = 0; 
        maskGeneratorMaterial.uniforms.tDiffuse.value = maskUsesAlpha ? pingPongRenderTargetB.texture : cleanColorTexture;
        maskGeneratorMaterial.uniforms.tEdgeMask.value = maskUsesAlpha ? null : finalEdgeMaskTexture;
        maskGeneratorMaterial.uniforms.tSceneDepth.value = screenNormalizedDepthTarget?.texture || null;
        maskGeneratorMaterial.uniforms.tExpandedGapMask.value = screenNormalizedDepthTarget?.texture || null;
        maskGeneratorMaterial.uniforms.u_useExpandedMask.value = false; // depth target has INVERTED alpha semantics — never use as exclusion mask
        maskGeneratorMaterial.uniforms.u_texelSize.value.set(1.0 / renderer.domElement.width, 1.0 / renderer.domElement.height);
        renderer.setRenderTarget(pullPyramidTargets[0]); renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);
        
        // Use normalized depth when background bias is enabled
        const useBackgroundBias = document.getElementById('useBackgroundBiasToggle')?.checked ?? true;
        let depthTextureDebug = sourceDepthTexture;
        if (useBackgroundBias && screenNormalizedDepthTarget) {
            renderNormalizedDepthPass();
            depthTextureDebug = screenNormalizedDepthTarget.texture;
        }
        
        // Read new depth options
        const useHardCutoff = document.getElementById('useHardCutoffToggle')?.checked ?? false;
        const useGapTargetDepth = document.getElementById('useGapTargetDepthToggle')?.checked ?? true;
        
        let pullShaderMaterialDebug = pullMaterialDepthAware;
        
        // Set new uniforms
        if (pullShaderMaterialDebug.uniforms.u_useHardCutoff) {
            pullShaderMaterialDebug.uniforms.u_useHardCutoff.value = useHardCutoff;
        }
        if (pullShaderMaterialDebug.uniforms.u_useGapTargetDepth) {
            pullShaderMaterialDebug.uniforms.u_useGapTargetDepth.value = useGapTargetDepth;
        }
        
        postProcessQuad.material = pullShaderMaterialDebug;
        const numLevelsToUseDebug = Math.min(pullPyramidTargets.length, maxPyramidLevels);
        const coarsestIndexDebug = numLevelsToUseDebug - 1;
        for (let i = 1; i <= coarsestIndexDebug; i++) { 
            const finerTarget = pullPyramidTargets[i-1]; const coarserTarget = pullPyramidTargets[i];
            if (!finerTarget?.texture || !coarserTarget) break;
            pullShaderMaterialDebug.uniforms.tFinerLevel.value = finerTarget.texture;
            pullShaderMaterialDebug.uniforms.u_texelSize.value.set(1.0 / finerTarget.width, 1.0 / finerTarget.height);
            pullShaderMaterialDebug.uniforms.tFinerDepth.value = depthTextureDebug;
            if (pullShaderMaterialDebug.uniforms.tGapTargetDepth) {
                pullShaderMaterialDebug.uniforms.tGapTargetDepth.value = depthTextureDebug;
            }
            pullShaderMaterialDebug.uniforms.tLayerMask.value = layerMaskTarget.texture; 
            pullShaderMaterialDebug.uniforms.u_maskChannel.value = 0;
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
    if (debugView === 'fg_inpainted' || debugView === 'bg_inpainted' || debugView === 'fg_layer' || debugView === 'bg_layer') {
        if (currentInpaintingMethod !== 'pullpush') {
            console.warn("FG/BG debug views only available for PullPush method.");
            renderToScreen(pingPongRenderTargetB.texture); 
            return;
        }
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
            maskGeneratorMaterial.uniforms.tDiffuse.value = maskUsesAlpha ? pingPongRenderTargetB.texture : cleanColorTexture;
            maskGeneratorMaterial.uniforms.tEdgeMask.value = maskUsesAlpha ? null : finalEdgeMaskTexture;
            maskGeneratorMaterial.uniforms.tSceneDepth.value = screenNormalizedDepthTarget?.texture || null;
            maskGeneratorMaterial.uniforms.tExpandedGapMask.value = screenNormalizedDepthTarget?.texture || null;
            maskGeneratorMaterial.uniforms.u_useExpandedMask.value = false; // depth target has INVERTED alpha semantics — never use as exclusion mask
        maskGeneratorMaterial.uniforms.u_texelSize.value.set(1.0 / renderer.domElement.width, 1.0 / renderer.domElement.height);
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
                pullShaderMaterial.uniforms.tFinerDepth.value = sourceDepthTexture;
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
        runPullPushPass(1); 
        postProcessQuad.material = copyMaterial;
        copyMaterial.uniforms.tDiffuse.value = pushPyramidTargets[0].texture;
        renderer.setRenderTarget(bgInpaintedTarget); renderer.clear();
        renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
        renderer.render(postProcessScene, postProcessCamera);
        runPullPushPass(0);
        postProcessQuad.material = copyMaterial;
        copyMaterial.uniforms.tDiffuse.value = pushPyramidTargets[0].texture;
        renderer.setRenderTarget(fgInpaintedTarget); renderer.clear();
        renderer.setViewport(0, 0, renderer.domElement.width, renderer.domElement.height);
        renderer.render(postProcessScene, postProcessCamera);
        postProcessQuad.material = finalCompositeMaterial;
        finalCompositeMaterial.uniforms.tFG.value = fgInpaintedTarget.texture;
        finalCompositeMaterial.uniforms.tBG.value = bgInpaintedTarget.texture;
        finalCompositeMaterial.uniforms.tLayerMask.value = layerMaskTarget.texture;
        finalCompositeMaterial.uniforms.tOriginal.value = pingPongRenderTargetB.texture;
        finalCompositeMaterial.uniforms.tExpandedGapMask.value = null;
        finalCompositeMaterial.uniforms.u_hasExpandedMask.value = false;  // No FG subtraction in this path
        finalCompositeMaterial.uniforms.u_bgLayerActive.value =
            !!(typeof bgLayerMesh !== 'undefined' && bgLayerMesh && bgLayerMesh.visible);
        finalCompositeMaterial.uniforms.tSceneDepth.value = screenNormalizedDepthTarget?.texture || null;
        finalCompositeMaterial.uniforms.u_maskUsesAlpha.value = maskUsesAlpha;
        renderer.setRenderTarget(finalInpaintedTextureTarget); renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);
        return; 
    }
    
    // --- PASS: Inpainting (Main Logic) ---
    if (!useInpainting && !(isAccumulatingGaps && !isSweeping)) {
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
        switch(currentInpaintingMethod) {
            case 'jfa': {
                if (!jfaSeedMaterial || !jfaFloodMaterial || !jfaResolveMaterial || !jfaPingTarget || !jfaPongTarget || !finalEdgeMaskTexture || !sourceDepthTexture || !cleanColorTexture || !copyMaterial || !pingPongRenderTargetB?.texture || !finalInpaintedTextureTarget) {
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
                
                // Check if background bias is enabled
                const useBackgroundBias = document.getElementById('useBackgroundBiasToggle')?.checked ?? true;
                if (jfaResolveMaterial.uniforms.u_useBackgroundBias) {
                    jfaResolveMaterial.uniforms.u_useBackgroundBias.value = useBackgroundBias;
                }
                
                // Render normalized depth FIRST if using background bias
                // This ensures consistent depth representation for both JFA and gap depth
                if (useBackgroundBias && screenNormalizedDepthTarget) {
                    renderNormalizedDepthPass();
                }
                
                // JFA seed: use normalized depth when background bias is enabled for consistent comparison
                const jfaDepthTexture = (useBackgroundBias && screenNormalizedDepthTarget) ? screenNormalizedDepthTarget.texture : sourceDepthTexture;
                postProcessQuad.material = jfaSeedMaterial; jfaSeedMaterial.uniforms.tDepth.value = jfaDepthTexture; jfaSeedMaterial.uniforms.u_seedDensity.value = jfaSeedDensity;
                 renderer.setRenderTarget(jfaPingTarget); renderer.clear(); renderer.render(postProcessScene, postProcessCamera);
                postProcessQuad.material = jfaFloodMaterial; let readTarget = jfaPingTarget, writeTarget = jfaPongTarget; const numPasses = Math.ceil(Math.log2(Math.max(renderer.domElement.width, renderer.domElement.height)));
                for (let i = 0; i < numPasses; i++) { const step = Math.pow(2, numPasses - 1 - i); jfaFloodMaterial.uniforms.u_step.value = step; jfaFloodMaterial.uniforms.tJFA.value = readTarget.texture; renderer.setRenderTarget(writeTarget); renderer.clear(); renderer.render(postProcessScene, postProcessCamera); [readTarget, writeTarget] = [writeTarget, readTarget]; } let finalJfaTexture = readTarget.texture;
                
                // --- Gap Target Depth Pass (background-biased depth estimation via Pull-Push) ---
                // Use normalized depth for consistency
                if (useBackgroundBias && gapDepthSeedMaterial && gapDepthPullMaterial && gapDepthPushMaterial && 
                    pullPyramidTargets.length > 0 && screenNormalizedDepthTarget) {
                    
                    const numLevels = Math.min(pullPyramidTargets.length, 10);
                    if (numLevels < 2) {
                        console.warn("Not enough pyramid levels for gap depth pull-push");
                    } else {
                        // Read BG Max Bias from slider
                        const bgMaxBias = parseFloat(document.getElementById('bgMaxBiasSlider')?.value || '0.7');
                        if (gapDepthPullMaterial.uniforms.u_maxBias) {
                            gapDepthPullMaterial.uniforms.u_maxBias.value = bgMaxBias;
                        }
                        
                        // Step 1: Seed - use normalized depth (0=far, 1=near)
                        postProcessQuad.material = gapDepthSeedMaterial;
                        gapDepthSeedMaterial.uniforms.tDepth.value = screenNormalizedDepthTarget.texture;
                        gapDepthSeedMaterial.uniforms.tEdgeMask.value = jfaEdgeMaskTexture;
                        gapDepthSeedMaterial.uniforms.u_maskUsesAlpha.value = maskUsesAlpha;
                        gapDepthSeedMaterial.uniforms.tLayerMask.value = layerMaskTarget?.texture || null;
                        gapDepthSeedMaterial.uniforms.u_texelSize.value.set(1.0 / renderer.domElement.width, 1.0 / renderer.domElement.height);
                        
                        renderer.setRenderTarget(pullPyramidTargets[0]);
                        renderer.clear();
                        renderer.render(postProcessScene, postProcessCamera);
                        
                        // Step 2: Pull - downsample taking min depth from valid neighbors (background = smaller values)
                        postProcessQuad.material = gapDepthPullMaterial;
                        for (let i = 1; i < numLevels; i++) {
                            const finer = pullPyramidTargets[i - 1];
                            const coarser = pullPyramidTargets[i];
                            
                            gapDepthPullMaterial.uniforms.tFinerLevel.value = finer.texture;
                            gapDepthPullMaterial.uniforms.u_texelSize.value.set(1.0 / finer.width, 1.0 / finer.height);
                            
                            renderer.setRenderTarget(coarser);
                            renderer.clear();
                            renderer.render(postProcessScene, postProcessCamera);
                        }
                        
                        // Step 3: Push - upsample filling gaps smoothly
                        postProcessQuad.material = copyMaterial;
                        copyMaterial.uniforms.tDiffuse.value = pullPyramidTargets[numLevels - 1].texture;
                        renderer.setRenderTarget(pushPyramidTargets[numLevels - 1]);
                        renderer.clear();
                        renderer.render(postProcessScene, postProcessCamera);
                        
                        postProcessQuad.material = gapDepthPushMaterial;
                        for (let i = numLevels - 2; i >= 0; i--) {
                            gapDepthPushMaterial.uniforms.tCurrentLevel.value = pullPyramidTargets[i].texture;
                            gapDepthPushMaterial.uniforms.tCoarserLevel.value = pushPyramidTargets[i + 1].texture;
                            
                            renderer.setRenderTarget(pushPyramidTargets[i]);
                            renderer.clear();
                            renderer.render(postProcessScene, postProcessCamera);
                        }
                        
                        // Final result is in pushPyramidTargets[0]
                        jfaResolveMaterial.uniforms.tGapTargetDepth.value = pushPyramidTargets[0].texture;
                    }
                }
                
                renderer.setRenderTarget(finalInpaintedTextureTarget); renderer.clear();
                postProcessQuad.material = copyMaterial; copyMaterial.uniforms.tDiffuse.value = pingPongRenderTargetB.texture;
                renderer.render(postProcessScene, postProcessCamera);
                postProcessQuad.material = jfaResolveMaterial;
                jfaResolveMaterial.uniforms.tOriginalDepth.value = sourceDepthTexture; 
                jfaResolveMaterial.uniforms.tDiffuse.value = cleanColorTexture; 
                jfaResolveMaterial.uniforms.tJFA.value = finalJfaTexture;
                 renderer.autoClear = false;
                 renderer.render(postProcessScene, postProcessCamera);
                 renderer.autoClear = true;
                break;
            }

            case 'pullpush': {
                if (!splitMaterial) splitMaterial = createSplitMaterial();
                if (pullPyramidTargets.length === 0 || pushPyramidTargets.length === 0 || !pullMaterial || !pushMaterial || !copyMaterial || !pingPongRenderTargetB?.texture || !finalEdgeMaskTexture || !pullMaterialDepthAware || !layerMaskTarget?.texture || !fgInpaintedTarget || !bgInpaintedTarget || !finalCompositeMaterial || !finalInpaintedTextureTarget) {
                    console.warn("PullPush pyramids or materials not initialized, skipping inpainting.");
                    renderer.setRenderTarget(null); renderer.clear(); if(copyMaterial && pingPongRenderTargetB?.texture) { postProcessQuad.material = copyMaterial; copyMaterial.uniforms.tDiffuse.value = pingPongRenderTargetB.texture; renderer.render(postProcessScene, postProcessCamera);}
                    return;
                }
                
                // Render normalized depth
                renderNormalizedDepthPass();
                
                // Track whether FG subtraction ran (for compositing)
                let fgSubtractionRan = false;
                
                // Compute background-biased gap target depth using Pull-Push
                // This uses the pyramid targets temporarily, then stores result in sdExportGapDepthTarget
                let depthTextureToUse = screenNormalizedDepthTarget?.texture || sourceDepthTexture;
                const useBackgroundBias = document.getElementById('useBackgroundBiasToggle')?.checked ?? true;
                
                if (useBackgroundBias && screenNormalizedDepthTarget && sdExportGapDepthTarget && sdExportGapDepthTarget2) {
                    // FG SUBTRACTION v2 (local rim depth). See runFGSubtraction() for the
                    // full algorithm + output channel contract. This replaces the old
                    // pyramid min-pooled gap-target computation, whose NON-LOCAL minimum
                    // corrupted the comparison baseline and caused the "sandwich" artifact
                    // (background pixels marked as FG on the far side of gaps).
                    // FAIL-SAFE: an enhancement pass must never take down the base render.
                    try {
                        const fgThreshold = parseFloat(document.getElementById('fgSubThresholdSlider')?.value || '0.05');
                        fgSubtractionRan = runFGSubtraction(
                            pingPongRenderTargetB?.texture || null,
                            maskUsesAlpha,
                            fgThreshold
                        );
                    } catch (e) {
                        console.error("[FG-SUB] runFGSubtraction threw — continuing without FG subtraction:", e);
                        fgSubtractionRan = false;
                    }
                    if (fgSubtractionRan) {
                        // R channel = local gap target depth (gaps + marked FG) or own
                        // depth (valid pixels) — valid for BOTH the depth-aware color
                        // pull (tGapTargetDepth) and the pyramid exclusion mask.
                        // Dedicated target: immune to the later pyramid pass that
                        // re-renders sdExportGapDepthTarget every frame.
                        depthTextureToUse = fgMaskTargetA.texture;
                    }
                }
                
                let pullShaderMaterial = pullMaterialDepthAware;
                
                // Read new depth options from UI
                const useHardCutoff = document.getElementById('useHardCutoffToggle')?.checked ?? false;
                const useGapTargetDepth = document.getElementById('useGapTargetDepthToggle')?.checked ?? true;
                
                // Set new uniforms
                if (pullShaderMaterial.uniforms.u_useHardCutoff) {
                    pullShaderMaterial.uniforms.u_useHardCutoff.value = useHardCutoff;
                }
                if (pullShaderMaterial.uniforms.u_useGapTargetDepth) {
                    pullShaderMaterial.uniforms.u_useGapTargetDepth.value = useGapTargetDepth;
                }
                
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
                    maskGeneratorMaterial.uniforms.tDiffuse.value = maskUsesAlpha ? pingPongRenderTargetB.texture : cleanColorTexture;
                    maskGeneratorMaterial.uniforms.tEdgeMask.value = maskUsesAlpha ? null : finalEdgeMaskTexture;
            maskGeneratorMaterial.uniforms.tSceneDepth.value = screenNormalizedDepthTarget?.texture || null;
            maskGeneratorMaterial.uniforms.tExpandedGapMask.value = depthTextureToUse;
            maskGeneratorMaterial.uniforms.u_useExpandedMask.value = fgSubtractionRan; // alpha is an exclusion mask ONLY after FG subtraction
        maskGeneratorMaterial.uniforms.u_texelSize.value.set(1.0 / renderer.domElement.width, 1.0 / renderer.domElement.height);
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
                        // Use SCENE depth to check actual neighbor depths (FG vs BG)
                        pullShaderMaterial.uniforms.tFinerDepth.value = screenNormalizedDepthTarget.texture;
                        // Use GAP-FILLED depth for target depth (what gaps should be)
                        if (pullShaderMaterial.uniforms.tGapTargetDepth) {
                            pullShaderMaterial.uniforms.tGapTargetDepth.value = depthTextureToUse;
                        }
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
                finalCompositeMaterial.uniforms.tOriginal.value = pingPongRenderTargetB.texture;
                finalCompositeMaterial.uniforms.tExpandedGapMask.value = depthTextureToUse;
                finalCompositeMaterial.uniforms.u_hasExpandedMask.value = fgSubtractionRan;
                finalCompositeMaterial.uniforms.u_bgLayerActive.value =
                    !!(typeof bgLayerMesh !== 'undefined' && bgLayerMesh && bgLayerMesh.visible);
                finalCompositeMaterial.uniforms.tSceneDepth.value = screenNormalizedDepthTarget?.texture || null;
                finalCompositeMaterial.uniforms.u_maskUsesAlpha.value = maskUsesAlpha;
                renderer.setRenderTarget(finalInpaintedTextureTarget); renderer.clear();
                renderer.render(postProcessScene, postProcessCamera);
                break;
            }

            case 'dilation': {
                if (!dilationMaterial || !pingPongRenderTargetB?.texture || !pingPongRenderTargetA || !copyMaterial || !finalInpaintedTextureTarget) {
                     console.error("Missing resources for dilation!");
                     renderer.setRenderTarget(null); renderer.clear(); if(copyMaterial && pingPongRenderTargetB?.texture) { postProcessQuad.material = copyMaterial; copyMaterial.uniforms.tDiffuse.value = pingPongRenderTargetB.texture; renderer.render(postProcessScene, postProcessCamera);}
                     return;
                 }
                
                // Render normalized depth
                renderNormalizedDepthPass();
                
                // Compute background-biased gap target depth
                let dilationDepthTexture = screenNormalizedDepthTarget?.texture || sourceDepthTexture;
                const useBackgroundBias = document.getElementById('useBackgroundBiasToggle')?.checked ?? true;
                
                if (useBackgroundBias && gapDepthSeedMaterial && gapDepthPullMaterial && gapDepthPushMaterial && 
                    screenNormalizedDepthTarget && sdExportGapDepthTarget && pullPyramidTargets.length >= 2) {
                    
                    const numLevels = Math.min(pullPyramidTargets.length, 10);
                    
                    // Read BG Max Bias from slider
                    const bgMaxBias = parseFloat(document.getElementById('bgMaxBiasSlider')?.value || '0.7');
                    if (gapDepthPullMaterial.uniforms.u_maxBias) {
                        gapDepthPullMaterial.uniforms.u_maxBias.value = bgMaxBias;
                    }
                    
                    // Seed
                    postProcessQuad.material = gapDepthSeedMaterial;
                    gapDepthSeedMaterial.uniforms.tDepth.value = screenNormalizedDepthTarget.texture;
                    gapDepthSeedMaterial.uniforms.tEdgeMask.value = finalEdgeMaskTexture;
                    gapDepthSeedMaterial.uniforms.u_maskUsesAlpha.value = maskUsesAlpha;
                    gapDepthSeedMaterial.uniforms.tLayerMask.value = layerMaskTarget?.texture || null;
                    gapDepthSeedMaterial.uniforms.u_texelSize.value.set(1.0 / renderer.domElement.width, 1.0 / renderer.domElement.height);
                    renderer.setRenderTarget(pullPyramidTargets[0]);
                    renderer.clear();
                    renderer.render(postProcessScene, postProcessCamera);
                    
                    // Pull
                    postProcessQuad.material = gapDepthPullMaterial;
                    for (let i = 1; i < numLevels; i++) {
                        const finer = pullPyramidTargets[i - 1];
                        const coarser = pullPyramidTargets[i];
                        gapDepthPullMaterial.uniforms.tFinerLevel.value = finer.texture;
                        gapDepthPullMaterial.uniforms.u_texelSize.value.set(1.0 / finer.width, 1.0 / finer.height);
                        renderer.setRenderTarget(coarser);
                        renderer.clear();
                        renderer.render(postProcessScene, postProcessCamera);
                    }
                    
                    // Push
                    postProcessQuad.material = copyMaterial;
                    copyMaterial.uniforms.tDiffuse.value = pullPyramidTargets[numLevels - 1].texture;
                    renderer.setRenderTarget(pushPyramidTargets[numLevels - 1]);
                    renderer.clear();
                    renderer.render(postProcessScene, postProcessCamera);
                    
                    postProcessQuad.material = gapDepthPushMaterial;
                    for (let i = numLevels - 2; i >= 0; i--) {
                        gapDepthPushMaterial.uniforms.tCurrentLevel.value = pullPyramidTargets[i].texture;
                        gapDepthPushMaterial.uniforms.tCoarserLevel.value = pushPyramidTargets[i + 1].texture;
                        renderer.setRenderTarget(pushPyramidTargets[i]);
                        renderer.clear();
                        renderer.render(postProcessScene, postProcessCamera);
                    }
                    
                    // Store result
                    postProcessQuad.material = copyMaterial;
                    copyMaterial.uniforms.tDiffuse.value = pushPyramidTargets[0].texture;
                    renderer.setRenderTarget(sdExportGapDepthTarget);
                    renderer.clear();
                    renderer.render(postProcessScene, postProcessCamera);
                    
                    dilationDepthTexture = sdExportGapDepthTarget.texture;
                }
                
                let dilateRead = pingPongRenderTargetB; let dilateWrite = pingPongRenderTargetA;
                for (let i = 0; i < dilationIterations; i++) {
                    postProcessQuad.material = dilationMaterial;
                    dilationMaterial.uniforms.tDiffuse.value = dilateRead.texture;
                    dilationMaterial.uniforms.tOriginalDepth.value = dilationDepthTexture;
                    renderer.setRenderTarget(dilateWrite); renderer.clear();
                    renderer.render(postProcessScene, postProcessCamera);
                    [dilateRead, dilateWrite] = [dilateWrite, dilateRead];
                }
                renderer.setRenderTarget(finalInpaintedTextureTarget); renderer.clear();
                postProcessQuad.material = copyMaterial;
                copyMaterial.uniforms.tDiffuse.value = dilateRead.texture;
                renderer.render(postProcessScene, postProcessCamera);
                break;
            }

            case 'cutoff': 
            case 'displacement': 
            default: {
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
    }
    
    // --- DEBUG VIEW: Inpaint Only ---
    // Shows only the inpainted pixels (difference between gapped and inpainted)
    if (debugView === 'inpaint_only') {
        if (!inpaintOnlyMaterial || !pingPongRenderTargetB?.texture || !finalInpaintedTextureTarget?.texture || !pingPongRenderTargetA) {
            console.error("Missing resources for inpaint_only debug view!");
            renderToScreen(cleanColorTexture);
            return;
        }
        
        // Render inpaint comparison to a temp target (same dimensions as other PP targets)
        postProcessQuad.material = inpaintOnlyMaterial;
        inpaintOnlyMaterial.uniforms.tGapped.value = pingPongRenderTargetB.texture;
        inpaintOnlyMaterial.uniforms.tInpainted.value = finalInpaintedTextureTarget.texture;
        
        renderer.setRenderTarget(pingPongRenderTargetA);
        renderer.setViewport(0, 0, pingPongRenderTargetA.width, pingPongRenderTargetA.height);
        renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);
        
        // Use same path as 'gaps' debug view
        renderToScreen(pingPongRenderTargetA.texture);
        return;
    }
    
    // --- DEBUG VIEW: Inpaint Only Depth ---
    // Shows depth where inpainting occurred (works with any inpainting method)
    if (debugView === 'inpaint_only_depth') {
        if (!inpaintOnlyDepthMaterial || !pingPongRenderTargetB?.texture || 
            !finalInpaintedTextureTarget?.texture || !pingPongRenderTargetA || 
            !screenNormalizedDepthTarget || !gapDepthSeedMaterial || !gapDepthPullMaterial || 
            !gapDepthPushMaterial || pullPyramidTargets.length < 2) {
            console.error("Missing resources for inpaint_only_depth debug view!");
            renderToScreen(cleanColorTexture);
            return;
        }
        
        // Ensure screen-space depth is rendered
        renderNormalizedDepthPass();
        
        // Read all controls
        const useBackgroundBias = document.getElementById('useBackgroundBiasToggle')?.checked ?? true;
        const bgMaxBias = parseFloat(document.getElementById('bgMaxBiasSlider')?.value || '0.7');
        const maxLevelsFromUI = parseInt(document.getElementById('maxPyramidLevelsSlider')?.value || '10');
        const numLevels = Math.min(pullPyramidTargets.length, maxLevelsFromUI, 10);
        
        // Default to raw screen depth
        let depthTextureToUse = screenNormalizedDepthTarget.texture;
        
        // Only run pull-push if background bias is enabled
        if (useBackgroundBias && numLevels >= 2) {
            // Set BG Max Bias
            if (gapDepthPullMaterial.uniforms.u_maxBias) {
                gapDepthPullMaterial.uniforms.u_maxBias.value = bgMaxBias;
            }
            
            postProcessQuad.material = gapDepthSeedMaterial;
            gapDepthSeedMaterial.uniforms.tDepth.value = screenNormalizedDepthTarget.texture;
            gapDepthSeedMaterial.uniforms.tEdgeMask.value = finalEdgeMaskTexture;
            gapDepthSeedMaterial.uniforms.u_maskUsesAlpha.value = maskUsesAlpha;
            gapDepthSeedMaterial.uniforms.tLayerMask.value = layerMaskTarget?.texture || null;
            gapDepthSeedMaterial.uniforms.u_texelSize.value.set(1.0 / renderer.domElement.width, 1.0 / renderer.domElement.height);
            renderer.setRenderTarget(pullPyramidTargets[0]);
            renderer.clear();
            renderer.render(postProcessScene, postProcessCamera);
            
            postProcessQuad.material = gapDepthPullMaterial;
            for (let i = 1; i < numLevels; i++) {
                const finer = pullPyramidTargets[i - 1];
                const coarser = pullPyramidTargets[i];
                gapDepthPullMaterial.uniforms.tFinerLevel.value = finer.texture;
                gapDepthPullMaterial.uniforms.u_texelSize.value.set(1.0 / finer.width, 1.0 / finer.height);
                renderer.setRenderTarget(coarser);
                renderer.clear();
                renderer.render(postProcessScene, postProcessCamera);
            }
            
            postProcessQuad.material = copyMaterial;
            copyMaterial.uniforms.tDiffuse.value = pullPyramidTargets[numLevels - 1].texture;
            renderer.setRenderTarget(pushPyramidTargets[numLevels - 1]);
            renderer.clear();
            renderer.render(postProcessScene, postProcessCamera);
            
            postProcessQuad.material = gapDepthPushMaterial;
            for (let i = numLevels - 2; i >= 0; i--) {
                gapDepthPushMaterial.uniforms.tCurrentLevel.value = pullPyramidTargets[i].texture;
                gapDepthPushMaterial.uniforms.tCoarserLevel.value = pushPyramidTargets[i + 1].texture;
                renderer.setRenderTarget(pushPyramidTargets[i]);
                renderer.clear();
                renderer.render(postProcessScene, postProcessCamera);
            }
            
            depthTextureToUse = pushPyramidTargets[0].texture;
        }
        
        // Show gap target depth using comparison method
        postProcessQuad.material = inpaintOnlyDepthMaterial;
        inpaintOnlyDepthMaterial.uniforms.tGapped.value = pingPongRenderTargetB.texture;
        inpaintOnlyDepthMaterial.uniforms.tInpainted.value = finalInpaintedTextureTarget.texture;
        inpaintOnlyDepthMaterial.uniforms.tDepth.value = depthTextureToUse;
        
        renderer.setRenderTarget(pingPongRenderTargetA);
        renderer.setViewport(0, 0, pingPongRenderTargetA.width, pingPongRenderTargetA.height);
        renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);
        
        // Display result
        renderToScreen(pingPongRenderTargetA.texture);
        return;
    }
    
    // --- DEBUG VIEW: Gap Target Depth (Background Bias) ---
    // Shows the computed background depth for gap pixels only (black for non-gaps)
    if (debugView === 'gap_target_depth') {
        if (!pingPongRenderTargetA || !screenNormalizedDepthTarget || !finalEdgeMaskTexture ||
            !gapDepthSeedMaterial || !gapDepthPullMaterial || !gapDepthPushMaterial ||
            pullPyramidTargets.length < 2) {
            console.error("Missing resources for gap_target_depth debug view!");
            renderToScreen(cleanColorTexture);
            return;
        }
        
        // Ensure normalized depth is rendered
        renderNormalizedDepthPass();
        
        // Read all controls
        const bgMaxBias = parseFloat(document.getElementById('bgMaxBiasSlider')?.value || '0.7');
        const maxLevelsFromUI = parseInt(document.getElementById('maxPyramidLevelsSlider')?.value || '10');
        const numLevels = Math.min(pullPyramidTargets.length, maxLevelsFromUI, 10);
        
        if (gapDepthPullMaterial.uniforms.u_maxBias) {
            gapDepthPullMaterial.uniforms.u_maxBias.value = bgMaxBias;
        }
        
        // Step 1: Seed - use normalized depth (0=far, 1=near)
        postProcessQuad.material = gapDepthSeedMaterial;
        gapDepthSeedMaterial.uniforms.tDepth.value = screenNormalizedDepthTarget.texture;
        gapDepthSeedMaterial.uniforms.tEdgeMask.value = finalEdgeMaskTexture;
        gapDepthSeedMaterial.uniforms.u_maskUsesAlpha.value = maskUsesAlpha;
        gapDepthSeedMaterial.uniforms.tLayerMask.value = layerMaskTarget?.texture || null;
        gapDepthSeedMaterial.uniforms.u_texelSize.value.set(1.0 / renderer.domElement.width, 1.0 / renderer.domElement.height);
        
        renderer.setRenderTarget(pullPyramidTargets[0]);
        renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);
        
        // Step 2: Pull - downsample taking max depth from valid neighbors
        postProcessQuad.material = gapDepthPullMaterial;
        for (let i = 1; i < numLevels; i++) {
            const finer = pullPyramidTargets[i - 1];
            const coarser = pullPyramidTargets[i];
            
            gapDepthPullMaterial.uniforms.tFinerLevel.value = finer.texture;
            gapDepthPullMaterial.uniforms.u_texelSize.value.set(1.0 / finer.width, 1.0 / finer.height);
            
            renderer.setRenderTarget(coarser);
            renderer.clear();
            renderer.render(postProcessScene, postProcessCamera);
        }
        
        // Step 3: Push - upsample filling gaps smoothly
        postProcessQuad.material = copyMaterial;
        copyMaterial.uniforms.tDiffuse.value = pullPyramidTargets[numLevels - 1].texture;
        renderer.setRenderTarget(pushPyramidTargets[numLevels - 1]);
        renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);
        
        postProcessQuad.material = gapDepthPushMaterial;
        for (let i = numLevels - 2; i >= 0; i--) {
            gapDepthPushMaterial.uniforms.tCurrentLevel.value = pullPyramidTargets[i].texture;
            gapDepthPushMaterial.uniforms.tCoarserLevel.value = pushPyramidTargets[i + 1].texture;
            
            renderer.setRenderTarget(pushPyramidTargets[i]);
            renderer.clear();
            renderer.render(postProcessScene, postProcessCamera);
        }
        
        // Visualize: show depth for gaps, black for non-gaps
        // Normalized depth: 1=near (bright), 0=far (dark)
        if (!debugGapTargetDepthMaterial) {
            debugGapTargetDepthMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    tGapDepth: { value: null },
                    tEdgeMask: { value: null },
                    u_maskUsesAlpha: { value: true }
                },
                vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
                fragmentShader: `
                    uniform sampler2D tGapDepth;
                    uniform sampler2D tEdgeMask;
                    uniform bool u_maskUsesAlpha;
                    varying vec2 vUv;
                    
                    void main() {
                        float maskValue = u_maskUsesAlpha ? (1.0 - texture2D(tEdgeMask, vUv).a) : texture2D(tEdgeMask, vUv).r;
                        bool isGap = maskValue > 0.5;
                        
                        if (!isGap) {
                            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
                            return;
                        }
                        
                        vec4 gapData = texture2D(tGapDepth, vUv);
                        if (gapData.a > 0.01) {
                            // Filled - show normalized depth directly (1=near/bright, 0=far/dark)
                            gl_FragColor = vec4(vec3(gapData.r), 1.0);
                        } else {
                            // Unfilled - show red
                            gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
                        }
                    }
                `,
                depthWrite: false,
                depthTest: false
            });
        }
        
        debugGapTargetDepthMaterial.uniforms.tGapDepth.value = pushPyramidTargets[0].texture;
        debugGapTargetDepthMaterial.uniforms.tEdgeMask.value = finalEdgeMaskTexture;
        debugGapTargetDepthMaterial.uniforms.u_maskUsesAlpha.value = maskUsesAlpha;
        
        postProcessQuad.material = debugGapTargetDepthMaterial;
        
        renderer.setRenderTarget(pingPongRenderTargetA);
        renderer.setViewport(0, 0, pingPongRenderTargetA.width, pingPongRenderTargetA.height);
        renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);
        
        renderToScreen(pingPongRenderTargetA.texture);
        return;
    }
    
    // --- DEBUG VIEW: Scene Depth (No Inpainting) ---
    // Shows the raw normalized screen depth - gaps shown in red
    if (debugView === 'scene_depth') {
        if (!screenNormalizedDepthTarget || !pingPongRenderTargetA || !finalEdgeMaskTexture) {
            console.error("Missing resources for scene_depth debug view!");
            renderToScreen(cleanColorTexture);
            return;
        }
        
        // Render normalized depth
        renderNormalizedDepthPass();
        
        // Create material to show depth with gaps highlighted
        if (!debugSceneDepthMaterial) {
            debugSceneDepthMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    tSceneDepth: { value: null },
                    tEdgeMask: { value: null },
                    u_maskUsesAlpha: { value: true }
                },
                vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
                fragmentShader: `
                    uniform sampler2D tSceneDepth;
                    uniform sampler2D tEdgeMask;
                    uniform bool u_maskUsesAlpha;
                    varying vec2 vUv;
                    
                    void main() {
                        float maskValue = u_maskUsesAlpha ? (1.0 - texture2D(tEdgeMask, vUv).a) : texture2D(tEdgeMask, vUv).r;
                        bool isGapFromMask = maskValue > 0.5;
                        
                        // Also check if depth pass discarded this pixel (alpha=0)
                        vec4 sceneDepthSample = texture2D(tSceneDepth, vUv);
                        bool isGapFromDepth = sceneDepthSample.a < 0.5;
                        
                        if (isGapFromMask || isGapFromDepth) {
                            // Show gaps in red
                            gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
                        } else {
                            // Show scene depth as grayscale
                            gl_FragColor = vec4(vec3(sceneDepthSample.r), 1.0);
                        }
                    }
                `,
                depthWrite: false,
                depthTest: false
            });
        }
        
        debugSceneDepthMaterial.uniforms.tSceneDepth.value = screenNormalizedDepthTarget.texture;
        debugSceneDepthMaterial.uniforms.tEdgeMask.value = finalEdgeMaskTexture;
        debugSceneDepthMaterial.uniforms.u_maskUsesAlpha.value = maskUsesAlpha;
        
        postProcessQuad.material = debugSceneDepthMaterial;
        
        renderer.setRenderTarget(pingPongRenderTargetA);
        renderer.setViewport(0, 0, pingPongRenderTargetA.width, pingPongRenderTargetA.height);
        renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);
        
        renderToScreen(pingPongRenderTargetA.texture);
        return;
    }
    
    // --- DEBUG VIEW: Scene + Inpainted Depth Composite ---
    // Shows scene depth for valid pixels, inpainted gap depth for gaps
    if (debugView === 'scene_depth_composite') {
        if (!screenNormalizedDepthTarget || !pingPongRenderTargetA || !finalEdgeMaskTexture ||
            !gapDepthSeedMaterial || !gapDepthPullMaterial || !gapDepthPushMaterial ||
            pullPyramidTargets.length < 2) {
            console.error("Missing resources for scene_depth_composite debug view!");
            renderToScreen(cleanColorTexture);
            return;
        }
        
        // Render normalized depth
        renderNormalizedDepthPass();
        
        // Read all controls
        const bgMaxBias = parseFloat(document.getElementById('bgMaxBiasSlider')?.value || '0.7');
        const maxLevelsFromUI = parseInt(document.getElementById('maxPyramidLevelsSlider')?.value || '10');
        const numLevels = Math.min(pullPyramidTargets.length, maxLevelsFromUI, 10);
        
        if (gapDepthPullMaterial.uniforms.u_maxBias) {
            gapDepthPullMaterial.uniforms.u_maxBias.value = bgMaxBias;
        }
        
        // Seed
        postProcessQuad.material = gapDepthSeedMaterial;
        gapDepthSeedMaterial.uniforms.tDepth.value = screenNormalizedDepthTarget.texture;
        gapDepthSeedMaterial.uniforms.tEdgeMask.value = finalEdgeMaskTexture;
        gapDepthSeedMaterial.uniforms.u_maskUsesAlpha.value = maskUsesAlpha;
        gapDepthSeedMaterial.uniforms.tLayerMask.value = layerMaskTarget?.texture || null;
        gapDepthSeedMaterial.uniforms.u_texelSize.value.set(1.0 / renderer.domElement.width, 1.0 / renderer.domElement.height);
        renderer.setRenderTarget(pullPyramidTargets[0]);
        renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);
        
        // Pull
        postProcessQuad.material = gapDepthPullMaterial;
        for (let i = 1; i < numLevels; i++) {
            const finer = pullPyramidTargets[i - 1];
            const coarser = pullPyramidTargets[i];
            gapDepthPullMaterial.uniforms.tFinerLevel.value = finer.texture;
            gapDepthPullMaterial.uniforms.u_texelSize.value.set(1.0 / finer.width, 1.0 / finer.height);
            renderer.setRenderTarget(coarser);
            renderer.clear();
            renderer.render(postProcessScene, postProcessCamera);
        }
        
        // Push
        postProcessQuad.material = copyMaterial;
        copyMaterial.uniforms.tDiffuse.value = pullPyramidTargets[numLevels - 1].texture;
        renderer.setRenderTarget(pushPyramidTargets[numLevels - 1]);
        renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);
        
        postProcessQuad.material = gapDepthPushMaterial;
        for (let i = numLevels - 2; i >= 0; i--) {
            gapDepthPushMaterial.uniforms.tCurrentLevel.value = pullPyramidTargets[i].texture;
            gapDepthPushMaterial.uniforms.tCoarserLevel.value = pushPyramidTargets[i + 1].texture;
            renderer.setRenderTarget(pushPyramidTargets[i]);
            renderer.clear();
            renderer.render(postProcessScene, postProcessCamera);
        }
        
        // Create composite material if needed
        if (!debugSceneDepthCompositeMaterial) {
            debugSceneDepthCompositeMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    tSceneDepth: { value: null },
                    tGapDepth: { value: null },
                    tEdgeMask: { value: null },
                    u_maskUsesAlpha: { value: true }
                },
                vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }`,
                fragmentShader: `
                    uniform sampler2D tSceneDepth;
                    uniform sampler2D tGapDepth;
                    uniform sampler2D tEdgeMask;
                    uniform bool u_maskUsesAlpha;
                    varying vec2 vUv;
                    
                    void main() {
                        float maskValue = u_maskUsesAlpha ? (1.0 - texture2D(tEdgeMask, vUv).a) : texture2D(tEdgeMask, vUv).r;
                        bool isGapFromMask = maskValue > 0.5;
                        
                        // Also check if depth pass discarded this pixel (alpha=0)
                        vec4 sceneDepthSample = texture2D(tSceneDepth, vUv);
                        bool isGapFromDepth = sceneDepthSample.a < 0.5;
                        
                        bool isGap = isGapFromMask || isGapFromDepth;
                        
                        float depth;
                        if (isGap) {
                            // Use inpainted gap depth
                            vec4 gapData = texture2D(tGapDepth, vUv);
                            depth = gapData.r;
                        } else {
                            // Use scene depth
                            depth = sceneDepthSample.r;
                        }
                        
                        gl_FragColor = vec4(vec3(depth), 1.0);
                    }
                `,
                depthWrite: false,
                depthTest: false
            });
        }
        
        debugSceneDepthCompositeMaterial.uniforms.tSceneDepth.value = screenNormalizedDepthTarget.texture;
        debugSceneDepthCompositeMaterial.uniforms.tGapDepth.value = pushPyramidTargets[0].texture;
        debugSceneDepthCompositeMaterial.uniforms.tEdgeMask.value = finalEdgeMaskTexture;
        debugSceneDepthCompositeMaterial.uniforms.u_maskUsesAlpha.value = maskUsesAlpha;
        
        postProcessQuad.material = debugSceneDepthCompositeMaterial;
        
        renderer.setRenderTarget(pingPongRenderTargetA);
        renderer.setViewport(0, 0, pingPongRenderTargetA.width, pingPongRenderTargetA.height);
        renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);
        
        renderToScreen(pingPongRenderTargetA.texture);
        return;
    }
    
    // --- FINAL POST-PROCESSING (AA -> Sharpen -> Dither) ---
    
    if (!finalInpaintedTextureTarget?.texture || !finalEdgeMaskTexture || 
        !ditherCompositeMaterial || !copyMaterial || !fxaaMaterial || 
        !finalRenderPassTarget || !sharpenMaterial || !sharpenTarget) {
            
        console.error("Missing resources for final render passes (AA/Sharpen/Dither)!");
        renderToScreen(cleanColorTexture); // Fallback to clean scene
        return;
    }

    let sourceForSharpenPass;
    if (useAntiAliasing) {
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

    renderer.setRenderTarget(sharpenTarget);
    renderer.clear();
    renderer.setViewport(0, 0, sharpenTarget.width, sharpenTarget.height);
    postProcessQuad.material = sharpenMaterial;
    sharpenMaterial.uniforms.tDiffuse.value = sourceForSharpenPass;
    renderer.render(postProcessScene, postProcessCamera);

    let textureForDither;
    if (ditherStrength > 0.01) {
        postProcessQuad.material = ditherCompositeMaterial;
        ditherCompositeMaterial.uniforms.tDiffuse.value = sharpenTarget.texture; // Read from Sharpen pass
        ditherCompositeMaterial.uniforms.tMask.value = finalEdgeMaskTexture;
        ditherCompositeMaterial.uniforms.u_maskUsesAlpha.value = maskUsesAlpha;
        ditherCompositeMaterial.uniforms.u_strength.value = ditherStrength;
        ditherCompositeMaterial.uniforms.u_resolution.value.set(renderer.domElement.width, renderer.domElement.height);
        
        renderer.setRenderTarget(finalRenderPassTarget); 
        renderer.clear();
        renderer.render(postProcessScene, postProcessCamera);
        textureForDither = finalRenderPassTarget.texture;

    } else {
        textureForDither = sharpenTarget.texture;
    }

    renderToScreen(textureForDither);
}
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
        'backgroundBiasRadiusSlider': { update: (v) => { if (sdGapDepthEstimatorMaterial?.uniforms?.u_searchRadius) sdGapDepthEstimatorMaterial.uniforms.u_searchRadius.value = v; }, precision: 0 },
        'bgDepthIterationsSlider': { update: (v) => {}, precision: 0 }, // Read directly in render loop
        'bgMaxBiasSlider': { update: (v) => { if (gapDepthPullMaterial?.uniforms?.u_maxBias) gapDepthPullMaterial.uniforms.u_maxBias.value = v; }, precision: 2 },
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
            if (isSweeping) return; 

            // Toggle state
            isAccumulatingGaps = !isAccumulatingGaps;
            
            if (isAccumulatingGaps) {
                // STARTING: Reset previous data first!
                resetAccumulation(); 
                
                isAccumulatingGaps = true; // Set again as reset() clears it
                useStaticInfillAtlas = false; 

                manualAccumulationButton.textContent = 'Stop and Bake';
                manualAccumulationButton.style.backgroundColor = '#dc3545'; 
            } else {
                // STOPPING: Bake results
                manualAccumulationButton.textContent = 'Baking...';
                manualAccumulationButton.disabled = true;
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

    // --- NEW: Bake Strategy Listeners ---
    const fillMethodSelect = document.getElementById('bakeFillMethodSelect');
    if (fillMethodSelect) {
        fillMethodSelect.addEventListener('change', (e) => {
            currentBakeFillMethod = e.target.value;
            console.log("Bake Fill Method changed to:", currentBakeFillMethod);
        });
    }

    const debugGeometryCheck = document.getElementById('debugAtlasGeometryCheck');
    if (debugGeometryCheck) {
        debugGeometryCheck.addEventListener('change', (e) => {
            debugAtlasGeometry = e.target.checked;
            // Immediate update if mesh exists
            if (infillAtlasMesh) {
                initializeInfillAtlasMesh(); 
            }
        });
    }

    // --- NEW: SD Pipeline Button Listeners ---
    const bakeSingleFrameBtn = document.getElementById('bakeSingleFrameButton');
    if (bakeSingleFrameBtn) {
        bakeSingleFrameBtn.addEventListener('click', snapshotAndFill);
    }
    
    const exportAtlasesBtn = document.getElementById('exportAtlasesButton');
    if (exportAtlasesBtn) {
        exportAtlasesBtn.addEventListener('click', exportSDPipelineData);
    }
    
    const importSDPatchBtn = document.getElementById('importSDPatchButton');
    if (importSDPatchBtn) {
        importSDPatchBtn.addEventListener('click', importSDInpaintedPatch);
    }
    
    const toggleSDPatchBtn = document.getElementById('toggleSDPatchButton');
    if (toggleSDPatchBtn) {
        toggleSDPatchBtn.addEventListener('click', toggleSDPatchVisibility);
    }

    // --- Hole Patch Button Listeners ---
    const resetHolePatchBtn = document.getElementById('resetHolePatchButton');
    if (resetHolePatchBtn) {
        resetHolePatchBtn.addEventListener('click', resetHolePatchAccumulation);
    }
    
    const holePatchQuickSweepBtn = document.getElementById('holePatchQuickSweepBtn');
    if (holePatchQuickSweepBtn) {
        holePatchQuickSweepBtn.addEventListener('click', runHolePatchQuickSweep);
    }
    
    const holePatchFullSweepBtn = document.getElementById('holePatchFullSweepBtn');
    if (holePatchFullSweepBtn) {
        holePatchFullSweepBtn.addEventListener('click', runHolePatchFullSweep);
    }
    
    const holePatchLiveSweepBtn = document.getElementById('holePatchLiveSweepBtn');
    if (holePatchLiveSweepBtn) {
        holePatchLiveSweepBtn.addEventListener('click', toggleHolePatchLiveSweep);
    }
    
    const stepHolePatchBtn = document.getElementById('stepHolePatchButton');
    if (stepHolePatchBtn) {
        stepHolePatchBtn.addEventListener('click', stepHoleAccumulation);
    }
    
    const bakeHolePatchBtn = document.getElementById('bakeHolePatchButton');
    if (bakeHolePatchBtn) {
        bakeHolePatchBtn.addEventListener('click', bakeHolePatch);
    }
    
    const toggleHolePatchBtn = document.getElementById('toggleHolePatchButton');
    if (toggleHolePatchBtn) {
        toggleHolePatchBtn.addEventListener('click', toggleHolePatchOnlyView);
    }
    
    const exportHolePatchBtn = document.getElementById('exportHolePatchButton');
    if (exportHolePatchBtn) {
        exportHolePatchBtn.addEventListener('click', exportHolePatchMaps);
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
    
    // Auto-load default images
    loadDefaultImages();

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
// ===================================================================å√