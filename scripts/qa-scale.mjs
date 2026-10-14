import { normalizeGraphDocument, computeLayout, getNodeGeometry } from '../app/graph-core.js';
import { writeFile, mkdir } from 'node:fs/promises';
await mkdir(new URL('../docs/qa/', import.meta.url), { recursive: true });
const results = [];
for (const count of [1000, 1500, 2000]) {
  const kinds = ['model', 'route', 'api-call', 'external', 'module'];
  const graph = normalizeGraphDocument({ nodes: Array.from({ length: count }, (_, i) => ({ id: `n:${i}`, kind: kinds[i % kinds.length], label: i % 5 === 4 ? `frontend/components/Component${i}.jsx` : `Long descriptive node ${i}` })), edges: Array.from({ length: count - 1 }, (_, i) => ({ source: `n:${i}`, target: `n:${i + 1}`, kind: 'IMPORTS' })) });
  await writeFile(new URL('../docs/qa/stress-' + count + '.json', import.meta.url), JSON.stringify(graph));
  for (const mode of ['layered', 'grid', 'force']) {
    const start = performance.now();
    const layout = computeLayout(graph, { mode });
    const ms = Math.round(performance.now() - start);
    let overlaps = 0;
    const geometry = graph.nodes.map(node => getNodeGeometry(node));
    for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
      const a = layout[`n:${i}`], b = layout[`n:${j}`];
      if (Math.abs(a.x - b.x) + 0.01 < (geometry[i].width + geometry[j].width) / 2 && Math.abs(a.y - b.y) + 0.01 < (geometry[i].height + geometry[j].height) / 2) overlaps++;
    }
    const result = { count, mode, ms, overlaps, positions: Object.keys(layout).length, nonfinite: Object.values(layout).filter(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)).length };
    results.push(result);
    console.log(JSON.stringify(result));
  }
}
await writeFile(new URL('../docs/qa/scale-audit.json', import.meta.url), JSON.stringify(results, null, 2));
