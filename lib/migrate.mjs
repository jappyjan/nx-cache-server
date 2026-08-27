import { randomUUID } from 'node:crypto';
import { hashToken } from './state.mjs';

export async function migrateEnvironmentTokens(state, rw, ro) {
  return state.update((data) => {
    if (data.tokenMigrationComplete) return false;
    const add = (label, token, permission) => {
      if (!token || data.tokens.some((item) => item.hash === hashToken(token))) return;
      data.tokens.push({ id: randomUUID(), label, prefix: 'migrated', hash: hashToken(token), permission, createdBy: 'startup migration', createdAt: new Date().toISOString() });
    };
    add('Migrated CI read/write token', rw, 'rw');
    add('Migrated CI read-only token', ro, 'ro');
    data.tokenMigrationComplete = true;
    return true;
  });
}
