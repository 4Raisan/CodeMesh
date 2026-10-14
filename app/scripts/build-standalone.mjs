import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertFactoryWired,
  assertNoResidualModuleSyntax,
  importedBindings,
  inlineOrThrow,
  stripModuleSyntax
} from './standalone-guard.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (name) => readFile(resolve(root, name), 'utf8');
const escapeRaw = (value) => value.replace(/<\/script/gi, '<\\/script');

const [indexHtml, styles, core, parser, renderer, app] = await Promise.all([
  read('index.html'),
  read('styles.css'),
  read('graph-core.js'),
  read('codebase-parser.js'),
  read('renderer.js'),
  read('app.js')
]);

const coreBody = stripModuleSyntax(core);
const parserBody = stripModuleSyntax(parser);
const rendererBody = stripModuleSyntax(renderer);
const appBody = stripModuleSyntax(app).replace(
  "new Worker(new URL('./parser-worker.js', import.meta.url), { type: 'module' })",
  "(() => { throw new Error('Standalone parser uses the main thread.'); })()"
);

for (const [label, body] of [
  ['graph-core.js', coreBody],
  ['codebase-parser.js', parserBody],
  ['renderer.js', rendererBody],
  ['app.js', appBody]
]) {
  assertNoResidualModuleSyntax(body, label);
}

const bundle = `
const KGCore = (() => {
${coreBody}
return { SCHEMA_VERSION, MAX_NODES, MAX_EDGES, DEFAULT_VISIBLE_NODE_LIMIT, DEFAULT_COLORS, createEmptyDocument, normalizeGraphDocument, GraphBuilder, createIndexes, getNodeSearchText, getVisibleNodeIds, getVisibleEdgeIds, computeLayout, getBounds, getArchitectureLayer, getNodeColor, getNodeKindLabel, getNodeGeometry, fingerprintDocument, createSampleDocument };
})();
const KGParser = ((GraphBuilder, SCHEMA_VERSION) => {
${parserBody}
return { shouldIgnorePath, detectLanguage, createCodebaseGraph };
})(KGCore.GraphBuilder, KGCore.SCHEMA_VERSION);
const KGRenderer = ((DEFAULT_COLORS, computeLayout, createIndexes, getBounds, getArchitectureLayer, getNodeColor, getNodeKindLabel, getNodeGeometry, getNodeSearchText, getVisibleEdgeIds, getVisibleNodeIds) => {
${rendererBody}
return { GraphRenderer, getRendererSummary };
})(KGCore.DEFAULT_COLORS, KGCore.computeLayout, KGCore.createIndexes, KGCore.getBounds, KGCore.getArchitectureLayer, KGCore.getNodeColor, KGCore.getNodeKindLabel, KGCore.getNodeGeometry, KGCore.getNodeSearchText, KGCore.getVisibleEdgeIds, KGCore.getVisibleNodeIds);
const KGApp = ((createIndexes, createEmptyDocument, createSampleDocument, fingerprintDocument, getNodeColor, getNodeKindLabel, getVisibleNodeIds, normalizeGraphDocument, shouldIgnorePath, createCodebaseGraph, GraphRenderer) => {
${appBody}
})(KGCore.createIndexes, KGCore.createEmptyDocument, KGCore.createSampleDocument, KGCore.fingerprintDocument, KGCore.getNodeColor, KGCore.getNodeKindLabel, KGCore.getVisibleNodeIds, KGCore.normalizeGraphDocument, KGParser.shouldIgnorePath, KGParser.createCodebaseGraph, KGRenderer.GraphRenderer);
`;

for (const [factory, source, label] of [
  ['KGParser', parser, 'codebase-parser.js'],
  ['KGRenderer', renderer, 'renderer.js'],
  ['KGApp', app, 'app.js']
]) {
  assertFactoryWired(bundle, factory, source, label);
}

const provided = new Set(
  /const KGApp = \(\(([^)]*)\)/.exec(bundle)[1].split(',').map((name) => name.trim()).filter(Boolean)
);
const unprovided = importedBindings(app).filter((name) => !provided.has(name));
if (unprovided.length > 0) throw new Error(`KGApp factory arguments drift from app.js imports: ${unprovided.join(', ')}`);

const standalone = inlineOrThrow(
  indexHtml,
  '<link rel="stylesheet" href="./styles.css">',
  `<style>${styles}</style>`,
  'the stylesheet link'
);
const withScript = inlineOrThrow(
  standalone,
  '<script type="module" src="./app.js"></script>',
  `<script>${escapeRaw(bundle)}</script>`,
  'the app module script'
);

const releaseDir = resolve(root, '..', 'release');
await mkdir(releaseDir, { recursive: true });
const license = await readFile(resolve(root, '..', 'LICENSE'), 'utf8');
await writeFile(resolve(releaseDir, 'CodeWeb.html'), withScript.replace('<!doctype html>', '<!doctype html>\n<!--\n' + license + '\n-->'), 'utf8');
process.stdout.write(`Wrote ${resolve(releaseDir, 'CodeWeb.html')}\n`);
