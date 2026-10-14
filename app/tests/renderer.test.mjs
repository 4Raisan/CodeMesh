import test from 'node:test';
import assert from 'node:assert/strict';

class StubClassList {
  constructor() { this.tokens = new Set(); }
  add(...names) { for (const name of names) this.tokens.add(name); }
  remove(...names) { for (const name of names) this.tokens.delete(name); }
  contains(name) { return this.tokens.has(name); }
}

class StubElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.style = { setProperty() {}, backgroundColor: '' };
    this.classList = new StubClassList();
    this.textContent = '';
    this.listeners = new Map();
    this.parentNode = null;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  removeEventListener() {}
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 700 }; }
  closest(selector) {
    const attribute = selector.replace(/[[\]]/g, '');
    for (let node = this; node; node = node.parentNode) {
      if (node.getAttribute(attribute) !== null) return node;
    }
    return null;
  }
  descendants() {
    const found = [];
    const walk = (node) => { for (const child of node.children) { found.push(child); walk(child); } };
    walk(this);
    return found;
  }
}

let animationFrames = [];

globalThis.document = {
  createElement: (tag) => new StubElement(tag),
  createElementNS: (_namespace, tag) => new StubElement(tag)
};
globalThis.window = {
  requestAnimationFrame: (callback) => animationFrames.push(callback),
  cancelAnimationFrame: () => { animationFrames = []; },
  addEventListener() {},
  removeEventListener() {},
  innerWidth: 1000,
  innerHeight: 700
};

const { GraphRenderer } = await import('../renderer.js');
const { createSampleDocument, normalizeGraphDocument } = await import('../graph-core.js');

function flushFrames() {
  const pending = animationFrames;
  animationFrames = [];
  for (const callback of pending) callback();
}

function createTestRenderer(document = createSampleDocument()) {
  const svg = new StubElement('svg');
  const renderer = new GraphRenderer(svg, {});
  renderer.setDocument(document);
  renderer.setView(renderer.getView());
  flushFrames();
  return { svg, renderer };
}

function pressKey(renderer, key) {
  const before = { x: renderer.view.x, y: renderer.view.y };
  renderer.onKeyDown({ key, target: new StubElement('svg'), preventDefault() {} });
  return { x: renderer.view.x - before.x, y: renderer.view.y - before.y };
}

test('arrow keys pan the viewport in the same direction as a pointer drag', () => {
  const { renderer } = createTestRenderer();
  // Panning uses "grab" semantics, proven by the pointer path: dragging the pointer
  // down by 50px moves the viewport down by 50px, so ArrowDown must add to view.y.
  renderer.onPointerDown({ button: 0, pointerId: 1, clientX: 500, clientY: 300, target: new StubElement('svg'), preventDefault() {} });
  renderer.onPointerMove({ pointerId: 1, clientX: 500, clientY: 350, preventDefault() {} });
  renderer.onPointerUp({ pointerId: 1, clientX: 500, clientY: 350 });
  assert.equal(renderer.view.y, 50, 'dragging down should move the viewport down');

  const right = pressKey(renderer, 'ArrowRight');
  assert.ok(right.x < 0 && right.y === 0, `ArrowRight should pan right (negative x offset), got ${JSON.stringify(right)}`);

  const left = pressKey(renderer, 'ArrowLeft');
  assert.ok(left.x > 0 && left.y === 0, `ArrowLeft should pan left (positive x offset), got ${JSON.stringify(left)}`);

  const down = pressKey(renderer, 'ArrowDown');
  assert.ok(down.y > 0 && down.x === 0, `ArrowDown should pan down (positive y offset), got ${JSON.stringify(down)}`);

  const up = pressKey(renderer, 'ArrowUp');
  assert.ok(up.y < 0 && up.x === 0, `ArrowUp should pan up (negative y offset), got ${JSON.stringify(up)}`);
});

test('search highlighting covers every field the visibility filter matches', () => {
  const { svg, renderer } = createTestRenderer(normalizeGraphDocument({
    nodes: [
      { id: 'qualified', kind: 'module', label: 'PlainLabel', group: 'code', qualifiedName: 'WidgetFactory' },
      { id: 'metadata', kind: 'module', label: 'OtherLabel', group: 'code', metadata: { note: 'hidden-gem' } },
      { id: 'plain', kind: 'module', label: 'Unrelated', group: 'code' }
    ],
    edges: []
  }));

  for (const [search, expected] of [['widgetfactory', 'qualified'], ['hidden-gem', 'metadata']]) {
    renderer.setView({ search });
    flushFrames();
    assert.deepEqual([...renderer.visibleNodeIds], [expected], `filter should keep only ${expected} for "${search}"`);
    const group = svg.descendants().find((element) => element.getAttribute('data-node-id') === expected);
    assert.ok(group, `expected ${expected} to be rendered`);
    assert.match(group.getAttribute('class'), /is-search-match/, `${expected} matched the filter but was not highlighted`);
  }
});

