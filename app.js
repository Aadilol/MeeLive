import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { addMiiBust, createBodyMotion, findBodyRig } from './avatar-motion.js';
import { createMiiMouth, createPlacedMouth, findMiiMask, findMouthPlacement, loadMouthArt, pickMouth } from './mouth-motion.js';
import { maxAvatarBytes, validateGlb } from './glb.js';

const $ = (id) => document.getElementById(id);
const webcam = $('webcam');
const stage = $('stage');
const preview = $('preview-mount');
const fillWindowButton = $('fill-window');
const framingPicker = $('framing');
const headPicker = $('head-node');
const modelInput = $('model-input');
const calibrationMeter = $('calibration-meter');
const threeLibs = new URL('./vendor/three/examples/jsm/libs/', import.meta.url).href;
const visionPath = new URL('./vendor/vision/', import.meta.url).href;
const maxRecordingBytes = 128 * 1024 * 1024;
const maxRecordingTime = 5 * 60 * 1000;

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setClearAlpha(0);
preview.append(renderer.domElement);
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute('aria-label', '3D avatar');
renderer.domElement.setAttribute('role', 'img');

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0xbfb5bf, 2.1));
const key = new THREE.DirectionalLight(0xfff1df, 2.25);
key.position.set(3, 6, 5);
const fill = new THREE.DirectionalLight(0xdcecff, 1.25);
fill.position.set(-4, 2, -4);
scene.add(key, fill);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 25);
camera.position.set(0, 0, 5);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enablePan = false;
orbit.enableDamping = true;
orbit.minZoom = 0.45;
orbit.maxZoom = 3.5;
orbit.minPolarAngle = 0.12;
orbit.maxPolarAngle = Math.PI - 0.12;

const draco = new DRACOLoader(new THREE.LoadingManager()).setDecoderPath(`${threeLibs}draco/gltf/`);
const ktx = new KTX2Loader(new THREE.LoadingManager()).setTranscoderPath(`${threeLibs}basis/`).detectSupport(renderer);
const modelResources = new THREE.LoadingManager().setURLModifier((url) => {
  if (/^(?:blob|data):/.test(url)) return url;
  throw new Error('Export the avatar with all buffers and textures embedded.');
});
const loader = new GLTFLoader(modelResources).setDRACOLoader(draco).setKTX2Loader(ktx).setMeshoptDecoder(MeshoptDecoder);

const yAxis = new THREE.Vector3(0, 1, 0);
const parentRotation = new THREE.Quaternion();
const viewRotation = new THREE.Quaternion();
const inverseViewRotation = new THREE.Quaternion();
const restHeadWorld = new THREE.Quaternion();
const targetRotation = new THREE.Quaternion();
const headMotion = new THREE.Quaternion();
const frameCenter = new THREE.Vector3();
const frameHalfSize = new THREE.Vector3(1, 1.15, 1);
const viewAxes = new THREE.Matrix4();
const bustClip = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let viewAspect = 1;
let resizeTimer;
let avatarView = false;
let facing = 0;
let renderNeeded = true;
let avatar = null;
let nodes = [];
let head = null;
let modelRequest = 0;
let loadingModel = false;
let forgettingAvatar = false;

let stream = null;
let startingCamera = false;
let cameraRequest = 0;
let tracker = null;
let trackerPromise = null;
let trackerDelegate = null;
let CPUOnly = false;
let videoFrameId = null;
let lastVideoTime = -1;
let lastDetectionAt = -Infinity;
let lastFaceAt = -Infinity;
let faceVisible = false;
let calibration = null;
let neutralInverse = null;
let poseTracker = null;
let posePromise = null;
let poseDelegate = null;
let poseCPUOnly = false;
let lastPoseAt = -Infinity;
let placingMouth = false;
let mouthPreviewTimer;

let recording = null;
let clipURL = null;
let databasePromise;
let saves = Promise.resolve();

function modelStatus(message, error = false) {
  const element = $('model-status');
  element.textContent = message;
  element.hidden = !message;
  element.classList.toggle('error', error);
}

function trackingStatus(label, message, state = 'off') {
  const indicator = $('camera-status');
  const text = $('camera-status-text');
  const status = $('tracking-status');
  if (indicator.dataset.state !== state) indicator.dataset.state = state;
  if (text.textContent !== label) text.textContent = label;
  if (status.textContent !== message) status.textContent = message;
  status.classList.toggle('error', state === 'error');
}

function syncControls() {
  const usingCamera = Boolean(startingCamera || stream);
  $('tracking-toggle').disabled = !usingCamera && (!head || loadingModel || placingMouth);
  $('tracking-label').textContent = startingCamera ? 'Cancel' : stream ? 'Stop tracking' : 'Start tracking';
  $('calibrate').hidden = !stream || startingCamera;
  $('calibrate').disabled = !head || loadingModel || Boolean(calibration);
  $('record').disabled = recording ? recording.stopping : !(stream && neutralInverse && !calibration && !loadingModel);
  $('record-label').textContent = recording ? (recording.stopping ? 'Saving clip…' : 'Stop recording') : 'Start recording';
  headPicker.disabled = !avatar || loadingModel;
  orbit.enabled = Boolean(avatar && !avatarView && !usingCamera && !placingMouth);
  renderer.domElement.classList.toggle('is-orbitable', orbit.enabled);
  renderer.domElement.classList.toggle('is-placing-mouth', placingMouth);
  $('set-front').disabled = !orbit.enabled || loadingModel;
  $('reset-view').disabled = !avatar;
  framingPicker.disabled = !avatar || loadingModel || placingMouth;
  fillWindowButton.disabled = !avatar || loadingModel || placingMouth;
  $('body-option').hidden = !avatar?.body;
  $('body-enabled').checked = Boolean(avatar?.bodyEnabled);
  $('body-enabled').disabled = loadingModel || !head;
  $('mouth-setup').hidden = !head;
  $('place-mouth').disabled = usingCamera || loadingModel;
  $('place-mouth').textContent = placingMouth ? 'Cancel placement' : activeMouth() ? 'Move mouth' : 'Place mouth';
  $('clear-mouth').hidden = !avatar?.placedMouth || placingMouth;
  $('mouth-size-row').hidden = !avatar?.placedMouth || placingMouth;
  $('clear-mouth').disabled = usingCamera || loadingModel;
  $('mouth-size').disabled = usingCamera || loadingModel;
  $('forget-avatar').hidden = !avatar?.remember;
  $('forget-avatar').disabled = loadingModel || forgettingAvatar;
}

