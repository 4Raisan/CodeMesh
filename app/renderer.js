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
  routeControl(edge, from, to, curve) {
    if (this.edgeRoutes.has(edge.id)) return this.edgeRoutes.get(edge.id);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy) || 1;
    let best = null;
    let bestHits = Infinity;
    const candidates = this.edgeObstacles.length <= 160 ? [curve, -curve, curve + 80, -curve - 80, curve + 180, -curve - 180] : [curve];
    for (const bend of candidates) {
      const control = { x: (from.x + to.x) / 2 - dy / distance * bend, y: (from.y + to.y) / 2 + dx / distance * bend };
      let hits = 0;
      for (const obstacle of this.edgeObstacles) {
        if (obstacle.id === edge.source || obstacle.id === edge.target) continue;
        const { position, geometry } = obstacle;
        const halfWidth = (geometry.boxLike ? geometry.width / 2 : geometry.radius) + 8;
        const halfHeight = (geometry.boxLike ? geometry.height / 2 : geometry.radius) + 8;
        if (position.x + halfWidth < Math.min(from.x, to.x, control.x) || position.x - halfWidth > Math.max(from.x, to.x, control.x) || position.y + halfHeight < Math.min(from.y, to.y, control.y) || position.y - halfHeight > Math.max(from.y, to.y, control.y)) continue;
        for (let step = 1; step < 32; step += 1) {
          const t = step / 32;
          const x = (1 - t) ** 2 * from.x + 2 * (1 - t) * t * control.x + t ** 2 * to.x;
          const y = (1 - t) ** 2 * from.y + 2 * (1 - t) * t * control.y + t ** 2 * to.y;
          if (Math.abs(x - position.x) < halfWidth && Math.abs(y - position.y) < halfHeight) { hits += 1; break; }
        }
        if (hits >= bestHits) break;
      }
      if (hits < bestHits) { best = control; bestHits = hits; }
      if (hits === 0) break;
    }
    this.edgeRoutes.set(edge.id, best);
    return best;
  }

  drawEdge(edge) {
    const from = this.layout[edge.source];
    const to = this.layout[edge.target];
    if (!from || !to) return;
    const selected = this.view.selectedId;
    const active = selected && (edge.source === selected || edge.target === selected);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy) || 1;
    const curve = (edge.source === edge.target ? 34 : Math.min(70, Math.max(18, distance * 0.12))) + (this.edgeOffsets.get(edge.id) ?? 0);
    const control = this.routeControl(edge, from, to, curve);
    const controlX = control.x;
    const controlY = control.y;
    const source = this.edgeBoundary(edge.source, from, { x: controlX, y: controlY });
    const target = this.edgeBoundary(edge.target, to, { x: controlX, y: controlY }, 5);
    const loopNode = getNodeGeometry(this.indexes.nodesById.get(edge.source), { nodeScale: this.view.nodeScale, labelScale: this.view.labelScale });
    const loopTop = from.y - (loopNode.boxLike ? loopNode.height / 2 : loopNode.radius) - 4;
    const pathData = edge.source === edge.target
      ? `M ${from.x - 18} ${loopTop} C ${from.x - curve - 25} ${loopTop - curve - 35}, ${from.x + curve + 25} ${loopTop - curve - 35}, ${from.x + 18} ${loopTop}`
      : `M ${source.x} ${source.y} Q ${controlX} ${controlY} ${target.x} ${target.y}`;
    const path = createSvg('path', {
      d: pathData,
      class: `kg-edge${edge.inferred ? ' is-inferred' : ''}${active ? ' is-active' : ''}`,
      fill: 'none',
      stroke: edge.inferred ? '#d6ad55' : '#a8f0d2',
      'stroke-width': active ? Math.max(2.2, edge.inferred ? this.view.dashedWidth : this.view.solidWidth) : (edge.inferred ? this.view.dashedWidth : this.view.solidWidth),
      'stroke-opacity': active ? Math.max(0.72, this.view.edgeOpacity) : (edge.inferred ? (this.view.inferredOpacity ?? this.view.edgeOpacity) : this.view.edgeOpacity),
      'stroke-dasharray': edge.inferred ? '6 5' : undefined,
      'data-edge-id': edge.id
    });
    const title = createSvg('title');
    title.textContent = `${edge.kind}: ${edge.source} → ${edge.target}`;
    path.append(title);
    let edgeLabel;
    if (active || this.view.labelEdges || shouldShowEdgeLabel(this.view.edgeLabelMode, active)) {
      const label = createSvg('text', { class: 'kg-edge-label', 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': `${12 * this.view.labelScale}px`, stroke: 'none' });
      const names = { IMPORTS: 'imports', DEPENDS_ON: 'depends on', CALLS: 'calls', TARGETS: 'targets', DEFINES: 'defines', EXPOSES: 'exposes', DOCUMENTS: 'documents' };
      const name = names[edge.kind] ?? truncate(edge.kind, 24);
      const id = `kg-edge-text-path-${this.edgeLayer.children.length}`;
      // Reverse the text guide, not the relationship, to keep names upright.
      const reverse = source.x > target.x;
      const guideData = edge.source === edge.target ? pathData : reverse
        ? `M ${target.x} ${target.y} Q ${controlX} ${controlY} ${source.x} ${source.y}` : pathData;
      const guide = createSvg('path', { id, d: guideData, fill: 'none', stroke: 'none' });
      const textPath = createSvg('textPath', { href: `#${id}`, startOffset: '50%' });
      textPath.textContent = name;
      label.append(textPath);
      label.style.stroke = 'none';
      this.edgeLayer.append(guide, label);
      const length = guide.getTotalLength?.() ?? (Math.hypot(controlX - source.x, controlY - source.y) + Math.hypot(target.x - controlX, target.y - controlY));
      const textWidth = textPath.getComputedTextLength?.() ?? name.length * 12 * this.view.labelScale * 0.52;
      const gap = Math.min(80, (textWidth + 4) / Math.max(length, 1) * 100);
      const maskId = `${id}-gap`;
      const mask = createSvg('mask', { id: maskId, maskUnits: 'userSpaceOnUse', x: Math.min(source.x, target.x, controlX) - 200, y: Math.min(source.y, target.y, controlY, loopTop - curve - 35) - 200, width: Math.abs(dx) + curve * 2 + 600, height: Math.abs(dy) + curve * 2 + 600 });
      mask.append(createSvg('rect', { x: '-100000', y: '-100000', width: '200000', height: '200000', fill: 'white' }));
      const gapPath = createSvg('path', { d: pathData, pathLength: 100, fill: 'none', stroke: 'black', 'stroke-width': 12 * this.view.labelScale + 6, 'stroke-dasharray': `0 ${50 - gap / 2} ${gap} 100` });
      mask.append(gapPath);
      this.edgeLabelPlacements.push({ label, textPath, gapPath, gap, reverse });
      this.edgeLayer.append(mask);
      path.setAttribute('mask', `url(#${maskId})`);
      edgeLabel = label;
    }
    this.edgeLayer.append(path);
    if (this.view.animationEnabled && !edge.inferred) this.edgeLayer.append(createSvg('path', {
      d: pathData, class: 'kg-edge-flow', fill: 'none', stroke: '#ffffff',
      'stroke-width': Number(path.getAttribute('stroke-width')) + 1,
      'stroke-dasharray': '10 70', 'stroke-linecap': 'round', 'stroke-opacity': 1,
      mask: path.getAttribute('mask') ?? undefined, 'pointer-events': 'none'
    }));
    if (edgeLabel) this.edgeLayer.append(edgeLabel);
    if (active || this.view.scale >= 0.35) {
      const tip = edge.source === edge.target ? { x: from.x + 18, y: loopTop } : target;
      const tangent = edge.source === edge.target ? { x: from.x + curve + 25, y: loopTop - curve - 35 } : control;
      const length = Math.hypot(tip.x - tangent.x, tip.y - tangent.y) || 1;
      const ux = (tip.x - tangent.x) / length, uy = (tip.y - tangent.y) / length;
      const size = this.view.arrowSize ?? 13.5;
      const bx = tip.x - ux * size, by = tip.y - uy * size;
      this.edgeLayer.append(createSvg('path', {
        class: 'kg-arrow',
        d: `M ${tip.x} ${tip.y} L ${bx - uy * size * 0.45} ${by + ux * size * 0.45} L ${bx + uy * size * 0.45} ${by - ux * size * 0.45} Z`,
        fill: path.getAttribute('stroke'), opacity: path.getAttribute('stroke-opacity'), 'pointer-events': 'none'
      }));
    }
  }

  edgeBoundary(id, center, toward, padding = 2) {
    const node = this.indexes.nodesById.get(id);
    const { radius, boxLike, width, height } = getNodeGeometry(node, { nodeScale: this.view.nodeScale, labelScale: this.view.labelScale, degree: this.indexes.degree.get(id) ?? 0 });
    const dx = toward.x - center.x;
    const dy = toward.y - center.y;
    const distance = Math.hypot(dx, dy) || 1;
    const extent = boxLike ? Math.min((width / 2) / (Math.abs(dx) / distance || 1e-9), (height / 2) / (Math.abs(dy) / distance || 1e-9)) : radius;
    return { x: center.x + dx / distance * (extent + padding), y: center.y + dy / distance * (extent + padding) };
  }
}
