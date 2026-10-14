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

function clonePositions(positions) {
  const result = {};
  if (!isRecord(positions)) return result;
  for (const [id, position] of Object.entries(positions)) {
    if (!isRecord(position) || !Number.isFinite(position.x) || !Number.isFinite(position.y)) continue;
    result[id] = { x: position.x, y: position.y, pinned: position.pinned === true };
  }
  return result;
}

function setFrom(value) {
  if (value instanceof Set) return new Set(value);
  if (Array.isArray(value)) return new Set(value);
  return new Set();
}

function clamp(value, fallback, minimum, maximum) {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function shouldShowEdgeLabel(mode, active) {
  if (mode === 'always') return true;
  if (mode === 'active') return Boolean(active);
  if (mode === 'off') return false;
  return Boolean(active);
}

export class GraphRenderer {
  zoomBy(factor) {
    const size = this.getSize();
    this.zoomAt(size.width / 2, size.height / 2, factor);
  }

  zoomAt(clientX, clientY, factor) {
    const size = this.getSize();
    const rect = this.svg.getBoundingClientRect();
    const localX = ((clientX - rect.left) / Math.max(rect.width, 1)) * size.width;
    const localY = ((clientY - rect.top) / Math.max(rect.height, 1)) * size.height;
    const oldScale = this.view.scale;
    const newScale = Math.max(0.12, Math.min(3, oldScale * factor));
    const worldX = (localX - this.view.x) / oldScale;
    const worldY = (localY - this.view.y) / oldScale;
    this.view.scale = newScale;
    this.view.x = localX - worldX * newScale;
    this.view.y = localY - worldY * newScale;
    this.applyTransform();
    this.scheduleRender();
    this.callbacks.onViewChange?.(this.getView());
  }

  localPoint(event) {
    const size = this.getSize();
    const rect = this.svg.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / Math.max(rect.width, 1)) * size.width,
      y: ((event.clientY - rect.top) / Math.max(rect.height, 1)) * size.height
    };
  }

  worldPoint(event) {
    const point = this.localPoint(event);
    return { x: (point.x - this.view.x) / this.view.scale, y: (point.y - this.view.y) / this.view.scale };
  }
}
