export const maxAvatarBytes = 64 * 1024 * 1024;
const maxJsonBytes = 4 * 1024 * 1024;
const maxDecodedBytes = 256 * 1024 * 1024;
const bufferData = /^data:application\/(?:octet-stream|gltf-buffer);base64,[A-Za-z0-9+/]+={0,2}$/;
const imageData = /^data:image\/(?:png|jpeg|webp|avif|ktx2);base64,[A-Za-z0-9+/]+={0,2}$/;
const accessorWidth = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

function entries(model, key, limit) {
  const list = model[key] ?? [];
  if (!Array.isArray(list) || list.length > limit || list.some((entry) => !entry || typeof entry !== 'object')) {
    throw new Error('The model is invalid or too complex.');
  }
  return list;
}

function checkHierarchy(nodes) {
  const parents = new Int32Array(nodes.length).fill(-1);
  for (const [index, { children = [] }] of nodes.entries()) {
    if (!Array.isArray(children)) throw new Error('Invalid model hierarchy.');
    for (const child of children) {
      if (!Number.isInteger(child) || !nodes[child] || parents[child] !== -1) throw new Error('Invalid model hierarchy.');
      parents[child] = index;
    }
  }
  for (let index = 0; index < nodes.length; index++) {
    let ancestor = parents[index];
    for (let depth = 0; ancestor !== -1; ancestor = parents[ancestor], depth++) {
      if (depth >= 128) throw new Error('The model hierarchy is too deep or cyclic.');
    }
  }
}

export function validateGlb(buffer) {
  const view = new DataView(buffer);
  const size = view.byteLength;
  if (size > maxAvatarBytes) throw new Error('Choose a GLB of 64 MB or less.');
  if (size < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 ||
      view.getUint32(8, true) !== size || view.getUint32(16, true) !== 0x4e4f534a) {
    throw new Error('Choose a valid binary glTF 2.0 (.glb) file.');
  }

  const length = view.getUint32(12, true);
  if (!length || length % 4 || length > maxJsonBytes || 20 + length > size) {
    throw new Error('The GLB metadata is invalid or too large.');
  }
  let model;
  try {
    model = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(buffer, 20, length)));
    if (model?.asset?.version !== '2.0') throw new Error();
  } catch {
    throw new Error('The GLB does not contain valid glTF 2.0 metadata.');
  }

  let binaryBytes = null;
  for (let offset = 20 + length; offset < size;) {
    if (size - offset < 8) throw new Error('The GLB contains a truncated chunk.');
    const chunkSize = view.getUint32(offset, true);
    if (chunkSize % 4 || chunkSize > size - offset - 8) throw new Error('The GLB contains an invalid chunk.');
    const type = view.getUint32(offset + 4, true);
    if (type === 0x4e4f534a || (type === 0x004e4942 && binaryBytes !== null)) {
      throw new Error('The GLB contains a duplicate data chunk.');
    }
    if (type === 0x004e4942) binaryBytes = chunkSize;
    offset += 8 + chunkSize;
  }

  for (const [index, { uri, byteLength }] of entries(model, 'buffers', 64).entries()) {
    if (uri !== undefined && (typeof uri !== 'string' || !bufferData.test(uri))) {
      throw new Error('Export the avatar with all buffers and textures embedded.');
    }
    const available = typeof uri === 'string' ? Math.floor(uri.slice(uri.indexOf(',') + 1).length * 0.75) : (binaryBytes ?? 0);
    if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > available || (uri === undefined && index !== 0)) {
      throw new Error('The GLB contains an invalid buffer.');
    }
  }
  for (const { uri } of entries(model, 'images', 128)) {
    if (uri !== undefined && (typeof uri !== 'string' || !imageData.test(uri))) {
      throw new Error('Export the avatar with all buffers and textures embedded.');
    }
  }

  const nodes = entries(model, 'nodes', 4096);
  checkHierarchy(nodes);
  for (const { nodes: roots = [] } of entries(model, 'scenes', 16)) {
    if (!Array.isArray(roots) || roots.length > nodes.length || new Set(roots).size !== roots.length ||
        roots.some((index) => !Number.isInteger(index) || !nodes[index])) throw new Error('Invalid model scene.');
  }
  let bytes = 0;
  for (const { count, type } of entries(model, 'accessors', 16384)) {
    const width = Object.hasOwn(accessorWidth, type) && accessorWidth[type];
    if (!width || !Number.isSafeInteger(count) || count < 1 || count > 4_000_000) {
      throw new Error('The model contains an invalid or oversized accessor.');
    }
    bytes += count * width * 4;
  }
  for (const { extensions } of entries(model, 'bufferViews', 16384)) {
    const compressed = extensions?.EXT_meshopt_compression;
    if (!compressed) continue;
    const { count, byteStride } = compressed;
    if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(byteStride) || byteStride < 1 || byteStride > 256) {
      throw new Error('The model contains invalid compressed data.');
    }
    bytes += count * byteStride;
  }
  if (bytes > maxDecodedBytes) throw new Error('The model exceeds the geometry budget.');

  const primitives = entries(model, 'meshes', 4096).map(({ primitives }) => {
    if (!Array.isArray(primitives) || !primitives.length || primitives.length > 256) {
      throw new Error('The model contains an invalid or oversized mesh.');
    }
    return primitives.length;
  });
  let drawCalls = 0;
  for (const { mesh } of nodes) {
    if (mesh === undefined) continue;
    if (!Number.isInteger(mesh) || !primitives[mesh]) throw new Error('Invalid model mesh.');
    drawCalls += primitives[mesh];
  }
  if (drawCalls > 4096) throw new Error('The model contains too many mesh parts.');
}
