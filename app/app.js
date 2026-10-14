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
