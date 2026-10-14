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
  render() {
    if (!this.document) return;
    const size = this.getSize();
    this.svg.setAttribute('viewBox', `0 0 ${size.width} ${size.height}`);
    this.visibleNodeIds = getVisibleNodeIds(this.document, this.view, this.indexes, this.callbacks.visibleLimit ?? this.document.nodes.length);
    // Idle visibility controls do not remove relationships from the layout.
    this.visibleEdgeIds = getVisibleEdgeIds(this.document, { ...this.view, showInferred: true }, this.visibleNodeIds, this.indexes);
    const visibleNodes = this.document.nodes.filter((node) => this.visibleNodeIds.has(node.id));
    const layoutKey = JSON.stringify([visibleNodes.map(node => node.id), [...this.visibleEdgeIds], this.positions, this.view.layoutSpacing, this.view.layoutMode, this.view.nodeScale, this.view.labelScale, this.view.linkDistance, this.view.repulsion, this.view.groupOffsets, this.view.areaNameSize]);
    if (layoutKey !== this.layoutKey) {
      this.layout = computeLayout(this.document, { nodes: visibleNodes, edges: this.document.edges.filter(edge => this.visibleEdgeIds.has(edge.id)), positions: this.positions, indexes: this.indexes, spacing: this.view.layoutSpacing, mode: this.view.layoutMode, labelScale: this.view.labelScale, nodeScale: this.view.nodeScale, linkDistance: this.view.linkDistance, repulsion: this.view.repulsion, areaNameSize: this.view.areaNameSize });
      if (this.view.layoutMode === 'grid') for (const node of visibleNodes) {
        const offset = this.view.groupOffsets?.[getArchitectureLayer(node)];
        if (offset && Number.isFinite(offset.x) && Number.isFinite(offset.y)) {
          this.layout[node.id].x += offset.x;
          this.layout[node.id].y += offset.y;
        }
      }
      this.layoutKey = layoutKey;
      this.edgeRoutes.clear();
      this.edgeObstacles = visibleNodes.map(node => ({ id: node.id, position: this.layout[node.id], geometry: getNodeGeometry(node, { nodeScale: this.view.nodeScale, labelScale: this.view.labelScale }) }));
    }
    this.svg.style.setProperty('--kg-motion-duration', `${Math.max(0.45, 3.2 / this.view.animationSpeed)}s`);
    this.svg.style.backgroundColor = this.view.backgroundColor === '#0c1220' ? 'transparent' : this.view.backgroundColor;
    if (this.view.animationEnabled) this.svg.classList.remove('motion-paused');
    else this.svg.classList.add('motion-paused');
    this.edgeLayer.replaceChildren();
    this.edgeLabelPlacements = [];
    this.nodeLayer.replaceChildren();
    this.layerGuides.replaceChildren();
    this.layerLabels.replaceChildren();
    if (['auto', 'layered'].includes(this.view.layoutMode)) {
      const rings = new Map();
      for (const node of visibleNodes) {
        const p = this.layout[node.id];
        const radius = Math.round(Math.hypot(p.x, p.y));
        const key = getArchitectureLayer(node);
        if (!rings.has(key)) rings.set(key, { radii: [], angles: [], name: key, color: getNodeColor(node) });
        rings.get(key).radii.push(radius);
        rings.get(key).angles.push((Math.atan2(p.y, p.x) + Math.PI * 2) % (Math.PI * 2));
      }
      for (const ring of rings.values()) {
        ring.radii.sort((a, b) => a - b);
        ring.radius = this.layout.layerRadii?.[ring.name] ?? ring.radii[Math.floor(ring.radii.length / 2)];
        // Follow the ring in its largest gap, using the same world-space scale
        // as node text instead of growing headings when the graph zooms out.
        ring.angles.sort((a, b) => a - b);
        let gap = -1;
        let center = -Math.PI / 2;
        ring.angles.forEach((angle, index) => {
          const next = ring.angles[(index + 1) % ring.angles.length] + (index === ring.angles.length - 1 ? Math.PI * 2 : 0);
          if (next - angle > gap) { gap = next - angle; center = (angle + next) / 2; }
        });
        const fontSize = (this.view.areaNameSize ?? 23) * this.view.nodeScale * this.view.labelScale;
        const measure = createSvg('text', { 'font-size': fontSize, 'font-family': 'system-ui,sans-serif', 'font-weight': 500, visibility: 'hidden' });
        measure.textContent = ring.name;
        this.layerGuides.append(measure);
        const textWidth = measure.getComputedTextLength?.() || ring.name.length * fontSize * 0.6;
        measure.remove?.();
        const span = Math.min(Math.PI, (textWidth + 10) / Math.max(ring.radius, 1));
        const obstacles = visibleNodes.map(node => ({ p: this.layout[node.id], g: getNodeGeometry(node, { nodeScale: this.view.nodeScale, labelScale: this.view.labelScale }) }));
        let bestHits = Infinity;
        let bestCenter = -Math.PI / 2;
        for (let attempt = 0; attempt < 72; attempt++) {
          const step = Math.ceil(attempt / 2) * Math.PI / 216;
          const candidate = -Math.PI / 2 + (attempt % 2 === 0 ? step : -step);
          let hits = 0;
          for (let sample = 0; sample <= 16; sample++) {
            const angle = candidate + (sample / 16 - 0.5) * span;
            const x = Math.cos(angle) * ring.radius, y = Math.sin(angle) * ring.radius;
            for (const { p, g } of obstacles) {
              if (Math.abs(x - p.x) < g.width / 2 + fontSize && Math.abs(y - p.y) < g.height / 2 + fontSize) hits++;
            }
          }
          if (hits < bestHits) { bestHits = hits; bestCenter = candidate; }
          if (hits === 0) break;
        }
        center = this.layout.layerRadii ? -Math.PI / 2 : bestCenter;
        const gapStart = center - span / 2, gapEnd = center + span / 2;
        this.layerGuides.append(createSvg('path', {
          class: 'kg-layer-ring',
          d: `M ${Math.cos(gapEnd) * ring.radius} ${Math.sin(gapEnd) * ring.radius} A ${ring.radius} ${ring.radius} 0 1 1 ${Math.cos(gapStart) * ring.radius} ${Math.sin(gapStart) * ring.radius}`,
          fill: 'none', stroke: ring.color, 'stroke-opacity': this.view.dottedOpacity ?? 0.85, 'stroke-width': this.view.areaWidth ?? 1.5, 'stroke-dasharray': '0 6', 'stroke-linecap': 'round'
        }));
        const reverse = Math.sin(center) > 0;
        const start = center + (reverse ? span / 2 : -span / 2);
        const end = center + (reverse ? -span / 2 : span / 2);
        const id = `kg-layer-label-${this.layerGuides.children.length}`;
        const arc = createSvg('path', { id, d: `M ${Math.cos(start) * ring.radius} ${Math.sin(start) * ring.radius} A ${ring.radius} ${ring.radius} 0 0 ${reverse ? 0 : 1} ${Math.cos(end) * ring.radius} ${Math.sin(end) * ring.radius}`, fill: 'none', stroke: 'none' });
        const label = createSvg('text', { 'dominant-baseline': 'central', fill: ring.color, 'text-anchor': 'middle', 'font-size': fontSize, 'font-family': 'system-ui,sans-serif', 'font-weight': 500 });
        const textPath = createSvg('textPath', { href: `#${id}`, startOffset: '50%' });
        textPath.textContent = ring.name;
        label.append(textPath);
        this.layerGuides.append(arc);
        this.layerLabels.append(label);
      }
    }
    if (this.view.layoutMode === 'grid') {
      const groups = new Map();
      for (const node of visibleNodes) {
        const name = getArchitectureLayer(node);
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(node);
      }
      for (const [name, nodes] of groups) {
        const bounds = nodes.map(node => {
          const p = this.layout[node.id];
          const g = getNodeGeometry(node, { nodeScale: this.view.nodeScale, labelScale: this.view.labelScale });
          return { left: p.x - g.width / 2, right: p.x + g.width / 2, top: p.y - g.height / 2, bottom: p.y + g.height / 2 };
        });
        let left = Math.min(...bounds.map(b => b.left)) - 28;
        const headingWidth = `${name} · ${nodes.length}`.length * 11 * this.view.labelScale;
        let right = Math.max(...bounds.map(b => b.right)) + 28;
        const extraWidth = Math.max(0, headingWidth + 40 - (right - left));
        left -= extraWidth / 2;
        right += extraWidth / 2;
        const top = Math.min(...bounds.map(b => b.top)) - 64;
        const bottom = Math.max(...bounds.map(b => b.bottom)) + 28;
        const color = getNodeColor(nodes[0]);
        this.layerGuides.append(createSvg('rect', { x: left, y: top, width: right - left, height: bottom - top, rx: 14, fill: '#111b2d', 'fill-opacity': 0.92, stroke: color, 'stroke-opacity': 0.45, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }));
        const heading = createSvg('text', { x: left + 20, y: top + 30, fill: color, 'font-size': 18 * this.view.labelScale, 'font-family': 'system-ui,sans-serif', 'font-weight': 600 });
        heading.textContent = `${name} · ${nodes.length}`;
        heading.setAttribute('data-group-name', name);
        heading.setAttribute('pointer-events', 'all');
        heading.style.cursor = 'grab';
        const handle = createSvg('rect', { x: left, y: top, width: right - left, height: 46, fill: 'transparent', 'data-group-name': name, 'pointer-events': 'all' });
        handle.style.cursor = 'grab';
        this.layerLabels.append(handle);
        this.layerLabels.append(heading);
      }
    }
    const drawnEdges = this.document.edges.filter(edge => {
      if (!this.visibleEdgeIds.has(edge.id)) return false;
      const selectedConnection = this.view.selectedId && (edge.source === this.view.selectedId || edge.target === this.view.selectedId);
      if (selectedConnection) return true;
      if (this.view.selectedId) return false;
      if (this.view.edgeDisplay === 'selected') return false;
      return edge.inferred ? this.view.showInferred !== false : this.view.showSolid !== false;
    });
    for (const edge of drawnEdges) this.drawEdge(edge);
    const selectedId = this.view.selectedId;
    const neighbors = this.getNeighborIds(selectedId);
    for (const [index, node] of visibleNodes.entries()) this.drawNode(node, neighbors, index);
    this.applyTransform();
    this.suppressEdgeLabelCollisions();
    this.callbacks.onVisibility?.({
      layers: [...new Map(visibleNodes.map(node => [getArchitectureLayer(node), { name: getArchitectureLayer(node), color: getNodeColor(node) }])).values()],
      visibleNodes: this.visibleNodeIds.size,
      totalNodes: this.document.nodes.length,
      visibleEdges: drawnEdges.length,
      totalEdges: this.document.edges.length,
      truncated: this.visibleNodeIds.size < getVisibleNodeIds(this.document, this.view, this.indexes, Infinity).size
    });
  }

  applyTransform() {
    this.root.setAttribute('transform', `translate(${this.view.x} ${this.view.y}) scale(${this.view.scale})`);
  }
}
