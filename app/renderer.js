import {
  DEFAULT_COLORS,
  computeLayout,
  createIndexes,
  getBounds,
  getArchitectureLayer,
  getNodeColor,
  getNodeKindLabel,
  getNodeGeometry,
  getNodeSearchText,
  getVisibleEdgeIds,
  getVisibleNodeIds
} from './graph-core.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const DEFAULT_VIEW = { x: 0, y: 0, scale: 1, selectedId: null, search: '', activeKinds: new Set(), activeGroups: new Set(), activeEdgeKinds: new Set(), focusIds: null, positions: {}, labelEdges: false, layoutSpacing: 1, layoutMode: 'layered', nodeScale: 1, labelScale: 1, edgeOpacity: 0.85, inferredOpacity: 0.70, dottedOpacity: 0.85, solidWidth: 2.2, dashedWidth: 2.2, areaWidth: 1.5, areaNameSize: 23, edgeLabelMode: 'off', backgroundColor: '#0c1220', animationEnabled: false, animationSpeed: 1, nodeLimit: 650, isolationMode: 'all', showInferred: true, linkDistance: 180, repulsion: 1 };

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function setAttributes(element, attributes) {
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null) element.setAttribute(key, String(value));
  }
}

function createSvg(tag, attributes = {}) {
  const element = document.createElementNS(SVG_NS, tag);
  setAttributes(element, attributes);
  return element;
}

