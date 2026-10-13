import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const files = [];
function collect(directory) {
  for (const name of readdirSync(directory)) {
    if (name === 'node_modules' || name === '.git') continue;
    const path = join(directory, name);
    const stats = statSync(path);
    if (stats.isDirectory()) collect(path);
    else if (/\.(?:js|mjs)$/.test(name)) files.push(path);
  }
}
collect(root);
const failures = [];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) failures.push(`${relative(root, file)}\n${result.stderr || result.stdout}`);
}
if (failures.length > 0) {
  process.stderr.write(failures.join('\n'));
  process.exit(1);
}
process.stdout.write(`PASS: syntax checked ${files.length} JavaScript files\n`);
