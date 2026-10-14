export const SCHEMA_VERSION = 'codemesh/1';

export const MAX_NODES = 10000;

export const MAX_EDGES = 30000;

export const DEFAULT_VISIBLE_NODE_LIMIT = 650;

export const DEFAULT_COLORS = Object.freeze({
  code: '#4f8cff',
  ui: '#4f8cff',
  route: '#52c8ab',
  data: '#e6a84a',
  test: '#32b8c6',
  docs: '#f3c969',
  config: '#a77bf3',
  external: '#94a3b8',
  unresolved: '#f97373',
  other: '#8b9bb4'
});

const GROUP_ORDER = ['core', 'entrypoint', 'route', 'ui', 'code', 'service', 'data', 'test', 'docs', 'config', 'external', 'unresolved', 'other'];

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

const MAX_SERIALIZED_METADATA = 2000;

const UNSERIALIZABLE_METADATA = '[unserializable]';

const TRUNCATED_METADATA = '[truncated]';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedText(value, fallback = '', maxLength = 240) {
  if (value === undefined || value === null) return fallback;
  const text = String(value).replace(CONTROL_CHARACTERS, ' ').trim();
  if (!text) return fallback;
  return text.slice(0, maxLength);
}

function positiveInteger(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return undefined;
  return Math.floor(value);
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizePath(value) {
  const text = boundedText(value, '', 600);
  if (!text) return '';
  return text.replace(/\\/g, '/').replace(/^\/+/, '');
}

function normalizeSource(value) {
  if (typeof value === 'string') {
    const path = normalizePath(value);
    return path ? { path } : undefined;
  }
  if (!isRecord(value)) return undefined;
  const path = normalizePath(value.path ?? value.file);
  if (!path) return undefined;
  const source = { path };
  const startLine = positiveInteger(value.startLine ?? value.line);
  const endLine = positiveInteger(value.endLine);
  if (startLine !== undefined) source.startLine = startLine;
  if (endLine !== undefined) source.endLine = endLine;
  const revision = boundedText(value.revision, '', 160);
  if (revision) source.revision = revision;
  return source;
}

function normalizeEvidence(value) {
  if (typeof value === 'string') return { extractor: boundedText(value, '', 160) };
  if (!isRecord(value)) return undefined;
  const evidence = {};
  const path = normalizePath(value.path);
  const range = boundedText(value.range, '', 160);
  const extractor = boundedText(value.extractor ?? value.source, '', 160);
  const revision = boundedText(value.revision, '', 160);
  if (path) evidence.path = path;
  if (range) evidence.range = range;
  if (extractor) evidence.extractor = extractor;
  if (revision) evidence.revision = revision;
  const startLine = positiveInteger(value.startLine);
  const endLine = positiveInteger(value.endLine);
  if (startLine !== undefined) evidence.startLine = startLine;
  if (endLine !== undefined) evidence.endLine = endLine;
  return Object.keys(evidence).length > 0 ? evidence : undefined;
}

function normalizeMetadata(value) {
  if (!isRecord(value)) return {};
  const metadata = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    const safeKey = boundedText(key, '', 100);
    if (!safeKey) continue;
    if (item === null || ['string', 'number', 'boolean'].includes(typeof item)) {
      metadata[safeKey] = typeof item === 'string' ? boundedText(item, '', 1200) : item;
    } else if (Array.isArray(item)) {
      metadata[safeKey] = item.slice(0, 100).map((entry) => typeof entry === 'string' ? boundedText(entry, '', 300) : entry);
    } else {
      let serialized;
      try {
        serialized = JSON.stringify(item);
      } catch {
        metadata[safeKey] = UNSERIALIZABLE_METADATA;
        continue;
      }
      if (typeof serialized !== 'string') metadata[safeKey] = UNSERIALIZABLE_METADATA;
      else if (serialized.length <= MAX_SERIALIZED_METADATA) metadata[safeKey] = item;
      else metadata[safeKey] = TRUNCATED_METADATA;
    }
  }
  return metadata;
}

