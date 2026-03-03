import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2a2a);

// Camera
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(800, 600, 800);
camera.lookAt(0, 0, 0);

// Renderer (alpha for transparency, preserveDrawingBuffer for export)
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.localClippingEnabled = true;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// Lighting
const ambientLight = new THREE.AmbientLight(0x404050, 0.4);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9);
directionalLight.position.set(400, 800, 400);
directionalLight.target.position.set(0, 0, 0);
scene.add(directionalLight);
scene.add(directionalLight.target);

directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 2048;
directionalLight.shadow.mapSize.height = 2048;
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 2000;
directionalLight.shadow.camera.left = -600;
directionalLight.shadow.camera.right = 600;
directionalLight.shadow.camera.top = 600;
directionalLight.shadow.camera.bottom = -600;
directionalLight.shadow.bias = -0.0001;

// Animation clock for frame-rate-independent timing
const clock = new THREE.Clock();

// OrbitControls
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// Hexagon cropping (clipping planes)
let hexagonEnabled = false;
let hexagonClippingPlanes = null;

function createHexagonClippingPlanes() {
  const r = halfSize; // 500 - fits within 1000x1000 grid
  // Pointy-top hexagon vertices in xz: 6 vertices
  const verts = [];
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2 - Math.PI / 6;
    verts.push(new THREE.Vector3(r * Math.cos(angle), 0, r * Math.sin(angle)));
  }
  const planes = [];
  for (let i = 0; i < 6; i++) {
    const v0 = verts[i];
    const v1 = verts[(i + 1) % 6];
    const edge = new THREE.Vector3().subVectors(v1, v0);
    const mid = new THREE.Vector3().addVectors(v0, v1).multiplyScalar(0.5);
    const inward = new THREE.Vector3(-edge.z, 0, edge.x).normalize();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(inward, mid);
    planes.push(plane);
  }
  return planes;
}

function applyHexagonClipping(obj, enabled) {
  if (!obj || !obj.material) return;
  const m = obj.material;
  m.clippingPlanes = enabled ? hexagonClippingPlanes : [];
  m.clipIntersection = false;
  m.clipShadows = false;
}

// Grid state
const gridSize = 1000;
const halfSize = gridSize / 2;
let gridLines = null;
let plane = null;

// Distortion: sine/cosine wave on 2D plane (Y displacement)
let distortionAmplitude = 250;
let distortionFrequency = 3;

// Animated display values (lerped toward targets)
let displayDistortionFactor = 0;
let displayDistortionAmplitude = 250;
let displayDistortionFrequency = 3;
const ANIMATION_SPEED = 0.08;

// Playback: smooth morphing of peaks/valleys over time
let distortionPlaybackActive = false;
let distortionPlaybackTime = 0;
// Speed in units per second (1.2 ≈ original 0.02/frame at 60fps)
const PLAYBACK_SPEED_MIN = 1.2;
const PLAYBACK_SPEED_MAX = 19.2;
let playbackSpeedMultiplier = 1; // 1 = min, 4 = max (quadruple)

function getDistortionHeight(x, z, amp = distortionAmplitude, freq = distortionFrequency) {
  const TAU = Math.PI * 2;
  const f = freq;
  const sx = x / gridSize;
  const sz = z / gridSize;
  const t = distortionPlaybackActive ? distortionPlaybackTime : 0;

  // Many wave components with uneven, irrational frequencies for organic variation
  const waves = [
    [1, 1, 0, 0, 0.35],
    [0.73, 1.17, 1.2, 0.7, 0.3],
    [1.41, 0.89, 2.1, 1.4, 0.25],
    [0.58, 1.31, 0.4, 2.8, 0.2],
    [1.23, 0.67, 1.9, 0.2, 0.18],
    [0.91, 1.09, 0.6, 1.7, 0.15],
    [1.62, 0.54, 2.5, 0.9, 0.12],
    [0.47, 1.43, 0.1, 2.3, 0.1],
  ];

  let combined = 0;
  let weightSum = 0;
  for (let i = 0; i < waves.length; i++) {
    const [fx, fz, px, pz, w] = waves[i];
    const phaseX = t * (0.1 + i * 0.03);
    const phaseZ = t * (0.08 + i * 0.02);
    const val = Math.sin(TAU * f * fx * sx + px + phaseX) * Math.sin(TAU * f * fz * sz + pz + phaseZ);
    combined += w * val;
    weightSum += w;
  }
  combined /= weightSum;

  // Strong amplitude modulation: peaks vary from 25% to 100%, valleys from 0% to 30%
  const modPhase = t * 0.04;
  const modSlow = 0.625 + 0.375 * Math.sin(TAU * 0.08 * sx + 0.5 + modPhase) * Math.sin(TAU * 0.11 * sz + 1.1 + modPhase * 0.7);
  const modMid = 0.8 + 0.2 * Math.sin(TAU * 0.23 * sx + 2.3 + modPhase * 1.2) * Math.cos(TAU * 0.19 * sz + 0.8 + modPhase * 0.9);
  const mod = modSlow * modMid;

  const h = amp * mod * 0.5 * (1 + combined);
  return Math.max(0, h);
}

