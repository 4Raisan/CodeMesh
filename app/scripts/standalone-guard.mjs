// Shared helpers for producing and validating the self-contained CodeWeb.html build.
// The import scanner is deliberately fail-closed: any import form it cannot classify
// throws instead of being skipped, so the build can never approve a bundle that
// leaves a reference unresolved.

const IMPORT_START = /^import(?=[\s{*'"])/gm;

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

function splitTopLevel(clause) {
  const parts = [];
  let current = '';
  let depth = 0;
  let quote = null;
  for (const character of clause) {
    if (quote) {
      current += character;
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') depth -= 1;
    if (character === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim()) parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

function namedBinding(entry, statement) {
  const aliased = /^[\s\S]*\s+as\s+([\w$]+)$/.exec(entry);
  if (aliased) return aliased[1];
  if (/^[\w$]+$/.test(entry)) return entry;
  throw new Error(`Unsupported named import "${entry}" in: ${statement}`);
}

function clauseBinding(clause, statement) {
  if (clause.startsWith('*')) {
    const namespace = /^\*\s+as\s+([\w$]+)$/.exec(clause);
    if (!namespace) throw new Error(`Unsupported namespace import "${clause}" in: ${statement}`);
    return namespace[1];
  }
  const alias = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(clause);
  if (!alias) throw new Error(`Unsupported import clause "${clause}" in: ${statement}`);
  return alias[2] ?? alias[1];
}

function classifyImport(statement) {
  const clause = statement
    .replace(/;\s*$/, '')
    .replace(/(?:\bfrom\s*)?['"][^'"\n]*['"]\s*$/, '')
    .trim();
  if (clause === '') return [];
  return splitTopLevel(stripComments(clause)).map((part) => {
    if (part.startsWith('{')) {
      const close = part.lastIndexOf('}');
      if (close === -1) throw new Error(`Unterminated named import "${part}" in: ${statement}`);
      return splitTopLevel(part.slice(1, close)).map((entry) => namedBinding(entry, statement));
    }
    return clauseBinding(part, statement);
  }).flat();
}

// Locates every import statement by span and reports the local bindings it declares.
export function moduleImports(source) {
  const statements = [];
  for (const match of source.matchAll(IMPORT_START)) {
    const start = match.index + 'import'.length;
    const rest = source.slice(start);
    const semicolon = rest.indexOf(';');
    let text;
    if (semicolon !== -1) {
      text = rest.slice(0, semicolon + 1);
    } else {
      // Semicolon-free style: bound the statement at the end of its module specifier.
      const specifiers = [...rest.matchAll(/['"][^'"\n]*['"]/g)];
      if (specifiers.length === 0) throw new Error(`Cannot find the module specifier of the import at offset ${match.index}.`);
      text = rest.slice(0, specifiers[specifiers.length - 1].index + specifiers[specifiers.length - 1][0].length);
    }
    const bindings = classifyImport(text);
    if (bindings.length === 0 && !/^\s*['"]/.test(text)) {
      throw new Error(`Import at offset ${match.index} declared no recognisable binding: ${text}`);
    }
    statements.push({ start: match.index, end: start + text.length, bindings });
  }
  return statements;
}

export function importedBindings(source) {
  return moduleImports(source).flatMap((statement) => statement.bindings);
}

export function stripModuleSyntax(source) {
  let body = source;
  for (const statement of moduleImports(source).sort((left, right) => right.start - left.start)) {
    body = body.slice(0, statement.start) + body.slice(statement.end).replace(/^\r?\n/, '');
  }
  if (/^[ \t]*export\s+default\b/m.test(body)) {
    throw new Error('A module uses "export default", which the standalone bundle cannot express.');
  }
  return body
    .replace(/\bexport\s+(?=(?:async\s+)?function\b|class\b|const\b|let\b|var\b)/g, '')
    .replace(/^export\s*\{[^;]+;\s*$/gm, '');
}

export function assertNoResidualModuleSyntax(body, label) {
  const residual = /^[ \t]*(?:import|export)\b/m.exec(body);
  if (residual) {
    throw new Error(`${label} still contains module syntax after stripping: ${JSON.stringify(residual[0].trim())}`);
  }
}

export function assertFactoryWired(bundle, factory, source, label) {
  const header = new RegExp(`${factory}\\s*=\\s*\\(\\(([^)]*)\\)\\s*=>`).exec(bundle);
  if (!header) throw new Error(`standalone bundle has no ${factory} factory to receive ${label} imports.`);
  const provided = new Set(header[1].split(',').map((name) => name.trim()).filter(Boolean));
  const missing = importedBindings(source).filter((name) => !provided.has(name));
  if (missing.length > 0) {
    throw new Error(`standalone bundle does not provide ${label} import(s): ${missing.join(', ')}. Add them to the ${factory} factory parameters and arguments.`);
  }
}

export function inlineOrThrow(source, needle, replacement, label) {
  if (!source.includes(needle)) {
    throw new Error(`index.html no longer contains ${label}; the standalone build would not be self-contained.`);
  }
  return source.replace(needle, replacement);
}
