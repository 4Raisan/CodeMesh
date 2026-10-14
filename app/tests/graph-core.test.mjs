import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLayout,
  createIndexes,
  createSampleDocument,
  fingerprintDocument,
  getVisibleEdgeIds,
  getNodeGeometry,
  getVisibleNodeIds,
  normalizeGraphDocument
} from '../graph-core.js';

test('normalizes Luxora-style nodes and edges without executing imported text', () => {
  const document = normalizeGraphDocument({
    name: 'fixture',
    version: '1.1.0',
    sourceRepository: { repository: 'owner/repo', branch: 'main' },
    nodes: [
      { id: 'a', type: 'File', label: '<img src=x onerror=alert(1)>', group: 'frontend', file: 'src/a.js' },
      { id: 'a', type: 'Duplicate', label: 'duplicate' },
      { id: 'b', type: 'Function', label: 'run', group: 'service', file: 'src/b.js' }
    ],
    edges: [
      { from: 'a', to: 'b', type: 'CALLS', label: 'calls' },
      { from: 'a', to: 'b', type: 'CALLS', label: 'second evidence' },
      { from: 'a', to: 'a', type: 'SELF', label: 'self' },
      { from: 'a', to: 'missing', type: 'BROKEN' },
      { from: 'a', to: 'b', type: 'BAD', confidence: 4 }
    ]
  });
  assert.equal(document.nodes.length, 2);
  assert.equal(document.edges.length, 4);
  assert.equal(document.repository.name, 'owner/repo');
  assert.equal(document.repository.revision, 'main');
  assert.equal(document.nodes[0].label, '<img src=x onerror=alert(1)>');
  assert.equal(document.diagnostics.some((item) => item.code === 'duplicate-node-id'), true);
  assert.equal(document.diagnostics.some((item) => item.code === 'dangling-edge'), true);
  assert.equal(document.diagnostics.some((item) => item.code === 'invalid-confidence'), true);
  assert.equal(document.edges.filter((edge) => edge.kind === 'CALLS').length, 2);
  assert.equal(document.edges.some((edge) => edge.source === edge.target), true);
});

test('preserves parallel edges and explicit inference state separately from relation kind', () => {
  const document = normalizeGraphDocument({
    nodes: [{ id: 'a', kind: 'file', label: 'A' }, { id: 'b', kind: 'file', label: 'B' }],
    edges: [
      { id: 'one', source: 'a', target: 'b', kind: 'CALLS', inferred: true, confidence: 0.4 },
      { id: 'two', source: 'a', target: 'b', kind: 'CALLS', inferred: false, confidence: 1 }
    ]
  });
  assert.equal(document.edges.length, 2);
  assert.equal(document.edges[0].kind, 'CALLS');
  assert.equal(document.edges[0].inferred, true);
  assert.equal(document.edges[1].inferred, false);
  assert.equal(new Set(document.edges.map((edge) => edge.id)).size, 2);
});

test('filters and bounds the initial visible set deterministically', () => {
  const document = normalizeGraphDocument({
    nodes: [
      ...Array.from({ length: 12 }, (_, index) => ({ id: `file:${index}`, kind: index % 2 ? 'module' : 'test', label: `File ${index}`, group: index % 2 ? 'code' : 'test' })),
      { id: 'target', kind: 'function', label: 'ExactTarget', group: 'code' }
    ],
    edges: [{ source: 'file:0', target: 'target', kind: 'CALLS' }]
  });
  const indexes = createIndexes(document);
  const exact = getVisibleNodeIds(document, { search: 'exacttarget' }, indexes, 100);
  assert.deepEqual([...exact], ['target']);
  const filtered = getVisibleNodeIds(document, { activeGroups: new Set(['test']) }, indexes, 100);
  assert.equal(filtered.size, 6);
  const bounded = getVisibleNodeIds(document, { selectedId: 'target' }, indexes, 3);
  assert.ok(bounded.has('target'));
  assert.equal(bounded.size, 3);
  const visibleEdges = getVisibleEdgeIds(document, { activeEdgeKinds: new Set(['CALLS']) }, exact, indexes);
  assert.equal(visibleEdges.size, 0);
});