// Create grid line geometry from divisions
function buildGridGeometry(divisions, getHeight = null) {
  const positions = [];
  const step = gridSize / divisions;

  // Vertical lines - sample along Z for smooth wave following
  for (let i = 0; i <= divisions; i++) {
    const x = -halfSize + i * step;
    const segments = Math.max(8, divisions);
    const zStep = gridSize / segments;
    for (let j = 0; j < segments; j++) {
      const z1 = -halfSize + j * zStep;
      const z2 = -halfSize + (j + 1) * zStep;
      const y1 = getHeight ? getHeight(x, z1) : 0.01;
      const y2 = getHeight ? getHeight(x, z2) : 0.01;
      positions.push(x, y1, z1, x, y2, z2);
    }
  }

  // Horizontal lines - sample along X for smooth wave following
  for (let i = 0; i <= divisions; i++) {
    const z = -halfSize + i * step;
    const segments = Math.max(8, divisions);
    const xStep = gridSize / segments;
    for (let j = 0; j < segments; j++) {
      const x1 = -halfSize + j * xStep;
      const x2 = -halfSize + (j + 1) * xStep;
      const y1 = getHeight ? getHeight(x1, z) : 0.01;
      const y2 = getHeight ? getHeight(x2, z) : 0.01;
      positions.push(x1, y1, z, x2, y2, z);
    }
  }

  return new Float32Array(positions);
}

// Create grid lines mesh
function createGridLines(divisions, lineWidth, color, transparent, distortionEnabled, dispAmp, dispFreq, dispFactor) {
  const amp = dispAmp ?? distortionAmplitude;
  const freq = dispFreq ?? distortionFrequency;
  const factor = dispFactor ?? 1;
  const getHeight = distortionEnabled ? (x, z) => (getDistortionHeight(x, z, amp, freq) * factor) + 0.5 : null;
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(buildGridGeometry(divisions, getHeight));

  const material = new LineMaterial({
    color: color,
    linewidth: lineWidth,
    worldUnits: false,
    transparent: transparent,
    opacity: transparent ? 0 : 1,
  });
  material.resolution.set(window.innerWidth, window.innerHeight);

  const lines = new LineSegments2(geometry, material);
  lines.position.set(0, 0, 0);
  lines.renderOrder = 1;
  lines.castShadow = true;
  lines.receiveShadow = true;
  return lines;
}

// Create fill plane (with optional distortion)
function createFillPlane(color, transparent, distortionEnabled, dispAmp, dispFreq, dispFactor) {
  const widthSegs = distortionEnabled ? Math.max(currentDivisions * 2, 16) : 1;
  const heightSegs = distortionEnabled ? Math.max(currentDivisions * 2, 16) : 1;
  const planeGeometry = new THREE.PlaneGeometry(gridSize, gridSize, widthSegs, heightSegs);
  planeGeometry.rotateX(-Math.PI / 2);

  if (distortionEnabled) {
    const amp = dispAmp ?? distortionAmplitude;
    const freq = dispFreq ?? distortionFrequency;
    const factor = dispFactor ?? 1;
    const pos = planeGeometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, Math.max(0, getDistortionHeight(x, z, amp, freq) * factor) - 0.5);
    }
    pos.needsUpdate = true;
    planeGeometry.computeVertexNormals();
  }

  const planeMaterial = new THREE.MeshLambertMaterial({
    color: color,
    side: THREE.DoubleSide,
    transparent: transparent,
    opacity: transparent ? 0 : 1,
    polygonOffset: true,
    polygonOffsetFactor: 4,
    polygonOffsetUnits: 4,
    clipping: true,
  });
  const mesh = new THREE.Mesh(planeGeometry, planeMaterial);
  mesh.position.set(0, distortionEnabled ? 0 : -0.5, 0);
  mesh.renderOrder = 0;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// Initial grid
