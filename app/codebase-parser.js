

const LANGUAGE_BY_EXTENSION = new Map(Object.entries({
  js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  py: 'Python', pyw: 'Python', go: 'Go', rs: 'Rust', java: 'Java', kt: 'Kotlin', kts: 'Kotlin',
  cs: 'C#', rb: 'Ruby', php: 'PHP', swift: 'Swift', m: 'Objective-C', mm: 'Objective-C++',
  c: 'C', h: 'C/C++', cc: 'C++', cpp: 'C++', cxx: 'C++', hpp: 'C++', hh: 'C++',
  css: 'CSS', scss: 'SCSS', sass: 'SCSS', less: 'Less', html: 'HTML', htm: 'HTML',
  json: 'JSON', jsonc: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML', xml: 'XML',
  graphql: 'GraphQL', gql: 'GraphQL', sql: 'SQL', prisma: 'Prisma', md: 'Markdown', mdx: 'Markdown',
  sh: 'Shell', bash: 'Shell', zsh: 'Shell', ps1: 'PowerShell', bat: 'Batch', cmd: 'Batch',
  vue: 'Vue', svelte: 'Svelte', astro: 'Astro'
}));

const IGNORED_SEGMENTS = new Set([
  '.git', '.hg', '.svn', 'node_modules', 'vendor', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.svelte-kit',
  '.turbo', '.cache', '.parcel-cache', '.pytest_cache', '__pycache__', '.venv', 'venv', 'target', 'bin', 'obj', '.idea', '.vscode', '.wwebjs_auth', '.wwebjs_cache'
]);

const SOURCE_EXTENSIONS = new Set([
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts', 'py', 'pyw', 'go', 'rs', 'java', 'kt', 'kts', 'cs', 'rb', 'php',
  'swift', 'm', 'mm', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'css', 'scss', 'sass', 'less', 'html', 'htm', 'vue', 'svelte', 'astro',
  'json', 'jsonc', 'yaml', 'yml', 'toml', 'xml', 'graphql', 'gql', 'sql', 'prisma', 'md', 'mdx', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd'
]);

const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 40 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5000;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function extensionOf(path) {
  const name = String(path).toLowerCase().split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1) : '';
}

function basename(path) {
  return String(path).split('/').pop() ?? '';
}

function normalizeSourcePath(input) {
  let value = String(input ?? '').replace(/\\/g, '/');
  value = value.replace(/^[A-Za-z]:\//, '');
  value = value.replace(/^\/+/, '');
  const parts = [];
  for (const part of value.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop();
      else parts.push(part);
      continue;
    }
    parts.push(part);
  }
  return parts.join('/');
}

function dirname(path) {
  const normalized = normalizeSourcePath(path);
  const index = normalized.lastIndexOf('/');
  return index === -1 ? '' : normalized.slice(0, index);
}

function joinPath(...parts) {
  return normalizeSourcePath(parts.filter(Boolean).join('/'));
}

function commonDirectory(paths) {
  if (paths.length < 2) return '';
  const split = paths.map((path) => path.split('/').filter(Boolean));
  const first = split[0];
  const common = [];
  for (let index = 0; index < first.length; index += 1) {
    if (split.every((parts) => parts.length > index && parts[index] === first[index])) common.push(first[index]);
    else break;
  }
  return common.length > 0 && common.length < first.length ? `${common.join('/')}/` : '';
}

export function shouldIgnorePath(path) {
  const normalized = normalizeSourcePath(path);
  if (!normalized || normalized.split('/').some((segment) => IGNORED_SEGMENTS.has(segment))) return true;
  const name = basename(normalized).toLowerCase();
  if (name === '.env' || name.startsWith('.env.')) return true;
  if (name.endsWith('.min.js') || name.endsWith('.map') || name === 'package-lock.json' || name === 'yarn.lock' || name === 'pnpm-lock.yaml') return true;
  if (name === '.ds_store' || name === 'thumbs.db') return true;
  if (name === 'kg-map.html' || name === 'kgmap.html' || name === 'codemesh.html') return true;
  return false;
}

