import * as THREE from 'three';

const mouthShapes = ['small', 'open', 'round', 'smile', 'frown'];
// Pixel bounds in the supplied 1024px Mii face masks.
const patch = { x: 384, y: 634, width: 256, height: 120 };
let artPromise;

export function loadMouthArt() {
  artPromise ||= Promise.all(mouthShapes.map(async (shape) => {
    const image = new Image();
    image.src = new URL(`./assets/mii-mouth/${shape}.png`, import.meta.url).href;
    await image.decode();
    return [shape, image];
  })).then((entries) => new Map(entries)).catch((error) => {
    artPromise = null;
    throw error;
  });
  return artPromise;
}

export function findMiiMask(root) {
  if (!root.getObjectByName('miiHead') && !root.getObjectByName('Faceline')) return null;
  return root.getObjectsByProperty('isMesh', true).find(({ name, material, userData }) =>
    material?.map && (userData.modulateType === 6 || /^mask(?:_\d+)?$/i.test(name) || /^mask$/i.test(material.name)));
}

function drawArt(context, image, x, y, width, height) {
  context.drawImage(image, patch.x, patch.y, patch.width, patch.height, x, y, width, height);
}

function drawMouthLine(context, x, y, width, weight) {
  context.strokeStyle = '#121212';
  context.lineWidth = weight;
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(x - width / 2, y);
  context.lineTo(x + width / 2, y);
  context.stroke();
}

function mouthCenter(context, [x, y, width, height]) {
  const { data } = context.getImageData(x, y, width, height);
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      if (data[(row * width + column) * 4 + 3] < 96) continue;
      left = Math.min(left, column);
      right = Math.max(right, column);
      top = Math.min(top, row);
      bottom = Math.max(bottom, row);
    }
  }
  return right < 0 ? null : [x + (left + right + 1) / 2, y + (top + bottom + 1) / 2];
}

function artCenters(art) {
  const canvas = document.createElement('canvas');
  canvas.width = patch.width;
  canvas.height = patch.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const rect = [0, 0, canvas.width, canvas.height];
  const centers = new Map();
  for (const [shape, image] of art) {
    context.clearRect(...rect);
    drawArt(context, image, ...rect);
    centers.set(shape, mouthCenter(context, rect) ?? [canvas.width / 2, canvas.height / 2]);
  }
  return centers;
}

function mouthSignals(categories = [], landmarks, aspect) {
  const score = (name) => categories.find(({ categoryName }) => categoryName === name)?.score ?? 0;
  let corners = null;
  let lipGap = null;
  if (landmarks?.length > 291 && Number.isFinite(aspect) && aspect > 0) {
    const [eyeLeft, eyeRight, left, right, upper, lower, upperInner, lowerInner] =
      [33, 263, 61, 291, 0, 17, 13, 14].map((index) => landmarks[index]);
    const dx = (eyeRight.x - eyeLeft.x) * aspect;
    const dy = eyeRight.y - eyeLeft.y;
    const eyeSpanSquared = dx * dx + dy * dy;
    if (eyeSpanSquared > 0.0001) {
      // Measure the height of the corners relative to the lip center, along the face's vertical axis.
      const x = (upper.x + lower.x - left.x - right.x) * aspect / 2;
      const y = (upper.y + lower.y - left.y - right.y) / 2;
      corners = (dx * y - dy * x) / eyeSpanSquared;
      lipGap = (dx * (lowerInner.y - upperInner.y) - dy * (lowerInner.x - upperInner.x) * aspect) / eyeSpanSquared;
    }
  }
  return {
    jaw: score('jawOpen'),
    round: Math.max(score('mouthFunnel'), score('mouthPucker')),
    smile: (score('mouthSmileLeft') + score('mouthSmileRight')) / 2,
    frown: (score('mouthFrownLeft') + score('mouthFrownRight')) / 2,
    corners,
    lipGap,
  };
}

function expressionStrength(score, shape) {
  const stronger = Math.max(0, score, shape);
  return stronger + 0.65 * Math.max(0, Math.min(score, shape));
}

