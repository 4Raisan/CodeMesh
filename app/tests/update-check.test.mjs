import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = (await readFile(new URL('../app.js', import.meta.url), 'utf8')).split('// Manual update checks never include imported project data.')[1];
async function check(tag, fail = false) {
  let click;
  const button = { addEventListener: (_name, handler) => { click = handler; } };
  const link = { hidden: false };
  vm.runInNewContext(source, {
    document: { getElementById: id => id === 'check-updates' ? button : link },
    window: { setTimeout: () => 1, clearTimeout: () => {} },
    AbortController, showToast: () => {},
    fetch: async () => { if (fail) throw new Error('offline'); return { ok: true, json: async () => ({ tag_name: tag }) }; }
  });
  await click();
  return { button, link };
}
for (const tag of ['v0.2.2', 'v0.1.0']) test(`no update link for ${tag}`, async () => {
  const { button, link } = await check(tag);
  assert.equal(link.hidden, true);
  assert.equal(button.textContent, 'Up to date');
});
test('newer release exposes the update action', async () => {
  const { link, button } = await check('v0.3.0');
  assert.equal(link.hidden, false);
  assert.equal(button.disabled, false);
});
test('failed checks clear a previously visible update action', async () => {
  const { link } = await check('', true);
  assert.equal(link.hidden, true);
});
test('invalid versions do not expose an update action', async () => {
  const { link } = await check('bad-version');
  assert.equal(link.hidden, true);
});
