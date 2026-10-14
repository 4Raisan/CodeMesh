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

function shouldShowEdgeLabel(mode, active) {
  if (mode === 'always') return true;
  if (mode === 'active') return Boolean(active);
  if (mode === 'off') return false;
  return Boolean(active);
}

export class GraphRenderer {
  focusNode(nodeId) {
    const position = this.layout[nodeId];
    if (!position) return;
    const size = this.getSize();
    const scale = Math.max(0.7, Math.min(1.8, this.view.scale));
    this.view.scale = scale;
    this.view.x = size.width / 2 - position.x * scale;
    this.view.y = size.height / 2 - position.y * scale;
    this.applyTransform();
    this.callbacks.onViewChange?.(this.getView());
  }

  fit() {
    this.render();
    const bounds = getBounds(this.layout);
    for (const node of this.document?.nodes ?? []) {
      const position = this.layout[node.id];
      if (!position) continue;
      const geometry = getNodeGeometry(node, { nodeScale: this.view.nodeScale, labelScale: this.view.labelScale });
      bounds.left = Math.min(bounds.left, position.x - geometry.width / 2);
      bounds.right = Math.max(bounds.right, position.x + geometry.width / 2);
      bounds.top = Math.min(bounds.top, position.y - (geometry.boxLike ? geometry.height / 2 : geometry.radius + geometry.fontSize + 18));
      bounds.bottom = Math.max(bounds.bottom, position.y + (geometry.boxLike ? geometry.height / 2 : geometry.radius));
    }
    bounds.width = bounds.right - bounds.left;
    bounds.height = bounds.bottom - bounds.top;
    if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height)) return;
    const size = this.getSize();
    const padding = Math.max(55, Math.min(90, Math.min(size.width, size.height) * 0.1));
    const availableWidth = Math.max(120, size.width - padding * 2);
    const availableHeight = Math.max(120, size.height - padding * 2);
    const scale = Math.max(0.08, Math.min(1.35, Math.min(availableWidth / Math.max(bounds.width, 1), availableHeight / Math.max(bounds.height, 1))));
    this.view.scale = scale;
    this.view.x = size.width / 2 - (bounds.left + bounds.width / 2) * scale;
    this.view.y = size.height / 2 - (bounds.top + bounds.height / 2) * scale;
    this.render();
    this.callbacks.onViewChange?.(this.getView());
  }

  resetPositions() {
    this.positions = {};
    this.view.groupOffsets = {};
    this.view.positions = this.positions;
    this.scheduleRender();
    this.callbacks.onViewChange?.(this.getView());
  }
}
