import {
  createIndexes,
  createEmptyDocument,
  createSampleDocument,
  fingerprintDocument,
  getNodeColor,
  getNodeKindLabel,
  getVisibleNodeIds,
  normalizeGraphDocument
} from './graph-core.js';

import { createCodebaseGraph, shouldIgnorePath } from './codebase-parser.js';

import { GraphRenderer } from './renderer.js';

const dom = {
  body: document.body,
  graphSvg: document.getElementById('graph-svg'),
  dropOverlay: document.getElementById('drop-overlay'),
  dropMessage: document.getElementById('drop-message'),
  emptyState: document.getElementById('empty-state'),
  graphStatus: document.getElementById('graph-status'),
  graphStats: document.getElementById('graph-stats'),
  search: document.getElementById('search-input'),
  searchClear: document.getElementById('search-clear'),
  groupFilters: document.getElementById('group-filters'),
  kindFilters: document.getElementById('kind-filters'),
  edgeFilters: document.getElementById('edge-filters'),
  filterSummary: document.getElementById('filter-summary'),
  inspector: document.getElementById('inspector-content'),
  nodeList: document.getElementById('node-list'),
  listCount: document.getElementById('list-count'),
  diagnostics: document.getElementById('diagnostics'),
  toast: document.getElementById('toast'),
  sidebar: document.getElementById('sidebar'),
  inspectorPanel: document.getElementById('inspector-panel'),
  sidebarLauncher: document.getElementById('sidebar-launcher'),
  inspectorLauncher: document.getElementById('inspector-launcher'),
  fileInput: document.getElementById('file-input'),
  folderInput: document.getElementById('folder-input'),
  viewInput: document.getElementById('view-input'),
  searchShortcut: document.getElementById('search-shortcut'),
  settingsDock: document.getElementById('settings-dock'),
  layoutMode: document.getElementById('layout-mode'),
  layoutSpacing: document.getElementById('layout-spacing'),
  layoutSpacingValue: document.getElementById('spacing-value'),
  labelScale: document.getElementById('label-scale'),
  labelScaleValue: document.getElementById('label-scale-value'),
  edgeOpacity: document.getElementById('edge-opacity'),
  edgeOpacityValue: document.getElementById('edge-opacity-value'),
  motionToggle: document.getElementById('motion-toggle'),
  animationSpeed: document.getElementById('animation-speed'),
  animationSpeedValue: document.getElementById('animation-speed-value'),
  edgeLabelMode: document.getElementById('edge-label-mode'),
  backgroundColor: document.getElementById('background-color'),
  resetSettings: document.getElementById('reset-settings'),
  settingsFit: document.getElementById('settings-fit')
};

const state = {
  document: createEmptyDocument({ name: 'Choose a project' }),
  view: null,
  visibility: { visibleNodes: 0, totalNodes: 0, visibleEdges: 0, totalEdges: 0, truncated: false },
  busy: false,
  dragDepth: 0
};

const defaultViewSettings = Object.freeze({
  layoutSpacing: 1,
  layoutMode: 'layered',
  nodeScale: 1,
  labelScale: 1,
  edgeOpacity: 0.85,
  inferredOpacity: 0.70,
  dottedOpacity: 0.85,
  showSolid: true,
  edgeDisplay: 'all',
  edgeLabelMode: 'off',
  backgroundColor: '#0c1220',
  animationEnabled: true,
  animationSpeed: 1,
  nodeLimit: 650,
  isolationMode: 'all',
  showInferred: true,
  linkDistance: 180,
  repulsion: 1,
  overviewMode: 'all'
});

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, className, action) {
  const node = element('button', className, text);
  node.type = 'button';
  if (action) node.addEventListener('click', action);
  return node;
}

function setText(node, text) {
  if (node) node.textContent = text;
}

