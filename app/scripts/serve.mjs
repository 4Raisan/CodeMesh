import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.env.PORT ?? 8000);
const types = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml']
]);

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const requested = normalize(decoded === '/' ? '/index.html' : decoded).replace(/^([/\\])+/, '');
  const absolute = resolve(join(root, requested));
  const relativePath = relative(root, absolute);
  if (relativePath.startsWith('..') || relativePath.includes(`..${process.platform === 'win32' ? '\\' : '/'}`)) return null;
  return absolute;
}

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Method not allowed');
    return;
  }
  const requestedUrl = request.url ?? '/';
  const path = ['/CodeMesh.html', '/KG-Map.html'].includes(requestedUrl.split('?')[0])
    ? resolve(root, '..', 'release', 'CodeMesh.html')
    : safePath(requestedUrl);
  if (!path) {
    response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Forbidden');
    return;
  }
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error('not a file');
    const content = await readFile(path);
    response.writeHead(200, {
      'content-type': types.get(extname(path).toLowerCase()) ?? 'application/octet-stream',
      'cache-control': 'no-cache',
      'content-length': content.byteLength
    });
    if (request.method === 'HEAD') response.end();
    else response.end(content);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('Not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`CodeMesh is running at http://127.0.0.1:${port}/\n`);
});