export function detectLanguage(path) {
  const name = basename(path).toLowerCase();
  if (name === 'dockerfile') return 'Dockerfile';
  if (name === 'makefile') return 'Makefile';
  if (name === 'package.json') return 'JSON';
  if (name === 'package-lock.json' || name === 'pnpm-lock.yaml' || name === 'yarn.lock') return 'Lockfile';
  return LANGUAGE_BY_EXTENSION.get(extensionOf(path)) ?? 'Text';
}

function isText(text) {
  if (typeof text !== 'string' || text.length === 0) return false;
  let controls = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0) return false;
    if (code < 9 || (code > 13 && code < 32)) controls += 1;
  }
  return controls / text.length < 0.02;
}

function kindForPath(path, language) {
  const normalized = path.toLowerCase();
  const name = basename(normalized);
  if (/(^|\/)(test|tests|spec|specs|__tests__)(\/|$)/.test(normalized) || /\.(test|spec)\.[^.]+$/.test(name)) return 'test';
  if (/^(readme|changelog|contributing|license|architecture|agents|claude)(\.|$)/.test(name) || /\.(md|mdx|rst|txt|adoc)$/.test(name)) return 'documentation';
  if (['prisma', 'sql', 'graphql', 'gql'].includes(extensionOf(path)) || /schema|migration|database/.test(normalized)) return 'schema';
  if (/^(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|tsconfig.*\.json|vite\.config|webpack\.config|rollup\.config|next\.config|astro\.config|dockerfile|makefile)$/.test(name) || /\.(ya?ml|toml|ini|cfg|conf|env)$/.test(name)) return 'configuration';
  if (SOURCE_EXTENSIONS.has(extensionOf(path))) return language === 'Text' ? 'file' : 'module';
  return 'file';
}

function groupForKind(kind, language) {
  if (kind === 'test') return 'test';
  if (kind === 'documentation') return 'docs';
  if (kind === 'schema') return 'data';
  if (kind === 'configuration') return 'config';
  if (['JavaScript', 'TypeScript', 'Vue', 'Svelte', 'Astro'].includes(language)) return 'code';
  return 'code';
}

function lineStarts(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function lineNumberAt(starts, index) {
  let low = 0;
  let high = starts.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (starts[middle] <= index) low = middle + 1;
    else high = middle - 1;
  }
  return Math.max(1, high + 1);
}

function addMatch(matches, starts, index, specifier, kind = 'IMPORTS') {
  if (!specifier || specifier.length > 500 || specifier.includes('\n')) return;
  matches.push({ specifier, kind, line: lineNumberAt(starts, index), index });
}

