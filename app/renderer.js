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
  onPointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return;
    const nodeElement = event.target.closest?.('[data-node-id]');
    const groupElement = this.view.layoutMode === 'grid' && event.target.closest?.('[data-group-name]');
    const point = this.localPoint(event);
    if (groupElement) {
      const name = groupElement.getAttribute('data-group-name');
      const offset = this.view.groupOffsets?.[name] ?? { x: 0, y: 0 };
      this.drag = { type: 'group', name, originX: offset.x, originY: offset.y, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false };
    } else if (nodeElement) {
      this.drag = { type: 'node', id: nodeElement.dataset.nodeId, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false, point };
    } else {
      this.drag = { type: 'pan', pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: this.view.x, originY: this.view.y, moved: false, point };
    }
    this.svg.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  onPointerMove(event) {
    if (!this.drag || (this.drag.pointerId !== undefined && event.pointerId !== this.drag.pointerId)) return;
    if (this.drag.type === 'group') {
      const dx = (event.clientX - this.drag.startX) / this.view.scale;
      const dy = (event.clientY - this.drag.startY) / this.view.scale;
      this.drag.moved = Math.hypot(dx, dy) > 3;
      this.view.groupOffsets = { ...this.view.groupOffsets, [this.drag.name]: { x: this.drag.originX + dx, y: this.drag.originY + dy } };
      this.scheduleRender();
      event.preventDefault();
      return;
    } else if (this.drag.type === 'node') {
      if (Math.hypot(event.clientX - this.drag.startX, event.clientY - this.drag.startY) > 3) this.drag.moved = true;
      event.preventDefault();
      return;
    } else {
      this.view.x = this.drag.originX + event.clientX - this.drag.startX;
      this.view.y = this.drag.originY + event.clientY - this.drag.startY;
      if (Math.hypot(event.clientX - this.drag.startX, event.clientY - this.drag.startY) > 3) this.drag.moved = true;
      this.applyTransform();
    }
    event.preventDefault();
  }

  onPointerUp(event) {
    if (!this.drag || (this.drag.pointerId !== undefined && event.pointerId !== this.drag.pointerId)) return;
    const drag = this.drag;
    this.drag = null;
    this.svg.releasePointerCapture?.(event.pointerId);
    if (drag.type === 'group') {
      this.callbacks.onViewChange?.(this.getView());
    } else if (drag.type === 'node') {
      if (drag.moved) this.callbacks.onViewChange?.(this.getView());
      else this.selectNode(drag.id);
    } else if (drag.moved) {
      this.callbacks.onViewChange?.(this.getView());
    } else {
      this.clearSelection();
      this.callbacks.onEscape?.();
    }
  }

  onPointerCancel() {
    this.drag = null;
  }
}
