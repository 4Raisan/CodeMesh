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
  suppressEdgeLabelCollisions() {
    if (!this.nodeLayer.querySelectorAll || !this.edgeLayer.querySelectorAll) return;
    const occupied = [...this.nodeLayer.querySelectorAll('.kg-node-label, .kg-node-shape, .kg-node-kind'), ...this.layerLabels.querySelectorAll('text')].map(element => element.getBoundingClientRect());
    const intersects = (left, right) => left.left < right.right + 2 && left.right > right.left - 2 && left.top < right.bottom + 2 && left.bottom > right.top - 2;
    for (const { label, textPath, gapPath, gap, reverse } of this.edgeLabelPlacements ?? []) {
      let placed = false;
      for (const offset of [50, 42, 58, 34, 66, 26, 74, 18, 82]) {
        if (offset - gap / 2 < 5 || offset + gap / 2 > 95) continue;
        textPath.setAttribute('startOffset', `${offset}%`);
        const bounds = label.getBoundingClientRect();
        if (occupied.some(other => intersects(bounds, other))) continue;
        const center = reverse ? 100 - offset : offset;
        gapPath.setAttribute('stroke-dasharray', `0 ${center - gap / 2} ${gap} 100`);
        occupied.push(bounds);
        placed = true;
        break;
      }
      if (!placed) {
        label.setAttribute('visibility', 'hidden');
        gapPath.setAttribute('stroke', 'none');
      }
    }
  }
}
