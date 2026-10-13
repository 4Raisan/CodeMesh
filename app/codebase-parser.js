

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