test('layout is finite, deterministic, and respects saved position overlays', () => {
  const document = createSampleDocument();
  const first = computeLayout(document);
  const second = computeLayout(document);
  assert.deepEqual(first, second);
  assert.ok(Object.values(first).every((position) => Number.isFinite(position.x) && Number.isFinite(position.y)));
  const saved = { ...first, 'file:src/app.ts': { x: 11, y: -17 } };
  const overlaid = computeLayout(document, { positions: saved });
  assert.deepEqual(overlaid['file:src/app.ts'], { x: 11, y: -17 });
  const grid = computeLayout(document, { mode: 'grid', spacing: 1.4 });
  assert.ok(Object.keys(grid).length === Object.keys(first).length);
  assert.ok(Object.values(grid).every((position) => Number.isFinite(position.x) && Number.isFinite(position.y)));
});

test('keeps generated node positions from overlapping', () => {
  const document = normalizeGraphDocument({
    nodes: Array.from({ length: 24 }, (_, index) => ({ id: `n:${index}`, kind: 'module', label: `module-${index}`, group: 'code' })),
    edges: []
  });
  const positions = computeLayout(document, { mode: 'force' });
  const values = Object.values(positions);
  let minimum = Infinity;
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      minimum = Math.min(minimum, Math.hypot(values[left].x - values[right].x, values[left].y - values[right].y));
    }
  }
  assert.ok(minimum > 45, `closest generated nodes were ${minimum.toFixed(1)}px apart`);
});

test('fingerprints are stable across equivalent graph facts', () => {
  const first = normalizeGraphDocument({ nodes: [{ id: 'a', kind: 'file', label: 'A' }], edges: [] });
  const second = normalizeGraphDocument({ nodes: [{ id: 'a', kind: 'file', label: 'A' }], edges: [] });
  assert.equal(fingerprintDocument(first), fingerprintDocument(second));
});

test('new nodes avoid a saved node and enlarged labels receive more space', () => {
  const graph = normalizeGraphDocument({ nodes: [
    { id: 'fixed', kind: 'module', label: 'Long pinned module label' },
    { id: 'new', kind: 'module', label: 'Long generated module label' }
  ], edges: [] });
  const baseline = computeLayout(graph, { mode: 'grid' });
  const saved = { fixed: { ...baseline.new, pinned: true } };
  const layout = computeLayout(graph, { mode: 'grid', positions: saved, labelScale: 1.6 });
  assert.deepEqual(layout.fixed, baseline.new, 'the saved pin must stay fixed');
  const a = getNodeGeometry(graph.nodes.find(node => node.id === 'fixed'), { labelScale: 1.6 });
  const b = getNodeGeometry(graph.nodes.find(node => node.id === 'new'), { labelScale: 1.6 });
  assert.ok(Math.abs(layout.new.x - layout.fixed.x) > (a.width + b.width) / 2 || Math.abs(layout.new.y - layout.fixed.y) > (a.height + b.height) / 2, 'the new card must move clear of the pinned card');
});

test('separates oversized metadata from metadata that cannot be serialized', () => {
  const circular = { name: 'loop' };
  circular.self = circular;
  const document = normalizeGraphDocument({
    nodes: [{
      id: 'a',
      kind: 'file',
      label: 'A',
      metadata: {
        small: { nested: 'kept' },
        oversized: { blob: 'x'.repeat(4000) },
        circular
      }
    }],
    edges: []
  });
  const metadata = document.nodes[0].metadata;
  assert.deepEqual(metadata.small, { nested: 'kept' }, 'metadata within the cap should be preserved as-is');
  assert.equal(metadata.oversized, '[truncated]', 'valid but oversized metadata should be reported as truncated');
  assert.equal(metadata.circular, '[unserializable]', 'metadata that cannot be serialized should stay unserializable');
  assert.equal(document.diagnostics.some((item) => item.severity === 'error'), false, 'odd metadata must not be treated as a graph error');
});