function diagnostic(severity, code, message, details = {}) {
  return {
    severity: ['error', 'warning', 'info'].includes(severity) ? severity : 'warning',
    code: boundedText(code, 'diagnostic', 100),
    message: boundedText(message, '', 1000),
    ...details
  };
}

function inferGroup(node) {
  const value = `${node.group ?? ''} ${node.kind ?? ''}`.toLowerCase();
  if (/unresolved|missing|external/.test(value)) return 'unresolved';
  if (/test|spec|fixture/.test(value)) return 'test';
  if (/route|endpoint|controller|api/.test(value)) return 'route';
  if (/database|schema|model|table|sql|prisma|graphql|data/.test(value)) return 'data';
  if (/doc|readme|markdown|guide|adr|decision/.test(value)) return 'docs';
  if (/config|package|manifest|build|tool/.test(value)) return 'config';
  if (/component|page|view|jsx|tsx|ui|frontend/.test(value)) return 'ui';
  if (/service|domain|business/.test(value)) return 'service';
  if (/entry|main|index|bootstrap/.test(value)) return 'entrypoint';
  if (/core|infrastructure|platform/.test(value)) return 'core';
  return 'code';
}

function normalizeRepository(input) {
  const raw = isRecord(input.repository) ? input.repository : (isRecord(input.sourceRepository) ? input.sourceRepository : {});
  const name = boundedText(raw.name ?? raw.repository ?? input.repositoryName ?? 'Imported codebase', 'Imported codebase', 240);
  const revision = boundedText(raw.revision ?? raw.branch ?? input.revision ?? 'unknown', 'unknown', 160);
  const repository = { name, revision };
  const url = boundedText(raw.url, '', 500);
  if (/^https:\/\/[^\s]+$/i.test(url)) repository.url = url;
  return repository;
}

function normalizeCoverage(value, fallback = {}) {
  const raw = isRecord(value) ? value : {};
  const source = { ...fallback, ...raw };
  const coverage = {};
  for (const key of ['filesDiscovered', 'filesScanned', 'filesSkipped', 'filesUnsupported', 'totalBytes', 'maxInitialNodes']) {
    const numeric = finiteNumber(source[key]);
    if (numeric !== undefined && numeric >= 0) coverage[key] = Math.floor(numeric);
  }
  for (const key of ['partial', 'stale', 'truncated', 'label']) {
    if (typeof source[key] === 'boolean' || typeof source[key] === 'string') coverage[key] = source[key];
  }
  return coverage;
}

function normalizeExtractor(value) {
  const raw = isRecord(value) ? value : {};
  return {
    name: boundedText(raw.name, 'unknown', 160),
    version: boundedText(raw.version, 'unknown', 80),
    mode: boundedText(raw.mode, 'imported', 120)
  };
}

function normalizePositions(value, validIds) {
  const positions = {};
  if (!isRecord(value)) return positions;
  for (const [id, raw] of Object.entries(value).slice(0, MAX_NODES)) {
    if (!validIds.has(id) || !isRecord(raw)) continue;
    const x = finiteNumber(raw.x);
    const y = finiteNumber(raw.y);
    if (x === undefined || y === undefined) continue;
    positions[id] = { x, y, pinned: raw.pinned === true };
  }
  return positions;
}

