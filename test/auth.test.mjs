import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createCacheAuthorizer, createSessionManager } from '../lib/auth.mjs';
import { createStateStore, hashToken } from '../lib/state.mjs';
import { migrateEnvironmentTokens } from '../lib/migrate.mjs';

test('developer tokens can write and revocation takes effect immediately', async () => {
  const state = await createStateStore(await mkdtemp(join(tmpdir(), 'nx-cache-auth-')));
  await state.update((data) => data.tokens.push({ id: 'one', label: 'Laptop', hash: hashToken('developer-token') }));
  const authorize = createCacheAuthorizer({ state });
  assert.deepEqual(await authorize('developer-token'), { writable: true, kind: 'read-write', tokenId: 'one' });
  await state.update((data) => { data.tokens[0].revokedAt = new Date().toISOString(); });
  assert.equal(await authorize('developer-token'), null);
});

test('migrates existing environment credentials exactly once into managed tokens', async () => {
  const state = await createStateStore(await mkdtemp(join(tmpdir(), 'nx-cache-migrate-')));
  assert.equal(await migrateEnvironmentTokens(state, 'old-rw', 'old-ro'), true);
  assert.equal(await migrateEnvironmentTokens(state, 'replacement-rw', 'replacement-ro'), false);
  const authorize = createCacheAuthorizer({ state });
  assert.equal((await authorize('old-rw')).writable, true);
  assert.equal((await authorize('old-ro')).writable, false);
  assert.equal(await authorize('replacement-rw'), null);
});

test('session signatures and expiration are checked', () => {
  const sessions = createSessionManager('test-secret');
  assert.equal(sessions.verify(sessions.create('admin@example.test')).email, 'admin@example.test');
  assert.equal(sessions.verify('tampered.value'), null);
});