test('dense rectangular maps keep every generated card separate', () => {
  const graph = normalizeGraphDocument({
    nodes: Array.from({ length: 86 }, (_, index) => ({ id: `n:${index}`, kind: 'module', label: `Long project module number ${index}`, group: 'code' })),
    edges: Array.from({ length: 85 }, (_, index) => ({ source: 'n:0', target: `n:${index + 1}`, kind: 'IMPORTS' }))
  });
  const positions = computeLayout(graph, { mode: 'force', nodeScale: 1.4, labelScale: 1.3 });
  for (let i = 0; i < graph.nodes.length; i += 1) for (let j = i + 1; j < graph.nodes.length; j += 1) {
    const a = getNodeGeometry(graph.nodes[i], { nodeScale: 1.4, labelScale: 1.3 });
    const b = getNodeGeometry(graph.nodes[j], { nodeScale: 1.4, labelScale: 1.3 });
    const left = positions[graph.nodes[i].id];
    const right = positions[graph.nodes[j].id];
    assert.ok(Math.abs(left.x - right.x) >= (a.width + b.width) / 2 || Math.abs(left.y - right.y) >= (a.height + b.height) / 2, `${graph.nodes[i].id} overlaps ${graph.nodes[j].id}`);
  }
});

test('isolated and connected views preserve source facts and inferred-edge visibility', () => {
  const graph = normalizeGraphDocument({ nodes: [{ id: 'a', kind: 'module', label: 'A' }, { id: 'b', kind: 'module', label: 'B' }, { id: 'alone', kind: 'module', label: 'Alone' }], edges: [{ id: 'ab', source: 'a', target: 'b', kind: 'IMPORTS', inferred: true }] });
  assert.deepEqual([...getVisibleNodeIds(graph, { isolationMode: 'isolated' })], ['alone']);
  assert.deepEqual([...getVisibleNodeIds(graph, { isolationMode: 'connected' })], ['a', 'b']);
  assert.equal(getVisibleEdgeIds(graph, { showInferred: false }).size, 0);
  assert.equal(graph.edges.length, 1);
  assert.notDeepEqual(computeLayout(graph, { mode: 'force', repulsion: 0.25 }), computeLayout(graph, { mode: 'force', repulsion: 2.5 }));
});

test('the overview hides dependencies while search can still discover them', () => {
  const graph = normalizeGraphDocument({ nodes: [{ id: 'file', kind: 'module', label: 'main.js' }, { id: 'dependency', kind: 'external', label: 'express' }], edges: [{ source: 'file', target: 'dependency', kind: 'IMPORTS' }] });
  assert.deepEqual([...getVisibleNodeIds(graph, { overviewMode: 'files' })], ['file']);
  assert.deepEqual([...getVisibleNodeIds(graph, { overviewMode: 'files', search: 'express' })], ['dependency']);
});


test('architecture rings keep sparse layers inside dense endpoints with no card collisions', () => {
  const graph = normalizeGraphDocument({ nodes: [
    { id: 'data', kind: 'model', label: 'User' },
    ...Array.from({ length: 45 }, (_, i) => ({ id: `route:${i}`, kind: 'route', label: `GET /very-long-endpoint-number-${i}` })),
    { id: 'dependency', kind: 'external', label: 'express' }
  ], edges: [] });
  const positions = computeLayout(graph, { mode: 'layered', nodeScale: 1.6, labelScale: 1.6 });
  const radius = id => Math.hypot(positions[id].x, positions[id].y);
  assert.ok(radius('data') < radius('route:0'));
  assert.ok(radius('dependency') < radius('route:0'));
  assert.deepEqual(positions, computeLayout(graph, { mode: 'layered', nodeScale: 1.6, labelScale: 1.6 }));
  for (let i = 0; i < graph.nodes.length; i++) for (let j = i + 1; j < graph.nodes.length; j++) {
    const a = graph.nodes[i], b = graph.nodes[j];
    const ga = getNodeGeometry(a, { nodeScale: 1.6, labelScale: 1.6 }), gb = getNodeGeometry(b, { nodeScale: 1.6, labelScale: 1.6 });
    assert.ok(Math.abs(positions[a.id].x - positions[b.id].x) >= (ga.width + gb.width) / 2 || Math.abs(positions[a.id].y - positions[b.id].y) >= (ga.height + gb.height) / 2, `${a.id} overlaps ${b.id}`);
  }
  const pinned = computeLayout(graph, { mode: 'layered', positions: { data: { x: 7, y: 11, pinned: true } } });
  assert.deepEqual(pinned.data, { x: 7, y: 11 });
});