function uniqueEdgeId(rawId, source, target, kind, index, used) {
  const base = boundedText(rawId, `edge:${kind}:${source}:${target}:${index}`, 500);
  let id = base;
  let suffix = 2;
  while (used.has(id)) {
    id = `${base}~${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

export function createEmptyDocument(options = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    name: boundedText(options.name, 'Codebase knowledge graph', 240),
    repository: normalizeRepository(options),
    generatedAt: typeof options.generatedAt === 'string' ? options.generatedAt : null,
    extractor: normalizeExtractor(options.extractor),
    coverage: normalizeCoverage(options.coverage),
    diagnostics: [],
    nodes: [],
    edges: [],
    positions: {},
    stats: { totalNodes: 0, totalEdges: 0, nodesByKind: {}, edgesByKind: {} }
  };
}

export function normalizeGraphDocument(input, options = {}) {
  if (!isRecord(input) || !Array.isArray(input.nodes)) {
    throw new TypeError('A graph document must contain a nodes array.');
  }
  const maxNodes = options.maxNodes ?? MAX_NODES;
  const maxEdges = options.maxEdges ?? MAX_EDGES;
  const diagnostics = [];
  const importedDiagnostics = Array.isArray(input.diagnostics) ? input.diagnostics : [];
  for (const item of importedDiagnostics.slice(0, 200)) {
    if (!isRecord(item)) continue;
    diagnostics.push(diagnostic(item.severity, item.code, item.message, {
      path: normalizePath(item.path) || undefined,
      line: positiveInteger(item.line)
    }));
  }
  if (input.nodes.length > maxNodes) {
    diagnostics.push(diagnostic('warning', 'node-limit', `Only the first ${maxNodes} nodes will be loaded.`));
  }
  if (Array.isArray(input.edges) && input.edges.length > maxEdges) {
    diagnostics.push(diagnostic('warning', 'edge-limit', `Only the first ${maxEdges} edges will be loaded.`));
  }
  const nodes = [];
  const positions = {};
  const nodeIds = new Set();
  for (const [index, raw] of input.nodes.slice(0, maxNodes).entries()) {
    if (!isRecord(raw)) {
      diagnostics.push(diagnostic('error', 'invalid-node', `Node ${index + 1} is not an object.`));
      continue;
    }
    const id = boundedText(raw.id, '', 500);
    if (!id) {
      diagnostics.push(diagnostic('error', 'invalid-node-id', `Node ${index + 1} has no usable id.`));
      continue;
    }
    if (nodeIds.has(id)) {
      diagnostics.push(diagnostic('error', 'duplicate-node-id', `Duplicate node id was skipped: ${id}`, { nodeId: id }));
      continue;
    }
    const kind = boundedText(raw.kind ?? raw.type, 'file', 120);
    const label = boundedText(raw.label ?? raw.name, id, 300);
    const group = boundedText(raw.group, inferGroup({ kind, group: '' }), 120);
    const source = normalizeSource(raw.source ?? raw.file);
    const node = {
      id,
      kind,
      label,
      group,
      qualifiedName: boundedText(raw.qualifiedName ?? raw.qualified_name, '', 500) || undefined,
      source,
      metadata: normalizeMetadata(raw.metadata)
    };
    if (source?.path) node.file = source.path;
    nodes.push(node);
    nodeIds.add(id);
    const position = isRecord(raw.position) ? raw.position : (finiteNumber(raw.x) !== undefined || finiteNumber(raw.y) !== undefined ? { x: raw.x, y: raw.y } : undefined);
    if (position !== undefined) {
      const x = finiteNumber(position.x);
      const y = finiteNumber(position.y);
      if (x === undefined || y === undefined) {
        diagnostics.push(diagnostic('warning', 'invalid-position', `Ignored a non-finite position for node ${id}.`, { nodeId: id }));
      } else {
        positions[id] = { x, y, pinned: position.pinned === true || raw.pinned === true };
      }
    }
  }
  const topLevelPositions = normalizePositions(input.positions, nodeIds);
  Object.assign(positions, topLevelPositions);
  const edges = [];
  const edgeIds = new Set();
  const rawEdges = Array.isArray(input.edges) ? input.edges.slice(0, maxEdges) : [];
  for (const [index, raw] of rawEdges.entries()) {
    if (!isRecord(raw)) {
      diagnostics.push(diagnostic('error', 'invalid-edge', `Edge ${index + 1} is not an object.`));
      continue;
    }
    const source = boundedText(raw.source ?? raw.from, '', 500);
    const target = boundedText(raw.target ?? raw.to, '', 500);
    if (!source || !target) {
      diagnostics.push(diagnostic('error', 'invalid-edge-endpoint', `Edge ${index + 1} is missing an endpoint.`));
      continue;
    }
    if (!nodeIds.has(source) || !nodeIds.has(target)) {
      diagnostics.push(diagnostic('error', 'dangling-edge', `Edge ${index + 1} points to a missing node.`, { source, target }));
      continue;
    }
    const kind = boundedText(raw.kind ?? raw.type, 'RELATED', 120);
    const edge = {
      id: uniqueEdgeId(raw.id, source, target, kind, index, edgeIds),
      source,
      target,
      kind,
      label: boundedText(raw.label, kind, 240),
      evidence: normalizeEvidence(raw.evidence),
      confidence: finiteNumber(raw.confidence),
      inferred: typeof raw.inferred === 'boolean' ? raw.inferred : undefined,
      resolution: boundedText(raw.resolution, '', 80) || undefined,
      metadata: normalizeMetadata(raw.metadata)
    };
    if (raw.confidence !== undefined && (edge.confidence === undefined || edge.confidence < 0 || edge.confidence > 1)) {
      diagnostics.push(diagnostic('warning', 'invalid-confidence', `Ignored an invalid confidence value on edge ${edge.id}.`, { edgeId: edge.id }));
      delete edge.confidence;
    }
    if (raw.inferred !== undefined && typeof raw.inferred !== 'boolean') {
      diagnostics.push(diagnostic('warning', 'invalid-inference-state', `Ignored a non-boolean inference state on edge ${edge.id}.`, { edgeId: edge.id }));
    }
    edges.push(edge);
  }
  const nodesByKind = {};
  const edgesByKind = {};
  for (const node of nodes) nodesByKind[node.kind] = (nodesByKind[node.kind] ?? 0) + 1;
  for (const edge of edges) edgesByKind[edge.kind] = (edgesByKind[edge.kind] ?? 0) + 1;
  const repository = normalizeRepository(input);
  const document = {
    schemaVersion: SCHEMA_VERSION,
    name: boundedText(input.name ?? repository.name, 'Codebase knowledge graph', 240),
    repository,
    generatedAt: typeof input.generatedAt === 'string' ? boundedText(input.generatedAt, '', 100) || null : null,
    extractor: normalizeExtractor(input.extractor),
    coverage: normalizeCoverage(input.coverage),
    diagnostics: diagnostics.slice(0, 300),
    nodes: nodes.sort((left, right) => left.id.localeCompare(right.id)),
    edges: edges.sort((left, right) => left.id.localeCompare(right.id)),
    positions,
    stats: {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      nodesByKind,
      edgesByKind
    }
  };
  document.fingerprint = fingerprintDocument(document);
  return document;
}

export class GraphBuilder {
  constructor(options = {}) {
    this.meta = {
      schemaVersion: SCHEMA_VERSION,
      name: options.name,
      repository: options.repository,
      generatedAt: options.generatedAt,
      extractor: options.extractor,
      coverage: options.coverage
    };
    this.nodes = [];
    this.edges = [];
    this.diagnostics = [];
    this.nodeMap = new Map();
    this.edgeIds = new Set();
  }

  addNode(raw) {
    const id = boundedText(raw?.id, '', 500);
    if (!id) {
      this.addDiagnostic('error', 'invalid-node-id', 'A generated node has no id.');
      return false;
    }
    if (this.nodeMap.has(id)) {
      const existing = this.nodeMap.get(id);
      existing.metadata = { ...existing.metadata, ...(raw.metadata ?? {}) };
      if (!existing.source && raw.source) existing.source = raw.source;
      if (!existing.file && raw.file) existing.file = raw.file;
      return true;
    }
    const node = { ...raw, id };
    this.nodes.push(node);
    this.nodeMap.set(id, node);
    return true;
  }

  addEdge(raw) {
    const source = boundedText(raw?.source ?? raw?.from, '', 500);
    const target = boundedText(raw?.target ?? raw?.to, '', 500);
    if (!this.nodeMap.has(source) || !this.nodeMap.has(target)) {
      this.addDiagnostic('error', 'dangling-edge', `Generated edge ${source} -> ${target} has a missing endpoint.`, { source, target });
      return false;
    }
    const kind = boundedText(raw?.kind ?? raw?.type, 'RELATED', 120);
    const baseId = boundedText(raw?.id, `edge:${kind}:${source}:${target}:${this.edges.length}`, 500);
    let id = baseId;
    let suffix = 2;
    while (this.edgeIds.has(id)) {
      id = `${baseId}~${suffix}`;
      suffix += 1;
    }
    this.edgeIds.add(id);
    this.edges.push({ ...raw, id, source, target, kind });
    return true;
  }

  addDiagnostic(severity, code, message, details = {}) {
    this.diagnostics.push(diagnostic(severity, code, message, details));
  }

  build() {
    return normalizeGraphDocument({
      ...this.meta,
      nodes: this.nodes,
      edges: this.edges,
      diagnostics: this.diagnostics
    });
  }
}

export function createIndexes(document) {
  const nodesById = new Map();
  const incoming = new Map();
  const outgoing = new Map();
  const degree = new Map();
  for (const node of document?.nodes ?? []) {
    nodesById.set(node.id, node);
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
    degree.set(node.id, 0);
  }
  for (const edge of document?.edges ?? []) {
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) continue;
    outgoing.get(edge.source).push(edge);
    incoming.get(edge.target).push(edge);
    degree.set(edge.source, degree.get(edge.source) + 1);
    degree.set(edge.target, degree.get(edge.target) + 1);
  }
  return { nodesById, incoming, outgoing, degree };
}

function setFrom(value) {
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value);
  return new Set();
}

export function getNodeSearchText(node) {
  return [node.label, node.id, node.kind, node.group, node.qualifiedName, node.source?.path, node.file, ...Object.values(node.metadata ?? {}).filter((value) => typeof value === 'string')]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function getVisibleNodeIds(document, viewState = {}, indexes = createIndexes(document), limit = DEFAULT_VISIBLE_NODE_LIMIT) {
  const activeKinds = setFrom(viewState.activeKinds);
  const activeGroups = setFrom(viewState.activeGroups);
  const focusIds = setFrom(viewState.focusIds);
  const search = String(viewState.search ?? '').trim().toLowerCase();
  let candidates = (document.nodes ?? []).filter((node) => {
    if (viewState.overviewMode === 'files' && !search && activeKinds.size === 0 && !['file', 'module', 'configuration', 'schema', 'documentation', 'test', 'model', 'enum'].includes(node.kind)) return false;
    const isolated = (indexes.degree.get(node.id) ?? 0) === 0;
    if (viewState.isolationMode === 'isolated' && !isolated) return false;
    if (viewState.isolationMode === 'connected' && isolated) return false;
    if (activeKinds.size > 0 && !activeKinds.has(node.kind)) return false;
    if (activeGroups.size > 0 && !activeGroups.has(node.group)) return false;
    if (search && !getNodeSearchText(node).includes(search)) return false;
    return true;
  });
  if (focusIds.size > 0) candidates = candidates.filter((node) => focusIds.has(node.id));
  if (candidates.length <= limit) return new Set(candidates.map((node) => node.id));
  const prioritized = [...candidates].sort((left, right) => {
    if (left.id === viewState.selectedId) return -1;
    if (right.id === viewState.selectedId) return 1;
    if (search) {
      const leftMatch = getNodeSearchText(left).startsWith(search) ? 1 : 0;
      const rightMatch = getNodeSearchText(right).startsWith(search) ? 1 : 0;
      if (leftMatch !== rightMatch) return rightMatch - leftMatch;
    }
    const degreeDifference = (indexes.degree.get(right.id) ?? 0) - (indexes.degree.get(left.id) ?? 0);
    return degreeDifference || left.id.localeCompare(right.id);
  });
  return new Set(prioritized.slice(0, limit).map((node) => node.id));
}

export function getVisibleEdgeIds(document, viewState = {}, visibleNodeIds = null, indexes = createIndexes(document)) {
  const visible = visibleNodeIds ?? getVisibleNodeIds(document, viewState, indexes);
  const activeEdgeKinds = setFrom(viewState.activeEdgeKinds);
  const ids = new Set();
  for (const edge of document.edges ?? []) {
    if (viewState.showInferred === false && edge.inferred === true) continue;
    if (activeEdgeKinds.size > 0 && !activeEdgeKinds.has(edge.kind)) continue;
    if (visible.has(edge.source) && visible.has(edge.target)) ids.add(edge.id);
  }
  return ids;
}

function groupRank(group) {
  const index = GROUP_ORDER.indexOf(group);
  return index === -1 ? GROUP_ORDER.length : index;
}

let nodeTextContext;

export function getNodeGeometry(node, options = {}) {
  if (node.layoutObstacle) return { ...node.layoutObstacle, boxLike: true, radius: 0 }; 
  const nodeScale = options.nodeScale ?? 1;
  const labelScale = options.labelScale ?? 1;
  const boxLike = ['file', 'module', 'schema', 'configuration', 'route', 'model', 'external', 'unresolved', 'api-call'].includes(node.kind) || ['route', 'data', 'config', 'external', 'unresolved'].includes(node.group);
  const rawTitle = node.source?.path === node.label ? node.label.split('/').pop() : node.label;
  const title = rawTitle.length > 34 ? `${rawTitle.slice(0, 33)}…` : rawTitle;
  const types = { file: 'Code file', module: 'Code file', schema: 'Schema', configuration: 'Configuration', route: 'Endpoint', 'api-call': 'API call', model: 'Data model', external: 'Dependency', unresolved: 'Unresolved' };
  const subtitle = node.kind === 'configuration' && node.source?.path.includes('/') ? `${node.source.path.split('/')[0]} · Configuration` : types[node.kind] ?? getNodeKindLabel(node);
  const radius = Math.min(22, (8 + Math.sqrt(options.degree ?? 0) * 1.8) * nodeScale);
  const textWidth = (text, fontSize, weight) => {
    const context = nodeTextContext ??= globalThis.document?.createElement?.('canvas')?.getContext?.('2d');
    if (context) {
      context.font = `${weight} ${fontSize}px Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`;
      return context.measureText(text).width;
    }
    return [...text].reduce((sum, char) => sum + (/[ilI1.,:;!'|]/.test(char) ? 0.30 : /[MW@%]/.test(char) ? 0.90 : /[A-Z]/.test(char) ? 0.66 : 0.56) * fontSize, 0);
  };
  const width = Math.max(textWidth(title, 13 * labelScale, 600), textWidth(subtitle, 10, 400)) * nodeScale + 24 * nodeScale;
  const height = 52 * nodeScale * Math.max(1, labelScale);
  return { boxLike, title, subtitle, width, height, radius, fontSize: 13 * nodeScale * labelScale };
}

function resolveNodeCollisions(result, nodes, savedPositions, spacing, labelScale, nodeScale) {
  const geometries = new Map(nodes.map(node => [node.id, getNodeGeometry(node, { labelScale, nodeScale })]));
  const fixed = new Set(nodes.filter((node) => {
    const saved = savedPositions[node.id];
    return isRecord(saved) && finiteNumber(saved.x) !== undefined && finiteNumber(saved.y) !== undefined;
  }).map(node => node.id));
  for (let pass = 0; pass < 32; pass += 1) {
    let changed = false;
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      const leftNode = nodes[leftIndex];
      const left = result[leftNode.id];
      if (!left) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const rightNode = nodes[rightIndex];
        if (fixed.has(leftNode.id) && fixed.has(rightNode.id)) continue;
        const right = result[rightNode.id];
        if (!right) continue;
        const dx = left.x - right.x;
        const dy = left.y - right.y;
        const a = geometries.get(leftNode.id);
        const b = geometries.get(rightNode.id);
        const minX = (a.width + b.width) / 2 + 20 * spacing;
        const minY = ((a.boxLike ? a.height : a.radius * 2 + a.fontSize + 24) + (b.boxLike ? b.height : b.radius * 2 + b.fontSize + 24)) / 2 + 24 * spacing;
        const overlapX = minX - Math.abs(dx);
        const overlapY = minY - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        const share = fixed.has(leftNode.id) || fixed.has(rightNode.id) ? 1 : 2;
        const pushX = overlapX < overlapY ? (Math.sign(dx) || 1) * (overlapX + 0.1) / share : 0;
        const pushY = overlapX < overlapY ? 0 : (Math.sign(dy) || 1) * (overlapY + 0.1) / share;
        if (!fixed.has(leftNode.id)) { left.x += pushX; left.y += pushY; }
        if (!fixed.has(rightNode.id)) { right.x -= pushX; right.y -= pushY; }
        changed = true;
      }
    }
    if (!changed) break;
  }
  // Relaxation can leave a few collisions in a dense hub. Place remaining free
  // cards in the nearest clear slot without disturbing saved/pinned positions.
  const placed = nodes.filter(node => fixed.has(node.id));
  const collides = (node, position) => placed.some(other => {
    const a = geometries.get(node.id);
    const b = geometries.get(other.id);
    const otherPosition = result[other.id];
    const heightA = a.boxLike ? a.height : a.radius * 2 + a.fontSize + 24;
    const heightB = b.boxLike ? b.height : b.radius * 2 + b.fontSize + 24;
    return Math.abs(position.x - otherPosition.x) < (a.width + b.width) / 2 + 16 * spacing && Math.abs(position.y - otherPosition.y) < (heightA + heightB) / 2 + 20 * spacing;
  });
  for (const node of nodes) {
    if (fixed.has(node.id)) continue;
    const position = result[node.id];
    if (collides(node, position)) {
      const geometry = geometries.get(node.id);
      const original = { ...position };
      const stepX = geometry.width / 2 + 20 * spacing;
      const stepY = geometry.height + 24 * spacing;
      let found = false;
      for (let ring = 1; ring <= nodes.length + 1 && !found; ring += 1) {
        const offsets = [[0, ring * stepY], [0, -ring * stepY], [ring * stepX, 0], [-ring * stepX, 0], [ring * stepX, ring * stepY], [-ring * stepX, ring * stepY], [ring * stepX, -ring * stepY], [-ring * stepX, -ring * stepY]];
        for (const [x, y] of offsets) {
          const candidate = { x: original.x + x, y: original.y + y };
          if (collides(node, candidate)) continue;
          result[node.id] = candidate;
          found = true;
          break;
        }
      }
    }
    placed.push(node);
  }
  return result;
}

export function getArchitectureLayer(node) {
  const path = String(node.source?.path ?? node.label ?? '').toLowerCase();
  if (/model|schema|database|table/.test(node.kind)) return 'Data';
  if (node.kind === 'route') return 'Endpoints';
  if (node.kind === 'api-call') return 'API calls';
  if (/external|dependency/.test(node.kind) || node.group === 'external' || node.group === 'unresolved') return 'Dependencies';
  if (/middleware|\/auth\//.test(path)) return 'Auth & middleware';
  if (/service|\/jobs\//.test(path)) return 'Services';
  if (/route|controller|server\.[^.]+$/.test(path)) return 'Routes & entrypoints';
  if (node.group === 'ui' || /frontend|\/pages\/|\/components\/|\.jsx$|\.tsx$/.test(path)) return 'UI';
  return 'Other files';
}

export function fingerprintDocument(document) {
  const text = [
    document?.schemaVersion ?? SCHEMA_VERSION,
    ...(document?.nodes ?? []).map((node) => `n:${node.id}:${node.kind}`),
    ...(document?.edges ?? []).map((edge) => `e:${edge.source}:${edge.target}:${edge.kind}:${edge.id}`)
  ].join('|');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `kg-${(hash >>> 0).toString(16)}`;
}
