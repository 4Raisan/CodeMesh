import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { stripModuleSyntax } from '../scripts/standalone-guard.mjs';

const read = (name) => readFile(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');
const [indexHtml, standaloneHtml, appSource, rendererSource, parserSource, coreSource] = await Promise.all([
  read('index.html'),
  read('../release/CodeMesh.html'),
  read('app.js'),
  read('renderer.js'),
  read('codebase-parser.js'),
  read('graph-core.js')
]);

test('standalone HTML is self-contained and exposes the copy-anywhere flow', () => {
  assert.match(standaloneHtml, /Open project/);
  assert.doesNotMatch(standaloneHtml, /<script[^>]+src=/);
  assert.doesNotMatch(standaloneHtml, /<link[^>]+stylesheet/);
  assert.match(standaloneHtml, /CodeMesh/);
  assert.match(standaloneHtml, /Force layout settings/);
  assert.match(standaloneHtml, /Animate connections/);
});

test('HTML exposes drag/drop, file, folder, view, and keyboard entry points', () => {
  for (const id of ['open-files', 'open-folder', 'drop-overlay', 'search-input', 'graph-svg', 'inspector-content', 'node-list', 'export-view', 'export-svg', 'export-graph', 'settings-dock', 'layout-mode', 'layout-spacing', 'motion-toggle', 'edge-label-mode', 'reset-settings']) {
    assert.match(indexHtml, new RegExp(`id=["']${id}["']`));
  }
  assert.match(indexHtml, /webkitdirectory/);
  assert.match(indexHtml, /aria-label=/);
  assert.match(indexHtml, /role="status"/);
});

test('viewer does not use unsafe HTML injection or evaluate source text', () => {
  assert.doesNotMatch(appSource, /\.innerHTML\s*=/);
  assert.doesNotMatch(rendererSource, /\beval\s*\(/);
  assert.doesNotMatch(parserSource, /\beval\s*\(/);
  assert.doesNotMatch(coreSource, /\beval\s*\(/);
  assert.doesNotMatch(indexHtml, /https?:\/\/[^"']+\.js/);
});

test('graph contracts and renderer are data-driven', () => {
  assert.match(coreSource, /SCHEMA_VERSION/);
  assert.match(coreSource, /inferred/);
  assert.match(coreSource, /source/);
  assert.match(parserSource, /browser-folder-drop/);
  assert.match(rendererSource, /kg-node/);
  assert.match(rendererSource, /aria-label/);
});

test('static shell declares the required non-pointer list fallback', () => {
  assert.match(indexHtml, /class="node-browser"/);
  assert.match(indexHtml, /Select a node to see its source and connections/);
  assert.match(appSource, /renderList/);
  assert.match(appSource, /selectNode/);
  assert.match(appSource, /discoverServerProject/);
  assert.match(appSource, /discoverServerProject/);
  assert.match(appSource, /readServerListing/);
  assert.match(appSource, /showDirectoryPicker/);
});

test('every element id app.js looks up exists in the static shell', () => {
  const referenced = new Set([...appSource.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)].map((match) => match[1]));
  assert.ok(referenced.size > 20, `expected many element references, found ${referenced.size}`);
  const missing = [...referenced].filter((id) => !new RegExp(`id=["']${id}["']`).test(indexHtml));
  assert.deepEqual(missing, [], `app.js would throw during boot for missing element ids: ${missing.join(', ')}`);
});

test('every function that adopts a document also guards against a superseded operation', () => {
  assert.match(appSource, /function beginDocumentOperation\(\)/);
  assert.match(appSource, /function isCurrentDocumentOperation\(operation\)/);
  assert.match(appSource, /function adoptDocument\(input, sourceLabel, operation = beginDocumentOperation\(\)\)/);
  assert.match(appSource, /function applySavedView\(payload, quiet = false, operation = beginDocumentOperation\(\)\)/);

  // Split on top-level function declarations and require staleness checks in every
  // function that can reach adoptDocument/applySavedView, so a newly added async
  // discovery or import path cannot silently skip the guard.
  const blocks = appSource.split(/\n(?=(?:async )?function [A-Za-z0-9_]+)/);
  const adopters = blocks.filter((block) => /\b(?:adoptDocument|applySavedView)\(/.test(block));
  assert.ok(adopters.length >= 5, `expected several adopting functions, found ${adopters.length}`);
  for (const block of adopters) {
    const name = /^(?:async )?function ([A-Za-z0-9_]+)/.exec(block)?.[1] ?? '(anonymous)';
    assert.match(block, /isCurrentDocumentOperation\(/, `${name} can adopt a document but never checks whether it is still the newest intent`);
  }
});

test('the standalone bundle embeds the current module sources', () => {
  // The standalone build strips module syntax and swaps the parser Worker for a
  // main-thread stub, so app.js is compared after the same substitution.
  const workerStub = "(() => { throw new Error('Standalone parser uses the main thread.'); })()";
  const expected = [
    ['graph-core.js', stripModuleSyntax(coreSource)],
    ['codebase-parser.js', stripModuleSyntax(parserSource)],
    ['renderer.js', stripModuleSyntax(rendererSource)],
    ['app.js', stripModuleSyntax(appSource).replace("new Worker(new URL('./parser-worker.js', import.meta.url), { type: 'module' })", workerStub)]
  ];
  for (const [name, body] of expected) {
    assert.ok(body.length > 200, `fixture for ${name} looks wrong`);
    assert.ok(standaloneHtml.includes(body), `CodeMesh.html is stale; rebuild it with "npm run build:standalone" (${name} no longer matches)`);
  }
});
