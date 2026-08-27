import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createStateStore, hashToken } from '../lib/state.mjs';

test('initializes and atomically persists administration state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nx-cache-state-'));
  const store = await createStateStore(directory);

  await store.update((state) => state.admins.push('admin@example.test'));

  const reloaded = await createStateStore(directory);
  assert.deepEqual((await reloaded.load()).admins, ['admin@example.test']);
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'admin-state.json'), 'utf8')).tokens, []);
});

test('hashToken is deterministic and does not retain plaintext', () => {
  assert.equal(hashToken('secret'), hashToken('secret'));
  assert.notEqual(hashToken('secret'), 'secret');
});
