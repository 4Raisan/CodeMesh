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
  onKeyDown(event) {
    const nodeElement = event.target.closest?.('[data-node-id]');
    if (nodeElement && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      this.selectNode(nodeElement.dataset.nodeId, true);
      return;
    }
    if (event.key === 'f' && this.view.selectedId) {
      event.preventDefault();
      this.focusNode(this.view.selectedId);
      return;
    }
    if (event.key === 'Escape') {
      this.callbacks.onEscape?.();
      return;
    }
    const step = 60 / this.view.scale;
    if (event.key === 'ArrowLeft') this.view.x += step;
    else if (event.key === 'ArrowRight') this.view.x -= step;
    else if (event.key === 'ArrowUp') this.view.y -= step;
    else if (event.key === 'ArrowDown') this.view.y += step;
    else if (event.key === '+' || event.key === '=') this.zoomBy(1.15);
    else if (event.key === '-') this.zoomBy(0.87);
    else return;
    event.preventDefault();
    this.applyTransform();
    this.callbacks.onViewChange?.(this.getView());
  }
}