function activeMouth() { return avatar?.placedMouth || avatar?.mouth || avatar?.anchoredMouth; }

function mouthStatus() {
  $('mouth-status').textContent = placingMouth ? 'Click the model’s mouth in the preview.'
    : avatar?.placedMouth ? 'Mouth placement saved.'
      : activeMouth() ? 'Mouth detected automatically.' : 'No mouth detected. Place it in the preview.';
}

function restoreMouthPlacement() {
  avatar.placedMouth?.dispose();
  avatar.placedMouth = null;
  avatar.anchoredMouth?.dispose();
  avatar.anchoredMouth = null;
  const automatic = head && !avatar.mouth && avatar.mouthArt
    ? findMouthPlacement(head.node, avatar.group, facing, avatar.bounds.max.y - avatar.bounds.min.y, !avatar.hasMiiMask)
    : null;
  avatar.mouth?.reset();
  if (head && avatar.placement?.headPath === head.path && avatar.mouthArt) {
    avatar.mouth?.showIdle(true);
    const neutral = avatar.mouth?.hasNeutral || automatic?.neutral;
    avatar.placedMouth = createPlacedMouth(head.node, { ...avatar.placement, neutral }, avatar.mouthArt);
    $('mouth-size').value = avatar.placement.scale;
  } else if (automatic) {
    avatar.anchoredMouth = createPlacedMouth(head.node, automatic, avatar.mouthArt);
  }
  mouthStatus();
}

function previewPlacedMouth() {
  clearTimeout(mouthPreviewTimer);
  const mouth = avatar?.placedMouth;
  if (!mouth || stream || startingCamera) return;
  mouth.preview();
  renderNeeded = true;
  mouthPreviewTimer = setTimeout(() => {
    if (mouth === avatar?.placedMouth && !stream && mouth.reset()) renderNeeded = true;
  }, 1000);
}

function fitFrustum() {
  viewAxes.makeRotationFromQuaternion(camera.quaternion);
  const axes = viewAxes.elements;
  const { x, y, z } = frameHalfSize;
  // Project the framing box onto the camera's right and up axes, even when orbited.
  let horizontal = Math.abs(axes[0]) * x + Math.abs(axes[1]) * y + Math.abs(axes[2]) * z;
  let vertical = Math.abs(axes[4]) * x + Math.abs(axes[5]) * y + Math.abs(axes[6]) * z;
  let centerX = 0;
  let centerY = 0;
  let padding = 1.12;
  if (framingPicker.value === 'full' && avatar?.fullFrame.parts.length) {
    // Fit the individual visible parts before taking their combined screen-space extent.
    // The center of the combined world-space box can be off-center from an angled view.
    const [left, right] = projectBodyParts(axes, 0);
    const [bottom, top] = projectBodyParts(axes, 4);
    horizontal = (right - left) / 2;
    vertical = (top - bottom) / 2;
    centerX = (right + left) / 2;
    centerY = (top + bottom) / 2;
    padding = 1.07;
  }
  const halfHeight = Math.max(vertical, horizontal / viewAspect, 0.005) * padding;
  const halfWidth = halfHeight * viewAspect;
  camera.top = centerY + halfHeight;
  camera.bottom = centerY - halfHeight;
  camera.right = centerX + halfWidth;
  camera.left = centerX - halfWidth;
  camera.updateProjectionMatrix();
}

function projectBodyParts(axes, offset) {
  const x = axes[offset];
  const y = axes[offset + 1];
  const z = axes[offset + 2];
  let min = Infinity;
  let max = -Infinity;
  for (const { center, half } of avatar.fullFrame.parts) {
    const position = (center.x - frameCenter.x) * x + (center.y - frameCenter.y) * y + (center.z - frameCenter.z) * z;
    const radius = half.x * Math.abs(x) + half.y * Math.abs(y) + half.z * Math.abs(z);
    min = Math.min(min, position - radius);
    max = Math.max(max, position + radius);
  }
  return [min, max];
}

function resizeCanvas() {
  clearTimeout(resizeTimer);
  if (!avatarView) {
    const top = stage.getBoundingClientRect().top + window.scrollY;
    const room = Math.max(1, window.innerHeight - top - 8);
    stage.style.setProperty('--stage-room', `${room}px`);
  }
  const width = preview.clientWidth;
  const height = preview.clientHeight;
  if (!width || !height) return;
  viewAspect = width / height;
  camera.zoom = 1;
  fitFrustum();
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  if (renderer.getPixelRatio() !== pixelRatio) renderer.setPixelRatio(pixelRatio);
  renderer.setSize(width, height, false);
  renderNeeded = true;
}

function scheduleResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(resizeCanvas, 90);
}

function resetView() {
  orbit.enableDamping = false;
  orbit.update();
  orbit.target.copy(frameCenter);
  const distance = Math.max(5, frameHalfSize.length() * 2);
  camera.position.copy(frameCenter).add(new THREE.Vector3(Math.sin(facing) * distance, 0, Math.cos(facing) * distance));
  camera.far = distance * 3;
  camera.zoom = 1;
  orbit.update();
  orbit.enableDamping = true;
  resizeCanvas();
}

function setAvatarView(enabled) {
  avatarView = enabled;
  document.body.classList.toggle('avatar-view', avatarView);
  syncControls();
  resizeCanvas();
  (avatarView ? renderer.domElement : fillWindowButton).focus({ preventScroll: true });
}

function visitMeshBounds(object, skipFaceOverlays, visit) {
  // Refresh the skin bind transforms after scaling or moving the model into the preview scene.
  object.updateWorldMatrix(true, false);
  object.updateMatrixWorld(true);
  const part = new THREE.Box3();
  object.traverseVisible((child) => {
    if (!child.isMesh) return;
    if (skipFaceOverlays && (child.userData.mouthOverlay || child.userData.modulateType === 6 ||
        (child.material?.transparent && /^mask(?:_\d+)?$/i.test(child.name)))) return;
    if (child.isSkinnedMesh || child.isInstancedMesh) {
      child.computeBoundingBox();
      part.copy(child.boundingBox);
    } else {
      if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
      part.copy(child.geometry.boundingBox);
    }
    if (!part.isEmpty()) visit(part.applyMatrix4(child.matrixWorld));
  });
}

function boundsOf(object, bottom = -Infinity, skipFaceOverlays = false) {
  const bounds = new THREE.Box3();
  visitMeshBounds(object, skipFaceOverlays, (part) => {
    part.min.y = Math.max(part.min.y, bottom);
    if (!part.isEmpty()) bounds.union(part);
  });
  return bounds;
}

function fullBodyFrame(group, fallback) {
  const bounds = new THREE.Box3();
  const parts = [];
  visitMeshBounds(group, true, (part) => {
    bounds.union(part);
    parts.push({ center: part.getCenter(new THREE.Vector3()), half: part.getSize(new THREE.Vector3()).multiplyScalar(0.5) });
  });
  return { bounds: parts.length ? bounds : fallback, parts };
}

function bustBounds() {
  const whole = avatar.bounds;
  const height = whole.max.y - whole.min.y;
  if (height <= 0) return whole;
  const face = avatar.bust?.bounds ?? (head ? boundsOf(head.node, -Infinity, true) : new THREE.Box3());
  const faceHeight = face.max.y - face.min.y;
  const headIsLocal = !face.isEmpty() && face.min.y > whole.min.y + height * 0.45;
  const shoulderNodes = avatar.shoulderNodes.length ? avatar.shoulderNodes : nodes
    .filter(({ name }) => /shoulder|clavicle|collar/i.test(name)).map(({ node }) => node);
  const shoulderLevels = shoulderNodes.map((node) => {
    const part = node.isMesh ? boundsOf(node) : null;
    return part && !part.isEmpty() ? (part.min.y + part.max.y) / 2 : node.getWorldPosition(new THREE.Vector3()).y;
  }).filter((level) => level > whole.min.y + height * 0.45 && level < whole.max.y);
  const hasBodyParts = avatar.body || nodes.some(({ name }) => /torso|chest|spine|hips|pelvis|arm(?!ature)|leg|foot/i.test(name));
  const width = Math.max(whole.max.x - whole.min.x, whole.max.z - whole.min.z);
  if (!shoulderLevels.length && !hasBodyParts && faceHeight >= height * 0.85 && height <= width * 1.45) return whole;

  // Keep a small band of shoulder below the joint line, without retaining the chest.
  const padding = headIsLocal ? faceHeight * 0.09 : height * 0.025;
  const shoulderCut = shoulderLevels.length ? Math.min(...shoulderLevels) - padding
    : headIsLocal ? face.min.y - faceHeight * 0.23 : whole.max.y - height * 0.30;
  const bottom = headIsLocal || avatar.bust ? Math.min(shoulderCut, face.min.y - padding) : shoulderCut;
  const bounds = boundsOf(avatar.group, bottom, true);
  if (bounds.isEmpty()) return whole;
  if (avatar.bust) {
    // Its face mask contains a larger transparent mesh. Use the visible head as the top edge.
    bounds.max.y = face.max.y;
  }
  return bounds;
}

function frameAvatar() {
  if (!avatar) return;
  const fullBody = framingPicker.value === 'full';
  const bounds = fullBody ? avatar.fullFrame.bounds : avatar.bustBounds;
  const crop = !fullBody && bounds.min.y > avatar.bounds.min.y;
  bustClip.constant = -bounds.min.y;
  renderer.clippingPlanes = crop ? [bustClip] : [];
  bounds.getCenter(frameCenter);
  bounds.getSize(frameHalfSize).multiplyScalar(0.5);
  resetView();
}

function headParentRotation() {
  // Compose the parent orientation from quaternions to keep scale out of the basis.
  parentRotation.identity();
  for (let node = head.node.parent; node; node = node.parent) parentRotation.premultiply(node.quaternion);
  return parentRotation;
}