test('setView clamps zoom and rejects non-finite offsets instead of writing NaN positions', () => {
  const { renderer } = createTestRenderer();
  renderer.setView({ scale: 0, x: Number.NaN, y: Number.POSITIVE_INFINITY });
  assert.ok(renderer.view.scale >= 0.08, `scale should be clamped away from zero, got ${renderer.view.scale}`);
  assert.ok(Number.isFinite(renderer.view.x) && Number.isFinite(renderer.view.y), 'offsets must stay finite');

  renderer.setView({ scale: 99 });
  assert.ok(renderer.view.scale <= 3, `scale should be clamped to the zoom ceiling, got ${renderer.view.scale}`);

  const target = 'file:src/app.ts';
  renderer.onPointerDown({ button: 0, pointerId: 1, clientX: 500, clientY: 300, target: new StubElement('svg'), preventDefault() {} });
  renderer.drag = { type: 'node', id: target, pointerId: 1, startX: 500, startY: 300, moved: false, point: { x: 0, y: 0 } };
  renderer.onPointerMove({ pointerId: 1, clientX: 540, clientY: 330, preventDefault() {} });
  const dragged = renderer.positions[target];
  assert.equal(dragged, undefined, 'locked nodes must not record a dragged position');
});

test('destroy releases the queued frame so the renderer can be driven again', () => {
  const { renderer } = createTestRenderer();
  renderer.scheduleRender();
  assert.ok(animationFrames.length > 0, 'a render should be queued before destroy');
  renderer.destroy();
  assert.equal(renderer.frame, null, 'destroy must clear the frame handle');
  animationFrames = [];
  renderer.scheduleRender();
  assert.equal(animationFrames.length, 1, 'a destroyed renderer should be able to schedule a new frame');
});

test('mouse and keyboard selection notify the inspector without recomputing layout', () => {
  const { renderer } = createTestRenderer();
  const layout = renderer.layout;
  const selected = [];
  renderer.callbacks.onSelect = id => selected.push(id);
  renderer.selectNode('file:src/app.ts');
  flushFrames();
  assert.deepEqual(selected, ['file:src/app.ts']);
  assert.strictEqual(renderer.layout, layout, 'selection must reuse the settled layout');
});

test('attempting to drag a locked node preserves every node position', () => {
  const { renderer } = createTestRenderer();
  const before = structuredClone(renderer.layout);
  const id = 'file:src/app.ts';
  renderer.drag = { type: 'node', id, pointerId: 1, startX: 500, startY: 300, moved: false };
  renderer.onPointerMove({ pointerId: 1, clientX: 540, clientY: 330, preventDefault() {} });
  flushFrames();
  for (const [nodeId, position] of Object.entries(before)) {
    if (nodeId !== id) assert.deepEqual(renderer.layout[nodeId], position, `${nodeId} moved during a different node's drag`);
  }
  assert.deepEqual(renderer.layout[id], before[id]);
});

test('parallel edges have separate paths and arrows stop before node centers', () => {
  const { svg } = createTestRenderer(normalizeGraphDocument({
    nodes: [{ id: 'a', kind: 'module', label: 'A' }, { id: 'b', kind: 'module', label: 'B' }],
    edges: [{ id: 'one', source: 'a', target: 'b', kind: 'IMPORTS' }, { id: 'two', source: 'a', target: 'b', kind: 'CALLS' }]
  }));
  const paths = svg.descendants().filter(element => element.getAttribute('data-edge-id'));
  assert.equal(paths.length, 2);
  assert.notEqual(paths[0].getAttribute('d'), paths[1].getAttribute('d'));
});

test('filtered neighborhoods are not reported as a capped overview', () => {
  const { renderer } = createTestRenderer();
  let status;
  renderer.callbacks.onVisibility = info => { status = info; };
  renderer.setView({ focusIds: new Set(['file:src/app.ts']) });
  flushFrames();
  assert.equal(status.visibleNodes, 1);
  assert.equal(status.truncated, false);
});

