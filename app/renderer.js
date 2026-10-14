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
  drawNode(node, neighborIds, index = 0) {
    const position = this.layout[node.id];
    if (!position) return;
    const selected = this.view.selectedId === node.id;
    const neighbor = neighborIds.has(node.id);
    const search = String(this.view.search ?? '').trim().toLowerCase();
    const searchMatch = Boolean(search && getNodeSearchText(node).includes(search));
    const degree = this.indexes.degree.get(node.id) ?? 0;
    const geometry = getNodeGeometry(node, { nodeScale: this.view.nodeScale, labelScale: this.view.labelScale, degree });
    const { radius, boxLike, width, height, fontSize } = geometry;
    const color = getNodeColor(node);
    const group = createSvg('g', {
      class: `kg-node${selected ? ' is-selected' : ''}${neighbor ? ' is-neighbor' : ''}${searchMatch ? ' is-search-match' : ''}${this.view.animationEnabled ? ' is-animated' : ''}`,
      transform: `translate(${position.x} ${position.y})`,
      style: `--kg-motion-delay: ${(index % 11) * -0.17}s`,
      tabindex: '0',
      role: 'button',
      'aria-label': `${node.label}, ${getNodeKindLabel(node)}`,
      'data-node-id': node.id
    });
    const title = createSvg('title');
    title.textContent = `${node.label}\n${getNodeKindLabel(node)}\n${degree} connection${degree === 1 ? '' : 's'}`;
    group.append(title);
    if (boxLike) {
      group.append(createSvg('rect', { x: -width / 2, y: -height / 2, width, height, rx: 10 * this.view.nodeScale, fill: color, stroke: color, class: 'kg-node-shape' }));
      group.append(createSvg('rect', { x: -width / 2 + 1, y: -height / 2 + 10, width: 3, height: height - 20, rx: 1.5, fill: color }));
    } else {
      group.append(createSvg('circle', { r: radius, fill: color, stroke: '#c9d4e8', class: 'kg-node-shape' }));
    }
    const label = createSvg('text', { x: 0, y: boxLike ? -3 * this.view.nodeScale : -radius - 12, class: `kg-node-label${boxLike ? '' : ' kg-dot-label'}`, 'text-anchor': 'middle', 'font-size': `${fontSize}px` });
    if (boxLike) label.style.fill = '#0c1424';
    label.textContent = geometry.title;
    group.append(label);
    if (boxLike) {
      const kind = createSvg('text', { x: 0, y: 15 * this.view.nodeScale, class: 'kg-node-kind', 'text-anchor': 'middle', 'font-size': `${10 * this.view.nodeScale}px` });
      kind.style.fill = '#172237';
      kind.textContent = geometry.subtitle;
      group.append(kind);
    }
    if (node.metadata?.unresolved === true) {
      const warning = createSvg('text', { x: 0, y: boxLike ? 0 : radius + 14, class: 'kg-node-warning', 'text-anchor': 'middle' });
      warning.textContent = '⚠';
      group.append(warning);
    }
    this.nodeLayer.append(group);
  }
}