function setHead(path) {
  if (head) head.node.quaternion.copy(head.rest);
  head = nodes.find((entry) => entry.path === path) || null;
  headPicker.value = head?.path || '';
  headPicker.title = head?.label || '';
  if (head) head.rest.copy(head.node.quaternion);
  targetRotation.identity();
  if (head) {
    targetRotation.copy(head.rest);
    restHeadWorld.copy(headParentRotation()).multiply(head.rest);
  }
  restoreMouthPlacement();
  avatar.bustBounds = bustBounds();
  frameAvatar();
  syncControls();
}

function collectNodes(root) {
  const entries = [];
  function visit(node, path, parentLabel) {
    const name = node.userData.name || node.name || '';
    const label = `${parentLabel}${name || 'Unnamed node'}`;
    entries.push({ node, name, label, path, rest: node.quaternion.clone() });
    node.children.forEach((child, index) => visit(child, `${path}.${index}`, `${label} / `));
  }
  root.children.forEach((node, index) => visit(node, String(index), ''));
  return entries;
}

function disposeModel(roots) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const images = new Set();
  const skeletons = new Set();
  for (const root of roots) {
    root.traverse((node) => {
      if (!node.isMesh) return;
      geometries.add(node.geometry);
      if (node.skeleton) skeletons.add(node.skeleton);
      for (const material of [].concat(node.material)) {
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value?.isTexture) {
            textures.add(value);
            if (typeof value.image?.close === 'function') images.add(value.image);
          }
        }
      }
    });
  }
  for (const resource of [...geometries, ...materials, ...textures, ...skeletons]) resource.dispose();
  for (const image of images) image.close();
}

async function loadModel(file, saved = null) {
  if (!file || !/\.glb$/i.test(file.name)) {
    modelStatus('Choose a .glb file to load an avatar.', true);
    return false;
  }
  if (file.size > maxAvatarBytes) {
    modelStatus('Choose a GLB of 64 MB or less.', true);
    return false;
  }
  const request = ++modelRequest;
  placingMouth = false;
  loadingModel = true;
  modelStatus(`Loading ${file.name}…`);
  syncControls();
  let gltf;
  let mouth;
  try {
    const bytes = await file.arrayBuffer();
    if (request !== modelRequest) return false;
    validateGlb(bytes);
    gltf = await loader.parseAsync(bytes, '');
    const root = gltf.scene || gltf.scenes[0];
    if (!root) throw new Error('The file contains no visible mesh.');
    const raw = boundsOf(root);
    if (raw.isEmpty()) throw new Error('The main scene contains no visible mesh.');
    const extent = raw.getSize(new THREE.Vector3());
    const size = extent.y || Math.max(extent.x, extent.z);
    if (!Number.isFinite(size) || size <= 0) throw new Error('The model has no usable bounds.');

    const mask = findMiiMask(root);
    let mouthArt;
    try {
      mouthArt = await loadMouthArt();
      if (mask) mouth = createMiiMouth(mask, mouthArt);
    } catch (error) { console.warn('Could not prepare mouth textures.', error); }

    if (request !== modelRequest) {
      mouth?.dispose();
      disposeModel(gltf.scenes);
      return false;
    }
    stopCamera();
    if (avatar) {
      scene.remove(avatar.group);
      avatar.mouth?.dispose();
      avatar.placedMouth?.dispose();
      avatar.anchoredMouth?.dispose();
      disposeModel([avatar.group, ...avatar.scenes]);
    }
    const group = new THREE.Group();
    group.scale.setScalar(2 / size);
    group.position.copy(raw.getCenter(new THREE.Vector3())).multiplyScalar(-group.scale.x);
    group.add(root);
    scene.add(group);
    const bust = addMiiBust(group, root, mask);
    const rig = bust || findBodyRig(root);
    const body = rig && createBodyMotion(rig);
    const bounds = boundsOf(group);
    avatar = {
      file, group, bounds, fullFrame: fullBodyFrame(group, bounds), scenes: gltf.scenes, bust, mouth, mouthArt,
      hasMiiMask: Boolean(mask),
      remember: true,
      shoulderNodes: [rig?.left[0]?.node, rig?.right[0]?.node].filter(Boolean),
      body, bodyEnabled: Boolean(body && saved?.bodyEnabled !== false), placement: saved?.placement || null,
    };
    nodes = collectNodes(root);
    facing = Number.isFinite(saved?.facing) ? saved.facing : 0;
    framingPicker.value = saved?.framing === 'full' ? 'full' : 'bust';
    const automatic = nodes.find(({ name }) => /^head$/i.test(name)) || nodes.find(({ name }) => /^miihead$/i.test(name));
    const remembered = nodes.find(({ path }) => path === saved?.path);
    const selected = remembered || (saved?.path !== '' ? automatic : null);
    head = null;
    headPicker.replaceChildren(new Option('Choose a node', ''), ...nodes.map(({ label, path }) => new Option(label, path)));
    setHead(selected?.path || '');
    $('stage-empty').hidden = true;
    $('drop-title').textContent = file.name;
    $('drop-title').title = file.name;
    $('drop-caption').textContent = 'Choose or drop to replace';
    $('body-status').textContent = '';
    modelStatus(remembered ? 'Saved head node restored.' : selected ? 'Head node detected.' : 'Choose the head node.');
    if (!saved) saveAvatar();
    return true;
  } catch (error) {
    if (gltf && gltf.scenes !== avatar?.scenes) {
      mouth?.dispose();
      disposeModel(gltf.scenes);
    }
    if (request === modelRequest) modelStatus(`Could not load ${file.name}. ${error.message}`, true);
    return false;
  } finally {
    if (request === modelRequest) {
      loadingModel = false;
      syncControls();
    }
  }
}

