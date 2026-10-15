import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
if (process.argv[2] === '--case') {
  const count = Number(process.argv[3]), approach = process.argv[4];
  let source = await readFile(new URL('../app/graph-core.js', import.meta.url), 'utf8');
  if (approach === 'force-12') source = source.replace('sortedNodes.length <= 250 ? 64 : 38', 'sortedNodes.length <= 250 ? 24 : 12');
  const core = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  const kinds = ['model', 'route', 'api-call', 'external', 'module'];
  const graph = core.normalizeGraphDocument({ nodes: Array.from({length:count}, (_,i) => ({id:`n${i}`,kind:kinds[i%5],label:`Project component ${i}`})), edges: Array.from({length:count*3},(_,i) => ({source:`n${i%count}`,target:`n${(i%count + [1,7,31][Math.floor(i/count)])%count}`,kind:'IMPORTS'})) });
  const nodes = approach === 'focus-300' ? graph.nodes.slice(0,300) : graph.nodes;
  const ids = new Set(nodes.map(n=>n.id));
  const edges = graph.edges.filter(e=>ids.has(e.source)&&ids.has(e.target));
  const start=performance.now();
  const positions=core.computeLayout(graph,{mode:approach.startsWith('force')?'force':'layered',nodes,edges});
  const ms=Math.round(performance.now()-start);
  let overlaps=0;
  const geo=nodes.map(n=>core.getNodeGeometry(n));
  for(let i=0;i<nodes.length;i++) for(let j=i+1;j<nodes.length;j++) {
    const a=positions[nodes[i].id],b=positions[nodes[j].id];
    if(Math.abs(a.x-b.x)<(geo[i].width+geo[j].width)/2 && Math.abs(a.y-b.y)<(geo[i].height+geo[j].height)/2)overlaps++;
  }
  console.log(JSON.stringify({count,approach,visible:nodes.length,edges:edges.length,ms,overlaps,positions:Object.keys(positions).length,finite:Object.values(positions).every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))}));
} else {
  const results=[];
  for(const count of [1000,1500,2000]) for(const approach of ['layers','focus-300','force','force-12']) {
    const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--case',String(count),approach],{encoding:'utf8',timeout:20000});
    const result=child.status===0?JSON.parse(child.stdout.trim()):{count,approach,timeoutMs:20000,error:child.error?.code??child.stderr.slice(0,200)};
    results.push(result);console.log(JSON.stringify(result));
  }
  await mkdir(new URL('../docs/qa/',import.meta.url),{recursive:true});
  await writeFile(new URL('../docs/qa/practical-performance.json',import.meta.url),JSON.stringify({method:'Synthetic 3 edges/node, fresh process per case, layout only, 20-second case timeout. Focus uses first 300 nodes as a bounded-view proxy, not neighborhood quality validation.',results},null,2));
}
