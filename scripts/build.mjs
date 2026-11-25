import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'dist');
const cache = join(root, '.release-cache');
const packages = join(root, 'node_modules');
const appFiles = ['index.html', 'bootstrap.js', 'app.js', 'glb.js', 'avatar-motion.js', 'mouth-motion.js', 'styles.css'];
const artwork = [
  'masthead-print.png', 'node-print.png', 'print-grain.png', 'tracking-print.png',
  ...['frown', 'open', 'round', 'small', 'smile'].map((shape) => `mii-mouth/${shape}.png`),
];
const threeFiles = [
  'LICENSE', 'build/three.module.min.js', 'build/three.core.min.js',
  ...[
    'controls/OrbitControls.js', 'loaders/GLTFLoader.js', 'loaders/DRACOLoader.js', 'loaders/KTX2Loader.js',
    'utils/BufferGeometryUtils.js', 'utils/WorkerPool.js', 'math/ColorSpaces.js',
    'libs/meshopt_decoder.module.js', 'libs/ktx-parse.module.js', 'libs/zstddec.module.js',
    'libs/draco/gltf/draco_decoder.js', 'libs/draco/gltf/draco_decoder.wasm', 'libs/draco/gltf/draco_wasm_wrapper.js',
    'libs/basis/basis_transcoder.js', 'libs/basis/basis_transcoder.wasm',
  ].map((file) => `examples/jsm/${file}`),
];
const visionFiles = [
  'vision_bundle.mjs',
  ...['vision_wasm_internal', 'vision_wasm_nosimd_internal'].flatMap((name) => [`wasm/${name}.js`, `wasm/${name}.wasm`]),
];
const fonts = [
  ['@fontsource-variable/bricolage-grotesque', 'bricolage-grotesque', ['bricolage-grotesque-latin-standard-normal.woff2']],
  ['@fontsource/ibm-plex-mono', 'ibm-plex-mono', ['ibm-plex-mono-latin-400-normal.woff2', 'ibm-plex-mono-latin-500-normal.woff2']],
];
const modelSource = 'https://storage.googleapis.com/mediapipe-models/';
const pinnedDownloads = [
  {
    file: 'face_landmarker.task',
    destination: 'models/face_landmarker.task',
    url: `${modelSource}face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
    sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
  },
  {
    file: 'pose_landmarker_lite.task',
    destination: 'models/pose_landmarker_lite.task',
    url: `${modelSource}pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
    sha256: '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
  },
  {
    file: 'mediapipe-LICENSE',
    destination: 'LICENSE',
    url: 'https://raw.githubusercontent.com/google-ai-edge/mediapipe/v0.10.21/LICENSE',
    sha256: '8707eef0533987efc5b155d64761eeb6e20793f50b9bd1a68dad1cf4719d0ed8',
  },
];

async function copy(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

async function download({ file, url, sha256 }) {
  const localFile = join(cache, file);
  let bytes;
  try {
    bytes = await readFile(localFile);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Could not fetch ${file} (HTTP ${response.status}).`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
    throw new Error(`Checksum mismatch for ${file}. Remove its copy from .release-cache and retry.`);
  }
  await writeFile(localFile, bytes);
}

function securityHeaders(html) {
  const importMap = /<script type="importmap">([\s\S]+?)<\/script>/.exec(html)?.[1];
  if (!importMap) throw new Error('The import map is missing.');
  const hash = createHash('sha256').update(importMap).digest('base64');
  const policy = [
    "default-src 'none'", `script-src 'self' 'wasm-unsafe-eval' 'sha256-${hash}'`,
    "style-src 'self'", "font-src 'self'", "img-src 'self' blob: data:", "connect-src 'self' blob: data:",
    "media-src 'self' blob:", "worker-src 'self' blob:", "object-src 'none'", "base-uri 'none'",
    "frame-ancestors 'none'", "form-action 'none'",
  ].join('; ');
  return `/*
  Content-Security-Policy: ${policy}
  Permissions-Policy: camera=(self), microphone=(), geolocation=()
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Cache-Control: no-cache
`;
}

await mkdir(cache, { recursive: true });
await Promise.all(pinnedDownloads.map(download));
const staging = await mkdtemp(join(root, '.meelive-build-'));
try {
  for (const file of appFiles) await copy(join(root, file), join(staging, file));
  for (const file of artwork) await copy(join(root, 'assets', file), join(staging, 'assets', file));
  for (const file of threeFiles) await copy(join(packages, 'three', file), join(staging, 'vendor/three', file));
  for (const file of visionFiles) {
    await copy(join(packages, '@mediapipe/tasks-vision', file), join(staging, 'vendor/vision', file));
  }
  for (const { file, destination } of pinnedDownloads) {
    await copy(join(cache, file), join(staging, 'vendor/vision', destination));
  }
  for (const [source, name, files] of fonts) {
    for (const file of files) await copy(join(packages, source, 'files', file), join(staging, 'vendor/fonts', file));
    await copy(join(packages, source, 'LICENSE'), join(staging, 'vendor/fonts', `${name}-LICENSE`));
  }

  const html = (await readFile(join(staging, 'index.html'), 'utf8')).replaceAll('\r\n', '\n');
  await writeFile(join(staging, 'index.html'), html);
  await writeFile(join(staging, '_headers'), securityHeaders(html));
  // Both paths are fixed children of the project root. The staging tree contains only the release allowlist.
  await rm(dist, { recursive: true, force: true });
  await cp(staging, dist, { recursive: true });
  console.log('Built MeeLive into dist/.');
} finally {
  await rm(staging, { recursive: true, force: true });
}