function mouthMotion(show, release) {
  let state = 'idle';
  let neutral;
  let jaw = 0;
  let round = 0;
  let smile = 0;
  let frown = 0;
  function reset() {
    state = 'idle';
    jaw = round = smile = frown = 0;
    return show('idle');
  }
  return {
    reset,
    preview: () => show('open'),
    calibrate(categories, landmarks, aspect, count) {
      const sample = mouthSignals(categories, landmarks, aspect);
      if (count === 1 || !neutral) neutral = sample;
      else {
        neutral.smile += (sample.smile - neutral.smile) / count;
        neutral.frown += (sample.frown - neutral.frown) / count;
        if (sample.corners !== null) {
          neutral.corners ??= sample.corners;
          neutral.corners += (sample.corners - neutral.corners) / count;
        }
        if (sample.lipGap !== null) {
          neutral.lipGap ??= sample.lipGap;
          neutral.lipGap += (sample.lipGap - neutral.lipGap) / count;
        }
      }
    },
    update(categories, landmarks, aspect) {
      const sample = mouthSignals(categories, landmarks, aspect);
      const corners = neutral?.corners != null && sample.corners !== null ? sample.corners - neutral.corners : 0;
      jaw += (sample.jaw - jaw) * 0.55;
      round += (sample.round - round) * 0.55;
      // Mouth-corner movement supplements low blendshape scores, particularly for subtle frowns.
      const smileEvidence = (sample.smile - (neutral?.smile ?? 0)) / 0.26;
      const frownEvidence = (sample.frown - (neutral?.frown ?? 0)) / 0.12;
      const smileAmount = expressionStrength(smileEvidence, corners / 0.028);
      const frownAmount = expressionStrength(frownEvidence, -corners / 0.020);
      smile += (smileAmount - smile) * 0.55;
      frown += (frownAmount - frown) * 0.55;
      const closed = sample.lipGap !== null && sample.lipGap <= Math.max(0.029, (neutral?.lipGap ?? 0) + 0.022);
      const smiling = smile > (state === 'smile' ? 0.58 : 0.95) && smile >= frown;
      const frowning = frown > (state === 'frown' ? 0.58 : 0.95) && frown > smile;
      const closedExpression = closed && (smiling || frowning);
      if (!closedExpression && round > (state === 'round' ? 0.24 : 0.37) && jaw > 0.035) state = 'round';
      else if (!closedExpression && jaw > (state === 'open' ? 0.22 : 0.29)) state = 'open';
      else if (smiling) state = 'smile';
      else if (frowning) state = 'frown';
      else if (jaw > (state === 'small' ? 0.065 : 0.10)) state = 'small';
      else state = 'idle';
      return show(state);
    },
    dispose() {
      reset();
      release();
    },
  };
}

export function createMiiMouth(mask, art) {
  const material = mask.material;
  const original = material.map;
  const image = original.image;
  if (!image?.width || image.width !== image.height || image.data) return null;
  const size = Math.min(image.width, 2048);
  const scale = size / 1024;
  const rect = [patch.x, patch.y, patch.width, patch.height].map((value) => Math.round(value * scale));
  const maps = new Map();
  let idle = original;
  function useMap(map) {
    if (material.map === map) return false;
    material.map = map;
    return true;
  }
  function textureFrom(canvas) {
    const map = original.clone();
    map.source = new THREE.Source(canvas);
    map.needsUpdate = true;
    return map;
  }
  try {
    const centers = artCenters(art);
    const base = document.createElement('canvas');
    base.width = base.height = size;
    const originalContext = base.getContext('2d', { willReadFrequently: true });
    originalContext.drawImage(image, 0, 0, size, size);
    const existing = mouthCenter(originalContext, rect);
    const center = existing || [512 * scale, 691 * scale];
    // Clear the original mouth from the transparent mask before drawing any replacements.
    originalContext.clearRect(...rect);
    for (const [shape, graphic] of art) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const context = canvas.getContext('2d');
      context.drawImage(base, 0, 0);
      const [x, y] = centers.get(shape);
      drawArt(context, graphic, Math.round(center[0] - x * scale),
        Math.round(center[1] - y * scale), rect[2], rect[3]);
      maps.set(shape, textureFrom(canvas));
    }
    if (!existing) {
      drawMouthLine(originalContext, ...center, 130 * scale, 10 * scale);
      idle = textureFrom(base);
    }
  } catch (error) {
    for (const map of maps) map.dispose();
    throw error;
  }
  useMap(idle);
  return {
    ...mouthMotion((shape) => useMap(maps.get(shape) || idle), () => {
      useMap(original);
      if (idle !== original) idle.dispose();
      maps.forEach((map) => map.dispose());
    }),
    hasNeutral: idle !== original,
    showIdle(overridden) {
      useMap(overridden ? original : idle);
    },
  };
}

function isVisibleSurface(hit) {
  const material = Array.isArray(hit.object.material) ? hit.object.material[hit.face.materialIndex] : hit.object.material;
  if (!material?.visible || (material.transparent && material.opacity < 0.65)) return false;
  const texture = material?.map;
  const image = texture?.image;
  if ((!material.transparent && !material.alphaTest) || !hit.uv || !image?.width || image.data) return true;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (texture.matrixAutoUpdate) texture.updateMatrix();
    const uv = texture.transformUv(hit.uv.clone());
    const x = Math.min(image.width - 1, Math.max(0, Math.floor(uv.x * image.width)));
    const y = Math.min(image.height - 1, Math.max(0, Math.floor(uv.y * image.height)));
    context.drawImage(image, x, y, 1, 1, 0, 0, 1, 1);
    const alpha = context.getImageData(0, 0, 1, 1).data[3];
    // Ignore transparent areas of a face mask when placing the cutout.
    const coverage = alpha / 255 * material.opacity;
    return coverage >= material.alphaTest && (!material.transparent || coverage >= 0.82);
  } catch {
    // Some compressed texture formats cannot be sampled through a 2D canvas.
  }
  return true;
}