function openDatabase() {
  databasePromise ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('meelive', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('session');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((error) => {
    databasePromise = null;
    throw error;
  });
  return databasePromise;
}

async function readAvatar() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction('session').objectStore('session').get('avatar');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function writeAvatar(mutate) {
  const write = saves.then(async () => {
    const database = await openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('session', 'readwrite');
      mutate(transaction.objectStore('session'));
      transaction.oncomplete = resolve;
      transaction.onabort = () => reject(transaction.error);
    });
  });
  saves = write.catch(() => {});
  return write;
}

function saveAvatar() {
  if (!avatar.remember) return;
  const saved = { file: avatar.file, path: head?.path || '', facing, bodyEnabled: avatar.bodyEnabled,
    placement: avatar.placement, framing: framingPicker.value };
  void writeAvatar((store) => store.put(saved, 'avatar')).catch(() => {
    if (avatar?.file === saved.file && !loadingModel) modelStatus('The model is ready for this page. Local storage is unavailable.');
  });
}

async function createTracker() {
  const { FaceLandmarker, FilesetResolver } = await import(`${visionPath}vision_bundle.mjs`);
  const runtime = await FilesetResolver.forVisionTasks(`${visionPath}wasm`);
  const modelAssetPath = `${visionPath}models/face_landmarker.task`;
  const create = (delegate) => FaceLandmarker.createFromOptions(runtime, {
    baseOptions: { modelAssetPath, delegate },
    // The Web API uses VIDEO and detectForVideo for a live camera.
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFacialTransformationMatrixes: true,
    outputFaceBlendshapes: true,
  });
  if (!CPUOnly) {
    try {
      const instance = await create('GPU');
      trackerDelegate = 'GPU';
      return instance;
    } catch (error) {
      console.info('MediaPipe GPU unavailable. Trying CPU.', error);
    }
  }
  const instance = await create('CPU');
  trackerDelegate = 'CPU';
  return instance;
}

function getTracker() {
  trackerPromise ||= createTracker().catch((error) => {
    trackerPromise = null;
    throw error;
  });
  return trackerPromise;
}

async function prepareBodyTracking() {
  if (!avatar?.bodyEnabled || !stream || poseTracker) return;
  const model = avatar;
  const request = cameraRequest;
  $('body-status').textContent = 'Loading body tracker…';
  posePromise ||= (async () => {
    const { PoseLandmarker, FilesetResolver } = await import(`${visionPath}vision_bundle.mjs`);
    const runtime = await FilesetResolver.forVisionTasks(`${visionPath}wasm`);
    const create = (delegate) => PoseLandmarker.createFromOptions(runtime, {
      baseOptions: {
        delegate,
        modelAssetPath: `${visionPath}models/pose_landmarker_lite.task`,
      },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
    if (!poseCPUOnly) {
      try {
        poseTracker = await create('GPU');
        poseDelegate = 'GPU';
        return;
      } catch (error) { console.info('Body tracker GPU unavailable. Trying CPU.', error); }
    }
    poseTracker = await create('CPU');
    poseDelegate = 'CPU';
  })().finally(() => { posePromise = null; });
  try {
    await posePromise;
    if (avatar === model && cameraRequest === request && model.bodyEnabled) $('body-status').textContent = 'Keep shoulders and elbows in view.';
  } catch (error) {
    console.warn('Could not start body tracking.', error);
    if (avatar === model && cameraRequest === request && model.bodyEnabled) $('body-status').textContent = 'Body tracker unavailable. Toggle to retry.';
  }
}

function cameraMessage(error) {
  switch (error.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Allow camera access in your browser and retry.';
    case 'NotFoundError':
      return 'Connect a webcam and retry.';
    case 'NotReadableError':
    case 'AbortError':
      return 'Close other apps using the camera and retry.';
    default:
      return error.message;
  }
}

async function startCamera() {
  if (startingCamera || stream || !head || loadingModel) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    trackingStatus('Camera unavailable', 'Open MeeLive over HTTPS or from a localhost server to use the webcam.', 'error');
    return;
  }
  const request = ++cameraRequest;
  clearTimeout(mouthPreviewTimer);
  activeMouth()?.reset();
  startingCamera = true;
  trackingStatus('Starting camera', 'Allow camera access when prompted.', 'pending');
  resetView();
  syncControls();
  try {
    const cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 }, facingMode: 'user' },
    });
    if (request !== cameraRequest) {
      cameraStream.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = cameraStream;
    for (const track of stream.getVideoTracks()) {
      track.addEventListener('ended', () => {
        if (stream !== cameraStream) return;
        stopCamera();
        trackingStatus('Camera disconnected', 'Reconnect the camera and start tracking again.', 'error');
      }, { once: true });
    }
    webcam.srcObject = stream;
    await webcam.play();
    if (request !== cameraRequest) return;
    webcam.hidden = false;
    trackingStatus('Loading tracker', 'Preparing face tracking…', 'pending');
    const instance = await getTracker();
    if (request !== cameraRequest) return;
    tracker = instance;
    startingCamera = false;
    lastVideoTime = -1;
    lastDetectionAt = -Infinity;
    lastPoseAt = -Infinity;
    beginCalibration();
    if (avatar?.bodyEnabled) {
      if (poseTracker) $('body-status').textContent = 'Keep shoulders and elbows in view.';
      else void prepareBodyTracking();
    }
    if ('requestVideoFrameCallback' in webcam) videoFrameId = webcam.requestVideoFrameCallback(onVideoFrame);
  } catch (error) {
    if (request !== cameraRequest) return;
    console.error(error);
    const message = stream && !tracker ? 'Face tracking could not initialize. Reload the page and try again.' : cameraMessage(error);
    stopCamera();
    trackingStatus('Camera unavailable', message, 'error');
  }
}

