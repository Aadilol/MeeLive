import assert from 'node:assert/strict';
import test from 'node:test';
import { maxAvatarBytes, validateGlb } from '../glb.js';

function chunk(type, data, padding) {
  const size = Math.ceil(data.length / 4) * 4;
  const bytes = Buffer.alloc(8 + size, padding);
  bytes.writeUInt32LE(size, 0);
  bytes.write(type, 4, 'ascii');
  data.copy(bytes, 8);
  return bytes;
}

function glb(metadata, extra = []) {
  const header = Buffer.alloc(12);
  header.write('glTF', 0);
  header.writeUInt32LE(2, 4);
  const json = JSON.stringify({ asset: { version: '2.0' }, ...metadata });
  const chunks = [chunk('JSON', Buffer.from(json), 32), ...extra];
  header.writeUInt32LE(12 + chunks.reduce((sum, item) => sum + item.length, 0), 8);
  return Uint8Array.from(Buffer.concat([header, ...chunks])).buffer;
}

test('accepts embedded buffers and textures', () => {
  const png = 'data:image/png;base64,AA==';
  assert.doesNotThrow(() => validateGlb(glb({
    buffers: [{ byteLength: 4 }],
    images: [{ bufferView: 0 }, { uri: png }],
    nodes: [{ mesh: 0, children: [1] }, {}],
    scenes: [{ nodes: [0] }],
    meshes: [{ primitives: [{}] }],
  }, [chunk('BIN\0', Buffer.alloc(4), 0)])));
});

test('rejects model-controlled network resources before loading', () => {
  for (const metadata of [
    { images: [{ uri: 'texture.png' }] },
    { images: [{ uri: 'blob:https://example.test/id' }] },
    { buffers: [{ byteLength: 4, uri: 'https://example.test/model.bin' }] },
    { images: [{ uri: 'data:image/svg+xml;base64,AA==' }] },
  ]) assert.throws(() => validateGlb(glb(metadata)), /embedded/);
});

test('rejects ambiguous and truncated GLB containers', () => {
  const duplicate = chunk('JSON', Buffer.from('{"asset":{"version":"2.0"}}'), 32);
  assert.throws(() => validateGlb(glb({}, [duplicate])), /duplicate/);
  const truncated = glb({}).slice(0, -2);
  assert.throws(() => validateGlb(truncated), /binary glTF/);
  assert.throws(() => validateGlb(new ArrayBuffer(maxAvatarBytes + 1)), /64 MB/);
});

test('bounds cycles, accessor counts, and compressed allocations', () => {
  assert.throws(() => validateGlb(glb({ nodes: [{ children: [0] }] })), /cyclic/);
  assert.throws(() => validateGlb(glb({ accessors: [{ type: 'VEC3', count: 4_000_001 }] })), /accessor/);
  assert.throws(() => validateGlb(glb({
    bufferViews: [{ extensions: { EXT_meshopt_compression: { count: 100_000_000, byteStride: 8 } } }],
  })), /budget/);
});
