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

function shouldShowEdgeLabel(mode, active) {
  if (mode === 'always') return true;
  if (mode === 'active') return Boolean(active);
  if (mode === 'off') return false;
  return Boolean(active);
}

export class GraphRenderer {
  getNeighborIds(nodeId) {
    const result = new Set();
    if (!nodeId) return result;
    for (const edge of this.indexes.outgoing.get(nodeId) ?? []) result.add(edge.target);
    for (const edge of this.indexes.incoming.get(nodeId) ?? []) result.add(edge.source);
    return result;
  }

  selectNode(nodeId, focus = false) {
    if (!this.document?.nodes.some((node) => node.id === nodeId)) return;
    if (!this.visibleNodeIds.has(nodeId)) {
      this.callbacks.onRequestReveal?.(nodeId);
      this.render();
    }
    this.view.selectedId = nodeId;
    this.scheduleRender();
    this.callbacks.onSelect?.(nodeId);
    if (focus) this.focusNode(nodeId);
  }

  clearSelection() {
    this.view.selectedId = null;
    this.view.focusIds = null;
    this.scheduleRender();
  }
}
