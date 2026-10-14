import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createCodebaseGraph } from '../codebase-parser.js';
import { createSampleDocument, normalizeGraphDocument } from '../graph-core.js';

const indexPath = fileURLToPath(new URL('../index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../app.js', import.meta.url));
const rendererPath = fileURLToPath(new URL('../renderer.js', import.meta.url));
const indexHtml = await readFile(indexPath, 'utf8');
const appSource = await readFile(appPath, 'utf8');
const rendererSource = await readFile(rendererPath, 'utf8');
for (const id of ['graph-svg', 'drop-overlay', 'search-input', 'inspector-content', 'node-list', 'file-input', 'folder-input', 'view-input']) {
  assert.match(indexHtml, new RegExp(`id=["']${id}["']`), `missing UI anchor #${id}`);
}
assert.doesNotMatch(appSource, /\.innerHTML\s*=/, 'imported content must not be assigned through innerHTML');
assert.doesNotMatch(rendererSource, /\beval\s*\(/, 'viewer must not evaluate source text');
assert.doesNotMatch(indexHtml, /https?:\/\/[^"']+\.js/, 'viewer must not depend on a remote script');
const sample = createSampleDocument();
assert.ok(sample.nodes.length > 0 && sample.edges.length > 0);
const generated = createCodebaseGraph([{ path: 'src/app.js', text: "import './service.js';\n", bytes: 30 }, { path: 'src/service.js', text: 'export function run() {}\n', bytes: 29 }]);
assert.equal(generated.nodes.length, 2);
assert.equal(generated.edges.length, 1);
const normalized = normalizeGraphDocument({ nodes: [{ id: 'a', kind: 'file', label: 'A' }], edges: [] });
assert.equal(normalized.schemaVersion, 'codeweb/1');
process.stdout.write('PASS: static UI wiring and graph contract checks\n');
