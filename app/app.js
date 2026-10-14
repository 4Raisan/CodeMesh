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

let renderer;

let toastTimer;

let activeParserJob = null;

let documentSequence = 0;

let importStartedAt = Date.now();

let projectNoticeTimer;

let serverAutoPromise = null;

function beginDocumentOperation() {
  documentSequence += 1;
  importStartedAt = Date.now();
  return documentSequence;
}

function isCurrentDocumentOperation(operation) {
  return operation === documentSequence;
}

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

function showToast(message, tone = 'normal') {
  setText(dom.toast, message);
  dom.toast.className = `toast is-visible ${tone}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    dom.toast.className = 'toast';
  }, 4200);
}

function setBusy(value, message = '') {
  state.busy = value;
  dom.body.classList.toggle('is-busy', value);
  if (message) setText(dom.dropMessage, message);
  const loading = document.getElementById('project-loading');
  if (loading) loading.hidden = !value;
  if (value) {
    setText(document.getElementById('loading-message'), message || 'Building your map…');
    const notice = document.getElementById('project-notice');
    if (notice) notice.hidden = true;
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat().format(value ?? 0);
}

const serverProjectFileNames = new Set(['package.json', 'tsconfig.json', 'jsconfig.json', 'dockerfile', 'makefile', 'readme.md', 'license']);

function isServerTextCandidate(path) {
  const name = path.split('/').pop()?.toLowerCase() ?? '';
  if (name === 'kg-map.html' || name === 'kgmap.html' || name === 'codemesh.html') return false;
  if (serverProjectFileNames.has(name)) return true;
  return /\.(?:html?|js|jsx|mjs|cjs|ts|tsx|mts|cts|py|pyw|go|rs|java|kt|kts|cs|rb|php|swift|c|h|cc|cpp|cxx|hpp|hh|css|scss|sass|less|json|jsonc|yaml|yml|toml|xml|graphql|gql|sql|prisma|md|mdx|sh|bash|zsh|ps1|bat|cmd|vue|svelte|astro)$/i.test(name);
}

async function readServerListing(url) {
  try {
    const response = await fetch(url, { cache: 'no-store', headers: { Accept: 'text/html' } });
    if (!response.ok || (response.url && response.url !== url.href) || !String(response.headers.get('content-type') ?? '').includes('text/html')) return null;
    const html = await response.text();
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const links = [...parsed.querySelectorAll('a[href]')].map((link) => link.getAttribute('href')).filter(Boolean);
    const looksLikeListing = links.some((href) => !/^(?:https?:|\/\/|#|\?)/i.test(href) && (href.endsWith('/') || isServerTextCandidate(href)));
    if (!looksLikeListing) return null;
    return { links: [...new Set(links)], baseUrl: url };
  } catch {
    return null;
  }
}

async function crawlServerDirectory(listing) {
  const queue = [{ url: listing.baseUrl, path: '' }];
  const visited = new Set([listing.baseUrl.href]);
  const records = [];
  const seenFiles = new Set();
  let fileCount = 0;
  let totalBytes = 0;
  while (queue.length > 0 && fileCount < 5000 && totalBytes < 40 * 1024 * 1024) {
    const current = queue.shift();
    const childListing = current.url.href === listing.baseUrl.href ? listing : await readServerListing(current.url);
    if (!childListing) continue;
    for (const href of childListing.links) {
      if (href.startsWith('?') || href.startsWith('#') || href === '../' || href === '/') continue;
      let resolved;
      try {
        resolved = new URL(href, current.url);
      } catch {
        continue;
      }
      if (resolved.origin !== listing.baseUrl.origin || resolved.search || resolved.hash || !resolved.pathname.startsWith(current.url.pathname) || !resolved.pathname.startsWith(listing.baseUrl.pathname)) continue;
      let relativePath;
      try { relativePath = decodeURIComponent(resolved.pathname.slice(listing.baseUrl.pathname.length)); } catch { continue; }
      if (!relativePath || relativePath.split('/').some(part => part === '..' || part === '.') || relativePath.includes('\\')) continue;
      if (shouldIgnorePath(relativePath)) continue;
      if (resolved.pathname.endsWith('/')) {
        if (!visited.has(resolved.href)) {
          visited.add(resolved.href);
          queue.push({ url: resolved, path: relativePath });
        }
        continue;
      }
      if (!isServerTextCandidate(relativePath) || seenFiles.has(resolved.href)) continue;
      seenFiles.add(resolved.href);
      try {
        const response = await fetch(resolved, { cache: 'no-store' });
        if (!response.ok || (response.url && response.url !== resolved.href)) continue;
        if (Number(response.headers.get('content-length')) > 2 * 1024 * 1024) continue;
        const text = await response.text();
        const bytes = new TextEncoder().encode(text).byteLength;
        if (bytes > 2 * 1024 * 1024 || text.includes('\0')) continue;
        if (totalBytes + bytes > 40 * 1024 * 1024) break;
        totalBytes += bytes;
        fileCount += 1;
        records.push({ path: relativePath, text, bytes });
      } catch {
        continue;
      }
    }
  }
  return records;
}

async function discoverServerProject() {
  if (window.location.protocol === 'file:') return null;
  // The HTML directory is the boundary. Never probe parents or import an arbitrary
  // adjacent graph export in place of the source tree.
  const baseUrl = new URL('./', window.location.href);
  const listing = await readServerListing(baseUrl);
  if (!listing) return null;
  const records = await crawlServerDirectory(listing);
  return records.length > 0 ? { type: 'codebase', records, source: 'auto · this folder' } : null;
}

async function autoLoadServerProject(notify = false, operation = documentSequence) {
  if (serverAutoPromise) return serverAutoPromise;
  const promise = (async () => {
    const discovered = await discoverServerProject();
    if (!discovered) return false;
    if (!isCurrentDocumentOperation(operation)) return false;
    if (discovered.type === 'graph') {
      return adoptDocument(discovered.value, discovered.source, operation);
    }
    const parsed = await parseCodebase(discovered.records, { stripCommonRoot: false, name: discovered.source });
    if (parsed.cancelled) return false;
    if (parsed.error) throw parsed.error;
    if (parsed.document.nodes.length === 0) return false;
    if (!adoptDocument(parsed.document, discovered.source, operation)) return false;
    if (notify) showToast(`Auto-discovered ${formatNumber(parsed.document.nodes.length)} nodes from this project.`);
    return true;
  })();
  serverAutoPromise = promise;
  try {
    const result = await promise;
    if (!result) serverAutoPromise = null;
    return result;
  } catch (error) {
    serverAutoPromise = null;
    throw error;
  }
}

function readTextFile(file) {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Unable to read file.'));
    reader.readAsText(file);
  });
}

function joinEntryPath(parent, name) {
  return parent ? `${parent}/${name}` : name;
}

function readDirectoryEntries(directory) {
  return new Promise((resolve, reject) => {
    const reader = directory.createReader();
    const entries = [];
    const readBatch = () => reader.readEntries((batch) => {
      if (!batch.length) {
        resolve(entries);
        return;
      }
      entries.push(...batch);
      readBatch();
    }, reject);
    readBatch();
  });
}

async function readEntry(entry, parentPath = '') {
  if (shouldIgnorePath(joinEntryPath(parentPath, entry.name))) return [];
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    const path = joinEntryPath(parentPath, entry.name);
    if ((file.size ?? 0) > 40 * 1024 * 1024) return [{ path, text: '', bytes: file.size ?? 0 }];
    return [{ path, text: await readTextFile(file), bytes: file.size ?? 0 }];
  }
  if (entry.isDirectory) {
    const path = joinEntryPath(parentPath, entry.name);
    const children = await readDirectoryEntries(entry);
    const records = [];
    for (const child of children) records.push(...await readEntry(child, path));
    return records;
  }
  return [];
}

async function recordsFromDataTransfer(dataTransfer) {
  const entries = [...(dataTransfer.items ?? [])]
    .map((item) => typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null)
    .filter(Boolean);
  if (entries.length > 0) {
    const records = [];
    for (const entry of entries) records.push(...await readEntry(entry));
    return records;
  }
  const records = [];
  for (const file of [...(dataTransfer.files ?? [])]) {
    const path = file.webkitRelativePath || file.name;
    if ((file.size ?? 0) > 40 * 1024 * 1024) records.push({ path, text: '', bytes: file.size ?? 0 });
    else records.push({ path, text: await readTextFile(file), bytes: file.size ?? 0 });
  }
  return records;
}

async function recordsFromFileList(fileList) {
  const records = [];
  for (const file of [...fileList]) {
    const path = file.webkitRelativePath || file.name;
    if (shouldIgnorePath(path)) continue;
    if ((file.size ?? 0) > 40 * 1024 * 1024) records.push({ path, text: '', bytes: file.size ?? 0 });
    else records.push({ path, text: await readTextFile(file), bytes: file.size ?? 0 });
  }
  return records;
}

async function recordsFromDirectoryHandle(directory, parentPath = '') {
  const records = [];
  for await (const [name, entry] of directory.entries()) {
    const path = joinEntryPath(parentPath, name);
    if (shouldIgnorePath(path)) continue;
    if (entry.kind === 'file') {
      const file = await entry.getFile();
      if ((file.size ?? 0) > 40 * 1024 * 1024) records.push({ path, text: '', bytes: file.size ?? 0 });
      else records.push({ path, text: await readTextFile(file), bytes: file.size ?? 0 });
    } else if (entry.kind === 'directory') {
      records.push(...await recordsFromDirectoryHandle(entry, path));
    }
  }
  return records;
}

async function chooseCodebaseFolder() {
  const operation = beginDocumentOperation();
  cancelParserJob();
  // Open during the user gesture; explicit selection must replace auto-discovery.
  if ('webkitdirectory' in dom.folderInput || typeof window.showDirectoryPicker !== 'function') {
    dom.folderInput.click();
    return;
  }
  try {
    const handle = await window.showDirectoryPicker();
    if (!isCurrentDocumentOperation(operation)) return;
    setBusy(true, 'Reading selected codebase…');
    try {
      const records = await recordsFromDirectoryHandle(handle);
      await handleRecords(records, 'selected codebase', operation);
    } finally {
      if (isCurrentDocumentOperation(operation)) setBusy(false);
    }
  } catch (error) {
    if (error?.name === 'AbortError') return;
    dom.folderInput.click();
  }
}

function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = element('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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

function updateStatus(info) {
  state.visibility = info;
  const legend = document.getElementById('layer-legend');
  legend.replaceChildren();
  if (['layered', 'auto'].includes(state.view.layoutMode)) {
    for (const layer of info.layers ?? []) {
      const item = element('span', '', layer.name);
      item.style.setProperty('--layer-color', layer.color);
      legend.append(item);
    }
  }
  const edgeText = `${formatNumber(info.visibleEdges)} / ${formatNumber(info.totalEdges)}`;
  setText(dom.graphStatus, `${formatNumber(info.visibleNodes)} / ${formatNumber(info.totalNodes)} nodes · ${edgeText} connections${state.view.edgeDisplay === 'selected' ? ' shown · select a node to explore' : ''}${info.truncated ? ' · node limit reached' : ''}`);
  dom.emptyState.hidden = info.visibleNodes > 0;
  const unloaded = state.document.nodes.length === 0;
  setText(document.getElementById('empty-title'), unloaded ? 'Open your codebase' : 'No matching nodes');
  setText(document.getElementById('empty-description'), unloaded ? 'Drop this folder onto the map, or select Open project. Browsers need your permission to read local files.' : 'Change your search or clear the filters.');
  setText(document.getElementById('empty-clear'), unloaded ? 'Open project' : 'Clear filters');
  renderList(info);
  updateFilterSummary();
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

function adoptDocument(input, sourceLabel, operation = beginDocumentOperation()) {
  if (!isCurrentDocumentOperation(operation)) return false;
  const normalized = normalizeGraphDocument(input);
  if (normalized.nodes.length === 0) throw new Error('The graph contains no usable nodes.');
  state.document = normalized;
  setText(document.getElementById('source-hint'), `${sourceLabel} · ${formatNumber(normalized.nodes.length)} nodes loaded`);
  state.view = emptyView(normalized);
  setPanel(dom.inspectorPanel, false);
  renderer.setDocument(normalized);
  syncView();
  requestAnimationFrame(() => renderer.fit());
  updateStatus({ visibleNodes: normalized.nodes.length, totalNodes: normalized.nodes.length, visibleEdges: normalized.edges.length, totalEdges: normalized.edges.length, truncated: false });
  const count = normalized.nodes.length;
  const guidance = count <= 300 ? 'Within the recommended everyday viewing range.' : count <= 1000 ? 'For a smoother view, keep Architecture layers and use filters or Show neighbors.' : 'Large map: explore smaller neighborhoods. Force layout may be slow.';
  setText(document.getElementById('project-notice-count'), `${formatNumber(count)} nodes · ${formatNumber(normalized.edges.length)} connections`);
  setText(document.getElementById('project-notice-guidance'), guidance + (normalized.coverage.partial ? ' Partial coverage: some files were skipped.' : ''));
  setText(document.getElementById('project-notice-time'), `Imported and arranged in ${((Date.now() - importStartedAt) / 1000).toFixed(1)} s · device-dependent`);
  const notice = document.getElementById('project-notice');
  if (notice) notice.hidden = false;
  window.clearTimeout(projectNoticeTimer);
  projectNoticeTimer = window.setTimeout(() => { if (notice) notice.hidden = true; }, 14000);
  return true;
}

function applySavedView(payload, quiet = false, operation = beginDocumentOperation()) {
  if (!isCurrentDocumentOperation(operation)) return false;
  if (!payload || payload.fingerprint !== state.document.fingerprint) {
    if (!quiet) showToast('Saved view revision or graph fingerprint does not match the loaded graph.', 'warning');
    return false;
  }
  const normalized = normalizeSavedView(payload.view, state.document);
  if (!normalized) return false;
  state.view = normalized;
  syncView();
  setPanel(dom.inspectorPanel, Boolean(state.view.selectedId), false);
  if (!quiet) showToast('Saved view restored.');
  return true;
}

function cancelParserJob() {
  if (!activeParserJob) return;
  const job = activeParserJob;
  activeParserJob = null;
  job.settled = true;
  if (job.timer) window.clearTimeout(job.timer);
  job.worker?.terminate();
  job.resolve({ cancelled: true });
}

async function parseCodebase(records, options) {
  const operation = documentSequence;
  cancelParserJob();
  if (document.visibilityState === 'visible') await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  if (!isCurrentDocumentOperation(operation)) return { cancelled: true };
  const fallback = () => createCodebaseGraph(records, options);
  if (typeof Worker !== 'function') return Promise.resolve({ document: fallback() });
  const job = { worker: null, resolve: null, timer: null, settled: false };
  const promise = new Promise((resolve) => {
    job.resolve = resolve;
  });
  activeParserJob = job;
  try {
    const worker = new Worker(new URL('./parser-worker.js', import.meta.url), { type: 'module' });
    job.worker = worker;
    const finish = (result) => {
      if (job.settled) return;
      job.settled = true;
      if (job.timer) window.clearTimeout(job.timer);
      if (activeParserJob === job) activeParserJob = null;
      worker.terminate();
      job.resolve(result);
    };
    worker.addEventListener('message', (event) => {
      if (event.data?.type === 'result') finish({ document: event.data.document });
      else finish({ error: new Error(event.data?.message ?? 'Codebase parser worker failed.') });
    });
    worker.addEventListener('error', () => {
      try {
        finish({ document: fallback() });
      } catch (error) {
        finish({ error });
      }
    });
    job.timer = window.setTimeout(() => finish({ error: new Error('Codebase parsing exceeded the browser time limit.') }), 30000);
    worker.postMessage({ records, options });
  } catch {
    activeParserJob = null;
    return Promise.resolve({ document: fallback() });
  }
  return promise;
}

async function handleRecords(records, sourceLabel, operation = beginDocumentOperation()) {
  if (records.length === 0) throw new Error('No files were found in the selection.');
  if (!isCurrentDocumentOperation(operation)) return;
  const graphCandidates = [];
  for (const record of records) {
    if (!record.path.toLowerCase().endsWith('.json') || record.bytes > 40 * 1024 * 1024) continue;
    try {
      const value = JSON.parse(record.text);
      if (isGraphDocument(value) || isViewDocument(value)) graphCandidates.push({ record, value });
    } catch {
      continue;
    }
  }
  if (graphCandidates.length > 1) throw new Error('More than one graph JSON was found. Drop one graph export or a source folder without graph exports.');
  if (graphCandidates.length === 1) {
    const candidate = graphCandidates[0];
    if (isViewDocument(candidate.value)) applySavedView(candidate.value, false, operation);
    else adoptDocument(candidate.value, candidate.record.path, operation);
    return;
  }
  setBusy(true, 'Finding nodes and connections…');
  const parsed = await parseCodebase(records, { stripCommonRoot: true, name: sourceLabel });
  if (parsed.cancelled) return;
  if (parsed.error) throw parsed.error;
  adoptDocument(parsed.document, sourceLabel, operation);
}

async function processFileList(fileList, sourceLabel) {
  const operation = beginDocumentOperation();
  cancelParserJob();
  setBusy(true, 'Reading dropped files…');
  try {
    const records = await recordsFromFileList(fileList);
    if (!isCurrentDocumentOperation(operation)) return;
    await handleRecords(records, sourceLabel, operation);
  } catch (error) {
    if (isCurrentDocumentOperation(operation)) showToast(error instanceof Error ? error.message : String(error), 'warning');
  } finally {
    if (isCurrentDocumentOperation(operation)) setBusy(false);
  }
}

async function processDrop(dataTransfer) {
  const operation = beginDocumentOperation();
  cancelParserJob();
  setBusy(true, 'Reading dropped files…');
  try {
    const records = await recordsFromDataTransfer(dataTransfer);
    if (!isCurrentDocumentOperation(operation)) return;
    await handleRecords(records, 'dropped selection', operation);
  } catch (error) {
    if (isCurrentDocumentOperation(operation)) showToast(error instanceof Error ? error.message : String(error), 'warning');
  } finally {
    if (isCurrentDocumentOperation(operation)) setBusy(false);
  }
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

function setupDropTarget() {
  document.getElementById('dismiss-project-notice')?.addEventListener('click', () => { document.getElementById('project-notice').hidden = true; });
  const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files');
  document.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    state.dragDepth += 1;
    dom.dropOverlay.classList.add('is-visible');
  });
  document.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  document.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    state.dragDepth = Math.max(0, state.dragDepth - 1);
    if (state.dragDepth === 0) dom.dropOverlay.classList.remove('is-visible');
  });
  document.addEventListener('drop', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    state.dragDepth = 0;
    dom.dropOverlay.classList.remove('is-visible');
    processDrop(event.dataTransfer);
  });
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
