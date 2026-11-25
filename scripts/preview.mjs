import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const headers = Object.fromEntries((await readFile(resolve(dist, '_headers'), 'utf8')).split('\n')
  .map((line) => /^  ([^:]+): (.+)$/.exec(line))
  .filter(Boolean).map(([, name, value]) => [name, value]));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
};
const port = Number(process.env.PORT ?? 8000);
createServer(async (request, response) => {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { ...headers, Allow: 'GET, HEAD' }).end();
      return;
    }
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = resolve(dist, `.${decodeURIComponent(pathname === '/' ? '/index.html' : pathname)}`);
    if (!file.startsWith(resolve(dist) + sep) || file === resolve(dist, '_headers')) {
      response.writeHead(404, headers).end();
      return;
    }
    const body = await readFile(file);
    response.writeHead(200, {
      ...headers,
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Content-Length': body.byteLength,
    }).end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(404, headers).end();
  }
}).listen(port, '127.0.0.1', () => console.log(`MeeLive release preview at http://127.0.0.1:${port}/`));