let currentDivisions = 40;
let currentThickness = 1;
let currentLineColor = 0xffffff;
let currentFillColor = 0x2a2a2a;
let lineTransparent = false;
let fillTransparent = false;
let distortionEnabled = false;

plane = createFillPlane(currentFillColor, fillTransparent, false);
scene.add(plane);

gridLines = createGridLines(currentDivisions, currentThickness, currentLineColor, lineTransparent, false);
scene.add(gridLines);

// Parse hex color to Three.js color (0x...)
function hexToThreeColor(hex) {
  return parseInt(hex.slice(1), 16);
}

// Update grid when controls change (optionally with display values for animation)
function updateGrid(useDisplayValues = false) {
  if (gridLines) {
    scene.remove(gridLines);
    gridLines.geometry.dispose();
    gridLines.material.dispose();
  }

  const useSubdivided = distortionEnabled || displayDistortionFactor > 0;
  const amp = useDisplayValues ? displayDistortionAmplitude : distortionAmplitude;
  const freq = useDisplayValues ? displayDistortionFrequency : distortionFrequency;
  const factor = useDisplayValues ? displayDistortionFactor : (distortionEnabled ? 1 : 0);

  gridLines = createGridLines(
    currentDivisions,
    currentThickness,
    currentLineColor,
    lineTransparent,
    useSubdivided,
    amp,
    freq,
    factor
  );
  scene.add(gridLines);

  gridLines.material.resolution.set(window.innerWidth, window.innerHeight);
  applyHexagonClipping(gridLines, hexagonEnabled);
}

function updateFillPlane(useDisplayValues = false) {
  if (plane) {
    scene.remove(plane);
    plane.geometry.dispose();
    plane.material.dispose();
  }

  const useSubdivided = distortionEnabled || displayDistortionFactor > 0;
  const amp = useDisplayValues ? displayDistortionAmplitude : distortionAmplitude;
  const freq = useDisplayValues ? displayDistortionFrequency : distortionFrequency;
  const factor = useDisplayValues ? displayDistortionFactor : (distortionEnabled ? 1 : 0);

  plane = createFillPlane(currentFillColor, fillTransparent, useSubdivided, amp, freq, factor);
  scene.add(plane);
  applyHexagonClipping(plane, hexagonEnabled);
}

function isDistortionAnimating() {
  const factorDone = Math.abs(displayDistortionFactor - (distortionEnabled ? 1 : 0)) < 0.001;
  const ampDone = Math.abs(displayDistortionAmplitude - distortionAmplitude) < 0.5;
  const freqDone = Math.abs(displayDistortionFrequency - distortionFrequency) < 0.01;
  return !factorDone || !ampDone || !freqDone;
}

// Control panel UI
const controlPanel = document.getElementById('controlPanel');
const toggleBtn = document.getElementById('toggleBtn');

toggleBtn.addEventListener('click', () => {
  controlPanel.classList.toggle('collapsed');
});

// Grid Divisions
const divisionsSlider = document.getElementById('divisionsSlider');
const divisionsValue = document.getElementById('divisionsValue');

function clampDivisions(val) {
  return Math.min(50, Math.max(2, Math.round(Number(val))));
}

divisionsSlider.addEventListener('input', (e) => {
  const val = clampDivisions(e.target.value);
  currentDivisions = val;
  divisionsSlider.value = val;
  divisionsValue.value = val;
  updateGrid();
});

divisionsValue.addEventListener('input', (e) => {
  const val = clampDivisions(e.target.value);
  currentDivisions = val;
  divisionsSlider.value = val;
  divisionsValue.value = val;
  updateGrid();
});

divisionsValue.addEventListener('blur', () => {
  divisionsValue.value = currentDivisions;
});

// Grid Line Thickness
const thicknessSlider = document.getElementById('thicknessSlider');
const thicknessValue = document.getElementById('thicknessValue');

function clampThickness(val) {
  return Math.min(10, Math.max(1, Math.round(Number(val))));
}

thicknessSlider.addEventListener('input', (e) => {
  const val = clampThickness(e.target.value);
  currentThickness = val;
  thicknessSlider.value = val;
  thicknessValue.value = val;
  updateGrid();
});

thicknessValue.addEventListener('input', (e) => {
  const val = clampThickness(e.target.value);
  currentThickness = val;
  thicknessSlider.value = val;
  thicknessValue.value = val;
  updateGrid();
});

thicknessValue.addEventListener('blur', () => {
  thicknessValue.value = currentThickness;
});