function stopCamera() {
  cameraRequest++;
  startingCamera = false;
  if (videoFrameId !== null) webcam.cancelVideoFrameCallback(videoFrameId);
  videoFrameId = null;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  webcam.srcObject = null;
  webcam.hidden = true;
  calibration = null;
  neutralInverse = null;
  faceVisible = false;
  avatar?.body?.reset();
  activeMouth()?.reset();
  $('body-status').textContent = '';
  calibrationMeter.hidden = true;
  endRecording();
  if (head) {
    head.node.quaternion.copy(head.rest);
    targetRotation.copy(head.rest);
  }
  renderNeeded = true;
  trackingStatus('Camera off', 'Look straight ahead to calibrate.');
  syncControls();
}

function beginCalibration() {
  calibration = { start: 0, count: 0, anchor: new THREE.Quaternion(), average: new THREE.Quaternion() };
  neutralInverse = null;
  avatar?.body?.reset();
  activeMouth()?.reset();
  renderNeeded = true;
  if (head) targetRotation.copy(head.rest);
  calibrationMeter.hidden = false;
  setCalibrationProgress(0);
  trackingStatus('Calibrating', 'Look straight ahead and relax your mouth.', 'pending');
  syncControls();
}

function setCalibrationProgress(progress) {
  calibrationMeter.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
  calibrationMeter.firstElementChild.style.transform = `scaleX(${progress})`;
}

function calibratePose(pose, now) {
  if (!calibration.count || calibration.anchor.angleTo(pose) > 0.15) {
    calibration.start = now;
    calibration.count = 0;
    calibration.anchor.copy(pose);
    calibration.average.copy(pose);
  }
  calibration.count++;
  calibration.average.slerp(pose, 1 / calibration.count);
  const progress = Math.min((now - calibration.start) / 800, calibration.count / 10, 1);
  setCalibrationProgress(progress);
  if (progress === 1) {
    neutralInverse = calibration.average.clone().invert();
    calibration = null;
    calibrationMeter.hidden = true;
    trackingStatus('Tracking live', 'Neutral pose set. Recalibrate if you move.', 'active');
    syncControls();
  }
}

const poseMatrix = new THREE.Matrix4();
const pose = new THREE.Quaternion();
const delta = new THREE.Quaternion();
const discardedPosition = new THREE.Vector3();
const discardedScale = new THREE.Vector3();

function mirrorRotation(rotation) {
  // Reflect across the screen's vertical axis: pitch stays, yaw and roll flip.
  return rotation.set(rotation.x, -rotation.y, -rotation.z, rotation.w);
}

function applyFaceMatrix(data, now) {
  // MediaPipe and Three.js both store these transforms in column-major order.
  poseMatrix.fromArray(data).decompose(discardedPosition, pose, discardedScale);
  pose.normalize();
  lastFaceAt = now;
  if (!faceVisible) {
    faceVisible = true;
    if (neutralInverse) trackingStatus('Tracking live', 'Neutral pose set. Recalibrate if you move.', 'active');
  }
  if (calibration) {
    if (!calibration.count) trackingStatus('Calibrating', 'Look straight ahead and relax your mouth.', 'pending');
    calibratePose(pose, now);
  }
  if (neutralInverse && head) {
    delta.copy(pose).multiply(neutralInverse);
    headMotion.copy(mirrorRotation(delta));
  }
}

function detectFrame() {
  if (!stream || startingCamera || !tracker || webcam.readyState < 2 || webcam.currentTime === lastVideoTime) return;
  const now = performance.now();
  if (now - lastDetectionAt < 25) return;
  lastDetectionAt = now;
  lastVideoTime = webcam.currentTime;
  try {
    const result = tracker.detectForVideo(webcam, now);
    const matrix = result.facialTransformationMatrixes[0];
    if (matrix?.data.length === 16) {
      const mouthCalibration = calibration;
      applyFaceMatrix(matrix.data, now);
      const mouth = activeMouth();
      if (mouth) {
        const scores = result.faceBlendshapes?.[0]?.categories;
        const landmarks = result.faceLandmarks?.[0];
        const aspect = webcam.videoWidth / webcam.videoHeight;
        if (mouthCalibration) mouth.calibrate(scores, landmarks, aspect, mouthCalibration.count);
        else if (neutralInverse && mouth.update(scores, landmarks, aspect)) renderNeeded = true;
      }
    } else if (calibration) {
      calibration.count = 0;
      setCalibrationProgress(0);
      trackingStatus('Looking for face', 'Center your face in the camera to calibrate.', 'pending');
    }
  } catch (error) {
    console.error(error);
    if (trackerDelegate === 'GPU') {
      CPUOnly = true;
      tracker.close();
      tracker = trackerPromise = null;
      stopCamera();
      void startCamera();
    } else {
      stopCamera();
      trackingStatus('Tracking interrupted', 'Face tracking stopped. Start tracking again to retry.', 'error');
    }
    return;
  }
  if (avatar?.bodyEnabled && poseTracker && now - lastPoseAt >= 70) {
    lastPoseAt = now;
    try {
      avatar.body.capture(poseTracker.detectForVideo(webcam, now), now, !neutralInverse);
    } catch (error) {
      console.warn('Body tracking interrupted.', error);
      poseTracker.close();
      poseTracker = null;
      if (poseDelegate === 'GPU') {
        poseCPUOnly = true;
        void prepareBodyTracking();
      } else $('body-status').textContent = 'Body tracker unavailable. Toggle to retry.';
    }
  }
}