function sampleSurface(ray, group) {
  for (const hit of ray.intersectObject(group, true)) {
    if (hit.object.userData.mouthOverlay) continue;
    let visible = true;
    for (let node = hit.object; node; node = node.parent) visible &&= node.visible;
    if (visible && isVisibleSurface(hit)) return hit;
  }
  return null;
}

export function pickMouth(head, group, camera, point, width) {
  const ray = new THREE.Raycaster();
  group.updateWorldMatrix(true, true);
  camera.updateWorldMatrix(true, false);
  function intersect(point) {
    ray.setFromCamera(point, camera);
    return sampleSurface(ray, group);
  }
  const hit = intersect(point);
  if (!hit) return null;
  const horizontal = width * camera.zoom / (camera.right - camera.left);
  const vertical = width * camera.zoom / (camera.top - camera.bottom);
  const samples = [-1, 1].map((side) => intersect(new THREE.Vector2(point.x + side * horizontal, point.y + vertical * 0.30)))
    .filter(Boolean);
  const orientation = camera.getWorldQuaternion(new THREE.Quaternion());
  const front = new THREE.Vector3(0, 0, 1).applyQuaternion(orientation);
  const depth = Math.max(0, ...samples.map(({ point }) => point.clone().sub(hit.point).dot(front)));
  hit.point.addScaledVector(front, Math.min(depth, width * 0.22) + width * 0.04);
  const local = head.worldToLocal(hit.point);
  const headScale = head.getWorldScale(new THREE.Vector3());
  return {
    position: local.toArray(),
    rotation: head.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(orientation).toArray(),
    width: width / Math.max(Math.abs(headScale.x), 0.0001),
    height: width * 0.60 / Math.max(Math.abs(headScale.y), 0.0001),
    scale: 1,
  };
}

export function findMouthPlacement(head, group, facing, modelHeight, allowMiiFallback) {
  const anchor = head.getObjectsByProperty('visible', true).find((node) =>
    /^(?:mouth|lips)(?:[_. -]?(?:mesh|center|anchor|locator|position|\d+))*$/i.test(node.userData.name || node.name));
  const face = !anchor && allowMiiFallback && head.getObjectByName('Faceline');
  if (!anchor && (!face || (face.userData.modulateType !== 0 && !head.getObjectByName('miiHead')))) return null;
  group.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(anchor || face, true);
  if (!anchor && bounds.isEmpty()) return null;
  const center = bounds.isEmpty() ? anchor.getWorldPosition(new THREE.Vector3()) : bounds.getCenter(new THREE.Vector3());
  const front = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing));
  const right = new THREE.Vector3(front.z, 0, -front.x);
  const size = bounds.getSize(new THREE.Vector3());
  const mouthWidth = Math.abs(right.x) * size.x + Math.abs(right.z) * size.z;
  if (!anchor) center.y = bounds.min.y + size.y * 0.26;
  const width = !anchor ? mouthWidth * 0.4
    : mouthWidth > modelHeight * 0.015 ? mouthWidth * 1.15 : modelHeight * 0.14;
  const camera = new THREE.OrthographicCamera(-modelHeight, modelHeight, modelHeight, -modelHeight, 0.01, modelHeight * 4);
  camera.position.copy(center).addScaledVector(front, modelHeight * 2);
  camera.lookAt(center);
  const placement = pickMouth(head, group, camera, new THREE.Vector2(), Math.min(width, modelHeight * 0.5));
  return placement && { ...placement, neutral: !anchor || bounds.isEmpty() };
}

export function createPlacedMouth(head, placement, art) {
  const maps = new Map();
  for (const [shape, image] of art) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 160;
    const context = canvas.getContext('2d');
    drawArt(context, image, 18, 28, 220, 103);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    maps.set(shape, map);
  }
  let idle;
  if (placement.neutral) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 160;
    drawMouthLine(canvas.getContext('2d'), 128, 80, 112, 9);
    idle = new THREE.CanvasTexture(canvas);
    idle.colorSpace = THREE.SRGBColorSpace;
  }
  const geometry = new THREE.PlaneGeometry(placement.width, placement.height);
  const material = new THREE.MeshBasicMaterial({ map: idle || maps.get('open'), alphaTest: 0.5, toneMapped: false });
  const plane = new THREE.Mesh(geometry, material);
  plane.userData.mouthOverlay = true;
  plane.visible = Boolean(idle);
  plane.position.fromArray(placement.position);
  plane.quaternion.fromArray(placement.rotation);
  plane.scale.setScalar(placement.scale);
  head.add(plane);
  return {
    ...mouthMotion((shape) => {
      const map = maps.get(shape) || idle;
      const visible = Boolean(map);
      if (plane.visible === visible && (!visible || material.map === map)) return false;
      plane.visible = visible;
      if (visible) material.map = map;
      return true;
    }, () => {
      plane.removeFromParent();
      geometry.dispose();
      material.dispose();
      idle?.dispose();
      maps.forEach((map) => map.dispose());
    }),
    resize(scale) { plane.scale.setScalar(scale); },
  };
}