// Color controls
const lineColorPicker = document.getElementById('lineColorPicker');
const fillColorPicker = document.getElementById('fillColorPicker');
const lineColorPreview = document.getElementById('lineColorPreview');
const fillColorPreview = document.getElementById('fillColorPreview');
const lineColorSwatch = document.getElementById('lineColorSwatch');
const fillColorSwatch = document.getElementById('fillColorSwatch');
const lineTransparentToggle = document.getElementById('lineTransparentToggle');
const fillTransparentToggle = document.getElementById('fillTransparentToggle');

function updateLineTransparentUI() {
  lineColorSwatch.classList.toggle('transparent', lineTransparent);
  lineColorPicker.disabled = lineTransparent;
  lineTransparentToggle.classList.toggle('is-active', !lineTransparent);
  lineTransparentToggle.setAttribute('aria-pressed', !lineTransparent);
}

function updateFillTransparentUI() {
  fillColorSwatch.classList.toggle('transparent', fillTransparent);
  fillColorPicker.disabled = fillTransparent;
  fillTransparentToggle.classList.toggle('is-active', !fillTransparent);
  fillTransparentToggle.setAttribute('aria-pressed', !fillTransparent);
}

lineColorPicker.addEventListener('input', (e) => {
  currentLineColor = hexToThreeColor(e.target.value);
  lineColorPreview.style.backgroundColor = e.target.value;
  lineTransparent = false;
  updateLineTransparentUI();
  updateGrid();
});

lineTransparentToggle.addEventListener('click', () => {
  lineTransparent = !lineTransparent;
  updateLineTransparentUI();
  updateGrid();
});
lineTransparentToggle.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    lineTransparent = !lineTransparent;
    updateLineTransparentUI();
    updateGrid();
  }
});

fillColorPicker.addEventListener('input', (e) => {
  currentFillColor = hexToThreeColor(e.target.value);
  fillColorPreview.style.backgroundColor = e.target.value;
  fillTransparent = false;
  updateFillTransparentUI();
  updateFillPlane();
});

fillTransparentToggle.addEventListener('click', () => {
  fillTransparent = !fillTransparent;
  updateFillTransparentUI();
  updateFillPlane();
});
fillTransparentToggle.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fillTransparent = !fillTransparent;
    updateFillTransparentUI();
    updateFillPlane();
  }
});

// Distortion amplitude slider
const amplitudeSlider = document.getElementById('amplitudeSlider');
const amplitudeValue = document.getElementById('amplitudeValue');

function clampAmplitude(val) {
  return Math.min(900, Math.max(10, Math.round(Number(val))));
}

amplitudeSlider.addEventListener('input', (e) => {
  const val = clampAmplitude(e.target.value);
  distortionAmplitude = val;
  amplitudeSlider.value = val;
  amplitudeValue.value = val;
});

amplitudeValue.addEventListener('input', (e) => {
  const val = clampAmplitude(e.target.value);
  distortionAmplitude = val;
  amplitudeSlider.value = val;
  amplitudeValue.value = val;
});

amplitudeValue.addEventListener('blur', () => {
  amplitudeValue.value = distortionAmplitude;
});

// Frequency slider
const frequencySlider = document.getElementById('frequencySlider');
const frequencyValue = document.getElementById('frequencyValue');

function clampFrequency(val) {
  return Math.min(5, Math.max(1, Math.round(Number(val))));
}

frequencySlider.addEventListener('input', (e) => {
  const val = clampFrequency(e.target.value);
  distortionFrequency = val;
  frequencySlider.value = val;
  frequencyValue.value = val;
});

frequencyValue.addEventListener('input', (e) => {
  const val = clampFrequency(e.target.value);
  distortionFrequency = val;
  frequencySlider.value = val;
  frequencyValue.value = val;
});

frequencyValue.addEventListener('blur', () => {
  frequencyValue.value = distortionFrequency;
});

// Hexagon toggle
const hexagonSwitch = document.getElementById('hexagonSwitch');

function toggleHexagon() {
  hexagonEnabled = !hexagonEnabled;
  hexagonSwitch.classList.toggle('is-active', hexagonEnabled);
  hexagonSwitch.setAttribute('aria-pressed', hexagonEnabled);
  if (hexagonEnabled && !hexagonClippingPlanes) {
    hexagonClippingPlanes = createHexagonClippingPlanes();
  }
  applyHexagonClipping(plane, hexagonEnabled);
  applyHexagonClipping(gridLines, hexagonEnabled);
}
hexagonSwitch.addEventListener('click', toggleHexagon);
hexagonSwitch.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    toggleHexagon();
  }
});

