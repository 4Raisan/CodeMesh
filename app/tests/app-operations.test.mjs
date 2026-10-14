import test from 'node:test';
import assert from 'node:assert/strict';

// app.js runs initialize() on import, so the DOM, fetch and rAF doubles must exist first.
// Worker is deliberately left undefined so the parser takes its synchronous main-thread
// fallback, which keeps the test offline and deterministic.

class StubClassList {
  constructor() { this.tokens = new Set(); }
  add(...names) { for (const name of names) this.tokens.add(name); }
  remove(...names) { for (const name of names) this.tokens.delete(name); }
  contains(name) { return this.tokens.has(name); }
  toggle(name, force) {
    const on = force === undefined ? !this.tokens.has(name) : Boolean(force);
    if (on) this.tokens.add(name); else this.tokens.delete(name);
    return on;
  }
}

class StubElement {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = []; this.attributes = new Map(); this.listeners = new Map();
    this.style = { setProperty() {}, display: '' };
    this.classList = new StubClassList();
    this.className = ''; this.textContent = ''; this.value = ''; this.checked = false;
    this.hidden = false; this.parentNode = null; this.dataset = {};
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  insertBefore(node, ref) { const index = this.children.indexOf(ref); this.children.splice(index === -1 ? 0 : index, 0, node); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this); }
  get firstChild() { return this.children[0] ?? null; }
  addEventListener(type, handler) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(handler); }
  removeEventListener() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 1200, height: 800 }; }
  closest(selector) {
    const attribute = selector.replace(/[[\]]/g, '');
    for (let node = this; node; node = node.parentNode) if (node.getAttribute(attribute) !== null) return node;
    return null;
  }
  descendants() {
    const found = [];
    const walk = (node) => { for (const child of node.children) { found.push(child); walk(child); } };
    walk(this);
    return found;
  }
}

const elements = new Map();
const documentListeners = new Map();
const elementFor = (id) => {
  if (!elements.has(id)) elements.set(id, new StubElement('div'));
  return elements.get(id);
};

globalThis.document = {
  body: new StubElement('body'),
  createElement: (tag) => new StubElement(tag),
  createElementNS: (_namespace, tag) => new StubElement(tag),
  getElementById: elementFor,
  addEventListener: (type, handler) => { if (!documentListeners.has(type)) documentListeners.set(type, []); documentListeners.get(type).push(handler); },
  removeEventListener() {},
  querySelectorAll: () => []
};

let animationFrames = [];
const flushFrames = () => { const pending = animationFrames; animationFrames = []; for (const frame of pending) frame(); };

globalThis.window = {
  location: { protocol: 'http:', href: 'http://127.0.0.1:8000/index.html', origin: 'http://127.0.0.1:8000' },
  requestAnimationFrame: (frame) => { animationFrames.push(frame); return animationFrames.length; },
  cancelAnimationFrame: () => { animationFrames = []; },
  addEventListener() {}, removeEventListener() {},
  innerWidth: 1200, innerHeight: 800,
  setTimeout: () => 0, clearTimeout: () => {},
  localStorage: { getItem: () => null, setItem() {} }
};
globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
globalThis.cancelAnimationFrame = globalThis.window.cancelAnimationFrame;

// Only the parsers app.js actually calls: link extraction from a listing, and text reads.
const LISTINGS = new Map([
  ['http://127.0.0.1:8000/', ['src/', 'package.json']],
  ['http://127.0.0.1:8000/src/', ['a.js']]
]);
const FILES = new Map([
  ['http://127.0.0.1:8000/package.json', JSON.stringify({ name: 'server-project', dependencies: { express: '^5.0.0' } })],
  ['http://127.0.0.1:8000/src/a.js', "export const fromServer = 1;\n"]
]);

// The boot-time crawl is parked on this file so the test can decide when it finishes.
let releaseHeldFile = null;
const heldFileUrl = 'http://127.0.0.1:8000/src/a.js';

globalThis.fetch = async (url) => {
  const href = String(url);
  if (heldFileUrl && href === heldFileUrl) {
    await new Promise((resolve) => { releaseHeldFile = () => resolve(); });
  }  if (LISTINGS.has(href)) {
    const links = LISTINGS.get(href).map((hrefValue) => `<a href="${hrefValue}">${hrefValue}</a>`).join('');
    return { ok: true, headers: { get: () => 'text/html; charset=utf-8' }, text: async () => `<html><body>${links}</body></html>`, json: async () => ({}) };
  }
  if (FILES.has(href)) {
    return { ok: true, headers: { get: () => 'application/javascript' }, text: async () => FILES.get(href), json: async () => JSON.parse(FILES.get(href)) };
  }
  return { ok: false, headers: { get: () => 'text/plain' }, text: async () => '', json: async () => ({}) };
};

