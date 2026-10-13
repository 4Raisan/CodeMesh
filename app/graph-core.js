export const SCHEMA_VERSION = 'codemesh/1';
export const MAX_NODES = 10000;
export const MAX_EDGES = 30000;
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