function truncate(value, maxLength) {
  const text = String(value ?? '');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

export class GraphRenderer {
  constructor(svg, callbacks = {}) {
    this.svg = svg;
    this.callbacks = callbacks;
    this.document = null;
    this.indexes = createIndexes({ nodes: [], edges: [] });
    this.view = { ...DEFAULT_VIEW, activeKinds: new Set(), activeGroups: new Set(), activeEdgeKinds: new Set(), positions: {} };
    this.positions = {};
    this.layout = {};
    this.layoutKey = null;
    this.edgeOffsets = new Map();
    this.edgeRoutes = new Map();
    this.edgeObstacles = [];
    this.visibleNodeIds = new Set();
    this.visibleEdgeIds = new Set();
    this.drag = null;
    this.frame = null;
    this.root = null;
    this.edgeLayer = null;
    this.nodeLayer = null;
    this.boundHandlers = {};
    this.setup();
  }

  setup() {
    this.svg.replaceChildren();
    this.svg.setAttribute('role', 'application');
    this.svg.setAttribute('tabindex', '0');
    this.svg.setAttribute('aria-label', 'Interactive codebase knowledge graph');
    const defs = createSvg('defs');
    this.root = createSvg('g', { class: 'kg-map-viewport' });
    this.layerGuides = createSvg('g', { class: 'kg-layer-guides', 'aria-hidden': 'true', 'pointer-events': 'none' });
    this.edgeLayer = createSvg('g', { class: 'kg-map-edges', 'aria-hidden': 'true' });
    this.nodeLayer = createSvg('g', { class: 'kg-map-nodes' });
    this.layerLabels = createSvg('g', { class: 'kg-layer-labels', 'aria-hidden': 'true', 'pointer-events': 'none' });
    this.root.append(this.layerGuides, this.edgeLayer, this.layerLabels, this.nodeLayer);
    this.svg.append(defs, this.root);
    this.boundHandlers.pointerDown = (event) => this.onPointerDown(event);
    this.boundHandlers.pointerMove = (event) => this.onPointerMove(event);
    this.boundHandlers.pointerUp = (event) => this.onPointerUp(event);
    this.boundHandlers.pointerCancel = () => this.onPointerCancel();
    this.boundHandlers.wheel = (event) => this.onWheel(event);
    this.boundHandlers.keyDown = (event) => this.onKeyDown(event);
    this.boundHandlers.resize = () => {
      this.scheduleRender();
      if (this.document) this.fit();
    };
    this.svg.addEventListener('pointerdown', this.boundHandlers.pointerDown);
    this.svg.addEventListener('pointermove', this.boundHandlers.pointerMove);
    this.svg.addEventListener('pointerup', this.boundHandlers.pointerUp);
    this.svg.addEventListener('pointercancel', this.boundHandlers.pointerCancel);
    this.svg.addEventListener('wheel', this.boundHandlers.wheel, { passive: false });
    this.svg.addEventListener('keydown', this.boundHandlers.keyDown);
    window.addEventListener('resize', this.boundHandlers.resize);
  }

  setDocument(document) {
    this.document = document;
    this.indexes = createIndexes(document);
    this.layoutKey = null;
    this.edgeOffsets.clear();
    const pairs = new Map();
    for (const edge of document.edges) {
      const key = JSON.stringify([edge.source, edge.target]);
      if (!pairs.has(key)) pairs.set(key, []);
      pairs.get(key).push(edge.id);
    }
    for (const ids of pairs.values()) ids.forEach((id, index) => this.edgeOffsets.set(id, index * 22));
    this.view = { ...this.view, selectedId: null, search: '', focusIds: null, positions: clonePositions(document?.positions) };
    this.positions = clonePositions(document?.positions);
    this.scheduleRender();
  }

  setView(view) {
    const next = { ...this.view, ...(view ?? {}) };
    next.activeKinds = setFrom(next.activeKinds);
    next.activeGroups = setFrom(next.activeGroups);
    next.activeEdgeKinds = setFrom(next.activeEdgeKinds);
    next.focusIds = next.focusIds instanceof Set || Array.isArray(next.focusIds) ? next.focusIds : null;
    next.layoutSpacing = clamp(next.layoutSpacing, 1, 0.65, 1.6);
    next.layoutMode = ['layered', 'auto', 'force', 'grid'].includes(next.layoutMode) ? next.layoutMode : 'layered';
    next.nodeScale = clamp(next.nodeScale, 1, 0.7, 1.6);
    next.labelScale = clamp(next.labelScale, 1, 0.7, 1.6);
    next.edgeOpacity = clamp(next.edgeOpacity, 0.85, 0, 1);
    next.solidWidth = clamp(next.solidWidth, 2.2, 0.1, 6);
    next.dashedWidth = clamp(next.dashedWidth, 2.2, 0.1, 6);
    next.edgeLabelMode = ['light', 'active', 'always', 'off'].includes(next.edgeLabelMode) ? next.edgeLabelMode : 'light';
    next.backgroundColor = /^#[0-9a-f]{6}$/i.test(next.backgroundColor) ? next.backgroundColor : '#0a1424';
    next.animationEnabled = next.animationEnabled !== false;
    next.animationSpeed = clamp(next.animationSpeed, 1, 0.25, 2);
    next.nodeLimit = clamp(next.nodeLimit, 650, 50, 650);
    next.isolationMode = ['all', 'connected', 'isolated'].includes(next.isolationMode) ? next.isolationMode : 'all';
    next.showInferred = next.showInferred !== false;
    next.linkDistance = clamp(next.linkDistance, 180, 0, 1500);
    next.repulsion = clamp(next.repulsion, 1, -10, 10);
    next.scale = clamp(next.scale, 1, 0.08, 3);
    next.x = Number.isFinite(next.x) ? next.x : 0;
    next.y = Number.isFinite(next.y) ? next.y : 0;
    this.positions = next.positions ? clonePositions(next.positions) : clonePositions(this.positions);
    next.positions = this.positions;
    this.view = next;
    this.scheduleRender();
  }

  getView() {
    return {
      ...this.view,
      activeKinds: new Set(this.view.activeKinds),
      activeGroups: new Set(this.view.activeGroups),
      activeEdgeKinds: new Set(this.view.activeEdgeKinds),
      focusIds: this.view.focusIds ? new Set(this.view.focusIds) : null,
      positions: clonePositions(this.positions)
    };
  }

  getSize() {
    const rect = this.svg.getBoundingClientRect();
    return {
      width: rect.width || this.svg.clientWidth || window.innerWidth || 1000,
      height: rect.height || this.svg.clientHeight || window.innerHeight || 700
    };
  }

  scheduleRender() {
    if (this.frame !== null) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = null;
      this.render();
    });
  }

  destroy() {
    if (this.frame !== null) window.cancelAnimationFrame(this.frame);
    this.frame = null;
    this.svg.removeEventListener('pointerdown', this.boundHandlers.pointerDown);
    this.svg.removeEventListener('pointermove', this.boundHandlers.pointerMove);
    this.svg.removeEventListener('pointerup', this.boundHandlers.pointerUp);
    this.svg.removeEventListener('pointercancel', this.boundHandlers.pointerCancel);
    this.svg.removeEventListener('wheel', this.boundHandlers.wheel);
    this.svg.removeEventListener('keydown', this.boundHandlers.keyDown);
    window.removeEventListener('resize', this.boundHandlers.resize);
    this.svg.replaceChildren();
  }
}
