import assert from 'node:assert/strict';
import { access, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createCache } from '../lib/cache.mjs';
import { createStateStore } from '../lib/state.mjs';

test('lists cache entries in 15-entry pages and clears only cache artifacts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nx-cache-'));
  const state = await createStateStore(directory);
  const cache = createCache(directory, state);

  await state.update((data) => {
    for (let index = 0; index < 16; index += 1) {
      const hash = `hash-${index}`;
      data.entries[hash] = { hash, size: index, createdAt: new Date(index).toISOString(), lastAccessedAt: new Date(index).toISOString(), accessCount: index };
    }
  });

  const first = await cache.list(1);
  const second = await cache.list(2);
  assert.equal(first.items.length, 15);
  assert.equal(first.total, 16);
  assert.equal(first.totalPages, 2);
  assert.equal(second.items.length, 1);

  await writeFile(join(directory, 'legacy-hash'), 'legacy cache data');
  assert.equal(await cache.clear(), 17);
  assert.equal((await cache.list()).total, 0);
  assert.deepEqual((await state.load()).entries, {});
  await assert.rejects(access(join(directory, 'legacy-hash')));
});

test('prune ignores administration state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nx-cache-'));
  const state = await createStateStore(directory);
  const cache = createCache(directory, state);
  await state.update((data) => data.admins.push('admin@example.test'));

  await cache.prune(Date.now());

  assert.deepEqual((await state.load()).admins, ['admin@example.test']);
});