test('layer names reserve padded space as fixed layout obstacles', () => {
  const graph = normalizeGraphDocument({ nodes: Array.from({ length: 12 }, (_, index) => ({ id: `model:${index}`, kind: 'model', label: `Model ${index}` })), edges: [] });
  const positions = computeLayout(graph, { mode: 'layered' });
  const y = -positions.layerRadii.Data;
  for (const node of graph.nodes) {
    const geometry = getNodeGeometry(node);
    const p = positions[node.id];
    assert.ok(Math.abs(p.x) >= (geometry.width + 160.8) / 2 || Math.abs(p.y - y) >= (geometry.height + 98) / 2, `${node.id} encroaches on the Data label's padded space`);
  }
  assert.equal(Object.keys(positions).length, graph.nodes.length, 'virtual label obstacles never become graph nodes');
});


test('a normal endpoint layer stays on one coherent ring', () => {
  const graph = normalizeGraphDocument({ nodes: Array.from({ length: 16 }, (_, i) => ({ id: `endpoint:${i}`, kind: 'route', label: `POST /api/endpoint-${i}` })), edges: [] });
  const positions = computeLayout(graph, { mode: 'layered' });
  const radius = positions.layerRadii.Endpoints;
  for (const node of graph.nodes) assert.ok(Math.abs(Math.hypot(positions[node.id].x, positions[node.id].y) - radius) < 80, 'endpoints must remain near their one layer ring');
});


test('adaptive ring pitch is consistent across arbitrary category populations', () => {
  for (const count of [3, 27, 120]) {
    const graph = normalizeGraphDocument({ nodes: [
      { id: 'model', kind: 'model', label: 'User' },
      { id: 'service', kind: 'module', label: 'src/services/service.js' },
      ...Array.from({ length: count }, (_, i) => ({ id: `r:${i}`, kind: 'route', label: `POST /endpoint/${i}` })),
      { id: 'external', kind: 'external', label: 'external-package' }
    ], edges: [] });
    const positions = computeLayout(graph, { mode: 'layered' });
    const radii = Object.values(positions.layerRadii);
    for (let i = 1; i < radii.length; i++) assert.ok(Math.abs(radii[i] - radii[i - 1] - radii[0]) < 0.001);
    assert.equal(Object.keys(positions).length, graph.nodes.length);
  }
});


test('layers with fewer nodes are inside layers with more nodes', () => {
  const graph = normalizeGraphDocument({ nodes: [
    ...Array.from({ length: 8 }, (_, i) => ({ id: `d:${i}`, kind: 'model', label: 'Model' })),
    ...Array.from({ length: 4 }, (_, i) => ({ id: `s:${i}`, kind: 'module', label: 'src/services/item.js' })),
    { id: 'r', kind: 'route', label: 'GET /item' }
  ], edges: [] });
  const positions = computeLayout(graph, { mode: 'layered' });
  assert.deepEqual(Object.keys(positions.layerRadii), ['Endpoints', 'Services', 'Data']);
  assert.ok(positions.layerRadii.Endpoints < positions.layerRadii.Services);
  assert.ok(positions.layerRadii.Services < positions.layerRadii.Data);
});

test('every layer heading takes the same circular slot as a node', () => {
  const cases = [
    ['Data', 'model', 'Model'],
    ['Services', 'module', 'src/services/item.js'],
    ['UI', 'module', 'frontend/item.jsx'],
    ['Endpoints', 'route', 'GET /item']
  ];
  for (const [layer, kind, label] of cases) {
    const graph = normalizeGraphDocument({ nodes: Array.from({ length: 3 }, (_, i) => ({ id: `n:${i}`, kind, label })), edges: [] });
    const positions = computeLayout(graph, { mode: 'layered' });
    const radius = positions.layerRadii[layer];
    assert.ok(Math.abs(positions['n:0'].x - radius) < 0.01, `${layer}: first node must be in the next slot after the top heading`);
    assert.ok(Math.abs(positions['n:1'].y - radius) < 0.01, `${layer}: second node belongs in the bottom slot`);
    assert.ok(Math.abs(positions['n:2'].x + radius) < 0.01, `${layer}: third node belongs in the left slot`);
  }
});