function onVideoFrame() {
  videoFrameId = null;
  detectFrame();
  if (stream && !startingCamera) videoFrameId = webcam.requestVideoFrameCallback(onVideoFrame);
}

function animate(now) {
  const elapsed = Math.min(100, now - (animate.previous ?? now));
  animate.previous = now;
  if (orbit.enabled && orbit.update()) {
    fitFrustum();
    renderNeeded = true;
  }
  if (videoFrameId === null && !('requestVideoFrameCallback' in webcam)) detectFrame();
  if (stream && avatar?.bodyEnabled && avatar.body.animate(now, elapsed, facing)) renderNeeded = true;
  if (stream && !startingCamera && faceVisible && now - lastFaceAt > 350) {
    faceVisible = false;
    if (head) targetRotation.copy(head.rest);
    if (activeMouth()?.reset()) renderNeeded = true;
    trackingStatus('Looking for face', 'Center your face in the camera to resume.', 'pending');
  }
  if (head && faceVisible && neutralInverse) {
    viewRotation.setFromAxisAngle(yAxis, facing);
    // Face tracking gives an absolute turn from neutral. Convert that turn to the moving torso's space.
    targetRotation.copy(headParentRotation()).invert().multiply(viewRotation).multiply(headMotion)
      .multiply(inverseViewRotation.copy(viewRotation).invert()).multiply(restHeadWorld);
  }
  if (head && head.node.quaternion.angleTo(targetRotation) > 0.0001) {
    head.node.quaternion.slerp(targetRotation, 1 - Math.exp(-elapsed / 85));
    renderNeeded = true;
  }
  if (renderNeeded || recording) {
    renderer.render(scene, camera);
    renderNeeded = false;
  }
  requestAnimationFrame(animate);
}

function startRecording() {
  if (recording || !neutralInverse || !stream) return;
  const status = $('record-status');
  status.hidden = false;
  if (typeof MediaRecorder === 'undefined' || !renderer.domElement.captureStream) {
    status.textContent = 'Canvas recording is unavailable in this browser.';
    return;
  }

  let capture;
  try {
    capture = renderer.domElement.captureStream(30);
    const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    const mimeType = types.find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(capture, mimeType ? { mimeType } : undefined);
    const session = { recorder, capture, chunks: [], bytes: 0, stopping: false, failed: false, limitReached: false };
    recorder.addEventListener('dataavailable', ({ data }) => {
      if (!data.size) return;
      session.bytes += data.size;
      if (session.bytes <= maxRecordingBytes) session.chunks.push(data);
      if (session.bytes >= maxRecordingBytes) {
        session.limitReached = true;
        if (session.bytes > maxRecordingBytes) {
          session.failed = true;
          status.textContent = 'Recording reached the size limit. Try a shorter clip.';
        }
        endRecording();
      }
    });
    recorder.addEventListener('error', () => {
      session.failed = true;
      status.textContent = 'Recording stopped because the browser encoder failed.';
      endRecording();
    });
    recorder.addEventListener('stop', () => finishRecording(session), { once: true });
    recorder.start(500);
    recording = session;
    session.timer = setTimeout(() => {
      session.limitReached = true;
      endRecording();
    }, maxRecordingTime);
    $('download').hidden = true;
    status.textContent = 'Recording…';
    syncControls();
  } catch (error) {
    capture?.getTracks().forEach((track) => track.stop());
    status.textContent = 'Could not start canvas recording in this browser.';
    console.error(error);
  }
}

function endRecording() {
  if (!recording || recording.stopping) return;
  recording.stopping = true;
  if (recording.recorder.state !== 'inactive') recording.recorder.stop();
  syncControls();
}

function finishRecording(session) {
  clearTimeout(session.timer);
  session.capture.getTracks().forEach((track) => track.stop());
  recording = null;
  const status = $('record-status');
  const download = $('download');
  if (!session.failed && session.chunks.length) {
    const type = session.recorder.mimeType || session.chunks[0].type || 'video/webm';
    if (clipURL) URL.revokeObjectURL(clipURL);
    clipURL = URL.createObjectURL(new Blob(session.chunks, { type }));
    download.href = clipURL;
    download.download = `MeeLive-${new Date().toISOString().replaceAll(':', '-').slice(0, 19)}.${type.includes('mp4') ? 'mp4' : 'webm'}`;
    status.textContent = session.limitReached ? 'Recording limit reached. Clip ready.' : 'Clip ready.';
  } else if (!session.failed) {
    status.textContent = 'The recording contained no frames. Try a longer clip.';
  }
  download.hidden = !clipURL;
  syncControls();
}

fillWindowButton.addEventListener('click', () => setAvatarView(true));
stage.addEventListener('dblclick', () => { if (avatarView) setAvatarView(false); });
document.addEventListener('keydown', (event) => {
  if (avatarView && !event.repeat && !event.altKey && !event.ctrlKey && !event.metaKey &&
      (event.key === 'Escape' || event.key.toLowerCase() === 'f')) setAvatarView(false);
});
framingPicker.addEventListener('change', () => {
  if (!avatar) return;
  frameAvatar();
  saveAvatar();
});