// Distortion toggle (switch only - no checkbox)
const distortionSwitch = document.getElementById('distortionSwitch');
const distortionSliders = document.getElementById('distortionSliders');
const playbackControls = document.getElementById('playbackControls');
const playbackBtnGroup = document.getElementById('playbackBtnGroup');

function toggleDistortion() {
  distortionEnabled = !distortionEnabled;
  distortionSwitch.classList.toggle('is-active', distortionEnabled);
  distortionSwitch.setAttribute('aria-pressed', distortionEnabled);
  distortionSliders.style.display = distortionEnabled ? 'block' : 'none';
  playbackControls.style.display = distortionEnabled ? 'block' : 'none';
  playbackBtnGroup.style.display = distortionEnabled ? 'block' : 'none';
  updateGrid(true);
  updateFillPlane(true);
}
distortionSwitch.addEventListener('click', toggleDistortion);
distortionSwitch.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    toggleDistortion();
  }
});

// Playback Speed slider
const playbackSpeedSlider = document.getElementById('playbackSpeedSlider');
const playbackSpeedValue = document.getElementById('playbackSpeedValue');

function clampPlaybackSpeed(val) {
  return Math.min(4, Math.max(1, Number(val)));
}

playbackSpeedSlider.addEventListener('input', (e) => {
  const val = clampPlaybackSpeed(e.target.value);
  playbackSpeedMultiplier = val;
  playbackSpeedSlider.value = val;
  playbackSpeedValue.value = val;
});

playbackSpeedValue.addEventListener('input', (e) => {
  const val = clampPlaybackSpeed(e.target.value);
  playbackSpeedMultiplier = val;
  playbackSpeedSlider.value = val;
  playbackSpeedValue.value = val;
});

playbackSpeedValue.addEventListener('blur', () => {
  playbackSpeedValue.value = playbackSpeedMultiplier;
});

// Play / Pause distortion morph animation
const playbackBtn = document.getElementById('playbackBtn');
const playIcon = document.getElementById('playIcon');
const pauseIcon = document.getElementById('pauseIcon');
const playbackBtnText = document.getElementById('playbackBtnText');

function togglePlayback() {
  distortionPlaybackActive = !distortionPlaybackActive;
  playIcon.style.display = distortionPlaybackActive ? 'none' : 'block';
  pauseIcon.style.display = distortionPlaybackActive ? 'block' : 'none';
  playbackBtnText.textContent = distortionPlaybackActive ? 'Pause' : 'Play';
  playbackBtn.setAttribute('aria-label', distortionPlaybackActive ? 'Pause' : 'Play');
}
playbackBtn.addEventListener('click', togglePlayback);

// Export - capture scene and trigger PNG download (transparent background)
const exportBtn = document.getElementById('exportBtn');
exportBtn.addEventListener('click', () => {
  const prevBackground = scene.background;
  scene.background = null;
  renderer.setClearColor(0x000000, 0);
  renderer.render(scene, camera);
  const canvas = renderer.domElement;
  const link = document.createElement('a');
  link.download = `grid-export-${Date.now()}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
  scene.background = prevBackground;
  renderer.setClearColor(0x2a2a2a, 1);
});

// Resize handler - update LineMaterial resolution
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);

  if (gridLines && gridLines.material.resolution) {
    gridLines.material.resolution.set(window.innerWidth, window.innerHeight);
  }
});

// Animation loop
function lerp(a, b, t) {
  return a + (b - a) * t;
}

function animate() {
  requestAnimationFrame(animate);

  if (isDistortionAnimating()) {
    const targetFactor = distortionEnabled ? 1 : 0;
    displayDistortionFactor = lerp(displayDistortionFactor, targetFactor, ANIMATION_SPEED);
    displayDistortionAmplitude = lerp(displayDistortionAmplitude, distortionAmplitude, ANIMATION_SPEED);
    displayDistortionFrequency = lerp(displayDistortionFrequency, distortionFrequency, ANIMATION_SPEED);
    updateGrid(true);
    updateFillPlane(true);
  } else if (distortionPlaybackActive && (distortionEnabled || displayDistortionFactor > 0)) {
    const deltaTime = clock.getDelta();
    const speed = PLAYBACK_SPEED_MIN + (PLAYBACK_SPEED_MAX - PLAYBACK_SPEED_MIN) * (playbackSpeedMultiplier - 1) / 3;
    distortionPlaybackTime += speed * deltaTime;
    updateGrid(true);
    updateFillPlane(true);
  }

  controls.update();
  renderer.render(scene, camera);
}

animate();
