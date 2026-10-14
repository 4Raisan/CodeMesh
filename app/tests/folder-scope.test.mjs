import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { shouldIgnorePath, createCodebaseGraph } from '../codebase-parser.js';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const discovery = source.slice(source.indexOf('const serverProjectFileNames'), source.indexOf('async function autoLoadServerProject'));
const origin = 'http://127.0.0.1:9000';
const files = new Map([
  ['/dashboard/User/main.js', "import './service.js';"],
  ['/dashboard/User/service.js', 'export const user = true;'],
  ['/dashboard/Customer/main.js', 'export const customer = true;'],
  ['/dashboard/Admin/main.js', 'export const admin = true;'],
  ['/outside.js', 'export const outside = true;']
]);
const listings = new Map([
  ['/dashboard/', ['User/', 'Customer/', 'Admin/', '../outside.js', 'CodeMesh.html']],
  ['/dashboard/User/', ['main.js', 'service.js', '../Customer/main.js', '../../outside.js', '/outside.js', '%2e%2e/Admin/main.js', '%2e%2e%2fAdmin/main.js', '%zz.js', '#main.js', '//evil.test/main.js', 'node_modules/']],
  ['/dashboard/Customer/', ['main.js']],
  ['/dashboard/Admin/', ['main.js']],
  ['/dashboard/User/node_modules/', ['bad.js']]
]);
function harness(href, protocol = 'http:') {
  const requests = [];
  const context = {
    URL, TextEncoder, shouldIgnorePath,
    window: { location: { href: origin + href, protocol, origin } },
    DOMParser: class { parseFromString(html) { return { querySelectorAll: () => JSON.parse(html).map(href => ({ getAttribute: () => href })) }; } },
    fetch: async url => {
      const path = new URL(url).pathname;
      requests.push(path);
      return { ok: listings.has(path) || files.has(path), headers: { get: name => name === 'content-type' ? (listings.has(path) ? 'text/html' : 'text/plain') : null }, text: async () => listings.has(path) ? JSON.stringify(listings.get(path)) : files.get(path) };
    }
  };
  runInNewContext(discovery + ';globalThis.discover = discoverServerProject;', context);
  return { context, requests };
}
test('HTML in monolith root maps User, Customer and Admin with correct import edges', async () => {
  const { context, requests } = harness('/dashboard/CodeMesh.html');
  const result = await context.discover();
  assert.deepEqual(Array.from(result.records, record => record.path).sort(), ['Admin/main.js', 'Customer/main.js', 'User/main.js', 'User/service.js']);
  const graph = createCodebaseGraph(result.records, { stripCommonRoot: false });
  assert.equal(graph.nodes.length, 4);
  assert.equal(graph.edges.length, 1);
  assert.ok(requests.every(path => path.startsWith('/dashboard/')));
});
test('HTML inside User never reads parents, siblings, escaped paths or generated folders', async () => {
  const { context, requests } = harness('/dashboard/User/CodeMesh.html');
  const result = await context.discover();
  assert.deepEqual(Array.from(result.records, record => record.path).sort(), ['main.js', 'service.js']);
  assert.deepEqual(requests.sort(), ['/dashboard/User/', '/dashboard/User/main.js', '/dashboard/User/service.js']);
});
test('missing listing stays inside placement folder and never falls back to a parent', async () => {
  const { context, requests } = harness('/dashboard/Empty/CodeMesh.html');
  assert.equal(await context.discover(), null);
  assert.deepEqual(requests, ['/dashboard/Empty/']);
});
test('local disk opening does not attempt forbidden network directory reads', async () => {
  const { context, requests } = harness('/dashboard/User/CodeMesh.html', 'file:');
  assert.equal(await context.discover(), null);
  assert.deepEqual(requests, []);
});
