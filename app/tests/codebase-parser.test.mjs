import test from 'node:test';
import assert from 'node:assert/strict';
import { createCodebaseGraph, detectLanguage, shouldIgnorePath } from '../codebase-parser.js';

const records = [
  { path: 'project/src/index.js', text: "import express from 'express';\nimport { userService } from './service.js';\nfetch('/users/42');\n", bytes: 120 },
  { path: 'project/src/service.js', text: "import { User } from './db.js';\nexport const userService = {};\n", bytes: 75 },
  { path: 'project/src/db.js', text: 'export class User {}\n', bytes: 24 },
  { path: 'project/src/routes/users.js', text: "router.get('/users/:id', handler);\n", bytes: 44 },
  { path: 'project/schema.prisma', text: 'model User {\n  id Int @id\n}\n', bytes: 36 },
  { path: 'project/tests/service.test.js', text: "import { userService } from '../src/service.js';\n", bytes: 60 },
  { path: 'project/README.md', text: 'See [service](./src/service.js).\n', bytes: 32 },
  { path: 'project/package.json', text: JSON.stringify({ dependencies: { express: '^5.0.0' } }), bytes: 48 },
  { path: 'project/node_modules/pkg/index.js', text: 'ignored', bytes: 7 },
  { path: 'project/assets/logo.bin', text: '\u0000\u0001binary', bytes: 14 }
];

test('extracts a portable file graph with imports, routes, schemas, docs, and dependencies', () => {
  const document = createCodebaseGraph(records, { stripCommonRoot: true, generatedAt: '2026-01-01T00:00:00.000Z' });
  const paths = new Set(document.nodes.map((node) => node.source?.path).filter(Boolean));
  assert.ok(paths.has('src/index.js'));
  assert.ok(paths.has('src/service.js'));
  assert.ok(paths.has('schema.prisma'));
  assert.equal(document.nodes.some((node) => node.source?.path === 'node_modules/pkg/index.js'), false);
  assert.equal(document.edges.some((edge) => edge.kind === 'IMPORTS' && edge.source === 'file:src/index.js' && edge.target === 'file:src/service.js'), true);
  assert.equal(document.edges.some((edge) => edge.kind === 'EXPOSES' && edge.target.startsWith('route:')), true);
  assert.equal(document.edges.some((edge) => edge.kind === 'DEFINES' && edge.target.includes('model')), true);
  assert.equal(document.edges.some((edge) => edge.kind === 'DOCUMENTS'), true);
  assert.equal(document.edges.some((edge) => edge.kind === 'DEPENDS_ON' && edge.target === 'external:express'), true);
  assert.equal(document.edges.some((edge) => edge.evidence?.path === 'src/index.js' && edge.evidence?.startLine === 2), true);
  assert.equal(document.nodes.some((node) => node.group === 'external'), true);
  assert.equal(document.coverage.filesSkipped >= 2, true);
  assert.equal(document.coverage.routeCount >= 1, true);
  assert.equal(document.diagnostics.some((item) => item.code === 'files-skipped'), true);
});

test('keeps unresolved imports explicit instead of inventing local nodes', () => {
  const document = createCodebaseGraph([
    { path: 'src/app.ts', text: "import { missing } from './missing.js';\nimport { external } from 'some-package';\n", bytes: 100 },
    { path: 'src/existing.ts', text: 'export const existing = true;\n', bytes: 35 }
  ], { stripCommonRoot: true, generatedAt: '2026-01-01T00:00:00.000Z' });
  const unresolved = document.nodes.find((node) => node.id === 'unresolved:./missing.js');
  const external = document.nodes.find((node) => node.id === 'external:some-package');
  assert.equal(unresolved?.metadata?.unresolved, true);
  assert.equal(external?.metadata?.unresolved, false);
  const unresolvedEdge = document.edges.find((edge) => edge.target === unresolved?.id);
  const externalEdge = document.edges.find((edge) => edge.target === external?.id);
  assert.equal(unresolvedEdge?.inferred, true);
  assert.equal(unresolvedEdge?.resolution, 'unresolved');
  assert.equal(externalEdge?.resolution, 'external');
  assert.equal(document.diagnostics.some((item) => item.code === 'unresolved-import'), true);
});

test('detects common source families and ignores generated directories', () => {
  assert.equal(detectLanguage('src/main.ts'), 'TypeScript');
  assert.equal(detectLanguage('src/main.py'), 'Python');
  assert.equal(detectLanguage('schema.prisma'), 'Prisma');
  assert.equal(detectLanguage('Dockerfile'), 'Dockerfile');
  assert.equal(shouldIgnorePath('repo/node_modules/pkg/index.js'), true);
  assert.equal(shouldIgnorePath('repo/dist/bundle.js'), true);
  assert.equal(shouldIgnorePath('repo/src/index.js'), false);
  assert.equal(shouldIgnorePath('repo/KG-Map.html'), true);
  assert.equal(shouldIgnorePath('backend/.wwebjs_auth/session/Default/Local State'), true);
  assert.equal(shouldIgnorePath('backend/.env'), true);
});

