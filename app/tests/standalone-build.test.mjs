import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  assertFactoryWired,
  assertNoResidualModuleSyntax,
  importedBindings,
  inlineOrThrow,
  moduleImports,
  stripModuleSyntax
} from '../scripts/standalone-guard.mjs';

const read = (name) => readFile(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');
const [buildSource, coreSource, parserSource, rendererSource, appSource] = await Promise.all([
  read('scripts/build-standalone.mjs'),
  read('graph-core.js'),
  read('codebase-parser.js'),
  read('renderer.js'),
  read('app.js')
]);

test('import scanning reports the local binding for every standard import form', () => {
  const cases = [
    ["import { a as b } from 'x';", ['b']],
    ["import { a, b as c } from 'x';", ['a', 'c']],
    ["import * as ns from 'x';", ['ns']],
    ["import d, * as ns from 'x';", ['d', 'ns']],
    ["import d, { a as b } from 'x';", ['d', 'b']],
    ["import d from 'x';", ['d']],
    ["import 'x';", []],
    ['import{a}from\'x\';', ['a']],
    ['import { a /* note */ } from \'x\';', ['a']],
    ["import {\n  a,\n  b as c\n} from 'x';", ['a', 'c']],
    ["import a from 'x';\nimport { b } from 'y';", ['a', 'b']],
    ["import { default as A } from 'x';", ['A']],
    ["import { 'a-b' as c } from 'x';", ['c']],
    ["import * as ns from 'x'", ['ns']]
  ];
  for (const [source, expected] of cases) {
    assert.deepEqual(importedBindings(source), expected, `bindings for ${JSON.stringify(source)}`);
  }
});

test('an aliased import requires the local name in the bundle, not the imported name', () => {
  const source = "import { computeLayout as layout } from './graph-core.js';\nlayout();";
  assert.deepEqual(importedBindings(source), ['layout']);
  assert.doesNotThrow(() => assertFactoryWired('const KGX = ((layout) => {\n})();', 'KGX', source, 'fixture'));
  assert.throws(
    () => assertFactoryWired('const KGX = ((computeLayout) => {\n})();', 'KGX', source, 'fixture'),
    /does not provide fixture import\(s\): layout/,
    'a factory exposing only the imported name leaves `layout` unresolved in the bundle'
  );
});

test('the guard refuses import forms it cannot classify instead of skipping them', () => {
  for (const source of [
    "import type { A } from 'x';",
    "import { a b } from 'x';",
    "import { a as } from 'x';",
    "import * from 'x';"
  ]) {
    assert.throws(() => importedBindings(source), /Unsupported/, `expected ${source} to be refused`);
  }
});

test('a bundle missing a namespace or unspaced import binding is rejected', () => {
  const bundle = 'const KGX = ((somethingElse) => {\n})();';
  for (const source of [
    "import * as ns from 'x';\nconsole.log(ns);",
    "import d, * as ns from 'x';\nconsole.log(d, ns);",
    "import{a}from'x';\nconsole.log(a);"
  ]) {
    assert.throws(() => assertFactoryWired(bundle, 'KGX', source, 'fixture'), /does not provide fixture import\(s\)/);
  }
});

test('a missing factory or drifted parameter list is reported', () => {
  assert.throws(() => assertFactoryWired('const Other = ((a) => {\n})();', 'KGX', "import { a } from 'x';", 'fixture'), /has no KGX factory/);
  assert.throws(() => assertFactoryWired('const KGX = ((a) => {\n})();', 'KGX', "import { a } from 'x';\nimport { b } from 'y';", 'fixture'), /import\(s\): b/);
});

test('stripping removes whole import statements and refuses unrepresentable exports', () => {
  assert.equal(stripModuleSyntax("import{a}from'x';\nconst a = 1;"), 'const a = 1;');
  assert.equal(stripModuleSyntax("import * as ns from 'x';\nconst a = 1;"), 'const a = 1;');
  assert.equal(stripModuleSyntax("import { a } from 'x';\nconst a = 1;"), 'const a = 1;');
  assert.equal(stripModuleSyntax('export function f() {}\nexport const g = 1;'), 'function f() {}\nconst g = 1;');
  assert.throws(() => stripModuleSyntax('export default 1;'), /export default/);
});

test('residual module syntax is flagged rather than shipped', () => {
  assert.doesNotThrow(() => assertNoResidualModuleSyntax('const a = 1;\nfunction f() { return 2; }', 'clean body'));
  assert.throws(() => assertNoResidualModuleSyntax("const a = 1;\nimport x from 'y';", 'fixture'), /still contains module syntax/);
  assert.throws(() => assertNoResidualModuleSyntax('const a = 1;\nexport class B {}', 'fixture'), /still contains module syntax/);
});

test('import spans are reported so the stripper and the guard agree', () => {
  const [statement] = moduleImports("import { a } from 'x';\nconst a = 1;");
  assert.equal(statement.bindings.join(','), 'a');
  assert.equal("import { a } from 'x';".slice(statement.start, statement.end), "import { a } from 'x';");
});

test('index.html inlining fails loudly when the expected tag is gone', () => {
  assert.equal(inlineOrThrow('a<link rel="stylesheet" href="./styles.css">b', '<link rel="stylesheet" href="./styles.css">', 'X', 'the stylesheet link'), 'aXb');
  assert.throws(() => inlineOrThrow('<html></html>', '<link rel="stylesheet" href="./styles.css">', 'X', 'the stylesheet link'), /no longer contains the stylesheet link/);
});

test('the shipped modules are fully wired and free of residual module syntax', () => {
  for (const [name, source] of [['graph-core.js', coreSource], ['codebase-parser.js', parserSource], ['renderer.js', rendererSource], ['app.js', appSource]]) {
    assert.doesNotThrow(() => assertNoResidualModuleSyntax(stripModuleSyntax(source), name), `${name} must strip cleanly`);
  }
  const factoryArgs = (pattern) => pattern.exec(buildSource)[1].split(',').map((name) => name.trim()).filter(Boolean);
  const rendererFactory = factoryArgs(/const KGRenderer = \(\(([^)]*)\)/);
  for (const binding of importedBindings(rendererSource)) {
    assert.ok(rendererFactory.includes(binding), `${binding} is imported by renderer.js but missing from the KGRenderer factory`);
  }
  assert.deepEqual([...importedBindings(appSource)].sort(), factoryArgs(/const KGApp = \(\(([^)]*)\)/).sort(), 'the KGApp factory arguments must match app.js imports exactly');
});