for (const button of [$('dropzone'), $('stage-upload')]) {
  button.addEventListener('click', () => modelInput.click());
}
modelInput.addEventListener('change', () => {
  const file = modelInput.files[0];
  modelInput.value = '';
  if (file) void loadModel(file);
});
for (const zone of [$('dropzone'), $('stage')]) {
  zone.addEventListener('dragover', (event) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    zone.classList.add('is-drop-target');
  });
  zone.addEventListener('dragleave', (event) => {
    if (!zone.contains(event.relatedTarget)) zone.classList.remove('is-drop-target');
  });
  zone.addEventListener('drop', (event) => {
    event.preventDefault();
    zone.classList.remove('is-drop-target');
    const file = event.dataTransfer.files[0];
    if (file) void loadModel(file);
  });
}
document.addEventListener('dragover', (event) => {
  if (event.dataTransfer.types.includes('Files')) event.preventDefault();
});
document.addEventListener('drop', (event) => event.preventDefault());

headPicker.addEventListener('change', () => {
  const path = headPicker.value;
  placingMouth = false;
  endRecording();
  avatar.body?.reset();
  setHead(path);
  modelStatus(head ? 'Head node selected.' : 'Choose the head node.');
  if (!head) stopCamera();
  else if (stream && !startingCamera) beginCalibration();
  saveAvatar();
});
$('set-front').addEventListener('click', () => {
  facing = orbit.getAzimuthalAngle();
  resetView();
  if (!avatar.mouth && !avatar.placedMouth) {
    restoreMouthPlacement();
    syncControls();
  }
  saveAvatar();
  modelStatus('Front view saved.');
});
$('reset-view').addEventListener('click', resetView);
$('place-mouth').addEventListener('click', () => {
  if (!head || stream || startingCamera || loadingModel) return;
  placingMouth = !placingMouth;
  if (placingMouth) {
    clearTimeout(mouthPreviewTimer);
    if (activeMouth()?.reset()) renderNeeded = true;
  }
  mouthStatus();
  syncControls();
});
renderer.domElement.addEventListener('click', async (event) => {
  if (!placingMouth || !head) return;
  const model = avatar;
  const entry = head;
  const rect = renderer.domElement.getBoundingClientRect();
  const point = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1,
    1 - (event.clientY - rect.top) / rect.height * 2);
  const faceWidth = boundsOf(head.node).getSize(new THREE.Vector3()).x;
  const modelHeight = avatar.bounds.max.y - avatar.bounds.min.y;
  const width = faceWidth > 0 ? Math.min(faceWidth * 0.44, modelHeight * 0.5) : modelHeight * 0.14;
  const placement = pickMouth(head.node, avatar.group, camera, point, width);
  if (!placement) {
    $('mouth-status').textContent = 'Click directly on the model’s mouth.';
    return;
  }
  try {
    const art = await loadMouthArt();
    if (!placingMouth || avatar !== model || head !== entry) return;
    avatar.mouthArt = art;
    avatar.placement = { ...placement, headPath: head.path };
    placingMouth = false;
    restoreMouthPlacement();
    syncControls();
    previewPlacedMouth();
    saveAvatar();
  } catch (error) {
    if (avatar !== model || !placingMouth) return;
    placingMouth = false;
    syncControls();
    $('mouth-status').textContent = 'Could not load the mouth textures. Try again.';
    console.warn(error);
  }
});
$('mouth-size').addEventListener('input', (event) => {
  if (!avatar?.placedMouth) return;
  avatar.placement.scale = Number(event.target.value);
  avatar.placedMouth.resize(avatar.placement.scale);
  previewPlacedMouth();
});
$('mouth-size').addEventListener('change', () => { if (avatar?.placedMouth) saveAvatar(); });
$('clear-mouth').addEventListener('click', () => {
  avatar.placement = null;
  restoreMouthPlacement();
  syncControls();
  renderNeeded = true;
  saveAvatar();
});
$('forget-avatar').addEventListener('click', async () => {
  if (!avatar?.remember || loadingModel || forgettingAvatar) return;
  const current = avatar;
  current.remember = false;
  forgettingAvatar = true;
  syncControls();
  try {
    await writeAvatar((store) => store.delete('avatar'));
    if (current === avatar) modelStatus('Saved avatar cleared. It stays open for this visit.');
  } catch {
    current.remember = true;
    if (current === avatar) modelStatus('Could not clear the saved avatar. Try again.', true);
  } finally {
    forgettingAvatar = false;
    syncControls();
  }
});
$('tracking-toggle').addEventListener('click', () => {
  if (stream || startingCamera) stopCamera();
  else void startCamera();
});
$('calibrate').addEventListener('click', beginCalibration);
$('body-enabled').addEventListener('change', (event) => {
  if (!avatar?.body) return;
  avatar.bodyEnabled = event.target.checked;
  avatar.body.reset();
  renderNeeded = true;
  $('body-status').textContent = '';
  if (avatar.bodyEnabled && stream) {
    if (poseTracker) $('body-status').textContent = 'Keep shoulders and elbows in view.';
    else void prepareBodyTracking();
  }
  saveAvatar();
});
$('record').addEventListener('click', () => {
  if (recording) endRecording();
  else startRecording();
});
const resizeObserver = new ResizeObserver(scheduleResize);
resizeObserver.observe(preview);
window.addEventListener('resize', scheduleResize);
syncControls();
resizeCanvas();
requestAnimationFrame(animate);

try {
  const saved = await readAvatar();
  if (!modelRequest && saved) await loadModel(saved.file, saved);
} catch {
  if (!modelRequest) modelStatus('Local storage is unavailable. You can still load a model for this page.');
}