function emptyView(document) {
  return {
    x: 0,
    y: 0,
    scale: 1,
    selectedId: null,
    search: '',
    activeKinds: new Set(),
    activeGroups: new Set(),
    activeEdgeKinds: new Set(),
    focusIds: null,
    positions: { ...(document?.positions ?? {}) },
    labelEdges: false,
    ...defaultViewSettings,
    overviewMode: 'all'
  };
}

function settingNumber(value, fallback, minimum, maximum) {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function settingBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function settingColor(value, fallback) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function viewForStorage(view) {
  return {
    x: Number.isFinite(view.x) ? view.x : 0,
    y: Number.isFinite(view.y) ? view.y : 0,
    scale: Number.isFinite(view.scale) ? view.scale : 1,
    selectedId: view.selectedId ?? null,
    search: view.search ?? '',
    activeKinds: [...(view.activeKinds ?? [])],
    activeGroups: [...(view.activeGroups ?? [])],
    activeEdgeKinds: [...(view.activeEdgeKinds ?? [])],
    focusIds: view.focusIds ? [...view.focusIds] : null,
    positions: Object.fromEntries(Object.entries(view.positions ?? {}).map(([id, position]) => [id, { x: position.x, y: position.y, pinned: position.pinned === true }])),
    labelEdges: view.labelEdges === true,
    layoutSpacing: view.layoutSpacing,
    layoutMode: view.layoutMode,
    nodeScale: view.nodeScale,
    labelScale: view.labelScale,
    edgeOpacity: view.edgeOpacity,
    appearanceVersion: 3,
    groupOffsets: view.groupOffsets ?? {},
    solidWidth: view.solidWidth,
    areaWidth: view.areaWidth,
    areaNameSize: view.areaNameSize,
    arrowSize: view.arrowSize,
    dashedWidth: view.dashedWidth,
    inferredOpacity: view.inferredOpacity,
    dottedOpacity: view.dottedOpacity,
    edgeDisplay: view.edgeDisplay,
    edgeLabelMode: view.edgeLabelMode,
    backgroundColor: view.backgroundColor,
    animationEnabled: view.animationEnabled,
    animationSpeed: view.animationSpeed,
    nodeLimit: view.nodeLimit,
    isolationMode: view.isolationMode,
    showInferred: view.showInferred,
    showSolid: view.showSolid,
    linkDistance: view.linkDistance,
    repulsion: view.repulsion,
    overviewMode: view.overviewMode
  };
}

function normalizeSavedView(saved, document) {
  if (!saved || typeof saved !== 'object') return null;
  const validIds = new Set(document.nodes.map((node) => node.id));
  const positions = {};
  for (const [id, position] of Object.entries(saved.positions ?? {})) {
    if (!validIds.has(id) || !position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) continue;
    positions[id] = { x: position.x, y: position.y, pinned: position.pinned === true };
  }
  return {
    x: Number.isFinite(saved.x) ? saved.x : 0,
    y: Number.isFinite(saved.y) ? saved.y : 0,
    scale: Number.isFinite(saved.scale) ? saved.scale : 1,
    selectedId: validIds.has(saved.selectedId) ? saved.selectedId : null,
    search: typeof saved.search === 'string' ? saved.search.slice(0, 200) : '',
    activeKinds: new Set((Array.isArray(saved.activeKinds) ? saved.activeKinds : []).filter((value) => value === '__none__' || document.nodes.some((node) => node.kind === value))),
    activeGroups: new Set((Array.isArray(saved.activeGroups) ? saved.activeGroups : []).filter((value) => value === '__none__' || document.nodes.some((node) => node.group === value))),
    activeEdgeKinds: new Set((Array.isArray(saved.activeEdgeKinds) ? saved.activeEdgeKinds : []).filter((value) => value === '__none__' || document.edges.some((edge) => edge.kind === value))),
    focusIds: Array.isArray(saved.focusIds) ? new Set(saved.focusIds.filter((id) => validIds.has(id))) : null,
    positions,
    labelEdges: saved.labelEdges === true,
    layoutSpacing: settingNumber(saved.layoutSpacing, defaultViewSettings.layoutSpacing, 0.65, 1.6),
    layoutMode: ['layered', 'auto', 'force', 'grid'].includes(saved.layoutMode) ? saved.layoutMode : defaultViewSettings.layoutMode,
    nodeScale: 1,
    labelScale: settingNumber(saved.labelScale, defaultViewSettings.labelScale, 0.7, 1.6),
    edgeDisplay: saved.edgeDisplay === 'selected' ? 'selected' : 'all',
    inferredOpacity: saved.appearanceVersion === 3 ? settingNumber(saved.inferredOpacity, 0.70, 0, 1) : 0.70,
    solidWidth: 2.2,
    areaWidth: 1.5,
    areaNameSize: 23,
    arrowSize: 13.5,
    groupOffsets: Object.fromEntries(Object.entries(saved.groupOffsets ?? {}).filter(([, offset]) => offset && Number.isFinite(offset.x) && Number.isFinite(offset.y))),
    dashedWidth: 2.2,
    dottedOpacity: 0.85,
    edgeOpacity: saved.appearanceVersion === 3 ? settingNumber(saved.edgeOpacity, defaultViewSettings.edgeOpacity, 0, 1) : 0.85,
    edgeLabelMode: saved.edgeLabelMode === 'light' ? 'active' : ['active', 'always', 'off'].includes(saved.edgeLabelMode) ? saved.edgeLabelMode : defaultViewSettings.edgeLabelMode,
    backgroundColor: saved.appearanceVersion === 3 ? settingColor(saved.backgroundColor, defaultViewSettings.backgroundColor) : '#0c1220',
    animationEnabled: settingBoolean(saved.animationEnabled, defaultViewSettings.animationEnabled),
    animationSpeed: settingNumber(saved.animationSpeed, defaultViewSettings.animationSpeed, 0.25, 2),
    nodeLimit: settingNumber(saved.nodeLimit, 650, 50, 650),
    isolationMode: 'all',
    showInferred: saved.showInferred !== false,
    showSolid: saved.showSolid !== false,
    linkDistance: settingNumber(saved.linkDistance, 180, 0, 1500),
    repulsion: settingNumber(saved.repulsion, 1, -10, 10),
    overviewMode: saved.overviewMode === 'files' ? 'files' : 'all'
  };
}

function localViewKey(document) {
  return `codemesh:view:${document.fingerprint ?? fingerprintDocument(document)}`;
}

function getLocalView(document) {
  try {
    const raw = window.localStorage.getItem(localViewKey(document)) ?? window.localStorage.getItem(`kg-map:view:${document.fingerprint ?? fingerprintDocument(document)}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function updateSettingsControls() {
  if (!dom.layoutSpacing) return;
  const spacing = Math.round(state.view.layoutSpacing * 100);
  const nodeScale = Math.round(state.view.nodeScale * 100);
  const labelScale = Math.round(state.view.labelScale * 100);
  const edgeOpacity = Math.round(state.view.edgeOpacity * 100);
  const animationSpeed = Math.round(state.view.animationSpeed * 100);
  dom.layoutSpacing.value = String(spacing);
  document.getElementById('background-connections').checked = state.view.edgeDisplay !== 'selected';
  dom.layoutMode.value = state.view.layoutMode;
  dom.labelScale.value = String(labelScale);
  dom.edgeOpacity.value = String(edgeOpacity);
  dom.animationSpeed.value = String(animationSpeed);
  dom.layoutSpacingValue.textContent = `${spacing}%`;
  dom.labelScaleValue.textContent = `${labelScale}%`;
  dom.edgeOpacityValue.textContent = `${edgeOpacity}%`;
  dom.animationSpeedValue.textContent = `${animationSpeed}%`;
  dom.motionToggle.checked = state.view.animationEnabled === true;
  dom.edgeLabelMode.checked = state.view.edgeLabelMode === 'always';
  dom.backgroundColor.value = state.view.backgroundColor;
  document.getElementById('theme-custom').value = state.view.backgroundColor;
  let presetTheme = false;
  for (const [id, color] of [['theme-night', '#0c1220'], ['theme-slate', '#202936'], ['theme-black', '#080a0e']]) {
    const active = state.view.backgroundColor === color;
    document.getElementById(id).setAttribute('aria-pressed', String(active));
    presetTheme ||= active;
  }
  document.getElementById('theme-custom').parentElement?.classList.toggle('is-active', !presetTheme);
  const controls = { 'link-distance': state.view.linkDistance, repulsion: Math.round(state.view.repulsion * 100), 'overview-mode': state.view.overviewMode, 'connection-display': state.view.edgeDisplay, 'inferred-opacity': Math.round(state.view.inferredOpacity * 100) };
  for (const [id, value] of Object.entries(controls)) {
    const control = document.getElementById(id);
    if (control) control.value = String(value);
    const output = document.getElementById(`${id}-value`);
    if (output) output.textContent = `${value}${['repulsion', 'inferred-opacity'].includes(id) ? '%' : ''}`;
  }
  document.getElementById('legend-solid').checked = state.view.showSolid !== false;
  document.getElementById('legend-inferred').checked = state.view.showInferred !== false;
  const inferredToggle = document.getElementById('show-inferred');
  if (inferredToggle) inferredToggle.checked = state.view.showInferred;
}

function syncView() {
  state.view = { ...state.view, positions: state.view.positions ?? {} };
  if (document.getElementById('label-edges')) document.getElementById('label-edges').checked = state.view.labelEdges === true;
  updateSettingsControls();
  renderer.setView(state.view);
  updateStats();
  renderFilters();
  renderInspector();
}

function setPanel(panel, open, fitView = false) {
  const changed = panel.classList.contains('is-open') !== open;
  const other = panel === dom.sidebar ? dom.inspectorPanel : dom.sidebar;
  if (open && other.classList.contains('is-open')) setPanel(other, false, fitView);
  panel.classList.toggle('is-open', open);
  panel.classList.toggle('is-collapsed', !open);
  const launcher = panel === dom.sidebar ? dom.sidebarLauncher : dom.inspectorLauncher;
  launcher.hidden = panel === dom.inspectorPanel && !state.view.selectedId;
  launcher.setAttribute('aria-expanded', String(open));
  dom.body.classList.toggle(panel === dom.sidebar ? 'sidebar-closed' : 'inspector-closed', !open);
  if (changed && fitView) requestAnimationFrame(() => renderer.fit());
}

function initialize() {
  state.view = emptyView(state.document);
  renderer = new GraphRenderer(dom.graphSvg, {
    
    onVisibility: updateStatus,
    onSelect: (nodeId) => selectNode(nodeId),
    onViewChange: (view) => {
      state.view = view;
      updateFilterSummary();
      updateSettingsControls();
    },
    onRequestReveal: (nodeId) => {
      state.view.search = '';
      state.view.activeKinds = new Set();
      state.view.activeGroups = new Set();
      state.view.activeEdgeKinds = new Set();
      state.view.focusIds = null;
      state.view.selectedId = nodeId;
      syncView();
    },
    onEscape: () => {
      state.view.selectedId = null;
      state.view.focusIds = null;
      syncView();
      setPanel(dom.inspectorPanel, false);
    }
  });
  renderer.setDocument(state.document);
  renderer.setView(state.view);
  setupDropTarget();
  setupControls();
  setPanel(dom.sidebar, false);
  setPanel(dom.inspectorPanel, false);
  updateStats();
  updateSettingsControls();
  renderFilters();
  renderInspector();
  requestAnimationFrame(() => renderer.fit());
  void autoLoadServerProject(false, beginDocumentOperation()).catch(() => false);
}

initialize();