function extractImports(text, language) {
  const matches = [];
  const starts = lineStarts(text);
  const addAll = (regex, mapper, kind = 'IMPORTS') => {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const mapped = mapper(match);
      if (Array.isArray(mapped)) mapped.forEach((entry) => addMatch(matches, starts, match.index, entry, kind));
      else addMatch(matches, starts, match.index, mapped, kind);
    }
  };
  if (['JavaScript', 'TypeScript', 'Vue', 'Svelte', 'Astro'].includes(language)) {
    addAll(/\b(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g, (match) => match[1]);
    addAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g, (match) => match[1]);
    addAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, (match) => match[1]);
    addAll(/from\s+["']([^"']+)["']/g, (match) => match[1]);
  }
  if (language === 'Python') {
    addAll(/^\s*from\s+([.\w]+)\s+import\b/gm, (match) => match[1]);
    addAll(/^\s*import\s+([.\w]+(?:\s*,\s*[.\w]+)*)/gm, (match) => match[1].split(',').map((value) => value.trim()));
  }
  if (language === 'Go') {
    addAll(/\bimport\s*\(([\s\S]*?)\)/g, (match) => [...match[1].matchAll(/["`]([^"`]+)["`]/g)].map((item) => item[1]));
    addAll(/^\s*import\s+(?:[A-Za-z_.]\s+)?["`]([^"`]+)["`]/gm, (match) => match[1]);
  }
  if (language === 'Rust') {
    addAll(/^\s*(?:pub\s+)?use\s+([A-Za-z_][\w]*(?:::[A-Za-z_][\w]*)+)/gm, (match) => match[1]);
    addAll(/^\s*(?:pub\s+)?mod\s+([A-Za-z_][\w]*)\s*;/gm, (match) => `crate::${match[1]}`);
  }
  if (['Java', 'Kotlin', 'C#', 'Swift', 'Objective-C', 'Objective-C++'].includes(language)) {
    addAll(/^\s*(?:import|using)\s+(?:static\s+)?([A-Za-z_][\w.]*(?:\.\*)?)\s*;?/gm, (match) => match[1]);
  }
  if (language === 'Ruby') {
    addAll(/\brequire(?:_relative)?\s*\(?\s*["']([^"']+)["']/g, (match) => match[1]);
  }
  if (language === 'PHP') {
    addAll(/^\s*(?:use|require(?:_once)?|include(?:_once)?)\s+["']([^"']+)["']/gm, (match) => match[1]);
  }
  if (['CSS', 'SCSS', 'Less'].includes(language)) {
    addAll(/@import\s+(?:url\()?\s*["']([^"']+)["']/gi, (match) => match[1]);
  }
  if (language === 'HTML') {
    addAll(/<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*["'](?!https?:|\/\/|data:)([^"']+)["']/gi, (match) => match[1]);
  }
  if (language === 'Markdown') {
    addAll(/\[[^\]]*\]\((?!https?:|mailto:|#)([^)]+)\)/gi, (match) => match[1].split('#')[0], 'DOCUMENTS');
  }
  const unique = new Map();
  for (const match of matches) unique.set(`${match.kind}:${match.line}:${match.specifier}`, match);
  return [...unique.values()];
}

function extensionCandidates(path) {
  const extension = extensionOf(path);
  const candidates = [path];
  if (!extension) {
    for (const value of ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'kt', 'rb', 'php', 'json', 'yaml', 'yml', 'md']) candidates.push(`${path}.${value}`);
    for (const value of ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'go', 'rs', 'java', 'kt', 'rb', 'php']) candidates.push(`${path}/index.${value}`);
  } else if (['js', 'jsx', 'mjs', 'cjs'].includes(extension)) {
    for (const value of ['ts', 'tsx', 'jsx', 'js']) candidates.push(path.replace(/\.[^.]+$/, `.${value}`));
  } else if (['ts', 'tsx'].includes(extension)) {
    for (const value of ['js', 'jsx', 'tsx', 'ts']) candidates.push(path.replace(/\.[^.]+$/, `.${value}`));
  }
  if (path.endsWith('/') || path.endsWith('__init__')) {
    for (const value of ['ts', 'tsx', 'js', 'jsx', 'py']) candidates.push(`${path}${value}`);
  }
  return [...new Set(candidates.map(normalizeSourcePath))];
}

function resolveRelativeImport(fromPath, specifier, filePaths, options) {
  let target = specifier.split(/[?#]/)[0];
  let packageRoot = dirname(fromPath);
  while (packageRoot && !filePaths.has(joinPath(packageRoot, 'package.json'))) packageRoot = dirname(packageRoot);
  if (target.startsWith('@/') || target.startsWith('~/')) target = joinPath(options.sourceRoot ?? joinPath(packageRoot, 'src'), target.slice(2));
  else if (target.startsWith('/')) target = joinPath(packageRoot, target.slice(1));
  else target = joinPath(dirname(fromPath), target);
  if (target.startsWith('..')) return { path: null, resolution: 'unresolved', reason: 'outside-project' };
  const candidates = extensionCandidates(target);
  for (const candidate of candidates) {
    if (filePaths.has(candidate)) return { path: candidate, resolution: 'resolved' };
  }
  return { path: null, resolution: 'unresolved', reason: 'missing-target' };
}

function resolvePythonImport(fromPath, specifier, filePaths, options) {
  const clean = specifier.split(/[?#]/)[0];
  const relative = /^\.+/.exec(clean)?.[0] ?? '';
  const moduleName = clean.slice(relative.length).replace(/\./g, '/');
  const base = relative ? joinPath(dirname(fromPath), ...Array.from({ length: relative.length - 1 }, () => '..'), moduleName) : joinPath(options.sourceRoot ?? 'src', moduleName);
  const candidates = [base, ...(relative ? [] : [moduleName]), ...(relative ? [] : [joinPath('lib', moduleName)])];
  for (const candidate of candidates) {
    for (const resolved of extensionCandidates(candidate)) {
      if (filePaths.has(resolved)) return { path: resolved, resolution: 'resolved' };
    }
  }
  return { path: null, resolution: 'unresolved', reason: 'missing-target' };
}

function resolveImport(fromPath, specifier, language, filePaths, options) {
  const clean = specifier.split(/[?#]/)[0];
  if (!clean) return { path: null, resolution: 'unresolved', reason: 'empty-specifier' };
  if (clean.startsWith('.') || clean.startsWith('/') || clean.startsWith('@/') || clean.startsWith('~/')) {
    return resolveRelativeImport(fromPath, clean, filePaths, options);
  }
  if (language === 'Python') return resolvePythonImport(fromPath, clean, filePaths, options);
  if (clean.startsWith('crate::') || clean.startsWith('super::') || clean.startsWith('self::')) {
    const module = clean.split('::').filter(Boolean).slice(-1)[0];
    return resolveRelativeImport(fromPath, `./${module}`, filePaths, options);
  }
  if (language === 'Ruby' && clean.startsWith('.')) return resolveRelativeImport(fromPath, clean, filePaths, options);
  return { path: null, resolution: 'external', reason: 'package-or-runtime' };
}

function routeId(method, path, filePath, line) {
  return `route:${method}:${path}:${filePath}:${line}`;
}

function extractRoutes(text, language, filePath) {
  const routes = [];
  const starts = lineStarts(text);
  const add = (method, path, index, framework) => {
    const cleanPath = String(path ?? '').trim();
    if (!cleanPath || (!cleanPath.startsWith('/') && !cleanPath.startsWith(':'))) return;
    const normalizedMethod = String(method ?? 'ANY').toUpperCase().replace('ALL', 'ANY');
    routes.push({
      id: routeId(normalizedMethod, cleanPath, filePath, lineNumberAt(starts, index)),
      kind: 'route',
      label: `${normalizedMethod} ${cleanPath}`,
      group: 'route',
      method: normalizedMethod,
      path: cleanPath,
      line: lineNumberAt(starts, index),
      framework
    });
  };
  let match;
  const jsRoute = /\b(?:app|router|server|fastify|api)\s*\.\s*(get|post|put|patch|delete|options|head|all)\s*\(\s*["'`]([^"'`]+)["'`]/gi;
  while ((match = jsRoute.exec(text)) !== null) add(match[1], match[2], match.index, 'http');
  const pythonGet = /@(app|router|api|blueprint|bp)\.(get|post|put|patch|delete|options|head)\s*\(\s*["']([^"']+)["']/gim;
  while ((match = pythonGet.exec(text)) !== null) add(match[2], match[3], match.index, 'python');
  const pythonRoute = /@(app|router|api|blueprint|bp)\.route\s*\(\s*["']([^"']+)["']([^\n]*)/gim;
  while ((match = pythonRoute.exec(text)) !== null) {
    const methods = [...match[3].matchAll(/["']([A-Z]+)["']/g)].map((item) => item[1]);
    const methodList = methods.length > 0 ? methods : ['ANY'];
    for (const method of methodList) add(method, match[2], match.index, 'python');
  }
  const javaRoute = /@(Get|Post|Put|Patch|Delete|Request)Mapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)/gim;
  while ((match = javaRoute.exec(text)) !== null) add(match[1] === 'Request' ? 'ANY' : match[1], match[2], match.index, 'jvm');
  const goRoute = /\b(Handle|HandleFunc|GET|POST|PUT|PATCH|DELETE)\s*\(\s*["`]([^"`]+)/g;
  while ((match = goRoute.exec(text)) !== null) add(match[1] === 'Handle' || match[1] === 'HandleFunc' ? 'ANY' : match[1], match[2], match.index, 'go');
  return routes;
}

function callArguments(text, opening) {
  let depth = 0;
  let quote = null;
  for (let index = opening; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') quote = char;
    else if (char === '(') depth += 1;
    else if (char === ')' && --depth === 0) return text.slice(opening + 1, index);
  }
  return '';
}

function extractApiCalls(text, language) {
  const calls = [];
  const starts = lineStarts(text);
  const add = (path, index, method = 'ANY') => {
    const clean = String(path ?? '').split(/[?#]/)[0];
    if (!clean.startsWith('/')) return;
    calls.push({ path: clean, method, line: lineNumberAt(starts, index), index });
  };
  let match;
  const jsCall = /\b(fetch|apiRequest|axios(?:\.(get|post|put|patch|delete|head|options))?)\s*\(\s*(["'`])([\s\S]*?)\3/gi;
  while ((match = jsCall.exec(text)) !== null) {
    const argumentsText = callArguments(text, text.indexOf('(', match.index));
    const optionsText = argumentsText.slice(argumentsText.indexOf(match[3], 0) + match[4].length + 2);
    const methodOption = /\bmethod\s*:\s*["'](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["']/i.exec(optionsText);
    const dynamicMethod = /\bmethod\s*:/.test(optionsText) && !methodOption;
    const method = match[2]?.toUpperCase() ?? methodOption?.[1].toUpperCase() ?? (match[1] === 'fetch' && !dynamicMethod ? 'GET' : 'ANY');
    add(match[4], match.index, method);
  }
  const pythonCall = /(?:requests|httpx)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*["']([^"']+)/gi;
  while ((match = pythonCall.exec(text)) !== null) add(match[2], match.index, match[1].toUpperCase());
  if (language === 'Go') {
    const goCall = /\b(?:http\.Get|http\.Post|http\.NewRequest)\s*\(\s*(?:[^,]+,\s*)?["`]([^"`]+)/g;
    while ((match = goCall.exec(text)) !== null) add(match[1], match.index);
  }
  return calls;
}

function normalizeRoutePath(path) {
  return String(path)
    .replace(/\/+$/, '')
    .replace(/\$\{[^}]+\}/g, ':id')
    .replace(/\/:\w+/g, '/:id')
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    || '/';
}

function routePathsMatch(routePath, callPath) {
  const route = normalizeRoutePath(routePath);
  const call = normalizeRoutePath(callPath);
  const routeParts = route.split('/');
  const callParts = call.split('/');
  return routeParts.length === callParts.length && routeParts.every((part, index) => part === ':id' ? Boolean(callParts[index]) : part === callParts[index]);
}

function extractModels(text, language, filePath) {
  const models = [];
  const starts = lineStarts(text);
  const add = (kind, name, index) => {
    if (!name || !/^[A-Za-z_][\w.-]*$/.test(name)) return;
    const normalizedKind = kind.toLowerCase() === 'enum' ? 'enum' : 'model';
    models.push({
      id: `schema:${normalizedKind}:${name}:${filePath}`,
      kind: normalizedKind,
      label: name,
      group: 'data',
      line: lineNumberAt(starts, index)
    });
  };
  let match;
  if (language === 'Prisma') {
    const prisma = /^\s*(model|enum)\s+([A-Za-z_][\w]*)/gm;
    while ((match = prisma.exec(text)) !== null) add(match[1], match[2], match.index);
  }
  if (language === 'SQL') {
    const sql = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`\[]?([A-Za-z_][\w.-]*)/gim;
    while ((match = sql.exec(text)) !== null) add('model', match[1], match.index);
  }
  if (['Java', 'Kotlin', 'C#', 'Python', 'TypeScript', 'JavaScript'].includes(language)) {
    const entity = /@(?:Entity|Table|Model)\s*\([^)]*\)\s*(?:export\s+)?(?:class|interface|type)\s+([A-Za-z_][\w]*)/g;
    while ((match = entity.exec(text)) !== null) add('model', match[1], match.index);
    const classLike = /^\s*(?:export\s+)?(?:class|interface)\s+([A-Z][A-Za-z0-9_]*)/gm;
    while ((match = classLike.exec(text)) !== null) {
      if (!models.some((item) => item.label === match[1] && item.line === lineNumberAt(starts, match.index))) add('class', match[1], match.index);
    }
  }
  return models;
}

function packageDependencies(text) {
  try {
    const parsed = JSON.parse(text);
    const dependencies = [];
    for (const group of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      if (!isRecord(parsed[group])) continue;
      for (const [name, version] of Object.entries(parsed[group])) {
        if (typeof version === 'string') dependencies.push({ name, version, group });
      }
    }
    return dependencies;
  } catch {
    return [];
  }
}
