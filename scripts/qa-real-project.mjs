import { createServer } from 'node:http';
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCodebaseGraph, shouldIgnorePath, detectLanguage } from '../app/codebase-parser.js';
import { computeLayout } from '../app/graph-core.js';

// Read-only real-project audit. Only supported source files are read; the project is never executed.
const project = resolve(process.argv[2]);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const records = [];
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    const path = relative(project, absolute).replaceAll('\\', '/');
    if (entry.isSymbolicLink() || shouldIgnorePath(path) || /(?:^|\/)(?:\.env[^/]*|credentials[^/]*|secrets?[^/]*)$/i.test(path)) continue;
    if (entry.isDirectory()) await scan(absolute);
    else if (detectLanguage(path) !== 'Text') {
      const bytes = await readFile(absolute);
      if (bytes.length <= 2 * 1024 * 1024 && !bytes.includes(0)) records.push({ path, text: bytes.toString('utf8'), bytes: bytes.length });
    }
  }
}
await scan(project);
const start = performance.now();
const graph = createCodebaseGraph(records, { name: project.split(/[\\/]/).pop(), stripCommonRoot: false });
const parseMs = performance.now() - start;
const ids = new Set(graph.nodes.map(node => node.id));
const layoutStart = performance.now();
const layout = computeLayout(graph);
const summary = {
  project: graph.name, files: records.length, nodes: graph.nodes.length, edges: graph.edges.length,
  parseMs: +parseMs.toFixed(2), layoutMs: +(performance.now() - layoutStart).toFixed(2),
  duplicateNodes: graph.nodes.length - ids.size,
  danglingEdges: graph.edges.filter(edge => !ids.has(edge.source) || !ids.has(edge.target)).length,
  missingEvidence: graph.edges.filter(edge => !edge.evidence?.path).length,
  nonfinitePositions: Object.values(layout).filter(position => !Number.isFinite(position.x) || !Number.isFinite(position.y)).length,
  unresolvedImports: graph.diagnostics.filter(item => item.code === 'unresolved-import').length,
  routes: graph.coverage.routeCount, models: graph.coverage.modelCount
};
await mkdir(resolve(root, 'docs', 'qa'), { recursive: true });
await writeFile(resolve(root, 'docs', 'qa', `${graph.name.toLowerCase().replace(/[^a-z0-9-]/g, '-')}-audit.json`), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
if (!process.argv.includes('--serve')) process.exit(0);
const files = new Map(records.map(record => [`/${record.path}`, record.text]));
const escapeHtml = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const port = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) ?? 8001);
createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    response.setHeader('Cache-Control', 'no-store');
    if (path.endsWith('/CodeMesh.html')) {
      response.setHeader('Content-Type', 'text/html');
      response.end(await readFile(resolve(root, 'release', 'CodeMesh.html')));
    } else if (files.has(path)) {
      response.setHeader('Content-Type', 'text/plain; charset=utf-8');
      response.end(files.get(path));
    } else if (path.endsWith('/')) {
      const children = new Set();
      for (const key of files.keys()) {
        if (!key.startsWith(path)) continue;
        const rest = key.slice(path.length);
        const slash = rest.indexOf('/');
        children.add(slash < 0 ? rest : rest.slice(0, slash + 1));
      }
      response.setHeader('Content-Type', 'text/html');
      response.end([...children].map(child => `<a href="${escapeHtml(child)}">${escapeHtml(child)}</a>`).join('\n'));
    } else { response.statusCode = 404; response.end(); }
  } catch { response.statusCode = 500; response.end(); }
}).listen(port, '127.0.0.1', () => console.log(`QA browser: http://127.0.0.1:${port}/CodeMesh.html`));