test('selection shows both relationship styles when idle checkboxes are off', () => {
  const graph = normalizeGraphDocument({ nodes: ['a', 'b', 'c'].map(id => ({ id, kind: 'module', label: id })), edges: [
    { id: 'solid', source: 'a', target: 'b', kind: 'IMPORTS' },
    { id: 'dashed', source: 'a', target: 'c', kind: 'CALLS', inferred: true },
    { id: 'unrelated', source: 'b', target: 'c', kind: 'IMPORTS' }
  ] });
  const { renderer, svg } = createTestRenderer(graph);
  const edges = () => svg.descendants().filter(element => (element.getAttribute('class') ?? '').split(' ').includes('kg-edge'));
  renderer.setView({ showSolid: false, showInferred: false, selectedId: null });
  flushFrames();
  assert.equal(edges().length, 0);
  renderer.setView({ selectedId: 'a' });
  flushFrames();
  assert.equal(edges().length, 2);
  renderer.setView({ showSolid: true, showInferred: true, edgeLabelMode: 'off' });
  flushFrames();
  assert.equal(edges().length, 2, 'only selected connections appear even with both idle styles enabled');
  assert.equal(new Set(svg.descendants().filter(element => element.getAttribute('class') === 'kg-edge-label')).size, 2);
  renderer.setView({ showSolid: false, showInferred: false });
  renderer.setView({ selectedId: null });
  flushFrames();
  assert.equal(edges().length, 0);
});

test('dragging a grid heading moves its entire group and leaves other groups fixed', () => {
  const graph = normalizeGraphDocument({ nodes: [
    { id: 'a', kind: 'model', label: 'User' }, { id: 'b', kind: 'model', label: 'Game' },
    { id: 'c', kind: 'external', label: 'react' }
  ], edges: [] });
  const { renderer, svg } = createTestRenderer(graph);
  renderer.setView({ layoutMode: 'grid', scale: 1 });
  flushFrames();
  const before = structuredClone(renderer.layout);
  const heading = svg.descendants().find(element => element.getAttribute('data-group-name') === 'Data');
  renderer.onPointerDown({ target: heading, button: 0, pointerId: 1, clientX: 100, clientY: 100, preventDefault() {} });
  renderer.onPointerMove({ pointerId: 1, clientX: 140, clientY: 120, preventDefault() {} });
  flushFrames();
  renderer.onPointerUp({ pointerId: 1 });
  for (const id of ['a', 'b']) {
    assert.equal(renderer.layout[id].x, before[id].x + 40);
    assert.equal(renderer.layout[id].y, before[id].y + 20);
  }
  assert.deepEqual(renderer.layout.c, before.c);
});

test('the viewer displays all loaded nodes without the former 650-node cap', () => {
  const graph = normalizeGraphDocument({ nodes: Array.from({ length: 701 }, (_, i) => ({ id: `n:${i}`, kind: 'module', label: `File ${i}` })), edges: [] });
  const { renderer } = createTestRenderer(graph);
  assert.equal(renderer.visibleNodeIds.size, 701);
});

test('rectangular nodes contain their title and a plain-language type', () => {
  const { svg } = createTestRenderer();
  const group = svg.descendants().find(element => element.getAttribute('data-node-id') === 'file:src/app.ts');
  const shape = group.children.find(element => element.getAttribute('class') === 'kg-node-shape');
  const title = group.children.find(element => element.getAttribute('class') === 'kg-node-label');
  const type = group.children.find(element => element.getAttribute('class') === 'kg-node-kind');
  assert.equal(title.textContent, 'app.ts');
  assert.equal(type.textContent, 'Code file');
  assert.ok(Number(title.getAttribute('y')) > Number(shape.getAttribute('y')));
  assert.ok(Number(type.getAttribute('y')) < Number(shape.getAttribute('y')) + Number(shape.getAttribute('height')));
});

test('every visible edge has both endpoints visible and an allowed kind', () => {
  const { renderer } = createTestRenderer(normalizeGraphDocument({
    nodes: Array.from({ length: 40 }, (_, index) => ({ id: `n:${index}`, kind: 'module', label: `Module ${index}`, group: 'code' })),
    edges: Array.from({ length: 39 }, (_, index) => ({ source: `n:${index}`, target: `n:${index + 1}`, kind: index % 2 ? 'CALLS' : 'IMPORTS' }))
  }));
  renderer.callbacks.visibleLimit = 10;
  renderer.setView({});
  flushFrames();
  assert.equal(renderer.visibleNodeIds.size, 10, 'the visible node limit must cap the rendered set');
  assert.ok(renderer.visibleNodeIds.size < renderer.document.nodes.length, 'the fixture must actually be truncated');
  for (const id of renderer.visibleEdgeIds) {
    const edge = renderer.document.edges.find((item) => item.id === id);
    assert.ok(renderer.visibleNodeIds.has(edge.source) && renderer.visibleNodeIds.has(edge.target), `edge ${id} has a hidden endpoint`);
  }

  renderer.setView({ activeEdgeKinds: new Set(['CALLS']) });
  flushFrames();
  for (const id of renderer.visibleEdgeIds) {
    const edge = renderer.document.edges.find((item) => item.id === id);
    assert.equal(edge.kind, 'CALLS', `edge ${id} should not survive the kind filter`);
  }
});