test('routes and API calls remain directional and evidence-backed', () => {
  const document = createCodebaseGraph([
    { path: 'src/app.js', text: "app.get('/users/:id', getUser);\nfetch('/users/42');\n", bytes: 64 }
  ], { stripCommonRoot: true, generatedAt: '2026-01-01T00:00:00.000Z' });
  const route = document.nodes.find((node) => node.kind === 'route');
  const call = document.nodes.find((node) => node.kind === 'api-call');
  assert.equal(route?.group, 'route');
  assert.equal(call?.metadata?.path, '/users/42');
  assert.equal(document.edges.some((edge) => edge.source === 'file:src/app.js' && edge.target === route?.id), true);
  assert.equal(document.edges.some((edge) => edge.source === call?.id && edge.target === route?.id), true);
  assert.equal(document.edges.find((edge) => edge.kind === 'TARGETS')?.inferred, true);
});

test('ignores malformed records instead of aborting the whole parse', () => {
  const document = createCodebaseGraph([
    null,
    undefined,
    'src/bare-string.js',
    42,
    { path: 'src/real.js', text: "import './helper.js';\n", bytes: 22 }
  ], { generatedAt: '2026-01-01T00:00:00.000Z' });
  assert.ok(document.nodes.some((node) => node.id === 'file:src/real.js'), 'the readable record should still be scanned');
  assert.ok(document.diagnostics.some((item) => item.code === 'invalid-record'), 'malformed entries should be reported');
});

test('API targets use the complete path and HTTP method instead of a prefix guess', () => {
  const graph = createCodebaseGraph([{ path: 'server.js', text: [
    "app.get('/api/profile', getProfile);",
    "app.post('/api/profile/steam', saveSteam);",
    "app.put('/api/categories/:id', updateCategory);",
    "app.delete('/api/categories/:id', deleteCategory);",
    "app.get('/', home);",
    "fetch('/api/profile/steam', { method: 'POST' });",
    "fetch(`/api/categories/${category.id}`, { method: 'DELETE' });",
    "fetch('/api/profile/steam');",
    "fetch('/api/missing');"
  ].join('\n') }]);
  const targets = graph.edges.filter(edge => edge.kind === 'TARGETS');
  const labels = targets.map(edge => graph.nodes.find(node => node.id === edge.target).label).sort();
  assert.deepEqual(labels, ['DELETE /api/categories/:id', 'POST /api/profile/steam']);
  assert.equal(targets.every(edge => edge.inferred && edge.evidence.startLine > 0), true);
});

test('ambiguous API targets remain unconnected with a diagnostic', () => {
  const graph = createCodebaseGraph([{ path: 'server.js', text: "app.get('/items', a);\napp.post('/items', b);\napiRequest('/items');" }]);
  assert.equal(graph.edges.some(edge => edge.kind === 'TARGETS'), false);
  assert.ok(graph.diagnostics.some(item => item.code === 'ambiguous-api-target'));
});

test('runtime storage and unsupported text do not become source nodes', () => {
  const graph = createCodebaseGraph([
    { path: 'backend/.wwebjs_auth/session/state.json', text: '{}' },
    { path: 'backend/.env', text: 'EXAMPLE=value' },
    { path: 'backend/Cache/LOG', text: 'runtime log' },
    { path: 'src/app.js', text: 'export const app = true;' }
  ]);
  assert.deepEqual(graph.nodes.map(node => node.id), ['file:src/app.js']);
});

test('HTML entrypoints resolve root-relative assets within their package', () => {
  const graph = createCodebaseGraph([
    { path: 'frontend/package.json', text: '{}' },
    { path: 'frontend/index.html', text: '<script type="module" src="/src/main.jsx"></script>' },
    { path: 'frontend/src/main.jsx', text: 'export const app = true;' },
    { path: 'release/CodeMesh.html', text: '<html>generated bundle</html>' }
  ]);
  assert.ok(graph.edges.some(edge => edge.source === 'file:frontend/index.html' && edge.target === 'file:frontend/src/main.jsx'));
  assert.equal(graph.nodes.some(node => node.source?.path === 'release/CodeMesh.html'), false);
});

test('enforces byte limits against the real encoded size rather than the declared count', () => {
  const oversized = 'const value = 1;\n'.repeat(40000);
  const actualBytes = new TextEncoder().encode(oversized).byteLength;
  const document = createCodebaseGraph(
    [
      { path: 'src/liar.js', text: oversized, bytes: 1 },
      { path: 'src/small.js', text: 'export const ok = true;\n', bytes: 999999 }
    ],
    { maxFileBytes: 4096, maxTotalBytes: 1024 * 1024, generatedAt: '2026-01-01T00:00:00.000Z' }
  );
  assert.ok(actualBytes > 4096, 'fixture must exceed maxFileBytes');
  assert.equal(document.nodes.some((node) => node.id === 'file:src/liar.js'), false, 'an oversized file must be skipped despite declaring 1 byte');
  assert.ok(document.coverage.filesSkipped >= 1);
  const small = document.nodes.find((node) => node.id === 'file:src/small.js');
  assert.ok(small, 'a genuinely small file must survive');
  assert.equal(small.metadata.bytes, new TextEncoder().encode('export const ok = true;\n').byteLength, 'reported bytes must describe the real text');
});