globalThis.DOMParser = class {
  parseFromString(html) {
    const hrefs = [...html.matchAll(/<a href="([^"]*)"/g)].map((match) => match[1]);
    return { querySelectorAll: () => hrefs.map((value) => ({ getAttribute: () => value })) };
  }
};

await import('../app.js');
flushFrames();

const settle = async (turns = 12) => { for (let index = 0; index < turns; index += 1) await new Promise((resolve) => setImmediate(resolve)); };
const text = (id) => elementFor(id).textContent;
const fakeFile = (name, source) => ({ name, size: source.length, text: async () => source });
const drop = (files) => {
  const handler = documentListeners.get('drop')[0];
  handler({ preventDefault() {}, dataTransfer: { types: ['Files'], items: [], files } });
};

test('a slow auto-discovery cannot overwrite a graph the user just dropped', async () => {
  assert.equal(typeof globalThis.Worker, 'undefined', 'the parser must use its main-thread fallback');

  drop([fakeFile('dropped-a.js', "import './missing-a.js';\n"), fakeFile('dropped-b.js', 'export const b = 1;\n')]);
  await settle();
  flushFrames();
  assert.equal(typeof releaseHeldFile, 'function', 'precondition: the boot-time crawl must be parked mid-import, otherwise this test proves nothing');
  assert.match(text('source-hint'), /^dropped selection · \d+ nodes loaded$/, 'the drop should be displayed while the crawl is in flight');

  releaseHeldFile();
  await settle();
  flushFrames();
  assert.match(text('source-hint'), /^dropped selection · \d+ nodes loaded$/, 'the completed auto-discovery must not replace the newer drop');
  assert.doesNotMatch(text('source-hint'), /auto ·/, 'a superseded auto-discovery must not adopt its graph');
  assert.doesNotMatch(text('toast'), /Auto-discovered|auto · this project/);
});

test('a superseded drop cannot overwrite a newer drop', async () => {
  let releaseSlowFile = null;
  const slowFile = { name: 'slow-a.js', size: 40, text: () => new Promise((resolve) => { releaseSlowFile = () => resolve("import './nope.js';\n"); }) };

  drop([slowFile, fakeFile('slow-b.js', 'export const a = 1;\n')]);
  drop([fakeFile('fast.js', 'export const b = 1;\n')]);
  await settle();
  flushFrames();
  assert.equal(typeof releaseSlowFile, 'function', 'precondition: the older drop must still be waiting on its file read');
  assert.equal(text('source-hint'), 'dropped selection · 1 nodes loaded', 'the newer drop should win while the older one is still reading');

  releaseSlowFile();
  await settle();
  flushFrames();
  assert.equal(text('source-hint'), 'dropped selection · 1 nodes loaded', 'the superseded drop must not replace the newer graph');
});

test('a dropped directory connects real file entries and skips generated folders before reading', async () => {
  let generatedReads = 0;
  const fileEntry = (name, source) => ({ name, isFile: true, file: callback => callback(fakeFile(name, source)) });
  const directoryEntry = (name, children) => ({ name, isDirectory: true, createReader() {
    let first = true;
    return { readEntries(callback) { const batch = first ? children : []; first = false; queueMicrotask(() => callback(batch)); } };
  } });
  const generated = { name: 'node_modules', isDirectory: true, createReader() { generatedReads += 1; throw new Error('Generated directory must not be opened'); } };
  const directory = directoryEntry('project', [
    directoryEntry('src', [fileEntry('main.js', "import './helper.js';"), fileEntry('helper.js', 'export const helper = true;')]),
    generated
  ]);
  documentListeners.get('drop')[0]({ preventDefault() {}, dataTransfer: {
    types: ['Files'], files: [], items: [{ webkitGetAsEntry: () => directory }]
  } });
  await settle();
  flushFrames();
  assert.equal(generatedReads, 0);
  assert.match(text('source-hint'), /2 nodes loaded/);
  assert.match(text('graph-status'), /2 \/ 2 nodes · 1 \/ 1 connections/);
});

test('unchecking the last node type shows an empty map instead of restoring every node', () => {
  const input = elementFor('kind-filters').descendants().find(element => element.tagName === 'INPUT');
  input.checked = false;
  input.listeners.get('change')[0]();
  flushFrames();
  assert.match(text('graph-status'), /0 \/ 2 nodes/);
});
